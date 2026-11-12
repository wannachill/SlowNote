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
  assert.ok(snapshot.summary, 'AI 问答数字快照返回聚合摘要')

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
