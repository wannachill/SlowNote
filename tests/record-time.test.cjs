const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { seed, memoryDb, service, front, load } = require('./helpers.cjs')

const day = '2026-10-20'
const rt = load('miniprogram/utils/record-time.js')
const runtime = load('cloudfunctions/_shared/runtime.js')

test('record-time tool builds 24/60/60 columns and round-trips HH:mm:ss', () => {
  assert.deepEqual(Array.from(rt.TIME_COLUMNS, c => c.length), [24, 60, 60])
  assert.equal(rt.TIME_COLUMNS[0][0], '00')
  assert.equal(rt.TIME_COLUMNS[0][23], '23')
  assert.equal(rt.TIME_COLUMNS[1][59], '59')
  assert.deepEqual(Array.from(rt.timeToIndexes('09:07:05')), [9, 7, 5])
  assert.equal(rt.indexesToTime([9, 7, 5]), '09:07:05')
  assert.equal(rt.indexesToTime([23, 59, 59]), '23:59:59')
  assert.equal(rt.validTime('23:59:59'), true)
  assert.equal(rt.validTime('24:00:00'), false)
  assert.equal(rt.validTime('12:60:00'), false)
  assert.equal(rt.validTime('12:30'), false)
  assert.equal(rt.validTime(''), false)
})

test('Beijing time conversion and legacy fallback never invent a time', () => {
  assert.equal(rt.timeKey('2026-10-21T06:48:00Z'), '14:48:00')
  assert.equal(rt.timeKey('2026-10-20T16:01:00Z'), '00:01:00')
  assert.equal(rt.timeKey(undefined), '')
  assert.equal(rt.timeKey(null), '')
  assert.equal(rt.timeKey('not-a-date'), '')
  assert.equal(rt.displayTime('09:07:05', '2026-10-21T06:48:00Z'), '09:07:05')
  assert.equal(rt.displayTime('', '2026-10-21T06:48:00Z'), '14:48:00')
  assert.equal(rt.displayTime('', undefined), '')
  assert.match(rt.nowTime(), /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)
  assert.match(rt.recordTimeData().recordTime, /^\d{2}:\d{2}:\d{2}$/)
  assert.equal(rt.recordTimeData('08:01:02').recordTime, '08:01:02')
  assert.deepEqual(Array.from(rt.recordTimeData('08:01:02').timeIndexes), [8, 1, 2])
})

test('server accepts a chosen HH:mm:ss, defaults to now, and rejects malformed values', async () => {
  assert.equal(runtime.validTime('00:00:00'), true)
  assert.equal(runtime.validTime('24:00:00'), false)
  assert.equal(runtime.normalizeRecordTime('07:08:09'), '07:08:09')
  assert.match(runtime.normalizeRecordTime(undefined), /^\d{2}:\d{2}:\d{2}$/)
  assert.throws(() => runtime.normalizeRecordTime('7:8:9'), err => err.code === 400 && err.message === 'INVALID_TIME')
  assert.equal(runtime.recordTimeOf({ record_time: '07:08:09', created_at: new Date('2026-10-21T06:48:00Z') }), '07:08:09')
  assert.equal(runtime.recordTimeOf({ created_at: new Date('2026-10-21T06:48:00Z') }), '14:48:00')
  assert.equal(runtime.recordTimeOf({}), '')
  assert.equal(runtime.recordTimeValue({ record_time: '07:08:09' }), 7 * 3600 + 8 * 60 + 9)
})

test('four record functions persist record_time on add and update, and list returns it', async () => {
  const cases = [
    { name: 'feedingRecord', table: 'feeding_records', add: { type: 'feed', payload: { mode: 'bottle', amountMl: 90 } }, update: { action: 'update', type: 'feed', payload: { mode: 'bottle', amountMl: 100 }, recordDate: day }, list: { action: 'listDate', recordDate: day, baby_id: 'baby-a' } },
    { name: 'growthRecord', table: 'growth_records', add: { height: 65, weight: 6.2, head: null }, update: { action: 'update', height: 66, weight: 6.3, head: null, recordDate: day }, list: { action: 'listDate', recordDate: day, baby_id: 'baby-a' } },
    { name: 'diaryRecord', table: 'diary_records', add: { content: '第一次翻身' }, update: { action: 'update', content: '会翻身啦', images: [], recordDate: day }, list: { action: 'list', baby_id: 'baby-a' } },
    { name: 'customRecord', table: 'custom_records', add: { category: 'custom', label: '午睡', value: '', unit: '', note: '' }, update: { action: 'update', category: 'custom', label: '午睡', value: '', unit: '', note: '', recordDate: day }, list: { action: 'list', recordDate: day, baby_id: 'baby-a' } }
  ]
  for (const c of cases) {
    const db = memoryDb(seed()), api = service(c.name, db)
    const added = await api.main({ ...c.add, recordDate: day, recordTime: '08:09:10', baby_id: 'baby-a', clientRequestId: `${c.name}-time-01` })
    assert.equal(added.code, 0, c.name)
    const id = added.data.id
    assert.equal(db.rows(c.table)[0].record_time, '08:09:10', c.name)
    assert.equal(db.rows(c.table)[0].record_date, day, c.name)
    await api.main({ ...c.update, id, recordTime: '21:22:23' })
    assert.equal(db.rows(c.table)[0].record_time, '21:22:23', c.name)
    const listed = await api.main(c.list)
    assert.equal(listed.code, 0, c.name)
    const row = listed.records.find(r => (r.id || r._id) === id)
    assert.ok(row, c.name)
    assert.equal(row.record_time || row.record_date === day ? (row.record_time || '21:22:23') : '', '21:22:23', c.name)
    const invalid = await api.main({ ...c.add, recordDate: day, recordTime: '99:99:99', baby_id: 'baby-a', clientRequestId: `${c.name}-bad-01` })
    assert.equal(invalid.code, 400, c.name)
    assert.equal(invalid.message, 'INVALID_TIME', c.name)
    assert.equal(db.rows(c.table).length, 1, c.name + ' must not write invalid row')
  }
})

