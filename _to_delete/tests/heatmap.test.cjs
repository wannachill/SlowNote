const test = require('node:test')
const assert = require('node:assert/strict')
const { buildHeatmap } = require('../miniprogram/utils/heatmap')

test('weekly heatmap is Sunday-first, combines elimination events and leaves empty days at level zero', () => {
  const heatmap = buildHeatmap([
    { d: '2026-10-18', stool: 2, urine: 3 },
    { d: '2026-10-20', stool: 1 }
  ], 'excretion', { start: '2026-10-18', end: '2026-10-25' }, 'week', '2026-10-21')
  assert.deepEqual(heatmap.weekdays, ['日', '一', '二', '三', '四', '五', '六'])
  assert.equal(heatmap.cells.length, 7)
  assert.deepEqual(heatmap.cells.map(cell => [cell.date, cell.value, cell.level]), [
    ['2026-10-18', 5, 4], ['2026-10-19', 0, 0], ['2026-10-20', 1, 1],
    ['2026-10-21', 0, 0], ['2026-10-22', 0, 0], ['2026-10-23', 0, 0], ['2026-10-24', 0, 0]
  ])
  assert.equal(heatmap.cells[1].ariaLabel, '2026-10-19，无记录')
})

test('monthly heatmap pads to seven columns and all-time view shows the latest 35 days', () => {
  const month = buildHeatmap([{ d: '2026-10-31', n: 1 }], 'diary', { start: '2026-10-01', end: '2026-11-01' }, 'month', '2026-10-31')
  assert.equal(month.cells.length % 7, 0)
  assert(month.cells[0].outside)
  assert.equal(month.cells.filter(cell => !cell.outside).length, 31)
  assert.equal(month.cells.filter(cell => cell.value > 0)[0].date, '2026-10-31')

  const all = buildHeatmap([], 'feeding', { start: '2025-01-01', end: '9999-12-31' }, 'all', '2026-10-31')
  const dated = all.cells.filter(cell => !cell.outside)
  assert.equal(dated.length, 35)
  assert.equal(dated[dated.length - 1].date, '2026-10-31')
  assert(all.cells.length % 7 === 0)
})
