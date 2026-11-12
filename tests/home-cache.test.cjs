const test = require('node:test'), assert = require('node:assert/strict')
const { front } = require('./helpers.cjs')

const date = '2026-10-21'
const summary = () => ({
  feeding: { count: 1, byCategory: { breast: { count: 1, durationMin: 12 } } },
  growth: { count: 0 }, diary: { count: 0 }, custom: { count: 0 }, milestone: { count: 0 }
})
const dailyResponse = () => ({ result: { code: 0, summary: summary(), times: { breast: '09:10' }, marks: [date] } })
const cachedCard = { key: 'breast', tag: 'feeding', name: '亲喂', value: 1, unit: '次', detail: '旧摘要', items: [] }

test('home keeps same-date cards visible until the silent daily refresh replaces them', async () => {
  let resolveDaily
  const f = front('index', { callFunction: () => new Promise(resolve => { resolveDaily = resolve }) })
  f.app.globalData.loggedIn = true
  f.app.globalData.activeBabyId = 'baby-a'
  f.page.setData({ selectedDate: date, cards: [cachedCard], activeTags: [], loading: false })
  f.page._allCards = [cachedCard]
  f.page._allCardsDate = date
  f.page._allCardsBabyId = 'baby-a'

  const request = f.page.load()
  assert.equal(f.page.data.loading, false)
  assert.equal(f.page.data.cards[0].detail, '旧摘要')
  assert.equal(f.page.data.cards.length, 1)

  resolveDaily(dailyResponse())
  await request
  assert.equal(f.page.data.loading, false)
  assert.equal(f.page.data.cards[0].detail, '亲喂 12.00 分钟')
  assert.equal(f.page.data.cards[0].time, '09:10')
  f.page.onUnload()
})

test('home shows cached cards for a recent save marker and clears it after revalidation', async () => {
  let dailyCalls = 0
  let resolveDaily
  const f = front('index', { callFunction: request => {
    if (request.name === 'statistics') { dailyCalls++; return new Promise(resolve => { resolveDaily = resolve }) }
    return { result: { code: 0, milestones: [] } }
  } })
  f.app.globalData.loggedIn = true
  f.app.globalData.activeBabyId = 'baby-a'
  await f.page.onLoad({})
  f.page.setData({ selectedDate: date, cards: [cachedCard], activeTags: [], loading: false })
  f.page._allCards = [cachedCard]
  f.page._allCardsDate = date
  f.page._allCardsBabyId = 'baby-a'
  f.app.globalData.homeRefresh = { date, at: Date.now() }

  await f.page.onShow()
  assert.equal(f.page.data.cards[0].detail, '旧摘要')
  assert.equal(dailyCalls, 1)
  resolveDaily(dailyResponse())
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.page.data.cards[0].detail, '亲喂 12.00 分钟')
  assert.equal(f.app.globalData.homeRefresh, null)
  f.page.onUnload()
})

test('home opening the add panel clears a cached card from a different baby before showing it', async () => {
  let resolveDaily
  const requests = []
  const f = front('index', { callFunction: request => {
    requests.push(request)
    return new Promise(resolve => { resolveDaily = resolve })
  } })
  f.app.globalData.loggedIn = true
  f.app.globalData.activeBabyId = 'baby-b'
  f.page.setData({ selectedDate: date, loggedIn: true, cards: [cachedCard], summaryTags: [{ key: 'feeding' }], activeTags: [] })
  f.page._allCards = [cachedCard]
  f.page._allCardsDate = date
  f.page._allCardsBabyId = 'baby-a'

  f.page.openPanel()
  assert.equal(f.page.data.panel, true)
  assert.equal(f.page.data.cards.length, 0)
  assert.equal(f.page.data.summaryTags.length, 0)
  assert.equal(f.page._allCards.length, 0)
  assert.equal(f.page._allCardsDate, '')
  assert.equal(f.page._allCardsBabyId, '')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].data.baby_id, 'baby-b')

  resolveDaily(dailyResponse())
  await new Promise(resolve => setImmediate(resolve))
  f.page.onUnload()
})

test('home with no active baby clears cached cards without requesting family-wide daily data', async () => {
  let calls = 0
  const f = front('index', { callFunction: async () => { calls++; return dailyResponse() } })
  f.app.globalData.loggedIn = true
  f.app.globalData.activeBabyId = ''
  f.page.setData({ selectedDate: date, cards: [cachedCard], summaryTags: [{ key: 'feeding' }] })
  f.page._allCards = [cachedCard]
  f.page._allCardsDate = date
  f.page._allCardsBabyId = 'baby-a'
  await f.page.load()
  assert.equal(calls, 0)
  assert.equal(f.page.data.cards.length, 0)
  assert.equal(f.page.data.summaryTags.length, 0)
  assert.equal(f.page._allCards.length, 0)
  assert.equal(f.page._allCardsDate, '')
  assert.equal(f.page._allCardsBabyId, '')
  f.page.onUnload()
})

test('home session changes invalidate every card cache key and pending save marker', () => {
  const f = front('index')
  f.page._allCards = [cachedCard]
  f.page._allCardsDate = date
  f.page._allCardsBabyId = 'baby-a'
  f.app.globalData.homeRefresh = { date, at: Date.now() }
  f.page.setData({ cards: [cachedCard], summaryTags: [{ key: 'feeding' }] })
  f.page.onSessionChange()
  assert.equal(f.page._allCards.length, 0)
  assert.equal(f.page._allCardsDate, '')
  assert.equal(f.page._allCardsBabyId, '')
  assert.equal(f.page.data.cards.length, 0)
  assert.equal(f.page.data.summaryTags.length, 0)
  assert.equal(f.app.globalData.homeRefresh, null)
  f.page.onUnload()
})
