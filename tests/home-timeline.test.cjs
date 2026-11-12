const test = require('node:test')
const assert = require('node:assert/strict')
const { front, memoryDb, seed, service } = require('./helpers.cjs')
const { summarize, series } = require('../cloudfunctions/statistics/lib/aggregation')
const { dailyCards, dailySummary } = require('../miniprogram/utils/viewmodels')
const { readSeries } = require('../miniprogram/utils/chart')
const date = '2026-10-21'
const daily = { action: 'daily', date, weekStart: '2026-10-18', baby_id: 'baby-a' }

test('daily timeline uses the latest real timestamp per category in Beijing time without crossing date or baby', async () => {
  const db = memoryDb(seed(['feeding', 'growth', 'diary', 'expense']))
  db.rows('feeding_records').push(
    { _id: 'early', openid: 'user-a', baby_id: 'baby-a', record_date: date, created_at: new Date('2026-10-21T01:00:00Z'), type: 'feed', payload: { mode: 'breast', durationMin: 5 } },
    { _id: 'late', openid: 'user-a', baby_id: 'baby-a', record_date: date, created_at: new Date('2026-10-21T06:48:00Z'), type: 'feed', payload: { mode: 'breast', durationMin: 10 } },
    { _id: 'solid', openid: 'user-a', baby_id: 'baby-a', record_date: date, created_at: new Date('2026-10-20T16:01:00Z'), type: 'solid', payload: { name: '米糊' } },
    { _id: 'other-baby', openid: 'user-a', baby_id: 'baby-b', record_date: date, created_at: new Date('2026-10-21T15:58:00Z'), type: 'feed', payload: { mode: 'breast', durationMin: 99 } },
    { _id: 'other-day', openid: 'user-a', baby_id: 'baby-a', record_date: '2026-10-20', created_at: new Date('2026-10-21T15:59:00Z'), type: 'feed', payload: { mode: 'breast', durationMin: 99 } }
  )
  db.rows('custom_records').push(
    { _id: 'out', openid: 'user-a', baby_id: 'baby-a', record_date: date, created_at: new Date('2026-10-21T02:02:00Z'), category: 'outdoor', value: 30 },
    { _id: 'custom', openid: 'user-a', baby_id: 'baby-a', record_date: date, created_at: new Date('2026-10-21T03:03:00Z'), category: 'custom', label: '午睡', value: 20, unit: '分钟' }
  )
  db.rows('diary_records').push({ _id: 'no-time', openid: 'user-a', baby_id: 'baby-a', record_date: date })
  const result = await service('statistics', db).main(daily)
  assert.equal(result.code, 0)
  assert.deepEqual({ ...result.times }, { breast: '14:48', solid: '00:01', custom: '11:03' })
  assert.equal(result.summary.feeding.count, 2)
  assert.equal(result.summary.feeding.byCategory.breast.durationMin, 15)
  const cards = dailyCards(result.summary, result.times)
  assert.equal(cards.find(card => card.key === 'diary').time, '')
  assert(!cards.some(card => card.key === 'outdoor' || card.key === 'expense'))
  assert(!cards.some(card => card.key === 'milestone'))
})

test('daily card information comes from raw summary values, preserves zero and missing values, and supports duplicate custom labels', () => {
  const summary = summarize({ feeding: [
    { type: 'feed', payload: { mode: 'breast', durationMin: 12 } },
    { type: 'feed', payload: { mode: 'bottle', amountMl: 120.125 } },
    { type: 'excretion', payload: { kind: 'urine' } },
    { type: 'solid', payload: { name: '米糊' } }
  ], growth: [{ record_date: date, weight: 6.5, height: 62, head: 40 }],
    custom: [{ category: 'custom', label: '午睡', value: 0, unit: '分钟' }, { category: 'custom', label: '午睡' }],
    diary: [{}], expense: [{ amount: 12.345 }] })
  const original = JSON.stringify(summary)
  const cards = dailyCards(summary, { breast: '09:30' })
  const card = key => cards.find(item => item.key === key)
  assert.equal(card('breast').time, '09:30')
  assert.equal(card('bottle').items.find(item => item.label === '奶量').value, '120.13 ml')
  assert.equal(card('breast').items.find(item => item.label === '奶量').value, '—')
  assert.equal(card('solid').items.length, 1)
  assert.equal(card('excretion').items[1].value, '1次')
  assert.equal(card('growth').items.find(item => item.label === '头围').value, '40.0 cm')
  assert.deepEqual(card('custom').items.map(item => item.value), ['0.00分钟', '已记'])
  assert.equal(new Set(card('custom').items.map(item => item.key)).size, 2)
  assert.equal(JSON.stringify(summary), original)
  assert(dailyCards(summary).every(item => item.time === ''))
})

