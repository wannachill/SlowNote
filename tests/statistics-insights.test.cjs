const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { currentPeriodValue, insightHasData, insightSections, insightText, metricPeriodValues, moduleSummaryOf, periodDelta, moduleCardOf } = require('../miniprogram/utils/statistics-insights')

test('period comparison uses current and previous period totals without treating zero as missing', () => {
  const current = {
    feeding: { count: 12, amountMl: 780 },
    solid: { count: 3 },
    excretion: { stool: 3, urine: 2 },
    growth: { weight: { latest: 6.2 }, height: { latest: 62 }, head: { latest: 40 } },
    diary: { count: 2 }
  }
  const previous = {
    feeding: { count: 10, amountMl: 720 },
    solid: { count: 2 },
    excretion: { stool: 2, urine: 2 },
    growth: { weight: { latest: 5.5 }, height: { latest: 58 }, head: { latest: 39 } },
    diary: { count: 2 }
  }
  assert.equal(currentPeriodValue('feeding', 'n', current), 12)
  assert.equal(currentPeriodValue('growth', 'weight', current), 6.2)
  assert.equal(currentPeriodValue('feeding', 'min', current), null)
  assert.deepEqual(metricPeriodValues('growth', 'weight', current, previous), { current: 6.2, previous: 5.5 })
  assert.deepEqual(metricPeriodValues('feeding', 'n', current, previous), { current: 12, previous: 10 })
  assert.deepEqual(metricPeriodValues('feeding', 'ml', { feeding: { count: 0, amountMl: 0 } }, { feeding: { count: 0, amountMl: 0 } }), { current: 0, previous: 0 })
  assert.equal(metricPeriodValues('feeding', 'min', current, previous), null)
  assert.equal(metricPeriodValues('growth', 'weight', current, null), null)
  assert.equal(periodDelta(6.2, 5.5, 'kg', 1), '+0.7 kg')
  assert.equal(periodDelta(2, 3.2, '次', 1), '−1.2 次')
  assert.equal(periodDelta(0, 0, '次', 0), '±0 次')
})

test('insight summary states available facts, period changes and neutral missing-record notes', () => {
  const current = {
    feeding: { count: 12, amountMl: 780 }, solid: { count: 3 }, excretion: { stool: 3, urine: 2 },
    growth: { count: 1, weight: { latest: 6.2 }, height: { latest: 62 }, head: { latest: null } },
    diary: { count: 2 }, custom: { count: 0 }, outdoor: { count: 9 }
  }
  const previous = {
    feeding: { count: 10, amountMl: 720 }, solid: { count: 2 }, excretion: { stool: 2, urine: 2 },
    growth: { count: 1, weight: { latest: 5.5 }, height: { latest: 58 }, head: { latest: null } },
    diary: { count: 2 }, custom: { count: 0 }, outdoor: { count: 7 }
  }
  const sections = insightSections(current, previous, 'week')
  const section = title => sections.find(item => item.title === title)
  assert.match(section('喂养').lines[0], /喂养次数：12次 · 较上周 \+2 次/)
  assert.match(section('成长').lines[0], /体重：6\.2 kg · 较上周 \+0\.7 kg/)
  assert(!sections.some(item => item.title === '提醒'))
  const text = insightText(current, previous, 'week')
  assert.match(text, /本周：喂养12次，奶量共780ml，辅食3次，便便记录5次/)
  assert.doesNotMatch(text, /户外/)
  assert.equal(insightHasData({ outdoor: { count: 9 } }), false)
  assert(!sections.some(section => section.lines.some(line => /户外/.test(line))))
  assert.doesNotMatch(text, /较上月|医疗|正常|异常/)

  const empty = insightText({ feeding: {}, solid: {}, excretion: {}, growth: {}, diary: {} }, null, 'all')
  assert.deepEqual(insightSections({ feeding: {}, solid: {}, excretion: {}, growth: {}, diary: {} }, null, 'all'), [])
  assert.equal(insightHasData({ feeding: {}, growth: {} }), false)
  assert.match(empty, /所选范围暂无记录/)
  assert.match(empty, /还没有成长记录/)
  assert.match(empty, /还没有便便记录/)
  assert.doesNotMatch(empty, /较上周|较上月/)
})

