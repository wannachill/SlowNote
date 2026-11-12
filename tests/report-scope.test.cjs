const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), path = require('path')
const { load, memoryDb, seed, service } = require('./helpers.cjs')
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
// 北京时间 2026-10-21 20:00
const NOW = new Date('2026-10-21T12:00:00.000Z')

test('报告数据范围支持今天/近3天/近7天/近30天，默认跟随频率', () => {
  const { reportWindow } = load('cloudfunctions/_shared/schedule.js')

  const daily = reportWindow('daily', NOW)
  assert.deepEqual([daily.start, daily.end, daily.days, daily.period], ['2026-10-21', '2026-10-22', 1, '今天'])
  const weekly = reportWindow('weekly', NOW)
  assert.deepEqual([weekly.start, weekly.end, weekly.days, weekly.period], ['2026-10-15', '2026-10-22', 7, '最近一周'])

  const three = reportWindow('daily', NOW, '3d')
  assert.deepEqual([three.start, three.days, three.period], ['2026-10-19', 3, '最近 3 天'])
  const thirty = reportWindow('weekly', NOW, '30d')
  assert.deepEqual([thirty.start, thirty.days, thirty.period], ['2026-09-22', 30, '最近 30 天'])
  const explicitWeekly = reportWindow('daily', NOW, '7d')
  assert.deepEqual([explicitWeekly.start, explicitWeekly.period], ['2026-10-15', '最近一周'], '范围与频率解耦')

  assert.equal(reportWindow('monthly', NOW, '7d').period, '上个月', '月度始终分析上月整月')
  assert.equal(reportWindow('daily', NOW, 'nope').days, 1, '非法范围回落到跟随频率')
  assert.equal(reportWindow('weekly', NOW, 'auto').days, 7)
})

test('报告任务保存数据类型与数据范围，月度强制上月整月', async () => {
  const db = memoryDb(seed()), api = service('aiTasks', db)

  const saved = await api.main({ action: 'save', categories: ['excretion', 'solid', 'feeding'], range: '7d', frequency: 'daily', time: '09:00', weekday: 1, consent: true, clientRequestId: 'range-save-001' })
  assert.equal(saved.code, 0)
  const row = db.rows('ai_tasks').find(item => item._id === saved.id)
  assert.deepEqual(Array.from(row.categories), ['excretion', 'feeding', 'solid'], '三类同源于喂养记录但可分别选择')
  assert.equal(row.range, '7d')

  const monthly = await api.main({ action: 'save', categories: ['growth'], range: '30d', frequency: 'monthly', time: '09:00', weekday: 1, consent: true, clientRequestId: 'range-save-002' })
  assert.equal(monthly.code, 0)
  assert.equal(db.rows('ai_tasks').find(item => item._id === monthly.id).range, 'auto', '月度任务忽略显式范围')

  const updated = await api.main({ action: 'update', id: saved.id, categories: ['feeding'], range: '30d', frequency: 'weekly', time: '09:00', weekday: 2, consent: true, clientRequestId: 'range-save-003' })
  assert.equal(updated.code, 0)
  assert.equal(db.rows('ai_tasks').find(item => item._id === saved.id).range, '30d')

  assert.equal((await api.main({ action: 'save', categories: ['feeding'], range: '90d', frequency: 'daily', time: '09:00', weekday: 1, consent: true, clientRequestId: 'range-save-004' })).code, 400)
  assert.equal((await api.main({ action: 'save', categories: ['sleep'], range: 'auto', frequency: 'daily', time: '09:00', weekday: 1, consent: true, clientRequestId: 'range-save-005' })).code, 400)

  const listed = await api.main({ action: 'list' })
  assert.equal(listed.items.length, 2)
  assert.equal(listed.items.find(item => item._id === saved.id).range, '30d')
})

test('报告标题随任务保存并更新，超出 20 字截断、缺省为空', async () => {
  const db = memoryDb(seed()), api = service('aiTasks', db)
  const saved = await api.main({ action: 'save', categories: ['feeding'], range: 'auto', frequency: 'daily', time: '09:00', weekday: 1, consent: true, report_title: '近30天成长汇总', clientRequestId: 'title-save-001' })
  assert.equal(saved.code, 0)
  assert.equal(db.rows('ai_tasks').find(item => item._id === saved.id).report_title, '近30天成长汇总')
  const updated = await api.main({ action: 'update', id: saved.id, categories: ['feeding'], range: 'auto', frequency: 'daily', time: '09:00', weekday: 1, consent: true, report_title: '这是一段明显超过二十个字的标题用于验证后端截断是否生效', clientRequestId: 'title-update-001' })
  assert.equal(updated.code, 0)
  assert.equal(db.rows('ai_tasks').find(item => item._id === saved.id).report_title.length, 20, '更新时超长截断')
  const none = await api.main({ action: 'save', categories: ['feeding'], range: 'auto', frequency: 'daily', time: '09:00', weekday: 1, consent: true, clientRequestId: 'title-save-002' })
  assert.equal(db.rows('ai_tasks').find(item => item._id === none.id).report_title, '', '不传报告标题则留空')
})

