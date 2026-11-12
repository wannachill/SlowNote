const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { access, hash, createOnce, all } = require('./lib/runtime')
const { aggregate } = require('./lib/aggregation')
const { buildDetails, MESSAGE_LIMIT, clipText } = require('./lib/record-details')
const { nextRun, reportWindow } = require('./lib/schedule')
const { ask, DISCLAIMER, redact } = require('./lib/llm')
const { compose, loadSettings } = require('./lib/ai-settings')
async function sendNotice(openid, now, result) {
  const templateId = process.env.AI_REPORT_TEMPLATE_ID
  if (!templateId || templateId.startsWith('YOUR_')) {
    console.error('[aiReport] sendNotice skipped: AI_REPORT_TEMPLATE_ID not configured')
    return { code: 501, status: 'in_app', message: 'TEMPLATE_NOT_CONFIGURED' }
  }
  // Field ids come from the applied subscribe template and are overridable via env.
  // Defaults align with the "查看报告提醒" template: thing1=报告类型, time2=生成时间, thing3=报告结果.
  const titleField = process.env.AI_REPORT_TITLE_FIELD || 'thing1'
  const timeField = process.env.AI_REPORT_TIME_FIELD || 'time2'
  const resultField = process.env.AI_REPORT_RESULT_FIELD || ''
  if (!/^thing\d+$/.test(titleField) || !/^time\d+$/.test(timeField)) {
    console.error('[aiReport] sendNotice skipped: invalid field mapping', { titleField, timeField })
    return { code: 501, status: 'in_app', message: 'TEMPLATE_FIELDS_NOT_CONFIGURED' }
  }
  if (resultField && !/^thing\d+$/.test(resultField)) {
    console.error('[aiReport] sendNotice skipped: invalid AI_REPORT_RESULT_FIELD', { resultField })
    return { code: 501, status: 'in_app', message: 'TEMPLATE_FIELDS_NOT_CONFIGURED' }
  }
  const data = {
    [titleField]: { value: '小迈定时报告' },
    [timeField]: { value: new Date(+now + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') }
  }
  // 报告结果：优先用任务配置的「报告标题」（用户在任务页填写、已限长 20 字）；未配置则不展示该字段，避免截断正文。
  if (resultField && result) {
    const preview = String(result).replace(/\s+/g, ' ').trim().slice(0, 20)
    if (preview) data[resultField] = { value: preview }
  }
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid, templateId, page: 'pages/ai-notifications/index', data
    })
    return { code: 0, status: 'sent' }
  } catch (error) {
    console.error('[aiReport] subscribeMessage.send failed', { errMsg: error && error.errMsg, errCode: error && error.errCode })
    return { code: 503, status: 'in_app', message: 'SUBSCRIBE_MESSAGE_UNAVAILABLE', error: (error && error.errMsg) || 'SEND_FAILED' }
  }
}
async function processTask(task, now) {
  const token = hash(`${task._id}:${+now}:${Math.random()}`), slot = new Date(task.next_run_at).toISOString(), runId = hash(`${task._id}:${slot}`)
  const claim = await db.collection('ai_tasks').where({ _id: task._id, enabled: true, next_run_at: task.next_run_at, lease_until: db.command.lte(now) }).update({ data: { lease_token: token, lease_until: new Date(+now + 180000) } })
  if (!claim.stats.updated) return false
  try {
    const run = await createOnce(db, 'ai_runs', runId, { task_id: task._id, openid: task.openid, slot, created_at: db.serverDate(), completed: false })
    let answer = run.record.answer, revoked = false
    if (!answer) {
      const context = await access(db, task.openid)
      try { if (!task.consent) throw Error('CONSENT_REQUIRED') }
      catch (error) { revoked = true }
      if (revoked) answer = { configured: false, unavailable: true, text: '定时报告已暂停。请确认数据使用同意后再启用任务。' }
      else {
        const window = reportWindow(task.frequency, now, task.range)
        const categories = Array.isArray(task.categories) ? task.categories : []
        const [{ data }, settings, babies] = await Promise.all([
          aggregate(db, context, { start: window.start, end: window.end }, task.baby_id || '', categories),
          loadSettings(db, hash(task.openid)),
          all(db, 'babies', context.scope)
        ])
        const scopedBabies = task.baby_id
          ? babies.filter(baby => String(baby.baby_id || baby._id) === String(task.baby_id) || String(baby._id) === String(task.baby_id))
          : babies
        const secrets = [task.openid, ...scopedBabies.flatMap(baby => [baby.nickname, baby.birthday])]
        const details = await buildDetails(data, categories, { db, scope: context.scope, babyId: task.baby_id || '', period: window.period })
        const content = clipText(redact(`没有记录不代表没有发生。${details}`, secrets), MESSAGE_LIMIT)
        answer = await ask([{ role: 'user', content }], {
          system: compose(settings.prompts, 'report', { days: window.days, period: window.period })
        })
      }
      await db.collection('ai_runs').doc(runId).update({ data: { answer, revoked } })
    } else revoked = !!run.record.revoked
    // A disabled/reclaimed task cannot publish after a slow model response.
    const active = (await db.collection('ai_tasks').where({ _id: task._id, enabled: true, lease_token: token }).count()).total
    if (!active) return false
    const notification = await createOnce(db, 'ai_notifications', runId, {
      openid: task.openid, task_id: task._id, title: revoked ? '报告任务已暂停' : (task.report_title || '小迈定时报告'),
      content: `${answer.text}\n\n${DISCLAIMER}`, configured: answer.configured, unavailable: !!answer.unavailable,
      read: false, delivery_status: 'pending', delivery: { code: 501, status: 'pending' }, created_at: db.serverDate()
    })
    const deliveryClaim = await db.collection('ai_notifications').where({ _id: notification.id, delivery_status: 'pending' }).update({ data: { delivery_status: 'attempted' } })
    if (deliveryClaim.stats.updated) {
      // 仅当用户为该任务单独开启微信通知时才尝试订阅消息推送；否则仅保留站内通知，避免浪费一次性订阅额度。
      const delivery = task.notify === true
        ? await sendNotice(task.openid, now, task.report_title)
        : { code: 0, status: 'in_app', message: 'WECHAT_NOTIFY_DISABLED' }
      await db.collection('ai_notifications').doc(notification.id).update({ data: { delivery } })
    }
    await db.collection('ai_runs').doc(runId).update({ data: { completed: true, completed_at: db.serverDate() } })
    await db.collection('ai_tasks').where({ _id: task._id, lease_token: token }).update({ data: { enabled: !revoked, next_run_at: nextRun(task, now), lease_until: new Date(0), last_status: revoked ? 'permission_changed' : answer.unavailable ? 'unavailable' : answer.configured ? 'completed' : 'not_configured', last_run_at: db.serverDate() } })
    return true
  } catch (error) {
    await db.collection('ai_tasks').where({ _id: task._id, lease_token: token }).update({ data: { lease_until: new Date(0), last_status: 'retry_pending' } })
    return false
  }
}
exports.main = async (event = {}) => {
  const triggerName = event.TriggerName
  // Accept a timer when either the type matches or the trigger name matches,
  // because the platform does not reliably deliver event.Type === 'Timer'.
  const isTimer = event.Type === 'Timer' || triggerName === 'aiReportTimer'
  if (!isTimer || cloud.getWXContext().OPENID) return { code: 403, message: 'TIMER_ONLY' }
  try {
    const now = new Date(), tasks = (await db.collection('ai_tasks').where({ enabled: true, next_run_at: db.command.lte(now), lease_until: db.command.lte(now) }).orderBy('next_run_at', 'asc').limit(10).get()).data
    let processed = 0
    for (let i = 0; i < tasks.length; i += 2) processed += (await Promise.all(tasks.slice(i, i + 2).map(task => processTask(task, now)))).filter(Boolean).length
    return { code: 0, processed }
  } catch (error) { return { code: 503, message: 'REPORT_SERVICE_UNAVAILABLE' } }
}
exports.sendNotice = sendNotice
