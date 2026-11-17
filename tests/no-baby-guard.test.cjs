const fs = require('node:fs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { front, seed, memoryDb, service } = require('./helpers.cjs')

const day = '2026-10-21'
const addCases = [
  ['feedingRecord', { type: 'feed', payload: { mode: 'bottle', amountMl: 90 }, recordDate: day }],
  ['growthRecord', { height: 65, weight: null, head: null, recordDate: day }],
  ['diaryRecord', { content: '测试记录', recordDate: day }],
  ['customRecord', { category: 'custom', label: '饮水', value: 30, unit: 'ml', recordDate: day }]
]
function withId(event, id = 'baby-add-test-01') { return { ...event, clientRequestId: id } }

test('home blocks the add panel without a baby and offers a confirmed route to baby profiles', () => {
  const f = front('index')
  f.wx.showModal = arg => { f.calls.push({ type: 'modal', ...arg }); arg.success({ confirm: true }) }
  f.app.globalData.activeBabyId = ''
  f.page.refreshProfile()
  f.page.openPanel()
  assert.equal(f.page.data.panel, false)
  assert.equal(f.page.data.hasBaby, false)
  assert.ok(f.calls.some(call => call.type === 'modal' && call.content === '还没有宝宝档案，请先添加宝宝后再记录'))
  assert.ok(f.calls.some(call => call.type === 'navigateTo' && call.url === '/pages/baby/index'))
})

test('home keeps its normal empty state and only opens the category panel with a baby', () => {
  const f = front('index')
  f.app.globalData.activeBabyId = 'baby-a'
  f.page.refreshProfile()
  f.page._allCards = []
  f.page._allCardsDate = f.page.data.selectedDate
  f.page._allCardsBabyId = 'baby-a'
  f.page.openPanel()
  assert.equal(f.page.data.panel, true)
  assert.equal(f.page.data.hasBaby, true)
  const markup = fs.readFileSync('miniprogram/pages/index/index.wxml', 'utf8')
  assert.doesNotMatch(markup, /添加宝宝后即可开始记录|去添加宝宝|bindtap="goBaby"/)
  assert.match(markup, /这一天，还没有记录/)
  f.app.globalData.activeBabyId = ''
  f.page.onSessionChange()
  assert.equal(f.page.data.hasBaby, false)
})

test('home cancellation and card transitions cannot open the category panel or navigate', () => {
  const f = front('index')
  f.wx.showModal = arg => { f.calls.push({ type: 'modal' }); arg.success({ confirm: false }) }
  f.page.refreshProfile()
  f.page.openPanel()
  assert.equal(f.page.data.panel, false)
  assert.equal(f.calls.some(call => call.type === 'navigateTo'), false)
  f.page.setData({ cardBusy: true })
  f.page.openPanel()
  f.page.setData({ cardBusy: false, cardSettling: true })
  f.page.openPanel()
  assert.equal(f.calls.filter(call => call.type === 'modal').length, 1)
})

test('record add actions reject missing or empty baby IDs before writes', async () => {
  for (const [name, event] of addCases) {
    const db = memoryDb(seed()), api = service(name, db)
    const missing = await api.main(withId(event))
    assert.equal(missing.code, 400, `${name}: omitted baby_id`)
    assert.equal(missing.message, 'INVALID_BABY_ID')
    const empty = await api.main(withId({ ...event, baby_id: '' }, 'baby-add-empty-01'))
    assert.equal(empty.code, 400, `${name}: empty baby_id`)
    assert.equal(empty.message, 'INVALID_BABY_ID')
    for (const baby_id of [null, 3, {}, 'x'.repeat(65)]) {
      const invalid = await api.main(withId({ ...event, baby_id }, 'baby-add-invalid-01'))
      assert.equal(invalid.code, 400, `${name}: invalid ID type/length`)
      assert.equal(invalid.message, 'INVALID_BABY_ID')
    }
    const collection = { feedingRecord: 'feeding_records', growthRecord: 'growth_records', diaryRecord: 'diary_records', customRecord: 'custom_records' }[name]
    assert.equal(db.rows(collection).length, 0)
  }
})

test('record add actions reject unknown or another user’s baby and accept the owned baby', async () => {
  for (const [name, event] of addCases) {
    const data = seed()
    data.babies.push({ _id: 'baby-b', baby_id: 'baby-b', openid: 'user-b', nickname: '他人宝宝' })
    const db = memoryDb(data), api = service(name, db)
    assert.equal((await api.main(withId({ ...event, baby_id: 'missing-baby' }, 'baby-add-missing-01'))).code, 404, `${name}: unknown baby`)
    assert.equal((await api.main(withId({ ...event, baby_id: 'baby-b' }, 'baby-add-foreign-01'))).message, 'BABY_NOT_FOUND', `${name}: foreign baby`)
    const saved = await api.main(withId({ ...event, baby_id: 'baby-a' }, 'baby-add-owned-01'))
    assert.equal(saved.code, 0, `${name}: owned baby`)
    const collection = { feedingRecord: 'feeding_records', growthRecord: 'growth_records', diaryRecord: 'diary_records', customRecord: 'custom_records' }[name]
    assert.equal(db.rows(collection)[0].baby_id, 'baby-a')
  }
})

test('empty baby filters still mean all babies for read actions and aggregate task scope', async () => {
  const data = seed()
  data.babies.push({ _id: 'baby-b', baby_id: 'baby-b', openid: 'user-a', nickname: '另一个宝宝' })
  data.feeding_records = ['baby-a', 'baby-b'].map((baby_id, i) => ({ _id: `feed-${i}`, openid: 'user-a', baby_id, type: 'feed', payload: { mode: 'bottle', amountMl: 90 }, record_date: day }))
  data.growth_records = ['baby-a', 'baby-b'].map((baby_id, i) => ({ _id: `growth-${i}`, openid: 'user-a', baby_id, height: 65, record_date: day }))
  data.diary_records = ['baby-a', 'baby-b'].map((baby_id, i) => ({ _id: `diary-${i}`, openid: 'user-a', baby_id, content: '日记', record_date: day }))
  data.custom_records = ['baby-a', 'baby-b'].map((baby_id, i) => ({ _id: `custom-${i}`, openid: 'user-a', baby_id, category: 'custom', label: '喝水', record_date: day }))
  const db = memoryDb(data)
  const reads = [
    ['feedingRecord', 'listDate', 'feeding_records'], ['growthRecord', 'list', 'growth_records'],
    ['diaryRecord', 'list', 'diary_records'], ['customRecord', 'list', 'custom_records']
  ]
  for (const [name, action, collection] of reads) {
    const result = await service(name, db).main({ action, recordDate: day, baby_id: '' })
    assert.equal(result.records.length, 2, `${name} read with empty baby_id includes all babies`)
    assert.equal(db.rows(collection).length, 2)
  }
  const statistics = await service('statistics', db).main({ action: 'daily', date: day, weekStart: '2026-10-18' })
  assert.equal(statistics.code, 0, 'statistics still allows omitted baby_id to aggregate all babies')
  const task = await service('aiTasks', db).main({ action: 'save', categories: ['growth'], frequency: 'daily', time: '21:00', weekday: 1, consent: true, clientRequestId: 'all-baby-task-01' })
  assert.equal(task.code, 0, 'an empty baby_id remains a valid all-baby report task')
  assert.equal(db.rows('ai_tasks')[0].baby_id, '')
})

test('record writes accept babies in the current family scope but reject a different family', async () => {
  for (const [name, event] of addCases) {
    const data = seed()
    data.family_members = [{ _id: 'member', openid: 'user-a', familyId: 'family-a' }]
    data.babies = [{ _id: 'shared-baby', openid: 'user-b', family_id: 'family-a' }, { _id: 'foreign-family-baby', openid: 'user-a', family_id: 'family-b' }]
    const db = memoryDb(data), api = service(name, db)
    const allowed = await api.main(withId({ ...event, baby_id: 'shared-baby' }, 'shared-baby-add-01'))
    assert.equal(allowed.code, 0, name)
    const denied = await api.main(withId({ ...event, baby_id: 'foreign-family-baby' }, 'foreign-family-add-01'))
    assert.equal(denied.code, 404, name)
  }
})

test('shared requireBaby is exported and synced to every managed function library', () => {
  const source = fs.readFileSync('cloudfunctions/_shared/runtime.js', 'utf8')
  assert.match(source, /async function requireBaby\(db, accessContext, babyId\)/)
  const dirs = fs.readdirSync('cloudfunctions').filter(name => fs.existsSync(`cloudfunctions/${name}/lib/runtime.js`))
  assert.equal(dirs.length, 14)
  for (const name of dirs) assert.equal(fs.readFileSync(`cloudfunctions/${name}/lib/runtime.js`, 'utf8'), source, `${name}/lib/runtime.js synced`)
})