test('backdated records keep distinct chosen times in the list order', async () => {
  const db = memoryDb(seed()), api = service('feedingRecord', db)
  const rows = [
    { id: 'a', time: '07:00:00', created: '2026-10-21T04:00:00Z' },
    { id: 'b', time: '19:30:15', created: '2026-10-21T05:00:00Z' },
    { id: 'c', time: '12:05:45', created: '2026-10-21T06:00:00Z' }
  ]
  for (const r of rows) {
    await api.main({ type: 'feed', payload: { mode: 'bottle', amountMl: 90 }, recordDate: day, recordTime: r.time, baby_id: 'baby-a', clientRequestId: `backfill-${r.id}-0001` })
  }
  const result = await api.main({ action: 'listDate', recordDate: day, baby_id: 'baby-a' })
  assert.deepEqual(Array.from(result.records, r => r.record_time), ['19:30:15', '12:05:45', '07:00:00'])
})

test('statistics daily timeline prefers chosen record_time over created_at', async () => {
  const db = memoryDb(seed())
  db.rows('feeding_records').push(
    { _id: 'f1', openid: 'user-a', baby_id: 'baby-a', record_date: day, record_time: '07:10:11', created_at: new Date('2026-10-21T15:00:00Z'), type: 'feed', payload: { mode: 'breast', durationMin: 5 } },
    { _id: 'f2', openid: 'user-a', baby_id: 'baby-a', record_date: day, record_time: '19:20:21', created_at: new Date('2026-10-21T01:00:00Z'), type: 'feed', payload: { mode: 'breast', durationMin: 10 } }
  )
  const result = await service('statistics', db).main({ action: 'daily', date: day, weekStart: '2026-10-18', baby_id: 'baby-a' })
  assert.equal(result.code, 0)
  assert.equal(result.times.breast, '19:20')
})

test('all six record pages expose a date+time picker wired to the shared handler', () => {
  for (const name of ['feeding', 'solid', 'excretion', 'growth', 'diary', 'custom-record']) {
    const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages', name, 'index.wxml'), 'utf8')
    assert.match(wxml, /mode="multiSelector"/, name)
    assert.match(wxml, /range="\{\{timeColumns\}\}"/, name)
    assert.match(wxml, /bindchange="onRecordTime"/, name)
    assert.match(wxml, /\{\{recordTime\}\}/, name)
    const js = fs.readFileSync(path.join(__dirname, '../miniprogram/pages', name, 'index.js'), 'utf8')
    assert.match(js, /withRecordTime\(/, name)
    assert.match(js, /recordTime: this\.data\.recordTime/, name)
  }
})

test('page wrapper defaults to now, updates on picker change, and invalidates the idempotency key', () => {
  const f = front('feeding', { callFunction: async () => ({ result: { code: 0, records: [] } }) })
  f.app.globalData.activeBabyId = 'baby-a'
  f.page.onLoad({})
  assert.match(f.page.data.recordTime, /^\d{2}:\d{2}:\d{2}$/)
  assert.deepEqual(f.page.data.timeIndexes.length, 3)
  assert.equal(f.page.data.timeColumns.length, 3)
  f.page._requestId = 'stale-key'
  f.page.onRecordTime({ detail: { value: [8, 9, 10] } })
  assert.equal(f.page.data.recordTime, '08:09:10')
  assert.deepEqual(Array.from(f.page.data.timeIndexes), [8, 9, 10])
  assert.equal(f.page._requestId, '')
  f.page.resetRecordTime()
  assert.equal(f.page._timeTouched, false)
  assert.match(f.page.data.recordTime, /^\d{2}:\d{2}:\d{2}$/)
})
