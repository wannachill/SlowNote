const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), path = require('path')
const { memoryDb, seed, service } = require('./helpers.cjs')

const backend = () => service('statistics', memoryDb(seed()))

test('statistics 拒绝白名单外的 action，返回 400 UNKNOWN_ACTION', async () => {
  const api = backend()
  for (const action of ['trned', 'foo', 'Range', 'get', 0, false]) {
    const result = await api.main({ action })
    assert.equal(result.code, 400, `action=${String(action)} 应被拒绝`)
    assert.equal(result.message, 'UNKNOWN_ACTION')
  }
})

test('statistics 的 4 个合法 action 均正常工作，不再静默落到聚合分支', async () => {
  const api = backend()
  const snapshot = await api.main({ action: 'range', range: '7d' })
  assert.equal(snapshot.code, 0)
  assert.equal(snapshot.range, '7d')
  assert.ok(snapshot.summary, 'AI 问答保留数值概览')
  assert.match(snapshot.details, /记录概览：/)
  assert.equal(snapshot.detailsLimit > 0, true)
  assert.equal(Object.hasOwn(snapshot, 'data'), false, '不把原始集合下发到小程序')

  const trend = await api.main({ action: 'trend', range: 'week' })
  assert.equal(trend.code, 0)
  assert.ok(trend.series)
  assert.ok(trend.totals)

  const calendar = await api.main({ action: 'calendar', date: '2026-11-12' })
  assert.equal(calendar.code, 0)
  assert.ok(Array.isArray(calendar.marks))

  const daily = await api.main({ action: 'daily', date: '2026-11-12', weekStart: '2026-11-09' })
  assert.equal(daily.code, 0)
  assert.equal(daily.date, '2026-11-12')

  const legacy = await api.main({ range: 'week' })
  assert.equal(legacy.code, 0, '省略 action 的旧调用保持兼容')
  assert.ok(legacy.summary)
  assert.equal(typeof legacy.details, 'string')
})

test('range 按选中类别返回明细，空选不查询记录集合', async () => {
  const data = seed()
  data.diary_records = [{ _id: 'd1', openid: 'user-a', baby_id: 'baby-a', record_date: '2026-10-20', content: '宝宝第一次翻身' }]
  data.feeding_records = [{ _id: 'f1', openid: 'user-a', baby_id: 'baby-a', type: 'feed', payload: { mode: 'bottle', amountMl: 90 }, record_date: '2026-10-20' }]
  const db = memoryDb(data), collection = db.collection.bind(db), queried = []
  db.collection = name => { if (name.endsWith('_records')) queried.push(name); return collection(name) }
  const api = service('statistics', db)
  const diary = await api.main({ action: 'range', range: '7d', baby_id: 'baby-a', categories: ['diary'] })
  assert.match(diary.details, /宝宝第一次翻身/)
  assert.doesNotMatch(diary.details, /奶瓶|90 ml/)
  assert.deepEqual(queried, ['diary_records'])
  queried.length = 0
  const empty = await api.main({ action: 'range', range: '7d', baby_id: 'baby-a', categories: [] })
  assert.equal(empty.details, '')
  assert.deepEqual(queried, [], '空选类别不读取任何记录集合')
})

test('前端所有 statistics 调用的 action 都在云函数白名单内', () => {
  const source = fs.readFileSync('cloudfunctions/statistics/index.js', 'utf8')
  const declared = /const ACTIONS = \[([^\]]+)\]/.exec(source)
  assert.ok(declared, '云函数须声明 ACTIONS 白名单')
  const allowed = [...declared[1].matchAll(/'([^']+)'/g)].map(match => match[1])
  assert.deepEqual([...allowed].sort(), ['calendar', 'daily', 'range', 'trend'])

  const jsFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name)
    return entry.isDirectory() ? jsFiles(target) : (target.endsWith('.js') ? [target] : [])
  })
  let checked = 0
  for (const file of jsFiles('miniprogram')) {
    const text = fs.readFileSync(file, 'utf8')
    const calls = /call\(['"]statistics['"],\s*\{([\s\S]{0,240}?)\}\)/g
    let match
    while ((match = calls.exec(text))) {
      const action = /action:\s*['"]([^'"]+)['"]/.exec(match[1])
      if (!action) continue
      checked++
      assert.ok(allowed.includes(action[1]), `${file} 的 action=${action[1]} 不在白名单内`)
    }
  }
  assert.ok(checked >= 6, `应覆盖至少 6 处 statistics 调用，实际 ${checked} 处`)
})