test('daily cards sort newest timestamps first and leave cards without timestamps last', () => {
  const summary = {
    feeding: { byCategory: {
      breast: { count: 1, durationMin: 5 },
      solid: { count: 1 },
      excretion: { count: 1, stoolCount: 1, urineCount: 0 }
    } },
    growth: { count: 1, weight: { latest: 5 }, height: { latest: 50 }, head: { latest: null } },
    diary: { count: 1 },
    custom: { count: 1, entries: [{ label: '午睡', value: 20, unit: '分钟' }] },
    milestone: { count: 1 }
  }
  const cards = dailyCards(summary, {
    breast: '14:44', solid: '14:47', excretion: '14:45', growth: '14:48',
    custom: '14:46', milestone: '14:45'
  })
  assert.deepEqual(cards.map(card => card.key), ['growth', 'solid', 'custom', 'excretion', 'breast', 'diary'])
  assert.equal(cards[0].time, '14:48')
  assert.equal(cards[cards.length - 1].time, '')
})

test('daily tags count feed operations separately from solid and excretion and keep category units', () => {
  const summary = summarize({ feeding: [{ type: 'feed', payload: { mode: 'breast' } }, { type: 'feed', payload: { mode: 'bottle' } }, { type: 'solid', payload: {} }, { type: 'excretion', payload: { kind: 'stool' } }], diary: [{}], growth: [{ height: 62 }], expense: [{ amount: 100 }] })
  const tags = Object.fromEntries(dailySummary(summary).map(item => [item.key, item.value]))
  assert.deepEqual(tags, { feeding: '2次', solid: '1次', excretion: '1次', growth: '1笔', diary: '1篇' })
  assert.equal(Object.hasOwn(tags, 'milestone'), false)
  assert.deepEqual(dailySummary(summarize({})), [])
  assert.deepEqual(dailyCards(null), [])
})

test('excretion summaries and charts sum the entered event counts, not form submissions', () => {
  const rows = [
    { type: 'excretion', record_date: date, payload: { kind: 'stool', count: 2 } },
    { type: 'excretion', record_date: date, payload: { kind: 'urine', count: 4 } },
    { type: 'excretion', record_date: date, payload: { kind: 'urine', count: 3 } },
    { type: 'excretion', record_date: date, payload: { kind: 'stool', count: 2 } }
  ]
  const summary = summarize({ feeding: rows })
  const excretion = summary.feeding.byCategory.excretion
  const card = dailyCards(summary).find(item => item.key === 'excretion')
  const tag = dailySummary(summary).find(item => item.key === 'excretion')
  assert.equal(excretion.count, 4)
  assert.equal(excretion.stoolCount, 4)
  assert.equal(excretion.urineCount, 7)
  assert.equal(card.value, 11)
  assert.deepEqual(card.items.map(item => item.value), ['4次', '7次'])
  assert.equal(tag.value, '11次')
  assert.deepEqual(series({ feeding: rows }).excretion, [{ d: date, stool: 4, urine: 7 }])
})

