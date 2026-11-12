const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { front } = require('./helpers.cjs')

test('Xiao Mai entry opens a blank general-purpose chat independent of range', async () => {
  const requests = []
  const brief = front('statistics', { callFunction: async request => {
    requests.push(request)
    return { result: { code: 0, range: request.data.range, totals: { feeding: { count: 2 } }, prevTotals: { feeding: { count: 1 } } } }
  } })
  brief.page.onRange({ detail: { value: 0 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests[0].data.range, 'day')
  assert.equal(brief.page.data.compareNote, '')
  assert.equal(brief.page.data.moduleCards.find(card => card.key === 'feeding').metrics.every(metric => !metric.deltaText), true)
  assert.deepEqual(Array.from(brief.page.data.moduleCards, card => card.key), ['feeding'])
  brief.page.askXiaoMai()
  const url = brief.calls.find(call => call.type === 'navigateTo').url
  assert.equal(url, '/pages/ai-chat/index')
  brief.page.setData({ rangeIndex: 2 })
  brief.page.askXiaoMai()
  const monthUrl = brief.calls.filter(call => call.type === 'navigateTo').at(-1).url
  assert.equal(monthUrl, '/pages/ai-chat/index')
  brief.page.setData({ rangeIndex: 3 })
  brief.page.askXiaoMai()
  const allUrl = brief.calls.filter(call => call.type === 'navigateTo').at(-1).url
  assert.equal(allUrl, '/pages/ai-chat/index')

  const chat = front('ai-chat')
  chat.page.onLoad({})
  assert.equal(chat.page.data.question, '')
  assert.equal(chat.page.data.focusInput, false)
  assert.equal(chat.page.data.sending, false)
})

test('Xiao Mai hides empty categories and shows the guide when the selected range has no records', async () => {
  let totals = { feeding: {}, solid: {}, excretion: {}, growth: {}, diary: {}, custom: {} }
  const f = front('statistics', { callFunction: async () => ({ result: { code: 0, range: 'week', totals } }) })

  await f.page.load()
  assert.equal(f.page.data.hasInsightData, false)
  assert.deepEqual(Array.from(f.page.data.moduleCards), [])
  f.page.openDetail({ currentTarget: { dataset: { type: 'feeding' } } })
  assert.equal(f.calls.some(call => call.type === 'navigateTo'), false)

  totals = { feeding: { count: 2, amountMl: 120 }, solid: {}, excretion: {}, growth: {}, diary: {}, custom: {} }
  await f.page.load(true)
  assert.equal(f.page.data.hasInsightData, true)
  assert.deepEqual(Array.from(f.page.data.moduleCards, card => card.key), ['feeding'])
  assert.equal(f.page.data.moduleCards.every(card => !card.empty), true)
})

test('monthly report task selection sends the monthly frequency', async () => {
  const f = front('ai-tasks')
  f.page.setData({ categories: [{ key: 'feeding', selected: true }], frequencyIndex: 2, consent: true })
  let payload
  f.wx.cloud.callFunction = async request => {
    if (request.name === 'aiTasks' && request.data.action === 'save') payload = request.data
    return { result: { code: 0, items: [], templateId: '' } }
  }
  await f.page.save()
  assert.equal(payload.frequency, 'monthly')
  assert.equal(payload.weekday, 1)
  assert.equal(f.page.data.saving, false)
})

test('editing an AI task prefills the sheet and dispatches update with the task id', async () => {
  let payload
  const tasks = [{ _id: 'task-1', openid: 'user-a', categories: ['growth'], frequency: 'weekly', time: '08:30', weekday: 3, enabled: true }]
  const f = front('ai-tasks', { callFunction: async request => {
    if (request.data.action === 'list') return { result: { code: 0, items: tasks, templateId: '' } }
    payload = request.data
    return { result: { code: 0 } }
  } })
  await f.page.onShow()
  await f.page.load()
  assert.equal(f.page.data.panel, false)
  f.page.startEdit({ currentTarget: { dataset: { id: 'task-1' } } })
  assert.equal(f.page.data.editingId, 'task-1')
  assert.equal(f.page.data.frequencyIndex, 1)
  assert.equal(f.page.data.time, '08:30')
  assert.equal(f.page.data.panel, true)
  await f.page.save()
  assert.equal(payload.action, 'update')
  assert.equal(payload.id, 'task-1')
  assert.equal(payload.frequency, 'weekly')
  assert.equal(f.page.data.panel, false)
  f.page.onUnload()
})

test('Xiao Mai empty guide and growth metric columns use the intended visual hierarchy', () => {
  const template = fs.readFileSync('miniprogram/pages/statistics/index.wxml', 'utf8')
  const style = fs.readFileSync('miniprogram/pages/statistics/index.wxss', 'utf8')
  assert.match(template, /class="ask-logo empty-guide-sprout"/)
  assert.match(template, /class="btn-primary" bindtap="goHome"[^>]*>去首页记一笔/)
  assert.match(template, /class="ask-entry"[^>]*aria-label="问问小迈，宝宝发育、喂养、睡眠都可以问"/)
  assert.match(template, /<text class="ask-placeholder">宝宝发育、喂养、睡眠……都可以问我<\/text>/)
  assert.match(template, /<view wx:if="\{\{hasInsightData\}\}" class="section overview-section">/)
  assert.doesNotMatch(template, /配置月度简报|goTasks/)
  const metricsStart = template.indexOf('class="module-metrics"')
  const ordinaryStart = template.indexOf('<view wx:else class="module-data">', metricsStart)
  const metricsTemplate = template.slice(metricsStart, ordinaryStart)
  assert(metricsTemplate.indexOf('class="module-metric-label"') < metricsTemplate.indexOf('class="module-metric-reading"'))
  assert(metricsTemplate.indexOf('class="module-metric-reading"') < metricsTemplate.indexOf('class="module-metric-delta'))
  assert(metricsTemplate.indexOf('class="module-metric-number"') < metricsTemplate.indexOf('class="module-metric-unit"'))
  assert.match(metricsTemplate, /class="module-metric-delta \{\{metric\.deltaDir\}\}">\{\{metric\.deltaText \? metric\.deltaArrow \+ metric\.deltaText : ''\}\}<\/text>/)
  assert.match(template, /item\.multi \? '查看' \+ item\.metrics\.length \+ '项指标'/)
  assert.doesNotMatch(metricsTemplate, /module-metric-value|compareNote|module-metric-delta[^\n]*metric\.unit/)
  assert.match(style, /\.module-name\s*\{[^}]*font-weight:\s*var\(--weight-bold\)/s)
  assert.match(style, /\.module-metric-label\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap/s)
  assert.match(style, /\.module-metric-reading\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden/s)
  assert.match(style, /\.module-metric-number\s*\{[^}]*min-width:\s*0;[^}]*text-align:\s*right/s)
  assert.match(style, /\.module-metric-unit\s*\{[^}]*min-width:\s*0;/s)
  assert.match(style, /\.module-metric-delta\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-width:\s*3em;[^}]*text-align:\s*right;[^}]*white-space:\s*nowrap/s)
  assert.doesNotMatch(style, /min-width:\s*(?:3\.6em|1\.8em)|\.module-sub-/)
  assert.match(style, /@media\s*\(max-width:\s*25em\)[\s\S]*?\.module-metric-reading\s*\{[^}]*font-size:\s*var\(--font-metric-compact\)/)
})
