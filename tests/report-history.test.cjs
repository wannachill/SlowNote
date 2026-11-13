const test = require('node:test')
const assert = require('node:assert/strict')
const { front, load, memoryDb, seed, service } = require('./helpers.cjs')

function reports() {
  const now = new Date('2026-11-10T12:00:00.000Z')
  return [
    { _id: 'n1', openid: 'user-a', title: '小迈定时报告', content: '最近一周喂养稳定，\n体重增长正常。', read: false, delivery: { code: 0, status: 'sent' }, created_at: now },
    { _id: 'n2', openid: 'user-a', title: '报告任务已暂停', content: '数据使用同意已撤回。', read: true, delivery: { code: 501, status: 'in_app' }, created_at: now }
  ]
}

function pageWith(items) {
  // 云函数 list 已把 _id 映射为 id，前端只认 id。
  const listed = items.map(item => ({ ...item, id: item._id }))
  const calls = []
  const f = front('ai-notifications', {
    callFunction: async ({ name, data }) => {
      calls.push({ name, data })
      if (data.action === 'list') return { result: { code: 0, items: listed } }
      return { result: { code: 0 } }
    }
  })
  return { ...f, calls }
}

test('历史报告列表压缩正文预览并区分投递状态', async () => {
  const { page, calls } = pageWith(reports())
  await page.onShow()
  assert.equal(calls[0].name, 'aiNotifications')
  assert.equal(calls[0].data.action, 'list')
  assert.equal(page.data.items.length, 2)
  assert.equal(page.data.items[0].wechatText, '微信已送达')
  assert.equal(page.data.items[0].wechatClass, 'status-sent')
  assert.equal(page.data.items[1].wechatText, '微信未送达')
  assert.equal(page.data.items[1].wechatClass, 'status-error')
  assert.equal(page.data.items[0].title, '小迈定时报告')
  assert.equal(page.data.items[0].read, false)
  assert.match(page.data.items[0].dateText, /^2026-11-10 20:00$/, '按北京时间展示')
})

test('未开启微信通知的任务标记为站内信（仅留存站内，不消耗订阅额度）', async () => {
  const { page } = pageWith([
    { _id: 'n3', openid: 'user-a', title: '小迈定时报告', content: '内容', read: true, delivery: { code: 0, status: 'in_app', message: 'WECHAT_NOTIFY_DISABLED' }, created_at: new Date() }
  ])
  await page.onShow()
  assert.equal(page.data.items[0].wechatText, '站内信')
  assert.equal(page.data.items[0].wechatClass, 'status-off')
})

test('历史报告默认显示本月日期区间，选择起止日期后筛选并支持分页', async () => {
  const { page, calls } = pageWith(reports())
  await page.onShow()
  assert.equal(calls[0].data.startDate, '2026-10-01')
  assert.equal(calls[0].data.endDate, '2026-10-21')
  assert.equal(page.data.startDateLabel, '2026年10月1日')
  assert.equal(page.data.endDateLabel, '2026年10月21日')
  await page.onStartDate({ detail: { value: '2026-09-10' } })
  assert.equal(calls.at(-1).data.startDate, '2026-09-10')
  assert.equal(calls.at(-1).data.endDate, '2026-10-21')
  await page.onEndDate({ detail: { value: '2026-09-20' } })
  assert.equal(calls.at(-1).data.startDate, '2026-09-10')
  assert.equal(calls.at(-1).data.endDate, '2026-09-20')
  await page.onStartDate({ detail: { value: '2026-10-05' } })
  assert.equal(calls.at(-1).data.startDate, '2026-10-05')
  assert.equal(calls.at(-1).data.endDate, '2026-10-05', '开始日期越过结束日期时自动收拢为单日范围')
  const count = calls.length
  await page.onEndDate({ detail: { value: '2026-09-01' } })
  assert.equal(calls.length, count)
  page.setData({ hasMore: true })
  await page.loadMore()
  assert.equal(calls.at(-1).data.offset, 2)
})

