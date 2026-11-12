const test = require('node:test')
const assert = require('node:assert/strict')
const { seed, memoryDb, service } = require('./helpers.cjs')

const day = '2026-10-20'

test('feeding mutations validate the stored owner and keep type-specific payloads', async () => {
  const db = memoryDb(seed()), api = service('feedingRecord', db), other = service('feedingRecord', db, { openid: 'user-b' })
  const added = await api.main({ type: 'feed', payload: { mode: 'bottle', amountMl: 90 }, recordDate: day, clientRequestId: 'feed-add-0001' })
  const id = added.data.id
  assert.equal((await other.main({ action: 'update', id, type: 'feed', payload: { mode: 'bottle', amountMl: 200 }, recordDate: day })).code, 404)
  assert.equal(db.rows('feeding_records')[0].payload.amountMl, 90)
  const updated = await api.main({ action: 'update', id, type: 'feed', payload: { mode: 'breast', durationMin: 12 }, recordDate: '2026-10-21' })
  assert.equal(updated.code, 0)
  assert.equal(updated.data.id, id)
  let row = db.rows('feeding_records')[0]
  assert.deepEqual(row.payload, { mode: 'breast', durationMin: 12 })
  assert.equal(row.record_date, '2026-10-21')
  const removed = await api.main({ action: 'delete', id })
  assert.equal(removed.code, 0)
  assert.equal(db.rows('feeding_records').length, 0)
})

test('growth mutations update only validated measurements and delete owned records', async () => {
  const db = memoryDb(seed()), api = service('growthRecord', db), other = service('growthRecord', db, { openid: 'user-b' })
  const added = await api.main({ height: 65, weight: 6.2, head: null, recordDate: day, clientRequestId: 'growth-add-01' })
  const id = added.data.id
  assert.equal((await other.main({ action: 'delete', id })).code, 404)
  assert.equal(db.rows('growth_records').length, 1)
  assert.equal((await api.main({ action: 'update', id, height: 66, weight: null, head: 41, recordDate: '2026-10-21' })).code, 0)
  const row = db.rows('growth_records')[0]
  assert.equal(row.height, 66)
  assert.equal(row.weight, null)
  assert.equal(row.head, 41)
  assert.equal(row.record_date, '2026-10-21')
  assert.equal((await api.main({ action: 'delete', id })).code, 0)
  assert.equal(db.rows('growth_records').length, 0)
})

test('growth listDate filters by exact record date and retains the compatible list action', async () => {
  const db = memoryDb(seed()), api = service('growthRecord', db)
  db.rows('growth_records').push(
    { _id: 'growth-day-a', openid: 'user-a', baby_id: 'baby-a', record_date: day, height: 65 },
    { _id: 'growth-day-b', openid: 'user-a', baby_id: 'baby-a', record_date: '2026-10-21', height: 66 },
    { _id: 'growth-other-baby', openid: 'user-a', baby_id: 'baby-b', record_date: day, height: 90 }
  )
  const exact = await api.main({ action: 'listDate', recordDate: day, baby_id: 'baby-a' })
  assert.equal(exact.code, 0)
  assert.deepEqual(exact.records.map(row => row._id), ['growth-day-a'])
  assert.equal((await api.main({ action: 'listDate', recordDate: '2026-02-30', baby_id: 'baby-a' })).code, 400)
  const compatible = await api.main({ action: 'list', baby_id: 'baby-a' })
  assert.deepEqual(compatible.records.map(row => row._id).sort(), ['growth-day-a', 'growth-day-b'])
})

test('diary update revalidates photo ownership and replaces content and date', async () => {
  const db = memoryDb(seed()), api = service('diaryRecord', db), other = service('diaryRecord', db, { openid: 'user-b' })
  const image = 'cloud://env/diary/user-a/photo.jpg'
  const added = await api.main({ content: '第一篇', images: [image], recordDate: day, clientRequestId: 'diary-add-001' })
  const id = added.data.id
  assert.equal((await other.main({ action: 'delete', id })).code, 404)
  assert.equal(db.rows('diary_records').length, 1)
  assert.equal((await api.main({ action: 'update', id, content: '修改后', images: [image], recordDate: '2026-10-21' })).code, 0)
  assert.equal(db.rows('diary_records')[0].content, '修改后')
  assert.equal(db.rows('diary_records')[0].record_date, '2026-10-21')
  assert.equal((await api.main({ action: 'update', id, content: '越权图片', images: ['cloud://env/diary/user-b/no.jpg'], recordDate: day })).code, 400)
})

test('custom mutations update allowed fields and reject another account record id', async () => {
  const db = memoryDb(seed()), owner = service('customRecord', db), other = service('customRecord', db, { openid: 'user-b' })
  const added = await owner.main({ category: 'custom', label: '体温', value: 37, unit: '度', note: '晚间', recordDate: day, clientRequestId: 'custom-add-01' })
  const id = added.data.id
  const denied = await other.main({ action: 'update', id, category: 'custom', label: '覆盖', value: 99, unit: '', note: '', recordDate: day })
  assert.equal(denied.code, 404)
  assert.equal(db.rows('custom_records')[0].label, '体温')
  assert.equal((await owner.main({ action: 'update', id, category: 'custom', label: '体温', value: 36.8, unit: '度', note: '已修改', recordDate: '2026-10-21' })).code, 0)
  assert.equal(db.rows('custom_records')[0].value, 36.8)
  assert.equal(db.rows('custom_records')[0].record_date, '2026-10-21')
  assert.equal((await other.main({ action: 'delete', id })).code, 404)
  assert.equal(db.rows('custom_records').length, 1)
  assert.equal((await owner.main({ action: 'delete', id })).code, 0)
  assert.equal(db.rows('custom_records').length, 0)
})
