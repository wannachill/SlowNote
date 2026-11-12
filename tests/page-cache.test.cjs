const test = require('node:test'), assert = require('node:assert/strict')
const { load, front } = require('./helpers.cjs')

function harness() {
  const storage = {}
  const wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: key => { delete storage[key] }
  }
  let clock = 1000
  const FakeDate = class extends Date { static now() { return clock } }
  const read = () => load('miniprogram/utils/page-cache.js', { wx, Date: FakeDate })
  return { storage, cache: read(), reload: read, advance: ms => { clock += ms } }
}

const summary = () => ({
  feeding: { count: 1, byCategory: { breast: { count: 1, durationMin: 12 } } },
  growth: { count: 0 }, diary: { count: 0 }, custom: { count: 0 }, milestone: { count: 0 }
})

test('page cache serves the same scope and params within 60 seconds', () => {
  const h = harness()
  h.cache.write('statistics.trend', { range: 'week', baby_id: 'b1' }, { totals: { feeding: { count: 1 } } })
  h.advance(59000)
  assert.deepEqual(h.cache.read('statistics.trend', { range: 'week', baby_id: 'b1' }), { totals: { feeding: { count: 1 } } })
})

test('page cache expires once the 60 second window passes', () => {
  const h = harness()
  h.cache.write('statistics.trend', { range: 'week' }, { ok: true })
  h.advance(60001)
  assert.equal(h.cache.read('statistics.trend', { range: 'week' }), null)
})

test('page cache isolates scopes and params from each other', () => {
  const h = harness()
  h.cache.write('home.daily', { date: '2026-10-21' }, { v: 1 })
  h.cache.write('home.daily', { date: '2026-10-22' }, { v: 2 })
  assert.equal(h.cache.read('home.daily', { date: '2026-10-21' }).v, 1)
  assert.equal(h.cache.read('home.daily', { date: '2026-10-22' }).v, 2)
  assert.equal(h.cache.read('statistics.trend', { date: '2026-10-21' }), null)
})

test('invalidating a scope drops its entries and keeps other scopes intact', () => {
  const h = harness()
  h.cache.write('home.daily', { date: 'a' }, { v: 1 })
  h.cache.write('statistics.trend', { range: 'week' }, { v: 2 })
  h.cache.invalidate('home')
  assert.equal(h.cache.read('home.daily', { date: 'a' }), null)
  assert.equal(h.cache.read('statistics.trend', { range: 'week' }).v, 2)
  assert.equal(h.storage[h.cache.keyOf('home.daily', { date: 'a' })], undefined)
})

test('page cache survives a cold start through local storage', () => {
  const h = harness()
  h.cache.write('home.daily', { date: 'a' }, { v: 1 })
  assert.equal(h.reload().read('home.daily', { date: 'a' }).v, 1)
})

test('page cache keeps oversized payloads in memory only', () => {
  const h = harness()
  h.cache.write('statistics.trend', { range: 'all' }, { text: 'x'.repeat(70000) })
  assert.equal(h.storage[h.cache.keyOf('statistics.trend', { range: 'all' })], undefined)
  assert.equal(h.cache.read('statistics.trend', { range: 'all' }).text.length, 70000)
  assert.equal(h.reload().read('statistics.trend', { range: 'all' }), null)
})

test('Xiao Mai reuses a fresh cache instead of requesting the cloud again', async () => {
  let calls = 0
  const f = front('statistics', { callFunction: async () => {
    calls += 1
    return { result: { code: 0, range: 'week', totals: { feeding: { count: 1, amountMl: 60 } } } }
  } })
  await f.page.load()
  assert.equal(calls, 1)
  await f.page.load()
  assert.equal(calls, 1)
  assert.equal(f.page.data.loading, false)
  assert.equal(f.page.data.moduleCards.length, 1)
})

test('pulling to refresh bypasses the cache without blanking existing cards', async () => {
  const f = front('statistics', { callFunction: async () => ({ result: { code: 0, range: 'week', totals: { feeding: { count: 1, amountMl: 60 } } } }) })
  await f.page.load()
  const request = f.page.load(true)
  assert.equal(f.page.data.loading, false)
  assert.equal(f.page.data.moduleCards.length, 1)
  await request
  assert.equal(f.page.data.moduleCards.length, 1)
})

test('home reuses the cached day and only requests once per window', async () => {
  let daily = 0
  const f = front('index', { callFunction: async request => {
    if (request.name === 'statistics') { daily += 1; return { result: { code: 0, summary: summary(), times: {}, marks: [] } } }
    return { result: { code: 0, milestones: [] } }
  } })
  f.app.globalData.loggedIn = true
  f.app.globalData.activeBabyId = 'baby-a'
  await f.page.onLoad({})
  await f.page.load()
  assert.equal(daily, 1)
  const cards = f.page.data.cards.length
  await f.page.load()
  assert.equal(daily, 1)
  assert.equal(f.page.data.cards.length, cards)
  assert.equal(f.page.data.loading, false)
  f.page.onUnload()
})
