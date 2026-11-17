// AI 对话会话存储：云集合 ai_sessions，按 openid 隔离；失败静默降级，不阻断对话主流程。
const DB = 'ai_sessions'
const MAX_TITLE = 14
const MAX_CONTENT = 8000
const MAX_REASONING = 4000
const writes = new Map()

// An older autosave must settle before a newer explicit delete can persist.
function writeSession(openid, sessionId, write) {
  const key = JSON.stringify([openid, sessionId]), previous = writes.get(key)
  const pending = (previous || Promise.resolve()).catch(() => {}).then(write)
  writes.set(key, pending)
  const clear = () => { if (writes.get(key) === pending) writes.delete(key) }
  pending.then(clear, clear)
  return pending
}

function tidy(messages) {
  return (messages || []).map(m => ({
    id: m.id,
    role: m.role,
    content: (m.content || '').slice(0, MAX_CONTENT),
    // Snapshots are capped by the statistics service's shared DETAILS_LIMIT before they reach the client.
    snapshot: typeof m.snapshot === 'string' ? m.snapshot : '',
    images: (m.images || []).map(p => p.fileID || p.path).filter(Boolean),
    status: m.role === 'assistant' ? (m.status || '') : '',
    reasoning: (m.reasoning || '').slice(0, MAX_REASONING),
    thinkingMs: m.thinkingMs || 0,
    thinking: !!m.thinking,
    failed: !!m.failed,
    quoted: m.quoted && typeof m.quoted === 'object' ? {
      role: m.quoted.role === 'assistant' ? 'assistant' : 'user',
      text: Array.from(String(m.quoted.text || '')).slice(0, 200).join('')
    } : null
  }))
}
function titleOf(messages) {
  const first = (messages.find(m => m.role === 'user') || {}).content || ''
  return first.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE)
}
function byId(openid, sessionId) {
  return wx.cloud.database().collection(DB).where({ openid, sessionId })
}
async function saveSession(openid, sessionId, messages, strict = false) {
  try {
    const babyId = getApp().globalData.activeBabyId || ''
    const record = { title: titleOf(messages), messages: tidy(messages), babyId, updatedAt: Date.now() }
    await writeSession(openid, sessionId, async () => {
      const existing = await byId(openid, sessionId).limit(1).get()
      if (existing.data.length) await wx.cloud.database().collection(DB).doc(existing.data[0]._id).update({ data: record })
      else await wx.cloud.database().collection(DB).add({ data: { openid, sessionId, ...record, createdAt: Date.now() } })
    })
  } catch (error) { if (strict) throw error /* 自动保存仍静默，显式删除需要回滚。 */ }
}
async function listSessions(openid) {
  const result = await wx.cloud.database().collection(DB)
    .where({ openid })
    .orderBy('updatedAt', 'desc')
    .limit(50)
    .field({ sessionId: true, title: true, updatedAt: true, babyId: true })
    .get()
  return result.data
}
async function getSession(openid, sessionId) {
  const res = await byId(openid, sessionId).limit(1).get()
  return res.data[0] || null
}
async function removeSession(openid, sessionId) {
  return writeSession(openid, sessionId, async () => {
    const res = await byId(openid, sessionId).limit(1).get()
    if (res.data.length) await wx.cloud.database().collection(DB).doc(res.data[0]._id).remove()
  })
}
module.exports = { saveSession, listSessions, getSession, removeSession }
