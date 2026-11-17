const test = require('node:test'), assert = require('node:assert/strict')
const { front, memoryDb, seed, service } = require('./helpers.cjs')
const { dailyCards } = require('../miniprogram/utils/viewmodels')
const date = '2026-10-21'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const loadDelete = (db, event) => service('homeCards', db).main(event)

test('home card deletion removes only the selected category on the selected day and baby', async () => {
  const db = memoryDb(seed(['feeding', 'growth', 'diary', 'expense']))
  db.rows('feeding_records').push(
    { _id: 'feed-1', openid: 'user-a', type: 'feed', payload: { mode: 'breast', durationMin: 12 }, record_date: date, baby_id: 'baby-a', created_at: new Date('2026-10-21T01:00:00Z') },
    { _id: 'feed-2', openid: 'user-a', type: 'solid', payload: { name: '米糊' }, record_date: date, baby_id: 'baby-a', created_at: new Date('2026-10-21T02:00:00Z') },
    { _id: 'feed-3', openid: 'user-a', type: 'feed', payload: { mode: 'breast', durationMin: 8 }, record_date: date, baby_id: 'baby-b', created_at: new Date('2026-10-21T03:00:00Z') },
    { _id: 'feed-4', openid: 'user-a', type: 'feed', payload: { mode: 'breast', durationMin: 5 }, record_date: '2026-10-20', baby_id: 'baby-a', created_at: new Date('2026-10-20T03:00:00Z') }
  )
  const result = await loadDelete(db, { action: 'deleteDay', category: 'breast', recordDate: date, baby_id: 'baby-a', clientRequestId: 'delete-breast-1' })
  assert.equal(result.code, 0); assert.equal(result.deleted, 1)
  assert.deepEqual(db.rows('feeding_records').map(row => row._id).sort(), ['feed-2', 'feed-3', 'feed-4'])
  const retry = await loadDelete(db, { action: 'deleteDay', category: 'breast', recordDate: date, baby_id: 'baby-a', clientRequestId: 'delete-breast-1' })
  assert.equal(retry.code, 0); assert.equal(retry.deleted, 1)
})

test('home card deletion never crosses a family or baby scope without category grants', async () => {
  const db = memoryDb(seed(['feeding']))
  db.rows('family_members').push({ _id: 'member-a', openid: 'user-a', familyId: 'family-a' })
  db.rows('feeding_records').push(
    { _id: 'family-feed-a', family_id: 'family-a', baby_id: 'baby-a', type: 'feed', payload: { mode: 'bottle' }, record_date: date },
    { _id: 'family-feed-b', family_id: 'family-a', baby_id: 'baby-b', type: 'feed', payload: { mode: 'bottle' }, record_date: date },
    { _id: 'other-family-feed', family_id: 'family-b', baby_id: 'baby-a', type: 'feed', payload: { mode: 'bottle' }, record_date: date }
  )
  const event = { action: 'deleteDay', category: 'bottle', recordDate: date, baby_id: 'baby-a', clientRequestId: 'family-delete-1' }
  const result = await loadDelete(db, event)
  assert.equal(result.deleted, 1)
  assert.deepEqual(db.rows('feeding_records').map(row => row._id).sort(), ['family-feed-b', 'other-family-feed'])

  const deniedDb = memoryDb(seed([]))
  deniedDb.rows('growth_records').push({ _id: 'growth-1', openid: 'user-a', baby_id: 'baby-a', record_date: date })
  deniedDb.rows('feeding_records').push({ _id: 'feed-no-grant', openid: 'user-a', baby_id: 'baby-a', type: 'feed', payload: { mode: 'bottle' }, record_date: date })
  const allowed = await loadDelete(deniedDb, { ...event, category: 'bottle', clientRequestId: 'no-grant-1' })
  assert.equal(allowed.code, 0)
  assert.equal(deniedDb.rows('feeding_records').length, 0)
  assert.equal(deniedDb.rows('growth_records').length, 1)
})

