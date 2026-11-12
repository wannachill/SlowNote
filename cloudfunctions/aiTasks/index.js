const { endpoint, requestId, hash, fail, createOnce, mutateOnce, readDoc } = require('./lib/runtime')
const { nextRun, REPORT_RANGES, normalizeRange } = require('./lib/schedule')
// 数据类型与常见问题对齐：feeding / excretion / solid 同源于 feeding_records，但可分别选择。
const CATEGORIES = new Set(['feeding', 'excretion', 'solid', 'growth', 'diary', 'milestone', 'custom'])
// 微信订阅消息 thing 字段上限 20 字；报告标题用于推送「报告结果」一行，超出截断。
const REPORT_TITLE_LIMIT = 20
function normalizeTitle(event) {
  const raw = event.report_title
  if (raw == null) return ''
  if (typeof raw !== 'string') fail(400, 'INVALID_REPORT_TITLE')
  return raw.replace(/\s+/g, ' ').trim().slice(0, REPORT_TITLE_LIMIT)
}
// Shared by save and update so the schedule contract can never drift between the two.
function validateSchedule(event) {
  if (!Array.isArray(event.categories) || !event.categories.length || event.categories.length > CATEGORIES.size || event.categories.some(c => !CATEGORIES.has(c))) fail(400, 'INVALID_CATEGORIES')
  const categories = [...new Set(event.categories)].sort()
  if (event.consent !== true || !['daily', 'weekly', 'monthly'].includes(event.frequency) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time || '') || !Number.isInteger(event.weekday) || event.weekday < 0 || event.weekday > 6) fail(400, 'INVALID_SCHEDULE')
  if (event.range !== undefined && event.range !== null && !REPORT_RANGES.includes(event.range)) fail(400, 'INVALID_RANGE')
  // Monthly always analyzes the previous full month, so any explicit range collapses to auto.
  const range = event.frequency === 'monthly' ? 'auto' : normalizeRange(event.range)
  return { categories, range }
}
exports.main = endpoint(async ({ event, db, openid }) => {
  const action = event.action || 'list'
  if (action === 'list') return { code: 0, items: (await db.collection('ai_tasks').where({ openid }).orderBy('created_at', 'desc').limit(50).get()).data, templateId: process.env.AI_REPORT_TEMPLATE_ID || '' }
  const clientId = requestId(event)
  if (action === 'remove' || action === 'toggle') {
    if (typeof event.id !== 'string') fail(400, 'INVALID_ID')
    return mutateOnce(db, openid, event, `task-${action}`, async tx => {
      const item = await readDoc(tx, 'ai_tasks', event.id)
      if (!item || item.openid !== openid) fail(404, 'TASK_NOT_FOUND')
      if (action === 'remove') { await tx.collection('ai_tasks').doc(item._id).remove(); return { code: 0 } }
      if (typeof event.enabled !== 'boolean') fail(400, 'INVALID_ENABLED')
      const data = { enabled: event.enabled, last_request_id: clientId, updated_at: db.serverDate() }
      if (event.enabled) data.next_run_at = nextRun(item)
      await tx.collection('ai_tasks').doc(item._id).update({ data })
      return { code: 0 }
    })
  }
  // 单任务微信通知开关：仅记录用户是否希望该任务推送订阅消息，真正的授权在客户端 requestSubscribeMessage 时获取。
  if (action === 'setNotify') {
    if (typeof event.id !== 'string') fail(400, 'INVALID_ID')
    if (event.notify !== true && event.notify !== false) fail(400, 'INVALID_NOTIFY')
    return mutateOnce(db, openid, event, 'task-set-notify', async tx => {
      const item = await readDoc(tx, 'ai_tasks', event.id)
      if (!item || item.openid !== openid) fail(404, 'TASK_NOT_FOUND')
      await tx.collection('ai_tasks').doc(item._id).update({ data: { notify: event.notify, last_request_id: clientId, updated_at: db.serverDate() } })
      return { code: 0 }
    })
  }
  if (action === 'update') {
    if (typeof event.id !== 'string') fail(400, 'INVALID_ID')
    const { categories, range } = validateSchedule(event)
    return mutateOnce(db, openid, event, 'task-update', async tx => {
      const item = await readDoc(tx, 'ai_tasks', event.id)
      if (!item || item.openid !== openid) fail(404, 'TASK_NOT_FOUND')
      const data = {
        categories, range, report_title: normalizeTitle(event), frequency: event.frequency, time: event.time, weekday: event.weekday,
        consent: true, lease_until: new Date(0), lease_token: '', updated_at: db.serverDate()
      }
      // A changed time/frequency must invalidate both the old schedule and an in-flight Timer lease.
      data.next_run_at = nextRun({ ...item, ...data })
      await tx.collection('ai_tasks').doc(item._id).update({ data })
      return { code: 0 }
    })
  }
  if (action !== 'save') fail(400, 'UNKNOWN_ACTION')
  const { categories, range } = validateSchedule(event)
  const id = hash(`${openid}:${clientId}`)
  if ((await db.collection('ai_tasks').where({ openid }).count()).total >= 10 && !(await db.collection('ai_tasks').where({ _id: id, openid }).count()).total) fail(409, 'TASK_LIMIT')
  const task = { openid, categories, range, report_title: normalizeTitle(event), frequency: event.frequency, time: event.time, weekday: event.weekday, consent: true, enabled: true, notify: false, baby_id: typeof event.baby_id === 'string' && event.baby_id.length <= 64 ? event.baby_id : '', lease_until: new Date(0), client_request_id: clientId, created_at: db.serverDate() }
  task.next_run_at = nextRun(task)
  const saved = await createOnce(db, 'ai_tasks', id, task)
  return { code: 0, id, duplicate: saved.duplicate }
})
