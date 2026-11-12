const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs')
const { front, load, seed, memoryDb, service } = require('./helpers.cjs')
const { CATEGORIES } = require('../miniprogram/utils/categories')
const date = '2026-10-21'
const flush = () => new Promise(resolve => setImmediate(resolve))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const plain = value => JSON.parse(JSON.stringify(value))
const routes = CATEGORIES.map(category => {
  const [path, query] = category.url.split('?')
  return { ...category, pageName: path.split('/')[2], options: { ...Object.fromEntries(new URLSearchParams(query)), date } }
})
const drafts = {
  feeding: { duration: '12' }, solid: { solidName: '南瓜泥' },
  excretion: { exCount: '1', exShape: '正常' }, growth: { measurement: '65' },
  diary: { content: '今天有新发现' },
  custom: { label: '午睡', value: '40', unit: '分钟', note: '午后' }
}
async function enter(route, options = {}) {
  const f = front(route.pageName, options)
  f.app.globalData.activeBabyId = 'baby-a'
  f.app.globalData.openid = 'user-a'
  await f.page.onLoad(route.options)
  await f.page.onShow()
  await f.page.onReady()
  return f
}
async function submit(route, page) {
  if (route.key === 'feeding') return page.submitFeed()
  if (route.key === 'solid') return page.submitSolid()
  if (route.key === 'excretion') return page.submitExcretion()
  return page[route.key === 'custom' ? 'save' : 'submit']()
}

test('all six FAB routes enter the registration scene for signed-in users', async () => {
  const home = front('index'); await home.page.onLoad({}); home.page.refreshProfile()
  for (const route of routes) {
    home.page.chooseCategory({ currentTarget: { dataset: { key: route.key } } })
    assert.equal(home.calls.at(-1).url, route.url + '&date=' + date)
    let calls = 0
    const f = await enter(route, { callFunction: async () => { calls++; throw Error('history must not load') } })
    assert.equal(f.page.data.panelMode, true, route.key)
    f.page.onDate({ detail: { value: '2026-10-20' } })
    assert.equal(f.page.data.recordDate, '2026-10-20')
    assert.equal(calls, 0, route.key)
    assert.match(fs.readFileSync('miniprogram/pages/' + route.pageName + '/index.wxml', 'utf8'), /wx:if="{{!panelMode && !entryPending}}"/)
    f.page.onUnload()
  }
  home.page.onUnload()
})

test('registration waits for session initialization before enforcing login', async () => {
  for (const route of routes) {
    let finish
    const f = front(route.pageName)
    f.app.globalData.initialized = false
    f.app.init = () => new Promise(resolve => { finish = resolve })
    const loaded = f.page.onLoad(route.options)
    const shown = f.page.onShow()
    assert.equal(f.page.data.entryPending, true, route.key)
    assert.equal(f.page.data.panelMode, false, route.key)
    f.app.globalData.initialized = true
    f.app.globalData.loggedIn = true
    finish()
    await loaded; await shown
    assert.equal(f.page.data.entryPending, false, route.key)
    assert.equal(f.page.data.panelMode, true, route.key)
    f.page.onUnload()
  }
})

test('summary cards open the full-screen editor for their record category and selected date', async () => {
  const f = front('index'); await f.page.onLoad({})
  for (const route of routes) {
    f.page.openCard({ currentTarget: { dataset: { url: route.url, key: route.key } } })
    const query = new URLSearchParams(f.calls.at(-1).url.split('?')[1])
    assert.equal(query.get('panel'), route.options.panel)
    assert.equal(query.get('date'), date)
    assert.equal(query.get('cardEdit'), '1')
    assert.equal(query.get('recordKey'), route.key)
    if (route.options.category) assert.equal(query.get('category'), route.options.category)
  }
})