test('报告范围在云端按北京时间包含起止当天，并正确分页与隔离账号', async () => {
  const items = Array.from({ length: 23 }, (_, index) => ({ ...reports()[0], _id: 'n' + String(index).padStart(2, '0'), created_at: new Date('2026-11-01T00:00:00Z') }))
  items.push({ ...reports()[0], _id: 'start', created_at: new Date('2026-10-31T16:00:00Z') },
    { ...reports()[0], _id: 'end', created_at: new Date('2026-11-30T15:59:59Z') },
    { ...reports()[0], _id: 'before', created_at: new Date('2026-10-31T15:59:59Z') },
    { ...reports()[0], _id: 'after', created_at: new Date('2026-11-30T16:00:00Z') },
    { ...reports()[0], _id: 'other', openid: 'user-b' })
  const api = service('aiNotifications', memoryDb({ ...seed(), ai_notifications: items }))
  const params = { action: 'list', startDate: '2026-11-01', endDate: '2026-11-30' }
  const first = await api.main(params), second = await api.main({ ...params, offset: 20 })
  assert.equal(first.total, 25)
  assert.equal(first.items.length, 20)
  assert.equal(first.hasMore, true)
  assert.equal(second.items.length, 5)
  assert.equal(second.hasMore, false)
  const ids = first.items.concat(second.items).map(item => item.id)
  assert.equal(new Set(ids).size, 25)
  assert.ok(ids.includes('start') && ids.includes('end'))
  for (const id of ['before', 'after', 'other']) assert.equal(ids.includes(id), false)
  assert.equal((await api.main({ ...params, startDate: '2026-02-30' })).code, 400)
  assert.equal((await api.main({ ...params, startDate: '2026-12-01' })).code, 400)
  assert.equal((await api.main({ action: 'list', offset: -1 })).code, 400)
})

test('快速切换日期区间时旧响应不覆盖新列表', async () => {
  const pending = []
  const f = front('ai-notifications', { callFunction: () => new Promise(resolve => pending.push(resolve)) })
  f.page.setData({ today: '2027-01-03', startDate: '2026-12-01', endDate: '2026-12-31' })
  const oldRequest = f.page.load()
  f.page.setData({ startDate: '2027-01-01', endDate: '2027-01-03' })
  const newRequest = f.page.load()
  pending[1]({ result: { code: 0, items: [{ ...reports()[0], id: 'new' }], total: 1, hasMore: false } })
  await newRequest
  pending[0]({ result: { code: 0, items: [], total: 0, hasMore: false } })
  await oldRequest
  assert.equal(f.page.data.items[0].id, 'new')
  assert.equal(f.page.data.total, 1)
})

test('历史报告始终显示中文起止日期选择器，不再提供范围预设下拉', () => {
  const fs = require('fs')
  const template = fs.readFileSync('miniprogram/pages/ai-notifications/index.wxml', 'utf8')
  const script = fs.readFileSync('miniprogram/pages/ai-notifications/index.js', 'utf8')
  assert.match(template, /picker mode="date" value="\{\{startDate\}\}" end="\{\{today\}\}" bindchange="onStartDate"/)
  assert.match(template, /picker mode="date" value="\{\{endDate\}\}" start="\{\{startDate\}\}" end="\{\{today\}\}" bindchange="onEndDate"/)
  assert.match(template, /\{\{startDateLabel\}\}/)
  assert.match(template, /\{\{endDateLabel\}\}/)
  assert.doesNotMatch(template, /report-date-caption|>开始</)
  assert.doesNotMatch(template, /report-date-caption|>结束</)
  assert.match(template, /至/)
  assert.doesNotMatch(template, /rangeOptions|rangeIndex|onRangeChange/)
  assert.doesNotMatch(script, /rangeOptions|rangeIndex|onRangeChange|applyPreset/)
})

test('微信通知发送到报告所属用户并链接历史报告，未配置或无授权时降级站内', async () => {
  const db = memoryDb(seed())
  const env = { AI_REPORT_TEMPLATE_ID: 'test-report-template', AI_REPORT_TITLE_FIELD: 'thing1', AI_REPORT_TIME_FIELD: 'time2', AI_REPORT_RESULT_FIELD: 'thing3' }
  const api = service('aiReport', db, { env })
  const result = await api.sendNotice('user-a', new Date('2026-11-11T05:30:00Z'))
  assert.equal(result.status, 'sent')
  assert.equal(api.state.pushes[0].touser, 'user-a')
  assert.equal(api.state.pushes[0].templateId, env.AI_REPORT_TEMPLATE_ID)
  assert.equal(api.state.pushes[0].page, 'pages/ai-notifications/index')
  assert.equal(api.state.pushes[0].data.thing1.value, '小迈定时报告')
  assert.equal(api.state.pushes[0].data.time2.value, '2026-11-11 13:30')
  assert.equal(api.state.pushes[0].data.thing3, undefined, '未传报告标题时不展示报告结果字段')
  const missing = service('aiReport', db)
  assert.equal((await missing.sendNotice('user-a', new Date())).status, 'in_app')
  assert.equal(missing.state.pushes.length, 0)
  const rejected = service('aiReport', db, { env, pushError: true })
  assert.equal((await rejected.sendNotice('user-a', new Date())).status, 'in_app')
})

