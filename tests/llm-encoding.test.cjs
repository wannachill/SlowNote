const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { load } = require('./helpers.cjs')

function client(file, chunks) {
  const https = { request(url, options, callback) {
    const req = new EventEmitter()
    req.destroy = () => req.emit('close')
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter()
      res.statusCode = 200
      callback(res)
      for (const chunk of chunks) res.emit('data', chunk)
      res.emit('end')
      req.emit('close')
    })
    return req
  } }
  return load(file, {}, { https })
}

test('LLM response preserves Chinese and emoji across every UTF-8 chunk boundary', async () => {
  const text = '宝宝是纯母乳、瓶喂还是混合喂养？请留意尿量。🌱'
  const reasoning = '先核对喂养记录，再说明信息不足。'
  const payload = Buffer.from(JSON.stringify({ choices: [{ message: { content: text, reasoning_content: reasoning } }] }))
  const config = { api_url: 'https://example.test', api_key: 'test', model: 'test' }
  for (const file of ['cloudfunctions/_shared/llm.js', 'cloudfunctions/aiChat/lib/llm.js', 'cloudfunctions/aiReport/lib/llm.js']) {
    // 单字节分块确保所有多字节字符都横跨网络块，覆盖正文与思考内容。
    const chunks = Array.from(payload, (_, index) => payload.subarray(index, index + 1))
    const result = await client(file, chunks).ask([{ role: 'user', content: '测试' }], { config, thinking: true })
    assert.equal(result.text, text, file)
    assert.equal(result.reasoning, reasoning, file)
    assert.equal(result.text.includes('\ufffd'), false, file)
  }
})

test('LLM response still accepts complete string chunks and normal question marks', async () => {
  const text = '今天记录完整吗？?'
  const payload = JSON.stringify({ choices: [{ message: { content: text } }] })
  const result = await client('cloudfunctions/_shared/llm.js', [payload]).ask([], {
    config: { api_url: 'https://example.test', api_key: 'test', model: 'test' }
  })
  assert.equal(result.text, text)
})