test('all six minimal forms save through unchanged services, return home, and refresh home and statistics', async () => {
  const db = memoryDb(seed(['feeding', 'growth', 'diary']))
  const apis = Object.fromEntries(['feedingRecord', 'growthRecord', 'customRecord', 'diaryRecord', 'statistics'].map(name => [name, service(name, db)]))
  const requests = []
  const callFunction = async request => {
    requests.push(plain(request))
    return { result: await apis[request.name].main(plain(request.data)) }
  }
  for (const route of routes) {
    const f = await enter(route, { callFunction })
    f.page.setData(drafts[route.key])
    await submit(route, f.page); await flush()
    const added = requests.at(-1)
    assert.equal(added.data.action, 'add', route.key)
    assert.equal(added.data.baby_id, 'baby-a')
    assert.equal(added.data.recordDate, date)
    assert(added.data.clientRequestId)
    assert(f.calls.some(c => c.icon === 'success'), route.key)
    assert.equal(f.page.data.closing, true, route.key)
    // The draft remains in place while the sheet exits; the list is never shown.
    for (const [key, value] of Object.entries(drafts[route.key])) assert.equal(f.page.data[key], value)
    const count = requests.length
    await submit(route, f.page); await flush()
    assert.equal(requests.length, count, 'no duplicate while closing: ' + route.key)
    await wait(430)
    assert(f.calls.some(c => c.type === 'switchTab' && c.url === '/pages/index/index'), route.key)
    f.page.onUnload()
  }
  assert.equal(db.rows('feeding_records').length, 3)
  assert.equal(db.rows('growth_records').length, 1)
  assert.equal(db.rows('custom_records').length, 1)
  assert.equal(db.rows('diary_records').length, 1)
  assert.deepEqual(plain(db.rows('feeding_records')[0].payload), { mode: 'breast', durationMin: 12 })
  assert.deepEqual(plain(db.rows('feeding_records')[1].payload), { name: '南瓜泥', note: '' })
  assert.deepEqual(plain(db.rows('feeding_records')[2].payload), { kind: 'stool', count: 1, shape: '正常' })
  assert.equal(db.rows('custom_records')[0].category, 'custom')
  const home = front('index', { callFunction }); home.app.globalData.activeBabyId = 'baby-a'; await home.page.onLoad({}); await home.page.onShow(); await flush()
  assert.equal(home.page.data.cards.length, 6)
  for (const key of ['solid', 'excretion', 'growth', 'diary', 'custom']) assert(home.page.data.cards.some(c => c.key === key))
  assert(home.page.data.cards.some(c => c.icon === 'feeding' && c.detail.includes('12')))
  assert(home.page.data.week.some(d => d.date === date && d.recorded))
  const statistics = front('statistics', { callFunction }); await statistics.page.onLoad({}); await statistics.page.onShow(); await flush()
  assert.equal(statistics.page.data.moduleCards.find(card => card.key === 'custom').primary, '1')
  assert.equal(statistics.page.data.moduleCards.find(card => card.key === 'custom').unit, '条')
  home.page.onUnload(); statistics.page.onUnload()
})

test('signed-out registration is redirected before form data loads', async () => {
  for (const route of routes) {
    let calls = 0
    const f = front(route.pageName, { callFunction: async () => { calls++; return { result: { code: 0 } } } })
    f.app.globalData.initialized = true
    f.app.globalData.loggedIn = false
    await f.page.onLoad(route.options)
    await f.page.onShow(); await flush()
    assert.equal(calls, 0, route.key)
    assert(f.calls.some(c => c.type === 'switchTab' && c.url === '/pages/mine/index'), route.key)
    assert.equal(f.page.data.entryPending, true)
    assert.equal(f.page.data.panelMode, false)
    f.page.onUnload()
  }
})

test('server denial and network failure retain drafts and the same retry identity for every category', async () => {
  for (const route of routes) {
    const requests = []
    const f = await enter(route, { callFunction: async r => { requests.push(plain(r)); return { result: { code: requests.length === 1 ? 403 : 503 } } } })
    f.page.setData(drafts[route.key])
    await submit(route, f.page); await flush(); await submit(route, f.page); await flush()
    assert.equal(requests.length, 2, route.key)
    assert.equal(requests[0].data.clientRequestId, requests[1].data.clientRequestId)
    for (const [key, value] of Object.entries(drafts[route.key])) assert.equal(f.page.data[key], value)
    assert(!f.page.data.closing)
    assert.equal(f.page.data.submitting, false)
    assert(!f.calls.some(c => c.icon === 'success' || c.type === 'switchTab'), route.key)
    f.page.onUnload()
  }
})