test('module summaries show a primary value, period comparison and empty fallback', () => {
  const current = {
    feeding: { count: 42, amountMl: 5460 }, solid: { count: 12 }, excretion: { stool: 18, urine: 10 },
    growth: { weight: { latest: 6.8 }, height: { latest: 64 }, head: { latest: 42 } },
    diary: { count: 5 }, custom: { count: 8 }
  }
  const previous = {
    feeding: { count: 40, amountMl: 5200 }, solid: { count: 10 }, excretion: { stool: 16, urine: 8 },
    growth: { weight: { latest: 6.1 }, height: { latest: 63 }, head: { latest: 41 } },
    diary: { count: 4 }, custom: { count: 6 }
  }
  assert.equal(moduleSummaryOf('growth', current, previous, 'week'), '体重 6.8kg · 体重较上周 +0.7 kg')
  assert.equal(moduleSummaryOf('feeding', current, previous, 'week'), '42 次 · 奶量 5,460ml · 喂养次数较上周 +2 次')
  assert.equal(moduleSummaryOf('solid', current, previous, 'week'), '12 次 · 辅食较上周 +2 次')
  assert.equal(moduleSummaryOf('excretion', current, previous, 'week'), '28 次记录 · 便便记录较上周 +4 次')
  assert.equal(moduleSummaryOf('diary', current, previous, 'week'), '5 篇 · 日记较上周 +1 篇')
  assert.equal(moduleSummaryOf('custom', current, previous, 'week'), '8 条 · 自定义较上周 +2 条')
  assert.equal(moduleSummaryOf('growth', { growth: {} }), '暂无记录')
  assert.equal(moduleSummaryOf('feeding', {}, null), '暂无记录')
})

