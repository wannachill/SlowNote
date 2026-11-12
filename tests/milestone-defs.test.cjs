const test = require('node:test'), assert = require('node:assert/strict')
const { memoryDb, seed, service } = require('./helpers.cjs')

function dbWithBabies() {
  const data = seed()
  data.babies = [
    { _id: 'baby-a', openid: 'user-a', family_id: '', nickname: '小满' },
    { _id: 'baby-b', openid: 'user-b', family_id: '', nickname: '小豆' }
  ]
  return memoryDb(data)
}

test('list initializes 68 stable builtin definitions once and returns all 36 months', async () => {
  const db = dbWithBabies(), api = service('milestoneRecord', db)
  const [first, second] = await Promise.all([
    api.main({ action: 'list', baby_id: 'baby-a' }), api.main({ action: 'list', baby_id: 'baby-a' })
  ])
  assert.equal(first.code, 0); assert.equal(second.code, 0)
  assert.equal(first.milestones.length, 68)
  assert.deepEqual(Array.from(first.months), Array.from({ length: 36 }, (_, index) => index + 1))
  assert(first.milestones.some(item => item.key === 'lift_head' && item.month === 1))
  assert.equal(db.rows('milestone_defs').length, 68)
  for (let month = 1; month <= 36; month++) {
    assert(first.milestones.some(item => Number(item.month) === month), `月龄 ${month} 应有内置里程碑`)
  }
})

test('shared family members racing to initialize one baby share one builtin set', async () => {
  const data = seed()
  data.family_members = [{ _id: 'member-a', openid: 'user-a', familyId: 'family-a' }, { _id: 'member-b', openid: 'user-b', familyId: 'family-a' }]
  data.babies = [{ _id: 'baby-a', family_id: 'family-a', nickname: '小满' }]
  const db = memoryDb(data)
  await Promise.all([
    service('milestoneRecord', db).main({ action: 'list', baby_id: 'baby-a' }),
    service('milestoneRecord', db, { openid: 'user-b' }).main({ action: 'list', baby_id: 'baby-a' })
  ])
  assert.equal(db.rows('milestone_defs').length, 68)
  assert.equal(new Set(db.rows('milestone_defs').map(item => item.key)).size, 68)
})

test('list creates milestone_defs on first use when the collection is missing', async () => {
  const db = dbWithBabies(), collection = db.collection.bind(db)
  let created = false
  db.collection = name => {
    if (name === 'milestone_defs' && !created) return { limit: () => ({ get: async () => { throw { errCode: -502005 } } }) }
    return collection(name)
  }
  db.createCollection = async name => { assert.equal(name, 'milestone_defs'); created = true }
  const result = await service('milestoneRecord', db).main({ action: 'list', baby_id: 'baby-a' })
  assert.equal(result.code, 0); assert.equal(result.milestones.length, 68); assert.equal(created, true)
})

test('custom definitions can be added, updated, reordered, and removed with completion records', async () => {
  const db = dbWithBabies(), api = service('milestoneRecord', db)
  await api.main({ action: 'list', baby_id: 'baby-a' })
  const added = await api.main({ action: 'addDef', baby_id: 'baby-a', name: '会主动伸手', domain: '其他', month: 1, clientRequestId: 'milestone-add-001' })
  assert.equal(added.code, 0)
  const customKey = added.key
  const updated = await api.main({ action: 'updateDef', baby_id: 'baby-a', key: customKey, name: '会主动伸手拿玩具', domain: '精细动作', month: 2, clientRequestId: 'milestone-update-001' })
  assert.equal(updated.code, 0)
  const list = await api.main({ action: 'list', baby_id: 'baby-a' })
  const edited = list.milestones.find(item => item.key === customKey)
  assert.equal(edited.name, '会主动伸手拿玩具'); assert.equal(edited.month, 2)

  const monthOne = list.milestones.filter(item => item.month === 1)
  const reordered = monthOne.map(item => item.key).reverse()
  assert.equal((await api.main({ action: 'reorder', baby_id: 'baby-a', month: 1, keys: reordered, clientRequestId: 'milestone-order-001' })).code, 0)
  const afterOrder = await api.main({ action: 'list', baby_id: 'baby-a' })
  assert.deepEqual(afterOrder.milestones.filter(item => item.month === 1).map(item => item.key), reordered)

  assert.equal((await api.main({ action: 'check', baby_id: 'baby-a', key: 'lift_head', recordDate: '2026-10-20', clientRequestId: 'milestone-check-001' })).code, 0)
  assert.equal((await api.main({ action: 'removeDef', baby_id: 'baby-a', key: 'lift_head', clientRequestId: 'milestone-remove-001' })).code, 0)
  assert.equal(db.rows('milestone_records').length, 0)
  const final = await api.main({ action: 'list', baby_id: 'baby-a' })
  assert(!final.milestones.some(item => item.key === 'lift_head'))
})

test('definition mutations reject another baby and validate domain, name, month and reorder membership', async () => {
  const db = dbWithBabies(), api = service('milestoneRecord', db)
  await api.main({ action: 'list', baby_id: 'baby-a' })
  assert.equal((await api.main({ action: 'addDef', baby_id: 'baby-b', name: '越权', domain: '其他', month: 1, clientRequestId: 'milestone-foreign-001' })).code, 404)
  assert.equal((await api.main({ action: 'addDef', baby_id: 'baby-a', name: ' ', domain: '其他', month: 1, clientRequestId: 'milestone-invalid-01' })).code, 400)
  assert.equal((await api.main({ action: 'addDef', baby_id: 'baby-a', name: '无效领域', domain: '医疗', month: 1, clientRequestId: 'milestone-invalid-02' })).code, 400)
  assert.equal((await api.main({ action: 'addDef', baby_id: 'baby-a', name: '超范围', domain: '其他', month: 37, clientRequestId: 'milestone-invalid-03' })).code, 400)
  assert.equal((await api.main({ action: 'reorder', baby_id: 'baby-a', month: 1, keys: ['fake'], clientRequestId: 'milestone-invalid-04' })).code, 400)
})