test('pending submission blocks duplicate taps and dismissal; switching away cannot navigate after unload', async () => {
  const route = routes[0]; let resolve, count = 0
  const f = await enter(route, { callFunction: () => { count++; return new Promise(done => { resolve = done }) } })
  f.page.setData(drafts.feeding)
  f.page.submitFeed(); f.page.submitFeed(); f.page.closePanel({ type: 'tap' })
  assert.equal(count, 1); assert.equal(f.page.data.submitting, true); assert(!f.page.data.closing)
  f.page.onUnload(); resolve({ result: { code: 0 } }); await flush(); await wait(430)
  assert(!f.calls.some(c => c.type === 'switchTab'))
})

test('registration close keeps its 400ms exit, returns to home in the stack, and falls back safely', () => {
  let done, delay, backs = 0, tabs = 0
  const home = { route: 'pages/index/index' }, form = { route: 'pages/feeding/index', data: { panelMode: true, panel: 'feed' }, setData(patch) { Object.assign(this.data, patch) } }
  const wx = { navigateBack(options) { backs++; assert.equal(options.delta, 2) }, switchTab(options) { tabs++; assert.equal(options.url, '/pages/index/index') } }
  const registration = load('miniprogram/utils/registration.js', { wx, getCurrentPages: () => [home, {}, form], setTimeout(fn, ms) { done = fn; delay = ms; return 1 }, clearTimeout() {} })
  registration.close(form); registration.close(form)
  assert.equal(delay, 400); assert.equal(backs, 0); assert.equal(form.data.panel, 'feed')
  done(); assert.equal(backs, 1); assert.equal(tabs, 0)
  form.data.closing = false
  wx.navigateBack = options => options.fail()
  registration.close(form); done(); assert.equal(tabs, 1)
})

test('backgrounding during close preserves panel and resumes dismissal after a confirmed save', async () => {
  const f = await enter(routes[0]); f.page.setData(drafts.feeding)
  await submit(routes[0], f.page); await flush()
  f.page.onHide()
  assert.equal(f.page.data.panel, 'feed'); assert.equal(f.page.data.closing, false)
  await f.page.onShow(); await wait(430)
  assert(f.calls.some(c => c.type === 'switchTab' && c.url === '/pages/index/index'))
  f.page.onUnload()
})

test('diary photo upload cache and idempotency survive a failed save, and growth types map to legacy keys', async () => {
  const diary = routes.find(r => r.key === 'diary'), requests = []; let uploads = 0
  const f = await enter(diary, { callFunction: async r => { requests.push(plain(r)); return { result: { code: 503 } } } })
  f.page.setData({ content: '文字', images: ['local.jpg'] })
  f.wx.cloud.uploadFile = async () => { uploads++; return { fileID: 'cloud://test/diary/user-a/photo.jpg' } }
  await f.page.submit(); await f.page.submit()
  assert.equal(uploads, 1); assert.equal(requests[0].data.clientRequestId, requests[1].data.clientRequestId)
  assert.deepEqual(requests[0].data.images, ['cloud://test/diary/user-a/photo.jpg'])
  f.page.onUnload()
  for (const [type, value] of [['height', '65'], ['weight', '6.2'], ['head', '40']]) {
    let request
    const g = await enter(routes.find(r => r.key === 'growth'), { callFunction: async r => { request = plain(r); return { result: { code: 503 } } } })
    g.page.selectGrowthType({ currentTarget: { dataset: { type } } }); g.page.setData({ measurement: value })
    await g.page.submit()
    assert.equal(request.data[type], value)
    for (const key of ['height', 'weight', 'head'].filter(key => key !== type)) assert.equal(request.data[key], '')
    g.page.onUnload()
  }
})