test('旧任务没有 range 字段时按跟随频率处理', async () => {
  const legacy = { _id: 'legacy-task', openid: 'user-a', categories: ['feeding'], frequency: 'weekly', time: '09:00', weekday: 3, consent: true, enabled: true, created_at: new Date('2026-10-01T00:00:00.000Z') }
  const db = memoryDb({ ...seed(), ai_tasks: [legacy] }), api = service('aiTasks', db)
  const { reportWindow } = load('cloudfunctions/_shared/schedule.js')
  const [item] = (await api.main({ action: 'list' })).items
  assert.equal(item.range, undefined)
  assert.equal(reportWindow(item.frequency, NOW, item.range).days, 7)
})

test('报告按数据类型切片：喂养不再吞并便便排尿与辅食', () => {
  const { summarize, aiSummary } = load('cloudfunctions/_shared/aggregation.js')
  const summary = summarize({
    feeding: [
      { type: 'feed', payload: { mode: 'bottle', amountMl: 120 }, record_date: '2026-10-21' },
      { type: 'excretion', payload: { kind: 'stool', count: 2 }, record_date: '2026-10-21' },
      { type: 'solid', payload: {}, record_date: '2026-10-21' }
    ],
    growth: [], diary: [], milestone: [], custom: []
  })

  const feedingOnly = aiSummary(summary, ['feeding'])
  assert.deepEqual(Object.keys(feedingOnly.feeding.byCategory), ['bottle'], '未选的便便/辅食不进提示词')
  assert.equal(feedingOnly.feeding.amountMl, 120)
  assert.equal(feedingOnly.excretion, undefined)

  const split = aiSummary(summary, ['excretion', 'solid'])
  assert.deepEqual([split.excretion.stool, split.excretion.urine, split.solid.count], [2, 0, 1])
  assert.equal(split.feeding, undefined, '未选的喂养不出现')

  // vm 上下文里的对象原型不同，逐字段断言而不是整体 deepEqual。
  const diaryOnly = aiSummary(summary, ['diary'])
  assert.deepEqual(Object.keys(diaryOnly), ['diary'])
  assert.equal(diaryOnly.diary.count, 0)
})

test('定时报告面板同时提供数据类型与数据范围选择', () => {
  const wxml = read('miniprogram/pages/ai-tasks/index.wxml')
  const js = read('miniprogram/pages/ai-tasks/index.js')
  const style = read('miniprogram/pages/ai-tasks/index.wxss')
  const questionStyle = read('miniprogram/pages/ai-settings/index.wxss')
  const appStyle = read('miniprogram/app.wxss')

  assert.match(wxml, /数据类型/)
  assert.match(wxml, /bindtap="toggleAllCategories"/)
  assert.match(wxml, /class="task-category-grid"/)
  assert.match(wxml, /class="type-btn choice-chip \{\{item\.selected \? 'active' : ''\}\}"/)
  assert.match(wxml, /数据范围/)
  assert.match(wxml, /class="task-categories range-chips"/)
  assert.match(wxml, /bindtap="selectRange"/)
  assert.match(wxml, /\{\{rangeHint\}\}/)
  assert.match(wxml, /数据范围固定为上月整月/)
  assert.match(wxml, /\{\{item\.scheduleText\}\}/)
  assert.match(wxml, /<input class="input" value="\{\{reportTitle\}\}"/)
  assert.doesNotMatch(style, /\.text-input\s*\{/)
  assert.doesNotMatch(wxml, /北京时间/)
  assert.doesNotMatch(wxml, /\{\{item\.rangeTag\}\}/)
  assert.match(wxml, /bindchange="onNotifyChange"/)
  assert.match(wxml, /这些报告任务会按你设定的频率生成宝宝成长报告/)
  assert.match(wxml, /wx:if="\{\{loading && !items\.length\}\}" class="status-block skeleton-loading"/)
  assert.doesNotMatch(wxml, /wx:if="\{\{loading\}\}" class="status-block skeleton-loading"/)
  assert.match(wxml, /报告标题/)
  assert.ok(wxml.indexOf('field-label">报告标题') < wxml.indexOf('field-label">数据类型'), '标题字段应排在数据类型之前')
  assert.ok(wxml.indexOf('field-label">数据类型') < wxml.indexOf('field-label">数据范围'), '数据范围应排在数据类型之后')
  assert.match(wxml, /bindinput="onReportTitle"/)
  assert.match(wxml, /maxlength="20"/)
  assert.match(js, /onReportTitle\(e\)/)
  assert.match(js, /report_title: this\.data\.reportTitle/)
  assert.match(js, /reportTitle: ''/)

  assert.match(js, /name: '便便排尿'/)
  assert.match(js, /name: '辅食'/)
  assert.match(js, /name: '成长日记'/)
  assert.match(js, /range: this\.data\.frequencyIndex === 2 \? 'auto' : this\.data\.range/)
  assert.match(style, /\.range-chips \.type-btn\s*\{[^}]*flex: 1 1 0;/)
  assert.match(style, /\.task-category-grid\s*\{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[^}]*gap: var\(--space-xs\)/)
  assert.match(questionStyle, /\.question-category-grid\s*\{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[^}]*gap: var\(--space-xs\)/)
  const questionWxml = read('miniprogram/pages/ai-settings/index.wxml')
  assert.match(questionWxml, /class="type-btn choice-chip \{\{item\.selected/)
  assert.match(appStyle, /\.choice-chip\s*\{[^}]*border-radius: var\(--radius-pill\);[^}]*font-size: var\(--font-caption\)/)
  assert.match(appStyle, /\.choice-chip\.active\s*\{[^}]*border-color: var\(--color-accent-ink\);[^}]*background: var\(--color-accent-soft\)/)
  assert.doesNotMatch(style, /\.task-category-grid \.type-btn(?:\.active)?\s*\{/)
  assert.doesNotMatch(questionStyle, /\.question-category-chip(?:\.active)?\s*\{/)
  assert.match(appStyle, /\.status-tag\s*\{[^}]*padding: 0 var\(--space-xs\);[^}]*border-radius: var\(--radius-small\);[^}]*font-size: var\(--font-caption\);[^}]*font-weight: var\(--weight-medium\)/)
  assert.match(style, /\.task-main > \.status-tag\s*\{\s*margin-top: var\(--space-xs\);\s*\}/)
  assert.match(appStyle, /\.link-btn\s*\{[^}]*min-height: var\(--control-height\);[^}]*min-width: var\(--control-height\);[^}]*border-radius: var\(--radius-small\);[^}]*font-size: var\(--font-body\)/)
  assert.doesNotMatch(style, /\.link-btn\s*\{/)
  assert.doesNotMatch(questionStyle, /\.settings-detail \.link-btn\s*\{/)
})