test('module cards expose primary values, units, supporting text and directional deltas', () => {
  const current = {
    feeding: { count: 42, amountMl: 5460 }, solid: { count: 12 }, excretion: { stool: 18, urine: 10 },
    growth: { weight: { latest: 6.8 }, height: { latest: 64 }, head: { latest: 42 } },
    diary: { count: 5 }, custom: { count: 8 }
  }
  const previous = {
    feeding: { count: 40, amountMl: 5200 }, solid: { count: 10 }, excretion: { stool: 16, urine: 8 },
    growth: { weight: { latest: 6.1 }, height: { latest: 63 }, head: { latest: 41 } },
    diary: { count: 4 }, custom: { count: 6 }
  }
  const growth = moduleCardOf('growth', current, previous, 'week')
  assert.equal(growth.key, 'growth')
  assert.equal(growth.multi, true)
  assert.equal(growth.metrics.length, 3)
  assert.deepEqual(growth.metrics.map(metric => [metric.label, metric.value, metric.unit, metric.hasData]), [
    ['体重', '6.8', 'kg', true], ['身高', '64.0', 'cm', true], ['头围', '42.0', 'cm', true]
  ])
  assert.deepEqual(growth.metrics.map(metric => [metric.deltaText, metric.deltaArrow, metric.deltaDir]), [
    ['0.7', '↑', 'up'], ['1.0', '↑', 'up'], ['1.0', '↑', 'up']
  ])
  assert.equal(growth.empty, false)
  const feeding = moduleCardOf('feeding', current, previous, 'week')
  assert.equal(feeding.multi, true)
  assert.deepEqual(feeding.metrics.map(metric => [metric.label, metric.value, metric.unit, metric.hasData]), [
    ['次数', '42', '次', true], ['奶量', '5,460', 'ml', true]
  ])
  assert.deepEqual(feeding.metrics.map(metric => [metric.deltaText, metric.deltaArrow, metric.deltaDir]), [
    ['2', '↑', 'up'], ['260', '↑', 'up']
  ])
  assert.equal(Object.hasOwn(feeding, 'primary'), false)
  assert.equal(Object.hasOwn(feeding, 'deltaText'), false)
  assert.equal(Object.hasOwn(feeding, 'sub'), false)
  assert.equal(Object.hasOwn(feeding, 'subDeltaText'), false)
  const countOnly = moduleCardOf('feeding', { feeding: { count: 2, amountMl: 0 } }, { feeding: { count: 1, amountMl: 0 } }, 'week')
  assert.equal(countOnly.empty, false)
  assert.deepEqual(countOnly.metrics[1], {
    label: '奶量', value: '', unit: 'ml', hasData: false, deltaText: '', deltaArrow: '', deltaDir: ''
  })
  const excretion = moduleCardOf('excretion', current, previous, 'week')
  assert.equal(excretion.primary, '28')
  assert.equal(excretion.unit, '次')
  const empty = moduleCardOf('diary', { diary: { count: 0 } }, null, 'week')
  assert.equal(empty.empty, true)
  assert.equal(empty.primary, '')
  assert.equal(empty.unit, '')
  assert.equal(empty.deltaText, '')
  const noPrev = moduleCardOf('growth', current, null, 'all')
  assert.equal(noPrev.multi, true)
  assert.equal(noPrev.metrics[0].value, '6.8')
  assert.equal(noPrev.metrics.every(metric => !metric.deltaText), true)
  const partialGrowth = moduleCardOf('growth', { growth: { height: { latest: 64 } } }, { growth: { weight: { latest: 6 } } }, 'week')
  assert.equal(partialGrowth.empty, false)
  assert.deepEqual(partialGrowth.metrics.map(metric => [metric.label, metric.value, metric.hasData, metric.deltaText]), [
    ['体重', '', false, ''], ['身高', '64.0', true, ''], ['头围', '', false, '']
  ])
  assert.equal(moduleCardOf('growth', { growth: {} }, previous, 'week').empty, true)
  const today = moduleCardOf('feeding', current, previous, 'day')
  assert.equal(today.metrics.every(metric => !metric.deltaText), true)
})

test('long growth and feeding values keep unit-free deltas in the shared three-column template', () => {
  const growth = moduleCardOf('growth', { growth: { height: { latest: 180 } } }, { growth: { height: { latest: 198 } } }, 'week')
  const feeding = moduleCardOf('feeding', { feeding: { count: 2, amountMl: 5460 } }, { feeding: { count: 1, amountMl: 5241 } }, 'week')
  assert.deepEqual(growth.metrics[1], {
    label: '身高', value: '180.0', unit: 'cm', deltaText: '18.0', deltaArrow: '↓', deltaDir: 'down', hasData: true
  })
  assert.deepEqual(feeding.metrics[1], {
    label: '奶量', value: '5,460', unit: 'ml', deltaText: '219', deltaArrow: '↑', deltaDir: 'up', hasData: true
  })
  assert.equal(growth.metrics.concat(feeding.metrics).every(metric => !metric.deltaText.includes(metric.unit)), true)

  const template = fs.readFileSync('miniprogram/pages/statistics/index.wxml', 'utf8')
  const metricStart = template.indexOf('class="module-metric-row"')
  const ordinaryStart = template.indexOf('<view wx:else class="module-data">', metricStart)
  const metricTemplate = template.slice(metricStart, ordinaryStart)
  assert(metricTemplate.indexOf('class="module-metric-label"') < metricTemplate.indexOf('class="module-metric-reading"'))
  assert(metricTemplate.indexOf('class="module-metric-reading"') < metricTemplate.indexOf('class="module-metric-delta'))
  assert.match(metricTemplate, /class="module-metric-delta \{\{metric\.deltaDir\}\}">\{\{metric\.deltaText \? metric\.deltaArrow \+ metric\.deltaText : ''\}\}<\/text>/)
  assert.doesNotMatch(metricTemplate, /metric\.unit[^\n]*module-metric-delta|module-metric-delta[^\n]*metric\.unit/)
})