test('growth trends retain the latest non-empty value for each metric on the day and custom zero values remain chartable', () => {
  const growth = series({ growth: [
    { record_date: date, created_at: new Date('2026-10-21T01:00:00Z'), height: 62, weight: 6 },
    { record_date: date, created_at: new Date('2026-10-21T02:00:00Z'), weight: 6.2 }
  ] })
  assert.deepEqual(growth.growth, [{ d: date, height: 62, weight: 6.2 }])

  const custom = series({ custom: [{ category: 'custom', label: '午睡', value: 0, unit: '分钟', record_date: date }] })
  assert.deepEqual(custom.custom[0].points, [{ d: date, value: 0 }])
  const model = readSeries({ kind: 'line', series: [{ name: '午睡', unit: '分钟', points: [{ x: date, y: 0 }] }] })
  assert.deepEqual(model.series[0].points.map(point => point.y), [0])
})

test('statistics detail exposes all current-type metrics and defaults to the latest populated metric', async () => {
  const f = front('statistics-detail', { callFunction: async () => ({ result: { code: 0, dates: { start: '2026-10-18', end: '2026-10-25' }, series: {
    growth: [], feeding: [{ d: '2026-10-18', ml: 100.5 }, { d: '2026-10-21', ml: 200.25 }], solid: [], excretion: [], custom: []
  } } }) })
  f.page.onLoad({ type: 'feeding', range: 'week' })
  await f.page.load()
  assert.equal(f.page.data.selectedDate, '2026-10-21')
  assert.deepEqual(Array.from(f.page.data.metrics, item => item.name), ['奶量', '次数', '亲喂'])
  assert.deepEqual(Array.from(f.page.data.metricKeys), ['ml'])

  const zero = front('statistics-detail', { callFunction: async () => ({ result: { code: 0, dates: { start: date, end: '2026-10-22' }, series: {
    growth: [], feeding: [], solid: [], excretion: [], custom: [
      { label: '午睡', unit: '分钟', points: [{ d: date, value: 0 }] },
      { label: '清醒', unit: '分钟', points: [{ d: date, value: 15 }] }
    ]
  } } }) })
  zero.page.onLoad({ type: 'custom', range: 'week' })
  zero.page._chartVisible = false
  await zero.page.load()
  assert.deepEqual(Array.from(zero.page.data.metrics, item => item.name), ['午睡', '清醒'])
  assert.deepEqual(Array.from(zero.page.data.metricKeys), ['午睡'])
  assert.equal(zero.page.data.selectedDate, date)
})

test('home loads timeline and tags together and discards an older date response', async () => {
  const requests = []
  const f = front('index', { callFunction: () => new Promise(resolve => requests.push(resolve)) })
  f.app.globalData.activeBabyId = 'baby-a'
  const first = f.page.load()
  f.page.setDate('2026-10-20', false)
  const second = f.page.load()
  const result = (summary, times) => ({ result: { code: 0, summary, times, marks: [] } })
  requests[1](result(summarize({ diary: [{}] }), { diary: '10:00' })); await second
  requests[0](result(summarize({ expense: [{ amount: 100 }] }), { expense: '11:00' })); await first
  assert.equal(f.page.data.cards[0].key, 'diary')
  assert.equal(f.page.data.cards[0].time, '10:00')
  assert.equal(f.page.data.summaryTags[0].key, 'diary')
  f.app.globalData.loggedIn = false; await f.page.load()
  assert.equal(f.page.data.cards.length, 0)
  assert.equal(f.page.data.summaryTags.length, 0)
})

test('card edit mode does not measure timeline slots or persist reordered card values', () => {
  const f = front('index')
  f.app.globalData.openid = 'user-a'; f.app.globalData.activeBabyId = 'baby-a'
  f.page.setData({ cards: [{ key: 'breast', value: 2 }, { key: 'growth', value: 6.5 }, { key: 'diary', value: 3 }], activeTags: ['breast'] })
  f.wx.createSelectorQuery = () => { throw new Error('card edit mode must not measure DOM') }
  f.page.beginCardEdit()
  assert.equal(f.page.data.cardEditing, true)
  assert.deepEqual(Array.from(f.page.data.cards, card => [card.key, card.value]), [['breast', 2], ['growth', 6.5], ['diary', 3]])
  assert.deepEqual(f.storage, {})
  f.page.finishCardEdit()
  assert.deepEqual(f.storage, {})
})
