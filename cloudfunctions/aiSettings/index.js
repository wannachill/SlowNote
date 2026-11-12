const { endpoint, hash, fail, readDoc } = require('./lib/runtime')
const { SAFETY, VISION_SAFETY, HISTORY_NOTE, DEFAULTS, LIMITS, PROMPT_KEYS, settingsOf, customOf, readStored } = require('./lib/ai-settings')

function response(stored) {
  return {
    code: 0,
    // 云端版本标记：排查“部署没生效”时，看到它就知道跑的是这份代码。
    build: 'ai-settings-2',
    ...settingsOf(stored),
    defaults: DEFAULTS,
    // 配置页展示全部锁定条文：通用 + 带图 + 纯文本对话，三段都会实际参与拼接。
    safety: [SAFETY, VISION_SAFETY, HISTORY_NOTE].join('\n'),
    limits: LIMITS,
    custom: customOf(stored)
  }
}

// doc(id).set() 在集合不存在时不会自动建表，直接抛 -502005。
// 不翻译这个错误，用户只会看到笼统的“服务不可用”，很难联想到是集合没建。
async function save(db, id, data) {
  try {
    await db.collection('ai_settings').doc(id).set({ data })
  } catch (error) {
    const missing = error && (error.errCode === -502005 || /not exist|not found/i.test(error.errMsg || error.message || ''))
    if (missing) fail(501, 'COLLECTION_MISSING')
    throw error
  }
}

// 不做“多余字段一律拒绝”的校验：wx.cloud.callFunction 会向 event 注入 userInfo 等平台字段，
// 屏蔽名单永远补不全，一旦漏一个，get/save/reset 会全部被判非法（400 INVALID_SETTINGS）。
// 真正的安全性来自下面按白名单显式重建 stored，而不是拒绝未知字段。
exports.main = endpoint(async ({ event, db, openid }) => {
  if (event.action === 'get') {
    return response(await readStored(db, hash(openid)))
  }

  if (event.action === 'save') {
    // 只校验会被写入的三个字段，其余入参一概忽略。
    const prompts = event.prompts
    if (!prompts || typeof prompts !== 'object' || Array.isArray(prompts) || typeof event.showThinking !== 'boolean') {
      fail(400, 'INVALID_SETTINGS')
    }
    let total = 0
    for (const key of PROMPT_KEYS) {
      const value = prompts[key]
      if (typeof value !== 'string') fail(400, 'INVALID_PROMPT')
      if (value.length > LIMITS[key]) fail(400, 'PROMPT_TOO_LONG')
      total += value.length
    }
    if (total > 4000) fail(400, 'PROMPTS_TOO_LONG')
    const stored = {
      openid,
      showThinking: event.showThinking,
      prompts: Object.fromEntries(PROMPT_KEYS.map(key => [key, prompts[key]])),
      updated_at: db.serverDate()
    }
    await save(db, hash(openid), stored)
    return response(stored)
  }

  if (event.action === 'reset') {
    const id = hash(openid)
    const stored = await readDoc(db, 'ai_settings', id)
    if (stored) await db.collection('ai_settings').doc(id).remove()
    return response(null)
  }

  fail(400, 'INVALID_ACTION')
})