test('微信通知报告结果取自任务标题且限长 20 字', async () => {
  const db = memoryDb(seed())
  const env = { AI_REPORT_TEMPLATE_ID: 'test-report-template', AI_REPORT_TITLE_FIELD: 'thing1', AI_REPORT_TIME_FIELD: 'time2', AI_REPORT_RESULT_FIELD: 'thing3' }
  const api = service('aiReport', db, { env })
  assert.equal((await api.sendNotice('user-a', new Date('2026-11-11T05:30:00Z'), '近30天成长汇总')).status, 'sent')
  assert.equal(api.state.pushes[0].data.thing3.value, '近30天成长汇总')
  await api.sendNotice('user-a', new Date('2026-11-11T05:30:00Z'), '这是一段明显超过二十个字的报告标题用于验证截断逻辑是否生效')
  assert.equal(api.state.pushes[1].data.thing3.value.length, 20, '报告标题超过 20 字截断')
})

test('点击卡片打开详情并标记已读，关闭后清空当前报告', async () => {
  const { page, calls } = pageWith(reports())
  await page.onShow()
  page.onCardTap({ currentTarget: { dataset: { id: 'n1' } } })
  assert.equal(page.data.panel, true)
  assert.equal(page.data.current.id, 'n1')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(page.data.items[0].read, true, '打开即视为已读')
  const read = calls.find(item => item.data.action === 'read')
  assert.equal(read.data.id, 'n1')
  assert.ok(read.data.clientRequestId.length >= 8)

  page.closePanel()
  assert.equal(page.data.closing, true)
  await new Promise(resolve => setTimeout(resolve, 420))
  assert.equal(page.data.panel, false, '关闭动画结束后卸载面板')
  assert.equal(page.data.current, null)
})

test('历史报告卡片与定时报告同构：标题+时间首行、微信状态+未读次行、时间未读靠右、未展示正文预览', () => {
  const fs = require('fs')
  const template = fs.readFileSync('miniprogram/pages/ai-notifications/index.wxml', 'utf8')
  const style = fs.readFileSync('miniprogram/pages/ai-notifications/index.wxss', 'utf8')
  const appStyle = fs.readFileSync('miniprogram/app.wxss', 'utf8')
  assert.match(template, /class="task-main"/)
  assert.match(template, /class="report-row report-head"/)
  assert.match(template, /class="title">\{\{item.title\}\}/)
  assert.match(template, /class="form-note report-date">\{\{item.dateText\}\}</)
  assert.match(template, /class="report-row report-foot"/)
  assert.match(template, /wx:if="\{\{item.wechatText\}\}" class="status-tag \{\{item.wechatClass\}\}">\{\{item.wechatText\}\}/)
  assert.match(template, /wx:if="\{\{!item.read\}\}" class="status-tag status-unread"[^>]*>未读<\/text>/)
  assert.doesNotMatch(template, /report-preview/)
  assert.match(style, /\.report-head \.title\s*\{[^}]*font-size:\s*var\(--font-body\)/)
  assert.match(style, /\.report-head\s*\{[^}]*justify-content:\s*space-between/)
  assert.match(style, /\.report-date\s*\{[^}]*text-align:\s*right/)
  assert.match(style, /\.report-swipe\s*\{[^}]*margin-top:\s*var\(--space-s\)/)
  assert.match(template, /class="select-value report-date-value"/)
  assert.match(appStyle, /\.select-value\s*\{[^}]*min-height:\s*var\(--input-height\);[^}]*padding:\s*var\(--space-s\) var\(--space-sm\);[^}]*border-radius:\s*var\(--radius-small\);[^}]*font-size:\s*var\(--font-body\)/)
  assert.doesNotMatch(style, /\.report-date-value\s*\{[^}]*min-height:/)
  assert.match(style, /\.status-unread\s*\{[^}]*background:\s*var\(--color-accent-ink\);[^}]*color:\s*var\(--color-on-accent\)/)
  assert.match(style, /\.status-sent\s*\{[^}]*background:\s*var\(--color-accent-soft\)/)
  assert.match(style, /\.status-off\s*\{[^}]*background:\s*var\(--color-field\)/)
  assert.match(style, /\.status-error\s*\{[^}]*background:\s*var\(--color-notice-soft\)/)
  assert.match(style, /\.report-sheet\s*\{\s*height:\s*var\(--sheet-max-height\)/)
  assert.match(style, /\.report-scroll\s*\{[^}]*height:\s*0;[^}]*flex:\s*1 1 0%;[^}]*min-height:\s*0/)
  assert.ok(template.indexOf('class="sheet-heading"') < template.indexOf('class="sheet-scroll report-scroll"'))
  assert.match(template, /<rich-text class="report-content" nodes="\{\{reportNodes\}\}"/)
  assert.match(template, /bindtap="copyReport"/)
  assert.doesNotMatch(template, /class="report-content" selectable/)
  assert.match(style, /\.md-strong\s*\{[^}]*font-weight:\s*var\(--weight-semibold\)/)
  assert.match(style, /\.md-heading-2\s*\{[^}]*font-size:\s*var\(--font-control\)/)
  assert.match(style, /\.report-copy\s*\{[^}]*margin-left:\s*auto/)
})

