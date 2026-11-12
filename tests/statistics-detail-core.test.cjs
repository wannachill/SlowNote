const test = require('node:test')
const assert = require('node:assert/strict')
const { EMPTY, TYPES, metricPoints, paneCountOf, cardsForType } = require('../miniprogram/utils/statistics-detail-core')

test('detail core defines all six modules with their expected chart and empty-state behavior', () => {
  assert.deepEqual(TYPES.map(type => type.key), ['growth', 'feeding', 'solid', 'excretion', 'diary', 'custom'])
  assert.deepEqual(TYPES.map(type => type.kind), ['line', 'line', 'line', 'line', 'line', 'line'])
  assert.deepEqual(TYPES.map(type => type.gap), ['skip', 'skip', 'skip', 'skip', 'skip', 'skip'])
  for (const key of ['growth', 'feeding', 'solid', 'excretion', 'diary', 'custom']) {
    assert.equal(typeof EMPTY[key][0], 'string')
    assert(EMPTY[key][0].length > 0)
  }
  const growth = metricPoints({ growth: [{ d: '2026-11-01', weight: 6, height: 62, head: 40 }] }, TYPES[0])
  assert.deepEqual(growth.weight, [{ d: '2026-11-01', y: 6 }])
  const feeding = metricPoints({ feeding: [{ d: '2026-11-01', n: 5, ml: 600, min: 12 }] }, TYPES[1])
  assert.deepEqual(feeding.ml, [{ d: '2026-11-01', y: 600 }])
  const sparseFeeding = metricPoints({ feeding: [
    { d: '2026-11-01', n: 2, ml: 120 },
    { d: '2026-11-02', n: 0, ml: 0 },
    { d: '2026-11-04', n: 1, ml: 60 }
  ] }, TYPES[1])
  assert.deepEqual(sparseFeeding.n, [{ d: '2026-11-01', y: 2 }, { d: '2026-11-04', y: 1 }])
  const customType = TYPES.find(type => type.key === 'custom')
  const custom = metricPoints({ custom: [{ label: '午睡', points: [{ d: '2026-11-01', value: 90 }] }] }, customType)
  assert.deepEqual(custom['午睡'], [{ d: '2026-11-01', y: 90 }])
  assert.equal(paneCountOf('line', [{ unit: 'kg' }, { unit: 'cm' }]), 2)
  assert.equal(paneCountOf('bar', [{ unit: '次' }, { unit: '次' }, { unit: 'ml' }]), 2)
})

test('cardsForType filters daily cards by category tag and retains feeding modes', () => {
  const cards = [
    { key: 'bottle', tag: 'feeding' }, { key: 'breast', tag: 'feeding' },
    { key: 'formula', tag: 'feeding' }, { key: 'mixed', tag: 'feeding' },
    { key: 'solid', tag: 'solid' }, { key: 'excretion', tag: 'excretion' },
    { key: 'growth', tag: 'growth' }, { key: 'diary', tag: 'diary' },
    { key: 'custom', tag: 'custom' }
  ]
  assert.deepEqual(cardsForType(cards, 'feeding').map(card => card.key), ['bottle', 'breast', 'formula', 'mixed'])
  assert.deepEqual(cardsForType(cards, 'excretion').map(card => card.key), ['excretion'])
  assert.deepEqual(cardsForType(cards, 'solid').map(card => card.key), ['solid'])
  assert.deepEqual(cardsForType(cards, 'growth').map(card => card.key), ['growth'])
  assert.deepEqual(cardsForType(cards, 'diary').map(card => card.key), ['diary'])
  assert.deepEqual(cardsForType(cards, 'custom').map(card => card.key), ['custom'])
  assert.deepEqual(cardsForType([{ key: 'feeding' }], 'feeding').map(card => card.key), ['feeding'])
  assert.deepEqual(cardsForType(cards, 'unknown'), [])
})
