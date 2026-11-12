const test = require('node:test'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { front, service, seed, memoryDb, load } = require('./helpers.cjs')
const FILE = 'cloud://test.bucket/ai-chat/user-a/12345678-image.jpg'
const JPEG = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])
const ENV = { LLM_API_URL: 'https://model.example/v1', LLM_API_KEY: 'test', LLM_MODEL: 'text', LLM_VISION_MODEL: 'vision' }
const EVENT = { consent: true, imageConsent: true, images: [FILE], messages: [{ role: 'user', content: '这张照片有什么需要留意的？' }] }
function backend(options = {}) {
  const db = memoryDb(seed()), state = { downloads: [], deletes: [], bodies: [] }
  const cloud = { init() {}, DYNAMIC_CURRENT_ENV: 'test', database: () => db, getWXContext: () => ({ OPENID: 'user-a' }),
    async downloadFile({ fileID }) { state.downloads.push(fileID); if (options.downloadError) throw new Error('private sdk error'); return { fileContent: options.bytes || JPEG } },
    async deleteFile({ fileList }) { state.deletes.push(...fileList); if (options.deleteError) throw new Error('delete failed'); return { fileList } } }
  const https = { request(url, headers, callback) {
    const req = new EventEmitter(); req.destroy = () => req.emit('close')
    req.end = body => { state.bodies.push(JSON.parse(body)); queueMicrotask(() => {
      const res = new EventEmitter(); res.statusCode = options.status || 200; callback(res)
      res.emit('data', JSON.stringify({ choices: [{ message: { content: '照片信息有限，建议结合日常记录观察。' } }] })); res.emit('end'); req.emit('close')
    }) }; return req
  } }
  return { ...service('aiChat', db, { env: options.env || ENV, substitutions: { 'wx-server-sdk': cloud, https } }), state }
}
async function frontend(options = {}) {
  const sent = [], deleted = []
  const f = front('ai-chat', { storage: options.storage || { slownote_ai_consent_v2: true }, callFunction: async arg => {
    if (arg.name === 'aiSettings') return { result: options.settingsResponse || { code: 0, showThinking: true } }
    sent.push(arg); if (options.callError) throw Error('network'); return { result: options.response || { code: 0, configured: true, text: '已分析照片。' } }
  } })
  f.app.globalData.openid = 'user-a'
  f.wx.cloud.uploadFile = async arg => { if (options.uploadError) throw Error('private upload error'); return { fileID: 'cloud://test.bucket/' + arg.cloudPath } }
  f.wx.cloud.deleteFile = async ({ fileList }) => { deleted.push(...fileList) }
  f.wx.chooseMedia = arg => arg.success({ tempFiles: [{ tempFilePath: '/tmp/photo.jpg' }] })
  f.wx.compressImage = arg => arg.success({ tempFilePath: arg.src })
  f.wx.getImageInfo = arg => arg.success({ type: options.type || 'jpeg', width: 100, height: 100 })
  f.wx.getFileSystemManager = () => ({ getFileInfo: arg => arg.success({ size: options.size || 100 }) })
  await f.page.onLoad()
  if (!options.deferSettings) await f.page.refreshAISettings()
  return { ...f, sent, deleted }
}
test('vision uses current-turn data URL and dedicated model, with no cloud identity in prompt', async () => {
  const b = backend(), result = await b.main(EVENT)
  assert.equal(result.code, 0); assert.equal(result.configured, true)
  assert.deepEqual(b.state.downloads, [FILE]); assert.deepEqual(b.state.deletes, [FILE])
  const body = b.state.bodies[0], last = body.messages.at(-1)
  assert.equal(body.model, 'vision'); assert.equal(last.content[0].type, 'text')
  assert.equal(last.content[1].image_url.url, 'data:image/jpeg;base64,' + JPEG.toString('base64'))
  assert(!JSON.stringify(body).includes('cloud://')); assert(!JSON.stringify(body).includes('user-a'))
})
test('thinking preference overrides environment and only strict booleans are accepted', async () => {
  const env = { ...ENV, LLM_MODEL: 'deepseek-flash' }
  const enabled = backend({ env: { ...env, LLM_THINKING: 'disabled' } })
  await enabled.main({ ...EVENT, images: [], thinking: true })
  assert.deepEqual(enabled.state.bodies[0].thinking, { type: 'enabled' })

  const disabled = backend({ env: { ...env, LLM_THINKING: 'enabled' } })
  await disabled.main({ ...EVENT, images: [], thinking: false })
  assert.deepEqual(disabled.state.bodies[0].thinking, { type: 'disabled' })

  const legacy = backend({ env })
  await legacy.main({ ...EVENT, images: [], thinking: 'true' })
  assert.deepEqual(legacy.state.bodies[0].thinking, { type: 'disabled' })
})
test('rejects unconsented, foreign, remote, traversal, duplicate and excessive images before reading', async () => {
  const variants = [ { consent: false }, { imageConsent: false },
    { images: [FILE.replace('user-a', 'user-b')] }, { images: ['https://example.com/image.jpg'] },
    { images: [FILE.replace('12345678-image.jpg', '../12345678-image.jpg')] },
    { images: ['cloud://test.bucket/ai-chat/user-a/short.jpg'] },
    { images: [FILE, FILE] }, { images: [FILE, FILE, FILE, FILE] }, { images: 'bad' } ]
  for (const variant of variants) { const b = backend(); assert.equal((await b.main({ ...EVENT, ...variant })).code, 400); assert.equal(b.state.downloads.length, 0); assert.equal(b.state.bodies.length, 0); assert.equal(b.state.deletes.length, 0) }
})
test('invalid image bytes and oversize payloads never reach the model and get cleaned', async () => {
  for (const [bytes, code] of [[Buffer.from('not actually a photo'), 400], [Buffer.alloc(2 * 1024 * 1024 + 1), 413]]) {
    const b = backend({ bytes }); assert.equal((await b.main(EVENT)).code, code); assert.equal(b.state.bodies.length, 0); assert.deepEqual(b.state.deletes, [FILE])
  }
})
test('downloads, model failure, missing vision configuration and cleanup failure are controlled', async () => {
  const broken = backend({ downloadError: true }); assert.equal((await broken.main(EVENT)).code, 503); assert.deepEqual(broken.state.deletes, [FILE])
  const unavailable = backend({ status: 500 }); assert.equal((await unavailable.main(EVENT)).unavailable, true); assert.deepEqual(unavailable.state.deletes, [FILE])
  const missing = backend({ env: { ...ENV, LLM_VISION_MODEL: '' } }); assert.equal((await missing.main(EVENT)).configured, false); assert.equal(missing.state.downloads.length, 0); assert.deepEqual(missing.state.deletes, [FILE])
  const cleanup = backend({ deleteError: true }); assert.equal((await cleanup.main(EVENT)).configured, true)
})
test('text requests still use the text model and do not read or delete photos', async () => {
  const b = backend(); const r = await b.main({ ...EVENT, images: [] })
  assert.equal(r.configured, true); assert.equal(b.state.bodies[0].model, 'text'); assert.equal(typeof b.state.bodies[0].messages.at(-1).content, 'string'); assert.equal(b.state.downloads.length, 0); assert.equal(b.state.deletes.length, 0)
})
test('PNG and WebP signatures are encoded using the actual content type', async () => {
  for (const [bytes, type] of [[Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]), 'png'], [Buffer.from('RIFF0000WEBP0000'), 'webp']]) {
    const b = backend({ bytes }); assert.equal((await b.main(EVENT)).code, 0); assert(b.state.bodies[0].messages.at(-1).content[1].image_url.url.startsWith('data:image/' + type + ';base64,'))
  }
})
test('choosing photos remains local and preview/remove do not send requests', async () => {
  const f = await frontend(); let preview
  f.wx.previewImage = arg => { preview = arg }
  await f.page.choosePhotos(); assert.equal(f.page.data.images.length, 1); assert.equal(f.sent.length, 0); assert.equal(f.deleted.length, 0)
  f.page.previewPhoto({ currentTarget: { dataset: { src: '/tmp/photo.jpg' } } }); assert.equal(preview.current, '/tmp/photo.jpg')
  f.page.removePhoto({ currentTarget: { dataset: { id: f.page.data.images[0].id } } }); assert.equal(f.page.data.images.length, 0)
})
test('thinking preference persists manual changes while photo selection only enables it in memory', async () => {
  const f = await frontend()
  assert.equal(f.page.data.thinking, false)
  f.page.onThinkingChange({ detail: { value: true } }); assert.equal(f.page.data.thinking, true); assert.equal(f.storage['ai.thinking'], true)
  f.page.onThinkingChange({ detail: { value: false } }); assert.equal(f.page.data.thinking, false); assert.equal(f.storage['ai.thinking'], false)
  await f.page.choosePhotos(); assert.equal(f.page.data.thinking, true); assert.equal(f.storage['ai.thinking'], false)
  f.page.removePhoto({ currentTarget: { dataset: { id: f.page.data.images[0].id } } })
  assert.equal(f.page.data.thinking, true)

  const fresh = await frontend(); await fresh.page.choosePhotos()
  assert.equal(fresh.page.data.thinking, true); assert.equal(fresh.storage['ai.thinking'], undefined)
})
test('thinking toggle stays hidden until settings confirm it is enabled', async () => {
  const f = await frontend({ deferSettings: true, storage: { 'ai.settings.cache.v1': { openid: 'user-a', value: { showThinking: true } } }, settingsResponse: { code: 0, showThinking: false } })
  assert.equal(f.page.data.showThinking, false)
  assert.equal(f.page.data.thinkingSettingsReady, false)
  const template = require('fs').readFileSync('miniprogram/pages/ai-chat/index.wxml', 'utf8')
  assert.match(template, /wx:if="\{\{thinkingSettingsReady && showThinking\}\}"/)
  await f.page.refreshAISettings()
  assert.equal(f.page.data.showThinking, false)
  assert.equal(f.page.data.thinkingSettingsReady, true)
})
test('image-only sends upload after consent and release temporary files after the response', async () => {
  const f = await frontend(); f.page._startTyping = async () => {}; await f.page.choosePhotos(); await f.page.send()
  assert.equal(f.sent.length, 1); const event = f.sent[0].data
  assert.equal(event.images.length, 1); assert.equal(event.imageConsent, true); assert.match(event.messages.at(-1).content, /分析这张照片/)
  assert.equal(event.thinking, true)
  assert.equal(f.page.data.messages.length, 2); assert.equal(f.page.data.images.length, 0); assert.equal(f.deleted.length, 1); assert.equal(f.page.data.sending, false)
})
test('legacy consent storage does not affect the current image send flow', async () => {
  const f = await frontend({ storage: { slownote_ai_consent: true } })
  assert.equal(Object.hasOwn(f.page.data, 'consent'), false)
  f.page._startTyping = async () => {}
  await f.page.choosePhotos(); await f.page.send()
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].data.images.length, 1)
  assert.equal(f.page.data.images.length, 0)
})
test('network, upload and model failures restore the complete draft and retry excludes failed turn', async () => {
  for (const options of [{ callError: true }, { uploadError: true }, { response: { code: 0, configured: true, unavailable: true } }, { response: { code: 0, configured: false } }]) {
    const f = await frontend(options); await f.page.choosePhotos(); f.page.setData({ question: '看看照片' }); await f.page.send()
    assert.equal(f.page.data.question, '看看照片'); assert.equal(f.page.data.images.length, 1); assert.equal(f.page.data.messages[0].failed, true); assert.equal(f.page.data.sending, false)
    f.wx.cloud.uploadFile = async () => ({ fileID: FILE }); f.wx.cloud.callFunction = async arg => { assert.equal(arg.data.messages.length, 1); return { result: { code: 0, configured: true, text: '已分析' } } }; await f.page.send(); assert.equal(f.page.data.messages.at(-1).content, '已分析')
  }
})
test('selection cancels cleanly and validates byte size, format and maximum count', async () => {
  const cancelled = await frontend(); cancelled.wx.chooseMedia = arg => arg.fail({ errMsg: 'chooseMedia:fail cancel' }); await cancelled.page.choosePhotos(); assert.equal(cancelled.page.data.error, ''); assert.equal(cancelled.page.data.selecting, false)
  for (const options of [{ size: 3 * 1024 * 1024 }, { type: 'gif' }]) { const f = await frontend(options); await f.page.choosePhotos(); assert.equal(f.page.data.images.length, 0); assert(f.page.data.error) }
  const f = await frontend(); for (let i = 0; i < 5; i++) await f.page.choosePhotos(); assert.equal(f.page.data.images.length, 3)
  const png = await frontend({ type: 'PNG' }); png.wx.compressImage = arg => arg.fail({ errMsg: 'unsupported compression' }); await png.page.choosePhotos(); assert.equal(png.page.data.images[0].ext, 'png')
})
test('partial uploads and unload are cleaned without sending a model request', async () => {
  const f = await frontend(); await f.page.choosePhotos(); await f.page.choosePhotos(); let count = 0
  f.wx.cloud.uploadFile = async () => { if (++count === 2) throw Error('network'); return { fileID: FILE } }; await f.page.send()
  assert.equal(f.sent.length, 0); assert.equal(f.deleted.length, 1); assert.equal(f.page.data.images.length, 2)
  const g = await frontend(); await g.page.choosePhotos(); g.wx.cloud.uploadFile = async () => { g.page.onUnload(); return { fileID: FILE } }; await g.page.send(); assert.equal(g.sent.length, 0); assert.equal(g.deleted.length, 1)
})
test('duplicate sends, message quoting and selection, and keyboard transitions remain bounded', async () => {
  const f = await frontend(); f.page.setData({ question: '帮我看看' }); await Promise.all([f.page.send(), f.page.send()]); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].data.thinking, false)
  f.page.setData({ messages: [{ id: 'user-1', role: 'user', content: '怎么判断宝宝饿了？' }, { id: 'assistant-1', role: 'assistant', content: '可以观察宝宝的觅食信号。' }] })
  f.page.setData({ messageViews: f.page._messageViews(f.page.data.messages), activeMessageIndex: 0 })
  f.page.quoteMessage({ currentTarget: { dataset: { i: 1 } } }); assert.equal(f.page.data.quote.text, '可以观察宝宝的觅食信号。')
  f.page.setData({ activeMessageIndex: 0 }); f.page.beginPickMode(); assert.equal(f.page.data.pickedCount, 1)
  f.page.togglePickedPair(1); assert.equal(f.page.data.pickedCount, 0); f.page.cancelPickMode()
  f.wx.createSelectorQuery = () => ({ in() { return this }, select() { return this }, boundingClientRect(callback) { callback({ height: 100 }); return this }, exec() {} })
  f.page.onKeyboardHeight({ detail: { height: 320 } }); assert.equal(f.page.data.keyboardHeight, 320); f.page.onKeyboardHeight({ detail: { height: 0 } }); assert.equal(f.page.data.keyboardHeight, 0)
})