test('报告正文按 Markdown 渲染，加粗与小标题生效，复制全文保留原始内容', async () => {
  const content = '## 总体结论\n**喂养稳定**，体重增长正常。\n\n## 需留意\n如有异常请及时就医。'
  const ctx = pageWith([{ ...reports()[0], content }])
  await ctx.page.onShow()
  ctx.page.onCardTap({ currentTarget: { dataset: { id: 'n1' } } })
  const nodes = ctx.page.data.reportNodes
  const serialized = JSON.stringify(nodes)
  assert.ok(nodes.length > 0, '应生成 rich-text 节点')
  assert.match(serialized, /md-heading md-heading-2/)
  assert.match(serialized, /md-strong/)
  assert.doesNotMatch(serialized, /\*\*/, '双星号不应原样显示')
  let copied = ''
  ctx.wx.setClipboardData = ({ data, success }) => { copied = data; if (success) success() }
  ctx.page.copyReport()
  assert.equal(copied, content)
  ctx.page.onCardTap({ currentTarget: { dataset: { id: 'n1' } } })
  assert.equal(ctx.page.data.reportNodes, nodes, '重复打开应复用缓存节点')
})

test('长报告打开后保留完整正文，微信未发送时仍标识为站内通知', async () => {
  const content = '情况分析与建议。\n'.repeat(1000) + '报告末尾'
  const report = { ...reports()[1], content }
  const { page } = pageWith([report])
  await page.onShow()
  page.onCardTap({ currentTarget: { dataset: { id: 'n2' } } })
  assert.equal(page.data.current.content, content)
  assert.equal(page.data.current.wechatText, '微信未送达')
})

test('已读报告不再重复调用标记已读', async () => {
  const { page, calls } = pageWith(reports())
  await page.onShow()
  const before = calls.length
  page.onCardTap({ currentTarget: { dataset: { id: 'n2' } } })
  assert.equal(page.data.panel, true)
  assert.equal(calls.length, before, '已读卡片打开详情不产生额外请求')
})

test('左滑只展开当前卡片，展开态点击先收起而不打开详情', async () => {
  const { page } = pageWith(reports())
  await page.onShow()
  const width = page.actionWidth()
  page.onCardTouchStart({ currentTarget: { dataset: { id: 'n1' } }, touches: [{ clientX: 300, clientY: 100 }] })
  page.onCardTouchMove({ touches: [{ clientX: 300 - width, clientY: 104 }] })
  page.onCardTouchEnd()
  assert.equal(page.data.items[0].swipeX, -width)
  assert.equal(page.data.items[1].swipeX, 0)

  page.onCardTouchStart({ currentTarget: { dataset: { id: 'n2' } }, touches: [{ clientX: 300, clientY: 100 }] })
  page.onCardTouchMove({ touches: [{ clientX: 300 - width, clientY: 101 }] })
  page.onCardTouchEnd()
  assert.equal(page.data.items[0].swipeX, 0, '展开第二张时第一张收起')
  assert.equal(page.data.items[1].swipeX, -width)

  page.setData({ panel: false })
  page.onCardTap({ currentTarget: { dataset: { id: 'n2' } } })
  assert.equal(page.data.panel, false, '展开态点击只收起卡片')
  assert.equal(page.data.items[1].swipeX, 0)
})

test('左滑删除二次确认后调用云端并刷新列表', async () => {
  const { page, calls } = pageWith(reports())
  await page.onShow()
  page.confirmDanger = options => {
    assert.equal(options.title, '删除这份报告')
    options.success({ confirm: true })
  }
  page.remove({ currentTarget: { dataset: { id: 'n1' } } })
  await new Promise(resolve => setTimeout(resolve, 10))
  const remove = calls.find(item => item.data.action === 'remove')
  assert.equal(remove.data.id, 'n1')
  assert.ok(remove.data.clientRequestId.length >= 8)
  assert.equal(calls.filter(item => item.data.action === 'list').length, 2, '删除成功后重新拉取列表')
})