test('home card deletion safely completes and replays multi-batch requests', async () => {
  const db = memoryDb(seed(['feeding']))
  for (let index = 0; index < 45; index++) db.rows('feeding_records').push({
    _id: 'feed-batch-' + index, openid: 'user-a', baby_id: 'baby-a', type: 'feed',
    payload: { mode: 'formula' }, record_date: date, created_at: new Date('2026-10-21T01:00:00Z')
  })
  const event = { action: 'deleteDay', category: 'formula', recordDate: date, baby_id: 'baby-a', clientRequestId: 'batch-delete-1' }
  const result = await loadDelete(db, event)
  assert.equal(result.deleted, 45)
  assert.equal(result.matched, 45)
  assert.equal(db.rows('feeding_records').length, 0)
  const retry = await loadDelete(db, event)
  assert.equal(retry.deleted, 45)
  assert.equal(db.rows('feeding_records').length, 0)
})

test('every home card category maps to its own record family without deleting adjacent categories', async () => {
  const categories = [
    ['breast', 'feeding_records', { type: 'feed', payload: { mode: 'breast' } }],
    ['bottle', 'feeding_records', { type: 'feed', payload: { mode: 'bottle' } }],
    ['formula', 'feeding_records', { type: 'feed', payload: { mode: 'formula' } }],
    ['mixed', 'feeding_records', { type: 'feed', payload: { mode: 'mixed' } }],
    ['solid', 'feeding_records', { type: 'solid', payload: {} }],
    ['excretion', 'feeding_records', { type: 'excretion', payload: {} }],
    ['growth', 'growth_records', {}],
    ['diary', 'diary_records', {}],
    ['outdoor', 'custom_records', { category: 'outdoor' }],
    ['custom', 'custom_records', { category: 'custom' }],
    ['milestone', 'milestone_records', {}]
  ]
  for (const [category, collection, fields] of categories) {
    const db = memoryDb(seed())
    db.rows(collection).push(
      { _id: 'target-' + category, openid: 'user-a', baby_id: 'baby-a', record_date: date, ...fields },
      { _id: 'neighbor-' + category, openid: 'user-a', baby_id: 'baby-a', record_date: date,
        ...(category === 'breast' ? { type: 'feed', payload: { mode: 'bottle' } } : category === 'bottle' ? { type: 'feed', payload: { mode: 'breast' } } : category === 'outdoor' ? { category: 'custom' } : category === 'custom' ? { category: 'outdoor' } : collection === 'feeding_records' ? { type: category === 'solid' ? 'excretion' : 'solid', payload: {} } : fields) }
    )
    const result = await loadDelete(db, { action: 'deleteDay', category, recordDate: date, baby_id: 'baby-a', clientRequestId: 'category-' + category + '-1' })
    const needsSubtypeFilter = ['breast', 'bottle', 'formula', 'mixed', 'solid', 'excretion', 'outdoor', 'custom'].includes(category)
    assert.equal(result.deleted, needsSubtypeFilter ? 1 : 2, category)
    assert.deepEqual(db.rows(collection).map(row => row._id), needsSubtypeFilter ? ['neighbor-' + category] : [], category)
  }
})

