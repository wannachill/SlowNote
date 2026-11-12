const { endpoint, hash, fail, createOnce, access } = require('./lib/runtime')
const { ask, messages, DISCLAIMER, redact } = require('./lib/llm')
const { compose, loadSettings } = require('./lib/ai-settings')
const photos = require('./images')
const monthAge = birthday => {
  const b = new Date(`${birthday}T00:00:00+08:00`)
  if (Number.isNaN(b.getTime())) return null
  const n = new Date()
  let months = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth())
  if (n.getDate() < b.getDate()) months--
  return months
}
exports.main = endpoint(async ({ event, cloud, db, openid }) => {
  if (event.consent !== true) fail(400, 'CONSENT_REQUIRED')
  const fileIDs = photos.ownedImages(event.images, openid)
  if (fileIDs.length && event.imageConsent !== true) fail(400, 'IMAGE_CONSENT_REQUIRED')
  try {
    if (!Array.isArray(event.messages) || event.messages.length > 20 || event.messages.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 4000)) fail(400, 'INVALID_MESSAGES')
    if (!event.messages.length || event.messages[event.messages.length - 1].role !== 'user' || !event.messages[event.messages.length - 1].content.trim()) fail(400, 'EMPTY_QUESTION')
    if (typeof event.snapshot === 'string' && event.snapshot.length > 2000) fail(400, 'SNAPSHOT_TOO_LONG')
    const context = await access(db, openid)
    const minute = Math.floor(Date.now() / 60000)
    let allowed = false
    for (let slot = 0; slot < 4; slot++) {
      const result = await createOnce(db, 'ai_rate_limits', hash(`${openid}:${minute}:${slot}`), { openid, expires_at: new Date((minute + 2) * 60000), created_at: db.serverDate() })
      if (!result.duplicate) { allowed = true; break }
    }
    if (!allowed) fail(429, 'RATE_LIMITED')
    const [baby, settings] = await Promise.all([
      db.collection('babies').where({ _id: hash(context.ownerKey) }).limit(1).get().then(result => result.data[0]),
      loadSettings(db, hash(openid))
    ])
    const secrets = [openid, baby && baby.nickname, baby && baby.birthday]
    const note = []
    if (baby) {
      const gender = baby.gender === 'female' ? '女宝' : baby.gender === 'male' ? '男宝' : '宝宝'
      const age = baby.birthday ? monthAge(baby.birthday) : null
      note.push(`当前宝宝：${gender}${age !== null ? `，约 ${age} 个月大` : ''}。`)
    }
    if (typeof event.snapshot === 'string' && event.snapshot.trim()) note.push(`用户主动附带的近期记录快照（仅数字统计）：\n${event.snapshot.trim()}`)
    let input = messages(event.messages, secrets)
    if (note.length) input = [{ role: 'user', content: redact(note.join('\n').slice(0, 2500), secrets) }, ...input]
    if (!input.length) fail(400, 'EMPTY_QUESTION')
    if (fileIDs.length) {
      // 不把 fileID / 临时 URL / openid 发送给外部模型，仅传本轮经验证的图片内容。
      if (!process.env.LLM_VISION_MODEL || !process.env.LLM_API_URL || !process.env.LLM_API_KEY) return { code: 0, configured: false, text: '图片分析服务尚未配置。', disclaimer: DISCLAIMER }
      const last = input[input.length - 1]
      last.content = [{ type: 'text', text: last.content }, ...await photos.content(cloud, fileIDs)]
    }
    const thinking = settings.showThinking && event.thinking === true
    const answer = await ask(input, {
      vision: fileIDs.length > 0,
      thinking,
      system: compose(settings.prompts, fileIDs.length ? 'vision' : '')
    })
    const reasoning = redact(answer.reasoning || '', secrets)
    return { code: 0, ...answer, text: redact(answer.text, secrets), reasoning, disclaimer: DISCLAIMER }
  } finally { await photos.cleanup(cloud, fileIDs) }
})