test('取消确认不会删除报告', async () => {
  const { page, calls } = pageWith(reports())
  await page.onShow()
  page.confirmDanger = options => options.success({ confirm: false })
  page.remove({ currentTarget: { dataset: { id: 'n1' } } })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(calls.some(item => item.data.action === 'remove'), false)
})

test('云端删除只允许本人报告，并按请求 ID 幂等', async () => {
  const db = memoryDb({ ...seed(), ai_notifications: reports() })
  const api = service('aiNotifications', db)

  const other = service('aiNotifications', db, { openid: 'user-b' })
  const denied = await other.main({ action: 'remove', id: 'n1', clientRequestId: 'other-remove' })
  assert.equal(denied.code, 404)
  assert.equal(db.rows('ai_notifications').length, 2)

  const first = await api.main({ action: 'remove', id: 'n1', clientRequestId: 'remove-1' })
  assert.equal(first.code, 0)
  assert.equal(db.rows('ai_notifications').length, 1)
  assert.equal(db.rows('ai_notifications')[0]._id, 'n2')

  const replay = await api.main({ action: 'remove', id: 'n1', clientRequestId: 'remove-1' })
  assert.equal(replay.code, 0)
  assert.equal(replay.duplicate, true, '重放同一请求返回同一结果')
})

test('云端删除缺 id 返回参数错误', async () => {
  const db = memoryDb({ ...seed(), ai_notifications: reports() })
  const api = service('aiNotifications', db)
  const result = await api.main({ action: 'remove', clientRequestId: 'bad-remove' })
  assert.equal(result.code, 400)
})

test('定时报告页不再提供「查看站内通知」入口，历史报告从我的进入', () => {
  const fs = require('fs'), path = require('path')
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const tasks = read('miniprogram/pages/ai-tasks/index.wxml')
  assert.doesNotMatch(tasks, /查看站内通知/)
  assert.doesNotMatch(read('miniprogram/pages/ai-tasks/index.js'), /notifications\(\)/)

  const mine = read('miniprogram/pages/mine/index.wxml')
  const names = [...mine.matchAll(/<text class="settings-name">([^<]+)<\/text>/g)].map(match => match[1])
  assert.deepEqual(names, ['主题设置', '小迈设置', '定时报告', '历史报告', '隐私政策'])
  assert.match(mine, /data-url="\/pages\/ai-notifications\/index"[^>]*aria-label="历史报告"/)
})

test('底栏「我的」不展示未读数字角标，报告卡片使用主题色未读文字标签', () => {
  const fs = require('fs'), path = require('path')
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const barTemplate = read('miniprogram/custom-tab-bar/index.wxml')
  const barScript = read('miniprogram/custom-tab-bar/index.js')
  const barStyle = read('miniprogram/custom-tab-bar/index.wxss')
  const appScript = read('miniprogram/app.js')

  assert.doesNotMatch(barTemplate, /tab-badge|noticeBadge|badgePulse|未读通知/)
  assert.doesNotMatch(barScript, /noticeBadge|badgePulse|syncNoticeBadge/)
  assert.doesNotMatch(barStyle, /tab-badge/)
  assert.doesNotMatch(appScript, /noticeBadge|unreadCount/, '不再拉取未读数做底栏角标')
  assert.doesNotMatch(read('cloudfunctions/aiNotifications/index.js'), /unreadCount/)
  const reportTemplate = read('miniprogram/pages/ai-notifications/index.wxml')
  assert.match(reportTemplate, /wx:if="\{\{!item.read\}\}" class="status-tag status-unread"[^>]*>未读<\/text>/)
  assert.doesNotMatch(reportTemplate, /report-dot|report-unread/)
  const reportStyle = read('miniprogram/pages/ai-notifications/index.wxss')
  assert.match(reportStyle, /\.status-unread\s*\{[^}]*background:\s*var\(--color-accent-ink\);[^}]*color:\s*var\(--color-on-accent\)/, '未读为实心主题色标签，与浅蓝的「微信已送达」区分')
})

test('文档同步记录历史报告入口与左滑删除', () => {
  const fs = require('fs'), path = require('path')
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  assert.match(read('docs/prd/slownote-prd.md'), /历史报告/)
  assert.match(read('docs/rules/frontend-standard.md'), /历史报告/)
  assert.match(read('docs/rules/introduction.md'), /历史报告/)
})