test('报告任务支持单任务微信通知开关，默认值关闭', async () => {
  const db = memoryDb(seed()), api = service('aiTasks', db)
  const saved = await api.main({ action: 'save', categories: ['feeding'], range: 'auto', frequency: 'daily', time: '09:00', weekday: 1, consent: true, clientRequestId: 'notify-save-001' })
  assert.equal(saved.code, 0)
  assert.equal(db.rows('ai_tasks').find(item => item._id === saved.id).notify, false, '新任务默认不推送微信')
  const listed = (await api.main({ action: 'list' })).items.find(item => item._id === saved.id)
  assert.equal(listed.notify, false)

  assert.equal((await api.main({ action: 'setNotify', id: saved.id, notify: true, clientRequestId: 'notify-on' })).code, 0)
  assert.equal(db.rows('ai_tasks').find(item => item._id === saved.id).notify, true)
  assert.equal((await api.main({ action: 'setNotify', id: saved.id, notify: false, clientRequestId: 'notify-off' })).code, 0)
  assert.equal(db.rows('ai_tasks').find(item => item._id === saved.id).notify, false)

  assert.equal((await api.main({ action: 'setNotify', id: saved.id, notify: 'yes', clientRequestId: 'notify-bad' })).code, 400, 'notify 必须为布尔')
  assert.equal((await service('aiTasks', db, { openid: 'user-b' }).main({ action: 'setNotify', id: saved.id, notify: true, clientRequestId: 'notify-other' })).code, 404)
})

test('未开启微信通知的任务只落站内、不消耗订阅额度', async () => {
  const db = memoryDb(seed()), tasks = service('aiTasks', db)
  await tasks.main({ action: 'save', categories: ['feeding'], range: 'auto', frequency: 'daily', time: '19:00', weekday: 1, consent: true, clientRequestId: 'notify-gate-setup' })
  db.rows('ai_tasks')[0].next_run_at = new Date(+NOW - 1000)
  // notify 缺省为 false，不应调用订阅消息接口。
  const client = service('aiReport', db, { openid: '' })
  await client.main({ Type: 'Timer', TriggerName: 'aiReportTimer' })
  const note = db.rows('ai_notifications')[0]
  assert.equal(note.delivery.code, 0)
  assert.equal(note.delivery.status, 'in_app')
  assert.equal(note.delivery.message, 'WECHAT_NOTIFY_DISABLED')
  assert.equal(client.state.pushes.length, 0)
})

test('文档记录报告的数据类型与数据范围', () => {
  assert.match(read('docs/prd/slownote-prd.md'), /数据范围/)
  assert.match(read('docs/database-design.md'), /ai_tasks/)
  assert.match(read('docs/database-design.md'), /report_title\(可选/)
  assert.match(read('docs/database-design.md'), /notify\(/)
  assert.match(read('docs/rules/frontend-standard.md'), /数据范围/)
})
