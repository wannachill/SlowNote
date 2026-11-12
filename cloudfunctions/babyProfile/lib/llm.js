const https = require('https')
const { StringDecoder } = require('string_decoder')
const { MESSAGE_LIMIT, CONTEXT_LIMIT } = require('./record-details')
const { compose } = require('./ai-settings')
const DISCLAIMER = 'AI 生成，仅供参考。涉及宝宝健康异常，请及时咨询医生。'
// 兜底提示词复用唯一来源 compose()：约定都传 system，此处仅防漏传时退化成旧版独立文案。
// 禁止在本文件再写一份默认提示词，否则调整默认值时必然出现分叉。
const SYSTEM = compose({}, '')
const REASONING_TAIL_MARKERS = [
  /(?:^|\s+)final\s+answer[.!:：！。]*$/i,
  /最终答案[.!:：！。]*$/,
  /正式回答[.!:：！。]*$/,
  /现在给出答案[.!:：！。]*$/
]
function cleanReasoningTail(value) {
  let text = String(value || '').trimEnd()
  let changed = true
  while (changed) {
    changed = false
    for (const marker of REASONING_TAIL_MARKERS) {
      const match = marker.exec(text)
      if (!match) continue
      text = text.slice(0, match.index).trimEnd()
      changed = true
      break
    }
  }
  return text
}
function redact(value, secrets = []) {
  let result = String(value || '').replace(/\b1[3-9]\d{9}\b/g, '[电话已隐去]').replace(/\b\d{17}[\dXx]\b/g, '[证件已隐去]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[邮箱已隐去]').replace(/(?:openid|unionid|family_id|baby_id|client_request_id|_id|fileid|created_at|家庭码)\s*[:：=]?\s*[\w./:+-]+/gi, '[标识已隐去]').replace(/\b(?:cloud|wxfile):\/\/[^\s"'，。]+/gi, '[文件标识已隐去]')
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 2) result = result.split(secret).join('[私人信息已隐去]')
  return result
}
function messages(input, secrets = [], reserve = 0) {
  if (!Array.isArray(input) || !input.length) return []
  let used = 0
  const budget = Math.max(0, CONTEXT_LIMIT - Math.max(0, Number(reserve) || 0))
  return input.slice(-10).reverse().filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map(m => ({ role: m.role, content: redact(m.content.slice(0, MESSAGE_LIMIT), secrets) })).filter(m => { used += m.content.length; return used <= budget }).reverse()
}
async function ask(input, options = {}) {
  const startedAt = Date.now()
  // 配置来自云函数环境变量。
  const cfg = options.config || {}
  const apiUrl = cfg.api_url || process.env.LLM_API_URL
  const apiKey = cfg.api_key || process.env.LLM_API_KEY
  const model = options.vision ? (cfg.vision_model || process.env.LLM_VISION_MODEL) : (cfg.model || process.env.LLM_MODEL)
  const temperature = typeof cfg.temperature === 'number' ? cfg.temperature : 0.4
  if (!apiUrl || !apiKey || !model) return { configured: false, text: options.vision ? '小迈暂未接入图片分析服务，请稍后再试。' : '小迈暂未接入问答服务。你可以继续记录，或稍后再来看看；如有健康疑问，请咨询医生。' }
  let url
  try { url = new URL(apiUrl) } catch (error) { return { configured: false, text: '小迈的连接设置尚未完成，请稍后再试。' } }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return { configured: false, text: '小迈的安全连接尚未配置，请稍后再试。' }
  if (!url.pathname.replace(/\/$/, '').endsWith('/chat/completions')) url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions'
  const fallbackSystem = options.vision ? compose({}, 'vision') : SYSTEM
  const system = typeof options.system === 'string' && options.system.trim() ? options.system : fallbackSystem
  const configuredThinking = process.env.LLM_THINKING
  const thinkingType = typeof options.thinking === 'boolean'
    ? (options.thinking ? 'enabled' : 'disabled')
    : configuredThinking === 'disabled' || configuredThinking === 'enabled'
      ? configuredThinking
      : !configuredThinking && model.startsWith('deepseek') ? 'disabled' : ''
  const body = JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...input], max_tokens: thinkingType === 'enabled' ? 2400 : 900, temperature, ...(thinkingType ? { thinking: { type: thinkingType } } : {}) })
  return new Promise(resolve => {
    let settled = false
    const finish = value => { if (!settled) { settled = true; resolve(value) } }
    const fallback = { configured: true, unavailable: true, text: '小迈暂时没有连上，请稍后重试。涉及健康异常时，请及时咨询医生。' }
    const req = https.request(url, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let data = ''
      // 网络分块可能落在中文或 emoji 的 UTF-8 字节中间，必须保留未完成字符到下一块。
      const decoder = new StringDecoder('utf8')
      res.on('data', chunk => {
        data += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        if (data.length > 131072) { finish(fallback); req.destroy() }
      })
      res.on('end', () => {
        data += decoder.end()
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.error('[llm] upstream HTTP error', res.statusCode)
          return finish(fallback)
        }
        try {
          const parsed = JSON.parse(data), choice = parsed.choices[0], message = choice.message
          const text = typeof message.content === 'string' ? message.content.trim() : ''
          const reasoning = typeof message.reasoning_content === 'string'
            ? cleanReasoningTail(message.reasoning_content.slice(0, 4000))
            : ''
          const elapsed = Date.now() - startedAt
          if (thinkingType === 'enabled' && !reasoning) console.warn('[llm] enabled thinking returned no reasoning', { model, finish_reason: choice.finish_reason })
          if (text) finish({ configured: true, text: text.slice(0, 6000), reasoning, elapsed })
          else if (thinkingType === 'enabled' && reasoning) finish({ configured: true, reasoning, text: '（思考完成但未生成正文，请换个问法重试）', elapsed })
          else finish(fallback)
        } catch (error) { console.error('[llm] response parse error', error && error.message); finish(fallback) }
      })
      res.on('error', error => { console.error('[llm] response error', error && error.message); finish(fallback) })
    })
    const timeoutMs = thinkingType === 'enabled' ? 45000 : 18000
    const deadline = setTimeout(() => { finish(fallback); req.destroy() }, timeoutMs)
    req.on('close', () => { clearTimeout(deadline); finish(fallback) })
    req.on('error', error => { console.error('[llm] request error', error && error.message); finish(fallback) })
    req.end(body)
  })
}
module.exports = { DISCLAIMER, SYSTEM, redact, messages, ask }