test('home delete removes immediately, rolls back failure, and retries with the same id without a reload', async () => {
  let finish, requests = [], confirmations = 0
  const f = front('index', { callFunction: request => { requests.push(request); return new Promise(resolve => { finish = resolve }) } })
  f.wx.showModal = options => { confirmations++; options.success({ confirm: true }) }
  Object.assign(f.app.globalData, { loggedIn: true, openid: 'user-a', activeBabyId: 'baby-a' })
  const cards = [{ key: 'feeding', tag: 'feeding', name: '喂养', value: 2, url: '/pages/feeding/index', swipeX: -55 }]
  f.page.setData({ selectedDate: date, cards, summaryTags: [{ key: 'feeding', count: 2, value: '2次' }], activeTags: ['feeding'] })
  f.page._allCards = cards
  let loads = 0
  const load = f.page.load
  f.page.load = () => { loads++; return Promise.resolve() }
  let pending = f.page.removeCard({ currentTarget: { dataset: { key: 'feeding' } } })
  await wait(0)
  assert.equal(f.page.data.cards.length, 0, 'removed before the network resolves')
  assert.equal(f.page._allCards.length, 0)
  assert.equal(f.page.data.summaryTags.length, 0)
  f.page.setData({ cardBusy: false, cardSettling: false }) // hide resets presentation flags while deletion remains in flight
  await load.call(f.page)
  assert.equal(requests.length, 1, 'a returning page cannot re-read stale cached cards during deletion')
  finish({ result: { code: 503 } }); await pending
  assert.equal(f.page.data.cards[0].key, 'feeding')
  assert.equal(f.page.data.cards[0].swipeX, 0)
  assert.equal(f.page._allCards.length, 1)
  assert.equal(f.page.data.summaryTags[0].count, 2)
  assert.deepEqual(Array.from(f.page.data.activeTags), ['feeding'])
  pending = f.page.removeCard({ currentTarget: { dataset: { key: 'feeding' } } })
  await wait(0)
  assert.equal(f.page.data.cards.length, 0)
  finish({ result: { code: 0, deleted: 1 } }); await pending
  await wait(220)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].data.clientRequestId, requests[1].data.clientRequestId)
  assert.equal(confirmations, 2)
  assert.equal(f.page.data.cards.length, 0)
  assert.equal(f.page.data.cardSettling, false)
  assert.equal(loads, 0)
  f.page.onUnload()
})

test('home card delete also prunes the cached _allCards so load() never resurrects it', async () => {
  let calls = 0
  const f = front('index', { callFunction: async request => { calls++; return { result: { code: 0, deleted: 1 } } } })
  f.wx.showModal = options => options.success({ confirm: true })
  f.app.globalData.loggedIn = true; f.app.globalData.openid = 'user-a'; f.app.globalData.activeBabyId = 'baby-a'
  const feeding = { key: 'feeding', name: '喂养', url: '/pages/feeding/index' }
  const growth = { key: 'growth', name: '成长', url: '/pages/growth/index' }
  f.page.setData({ selectedDate: date, cards: [feeding, growth] })
  f.page._allCards = [feeding, growth]
  f.page._allCardsDate = date
  f.page._allCardsBabyId = 'baby-a'
  let loads = 0
  f.page.load = () => { loads++; return Promise.resolve() }
  await f.page.removeCard({ currentTarget: { dataset: { key: 'feeding' } } })
  await wait(240)
  assert.equal(calls, 1)
  assert.equal(f.page.data.cards.length, 1)
  assert.equal(f.page.data.cards[0].key, 'growth')
  assert.equal(f.page._allCards.length, 1)
  assert.equal(f.page._allCards[0].key, 'growth')
  assert.equal(loads, 0)
  f.page.onUnload()
})

test('home swipe closes before navigation and never measures DOM or persists order', () => {
  const f = front('index')
  f.page.setData({ cards: [{ key: 'feeding', swipeX: 0 }, { key: 'growth', swipeX: 0 }], activeTags: ['feeding'] })
  f.wx.createSelectorQuery = () => { throw new Error('swipe must not measure DOM') }
  f.page.onCardTouchStart({ currentTarget: { dataset: { key: 'feeding' } }, touches: [{ clientX: 200, clientY: 50 }] })
  f.page.onCardTouchMove({ touches: [{ clientX: 110, clientY: 50 }] })
  f.page.onCardTouchEnd()
  assert.equal(f.page.data.cards[0].swipeX, -55)
  const event = { currentTarget: { dataset: { key: 'feeding', url: '/pages/feeding/index' } } }
  f.page.openCard(event)
  assert.equal(f.calls.some(call => call.type === 'navigateTo'), false)
  f.page._ignoreCardTapUntil = 0
  f.page.openCard(event)
  assert.equal(f.calls.filter(call => call.type === 'navigateTo').length, 1)
  assert.deepEqual(f.storage, {})
  const template = require('node:fs').readFileSync('miniprogram/pages/index/index.wxml', 'utf8')
  assert.doesNotMatch(template, /bindlongpress|card-remove|beginCardEdit|cardEditing|metric-wiggle/)
  assert.match(template, /class="metric-swipe/)
  assert.match(template, /catchtap="removeCard"/)
  f.page.onUnload()
})
