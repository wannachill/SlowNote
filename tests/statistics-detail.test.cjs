const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { front } = require('./helpers.cjs')
const { readSeries, layout, axisLabels, xAtDate } = require('../miniprogram/utils/chart')
const palette = require('../miniprogram/utils/theme').resolve()

function createDailyFixture(typeKey, rangeIndex = 1) {
  const requests = []
  const f = front('statistics-detail', { callFunction: async request => {
    requests.push(request.data)
    if (request.data.action === 'daily') return { result: {
      code: 0, times: {
        breast: '09:30', bottle: '10:15', formula: '08:45', mixed: '09:00', solid: '11:00',
        excretion: '08:15', growth: '12:00', diary: '13:20', custom: '14:00'
      },
      summary: {
        feeding: { count: 4, amountMl: 250, byCategory: {
          breast: { count: 1, amountMl: 50, durationMin: 5 },
          bottle: { count: 1, amountMl: 100, durationMin: 0 },
          formula: { count: 1, amountMl: 70, durationMin: 0 },
          mixed: { count: 1, amountMl: 30, durationMin: 0 },
          solid: { count: 1 }, excretion: { stoolCount: 1, urineCount: 1 }
        } },
        growth: { count: 1, weight: { latest: 6 }, height: { latest: 62 }, head: { latest: 40 } },
        diary: { count: 1 }, custom: { count: 1, entries: [{ label: '喝水', value: 20, unit: 'ml' }] }
      }
    } }
    const series = typeKey === 'excretion'
      ? { excretion: [{ d: '2026-10-20', stool: 2, urine: 1 }] }
      : { feeding: [{ d: '2026-10-20', n: 2, ml: 150 }] }
    return { result: {
      code: 0, dates: { start: '2026-10-18', end: '2026-10-25' }, series,
      totals: typeKey === 'excretion' ? { excretion: { stool: 2, urine: 1 } } : { feeding: { count: 2, amountMl: 150 } },
      prevTotals: null
    } }
  } })
  const typeNames = { feeding: '喂养', excretion: '便便' }
  f.app.globalData.activeBabyId = 'baby-a'
  f.page.setData({ typeKey, typeName: typeNames[typeKey], rangeIndex })
  f.page._chartVisible = false
  return { f, requests }
}

test('detail page accepts type and range, loads one module and keeps its chart directly visible', async () => {
  const requests = []
  const f = front('statistics-detail', {
    callFunction: async request => {
      requests.push(request)
      return { result: {
        code: 0,
        range: request.data.range,
        dates: { start: request.data.range === 'month' ? '2026-10-01' : '2026-10-18', end: request.data.range === 'month' ? '2026-11-01' : '2026-10-25' },
        series: { growth: [{ d: '2026-10-20', weight: 6.2, height: 62 }, { d: '2026-10-21', weight: 6.3, height: 63 }] },
        totals: { growth: { count: 2, weight: { latest: 6.3 }, height: { latest: 63 }, head: { latest: null } } },
        prevTotals: { growth: { count: 1, weight: { latest: 6.1 }, height: { latest: 62 }, head: { latest: null } } }
      } }
    }
  })
  f.app.globalData.activeBabyId = 'baby-a'
  await f.page.onLoad({ type: 'growth', range: 'month' })
  assert.equal(f.page.data.typeKey, 'growth')
  assert.equal(f.page.data.rangeIndex, 2)
  assert.equal(f.page.data.title, '成长趋势')

  const draws = []
  f.page._chartVisible = true
  f.page.draw = () => draws.push(f.page.data.typeKey)
  await f.page.load()
  assert.equal(requests[0].data.range, 'month')
  assert.equal(requests[0].data.baby_id, 'baby-a')
  assert.equal(f.page.data.hasData, true)
  assert.deepEqual(Array.from(f.page.data.metrics, item => item.name), ['体重', '身高', '头围'])
  assert.deepEqual(Array.from(f.page.data.metricKeys), ['weight'])
  assert.deepEqual(draws, ['growth'])
  assert.equal(Object.prototype.hasOwnProperty.call(f.page.data, 'chartExpanded'), false)

  f.page.onMetric({ currentTarget: { dataset: { key: 'height' } } })
  assert.equal(f.page.data.metricKeys[0], 'height')
  assert.deepEqual(draws, ['growth', 'growth'])
})

test('detail route range initializes the module period, and hide/unload cancel chart motion', async () => {
  const requests = []
  const f = front('statistics-detail', { callFunction: async request => {
    requests.push(request)
    return { result: {
      code: 0,
      dates: { start: '2026-10-18', end: '2026-10-25' },
      series: { feeding: [{ d: '2026-10-20', n: 2, ml: 100 }] },
      totals: { feeding: { count: 1, amountMl: 100 } },
      prevTotals: null
    } }
  } })
  f.page.onLoad({ type: 'feeding', range: 'month' })
  f.page.draw = () => {}
  await f.page.load()
  assert.equal(requests[0].data.range, 'month')
  assert.equal(f.page.data.typeKey, 'feeding')
  assert.equal(f.page.data.hasData, true)
  f.page._chartContext = { cancel: true }
  const token = f.page._chartToken || 0
  f.page.onHide()
  assert.equal(f.page._chartVisible, false)
  assert.equal(f.page._chartToken, token + 1)
  f.page.onUnload()
  assert.equal(f.page._chartToken, token + 2)
})

test('stat detail caches trend and daily data by scope and date, and keeps loaded content during refresh', async () => {
  const requests = []
  const trendResult = {
    code: 0,
    range: 'week',
    dates: { start: '2026-10-18', end: '2026-10-25' },
    series: { feeding: [
      { d: '2026-10-20', n: 2, ml: 150 },
      { d: '2026-10-21', n: 3, ml: 200 }
    ] }
  }
  const dailyResult = { code: 0, summary: {
    feeding: { count: 0, byCategory: {} },
    growth: { count: 0 }, diary: { count: 0 }, custom: { count: 0, entries: [] }
  }, times: {} }
  const f = front('statistics-detail', { callFunction: async request => {
    requests.push(request.data)
    if (request.data.action === 'trend') return { result: trendResult }
    return { result: dailyResult }
  } })
  f.app.globalData.activeBabyId = 'baby-a'
  f.page.setData({ typeKey: 'feeding', typeName: '喂养', rangeIndex: 1 })
  f.page._chartVisible = false

  await f.page.load()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.filter(request => request.action === 'trend').length, 1)
  assert.equal(requests.filter(request => request.action === 'daily').length, 1)
  assert.equal(f.page.data.hasData, true)
  assert.equal(f.page.data.selectedDate, '2026-10-21')

  const beforeWarmLoad = requests.length
  await f.page.load()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, beforeWarmLoad, 'a fresh trend and selected-day cache skips both requests')

  f.page.setData({ selectedDate: '2026-10-20' })
  await f.page.loadDayDetails('2026-10-20')
  assert.equal(requests.filter(request => request.action === 'daily').length, 2)
  f.page.setData({ selectedDate: '2026-10-21' })
  await f.page.loadDayDetails('2026-10-21')
  assert.equal(requests.filter(request => request.action === 'daily').length, 2, 'switching back to a cached date does not refetch it')
  const cacheKeys = Object.keys(f.storage).filter(key => key.startsWith('slownote.cache.v1:statDetail:')).map(key => JSON.parse(key.slice('slownote.cache.v1:statDetail:'.length)))
  assert(cacheKeys.some(params => params.babyId === 'baby-a' && params.range === 'week' && params.type === 'feeding'), JSON.stringify(cacheKeys))
  assert(cacheKeys.some(params => params.babyId === 'baby-a' && params.dateKey === '2026-10-20' && params.range === 'week' && params.type === 'feeding'), JSON.stringify(cacheKeys))
  assert(cacheKeys.some(params => params.babyId === 'baby-a' && params.dateKey === '2026-10-21' && params.range === 'week' && params.type === 'feeding'), JSON.stringify(cacheKeys))

  let finishRefresh
  f.wx.cloud.callFunction = request => {
    requests.push(request.data)
    return new Promise(resolve => { finishRefresh = () => resolve({ result: trendResult }) })
  }
  let loadingStarted = false
  const setData = f.page.setData.bind(f.page)
  f.page.setData = (updates, done) => {
    if (updates.loading === true) loadingStarted = true
    setData(updates, done)
  }
  const refresh = f.page.load(true)
  assert.equal(f.page.data.loading, false)
  assert.equal(f.page.data.hasData, true)
  assert.equal(loadingStarted, false, 'refreshing an existing scope does not show the skeleton')
  finishRefresh()
  await refresh
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.page.data.hasData, true)
  const retainedSeries = f.page.data.series
  let redraws = 0
  f.page._chartVisible = true
  f.page.draw = () => { redraws += 1 }
  f.page._forceChartDraw = true
  f.wx.cloud.callFunction = async () => { throw new Error('offline') }
  await f.page.load(true)
  assert.equal(f.page.data.hasData, true)
  assert.deepEqual(f.page.data.series, retainedSeries, 'an offline refresh keeps the last trend visible')
  assert.equal(redraws, 1, 'the retained trend is repainted after returning to the page')
  assert.equal(f.page.data.error, '')
  assert(f.calls.some(call => call.type === 'toast'))

  f.page.onUnload()
})

test('detail page accepts the today range and requests day data without comparison totals', async () => {
  let request
  const f = front('statistics-detail', { callFunction: async value => {
    request = value
    return { result: { code: 0, range: 'day', dates: { start: '2026-10-21', end: '2026-10-22' }, series: {}, totals: {}, prevTotals: null } }
  } })
  f.page.onLoad({ type: 'feeding', range: 'day' })
  f.page.draw = () => {}
  await f.page.load()
  assert.equal(f.page.data.rangeIndex, 0)
  assert.equal(request.data.range, 'day')
  assert.equal(Object.hasOwn(f.page.data, 'prevTotals'), false)
})

test('statistics detail is a registered normal page with a visible chart canvas and no calendar heatmap', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'))
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/statistics-detail/index.json'), 'utf8'))
  assert(app.pages.includes('pages/statistics-detail/index'))
  assert.equal(app.tabBar.list.some(tab => tab.pagePath === 'pages/statistics-detail/index'), false)
  assert.equal(config.enablePullDownRefresh, false)
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/statistics-detail/index.wxml'), 'utf8')
  assert.match(template, /class="theme-root \{\{themeClass\}\} page statistics-detail-page \{\{hasData \? 'detail-fixed' : ''\}\}"/)
  assert.match(template, /statisticsDetailChart/)
  assert.doesNotMatch(template, /heatmap-grid|heatmap-section|记录日历/)
  assert.match(template, /selected-day-section/)
  assert.match(template, /class="chart-scroll" scroll-x/)
  assert.match(template, /class="chart-scroll"[^>]*bindscroll="onChartScroll"/)
  assert.match(template, /class="chart-unit-hint"[^>]*>单位：\{\{activeUnit\}\}/)
  assert.match(template, /class="chart-body"[\s\S]*?class="chart-plot-viewport" bindtap="onChartTap"[\s\S]*?class="y-axis-fixed"[^>]*>[\s\S]*?wx:for="\{\{yAxisLabels\}\}"/)
  assert.match(template, /<view class="chart-plot-viewport" bindtap="onChartTap">[\s\S]*?<canvas type="2d" id="statisticsDetailChart" class="chart chart-panes-\{\{chartPaneCount\}\}"><\/canvas>[\s\S]*?<scroll-view class="chart-scroll"[^>]*>[\s\S]*?<view class="chart-scroll-spacer" style="width: \{\{chartWidth\}\}px"[\s\S]*?<\/view>[\s\S]*?<view class="y-axis-fixed" style="width: \{\{axisOverlayWidth\}\}px"/)
  assert.match(template, /<view class="chart-plot-viewport"[^>]*>[\s\S]*?<\/view>\s*<view class="y-axis-fixed"/, 'the fixed axis is a sibling of the scrollable plot viewport')
  assert.doesNotMatch(template, /<canvas[^>]*(?:style="width: \{\{chartWidth\}\}px"|bindtap="onChartTap")/)
  assert.match(template, /class="chart-motion-probe"/)
  assert.match(template, /<scroll-view wx:if="\{\{hasData\}\}" class="detail-scroll" scroll-y[\s\S]*?<view class="selected-day-section">[\s\S]*?<\/scroll-view>/)
  assert.match(template, /class="chart-scroll-spacer"\s+style="width: \{\{chartWidth\}\}px"/)
  assert.match(template, /单位：/)
  assert.doesNotMatch(template, /chart-scroll-hint|横滑查看更多记录|chart-meta/)
  assert.match(template, /class="section-meta">\{\{typeName\}\}记录<\/text>/)
  assert.match(template, /这一天还没有\{\{typeName\}\}记录/)
  assert.match(template, /class="line-icon record-icon detail-day-icon icon-category-\{\{item\.icon\}\}"/)
  assert.match(template, /metric-switch-option \{\{item\.active \? 'active' : ''\}\}/)
  assert.doesNotMatch(template, /bindtouchstart="onChartTouchStart"|bindtouchmove="onChartTouchMove"|detail-range/)
  const style = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/statistics-detail/index.wxss'), 'utf8')
  assert.match(style, /\.statistics-chart\s*\{[^}]*overflow:\s*hidden;/s)
  assert.match(style, /\.chart-body\s*\{[^}]*clip-path:\s*inset\(0\);/s)
  assert.match(style, /\.chart-body\s*\{[^}]*display:\s*flex;/s)
  assert.match(style, /\.chart-plot-viewport\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s)
  assert.match(style, /\.chart-scroll\s*\{[^}]*overflow:\s*hidden;/s)
  assert.match(style, /\.chart-axis-fade-left\s*\{[^}]*left:\s*0;[^}]*width:\s*24rpx;[^}]*linear-gradient\(90deg,\s*var\(--color-surface\),\s*transparent\)/s)
  assert.match(style, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.chart-motion-probe\s*\{\s*display:\s*none;/)
  assert.match(style, /\.statistics-detail-page\.detail-fixed\s*\{[^}]*display:\s*flex;[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;[^}]*padding-bottom:\s*0;/s)
  assert.match(style, /\.detail-scroll\s*\{[^}]*flex:\s*1;[^}]*height:\s*0;[^}]*min-height:\s*0;/s)
  assert.match(style, /\.selected-day-section\s*\{[^}]*padding-bottom:\s*calc\(var\(--space-m\) \+ env\(safe-area-inset-bottom\)\);/s)
  const script = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/statistics-detail/index.js'), 'utf8')
  assert.doesNotMatch(script, /statsGroups|metricCards|metricCardOf|statsOf/)
  assert.doesNotMatch(script, /onPullDownRefresh|cardMatchesType/)
  assert.doesNotMatch(script, /_chartScrollTimer/)
  const chartScript = fs.readFileSync(path.join(__dirname, '../miniprogram/utils/chart.js'), 'utf8')
  assert.match(script, /applyChartClip\(/)
  assert.match(script, /clipViewport\(/)
  assert.match(chartScript, /geometry\.viewOffset/)
  assert.match(chartScript, /ctx\.rect\(0, 0, viewWidth, height\)/)
  assert.match(chartScript, /ctx\.translate\(-offset, 0\)/)
  assert.match(script, /select\('\.chart-plot-viewport'\)/)
  assert.match(chartScript, /function clipViewport/)
  assert.doesNotMatch(chartScript, /viewClip/)
})

test('chart geometry feeds fixed right-side numeric axis labels and viewport-aware scroll state', () => {
  const f = front('statistics-detail')
  const geometry = layout(readSeries({
    kind: 'bar', zeroBased: true,
    dates: { start: '2026-10-01', end: '2026-10-06' },
    series: [{ name: '喂养次数', unit: '次', points: [{ x: '2026-10-01', y: 2 }, { x: '2026-10-05', y: 4 }] }]
  }), 700, 240, palette, 44, 14)
  f.page.setData({ selectedDate: '2026-10-05', chartWidth: 700, axisOverlayWidth: 52 })
  f.page._chartGeometry = geometry
  f.page._chartViewportWidth = 320

  f.page.onChartGeometry(geometry)

  assert(f.page.data.yAxisLabels.length > 0)
  assert(f.page.data.yAxisLabels.every(label => !/次|ml|cm|kg/.test(label.text)))
  assert.equal(f.page.data.axisOverlayWidth, 52)
  const style = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/statistics-detail/index.wxss'), 'utf8')
  assert.match(style, /\.y-axis-fixed text\s*\{[^}]*right:\s*4px;[^}]*text-align:\s*right;/s)
  assert.equal(f.page.data.chartScrollable, true)
  assert(f.page.data.chartScrollLeft > 0)
})

test('chart range sizing reserves an extra date slot and scroll state is measured against the viewport', async () => {
  const f = front('statistics-detail', { callFunction: async () => ({ result: {
    code: 0,
    dates: { start: '2026-10-01', end: '2026-10-25' },
    series: { feeding: [{ d: '2026-10-01', n: 1, ml: 90 }, { d: '2026-10-24', n: 2, ml: 180 }] }
  } }) })
  f.page.setData({ typeKey: 'feeding', typeName: '喂养', rangeIndex: 1 })
  f.page._chartVisible = false
  await f.page.load()
  assert.equal(f.page.data.chartScrollable, false)
  assert.equal(f.page.data.yAxisLabels.length, 0)
  assert(f.page.data.chartWidth >= 320)
})

test('detail page builds chart series for every module type, including custom groups', async () => {
  const fixtures = {
    growth: { series: { growth: [{ d: '2026-10-20', weight: 6, height: 62, head: 40 }] }, totals: { growth: { count: 1, weight: { latest: 6 }, height: { latest: 62 }, head: { latest: 40 } } } },
    feeding: { series: { feeding: [{ d: '2026-10-20', n: 2, ml: 120 }] }, totals: { feeding: { count: 2, amountMl: 120 } } },
    solid: { series: { solid: [{ d: '2026-10-20', n: 1 }] }, totals: { solid: { count: 1 } } },
    excretion: { series: { excretion: [{ d: '2026-10-20', stool: 2, urine: 1 }] }, totals: { excretion: { stool: 2, urine: 1 } } },
    diary: { series: { diary: [{ d: '2026-10-20', n: 1 }] }, totals: { diary: { count: 1 } } },
    custom: { series: { custom: [
      { label: '午睡', unit: '分钟', points: [{ d: '2026-10-20', value: 90 }] },
      { label: '喝水', unit: 'ml', points: [{ d: '2026-10-20', value: 120 }] }
    ] }, totals: { custom: { count: 2 } } }
  }
  for (const [type, fixture] of Object.entries(fixtures)) {
    const f = front('statistics-detail', { callFunction: async () => ({ result: {
      code: 0, series: fixture.series, totals: fixture.totals, prevTotals: null,
      dates: { start: '2026-10-18', end: '2026-10-25' }
    } }) })
    f.page.setData({ typeKey: type, typeName: type, rangeIndex: 0 })
    f.page._chartVisible = false
    await f.page.load()
    assert.equal(f.page.data.hasData, true, type)
    assert(f.page._spec.series.length > 0, type)
    assert.equal(f.page.data.activeUnit, f.page.data.metrics.find(metric => metric.active)?.unit || '', type)
    if (type === 'custom') assert.equal(f.page.data.metrics.length, 2)
  }
})

test('selected chart date loads daily cards filtered to the current type', async () => {
  const { f, requests } = createDailyFixture('feeding')
  await f.page.load()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.page.data.selectedDate, '2026-10-20')
  assert.deepEqual(Array.from(f.page.data.dayCards).map(card => card.key), ['bottle', 'breast', 'mixed', 'formula'])
  assert.deepEqual(Array.from(f.page.data.dayCards).map(card => card.icon), ['feeding', 'feeding', 'feeding', 'feeding'])
  assert.equal(requests.find(request => request.action === 'daily').date, '2026-10-20')
  f.page.setData({ selectedDate: '2026-10-21' })
  await f.page.loadDayDetails('2026-10-21')
  assert.deepEqual(Array.from(f.page.data.dayCards).map(card => card.key), ['bottle', 'breast', 'mixed', 'formula'])
  assert.equal(requests.filter(request => request.action === 'daily').at(-1).date, '2026-10-21')
})

test('selected chart date loads only excretion cards for the excretion detail type', async () => {
  const { f, requests } = createDailyFixture('excretion', 3)
  await f.page.load()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.page.data.selectedDate, '2026-10-20')
  assert.deepEqual(Array.from(f.page.data.dayCards).map(card => card.key), ['excretion'])
  assert.deepEqual(Array.from(f.page.data.dayCards).map(card => card.icon), ['diaper'])
  assert.deepEqual(Array.from(f.page.data.dayCards[0].items, item => item.label), ['大便', '小便'])
  assert.equal(requests.find(request => request.action === 'trend').range, 'all')
  assert.equal(requests.find(request => request.action === 'daily').date, '2026-10-20')
  assert.deepEqual(Array.from(f.page.data.dayCards).map(card => card.tag), ['excretion'])
})

test('metric segment switches among populated growth, feeding and excretion series', () => {
  const cases = [
    { type: 'growth', metrics: ['weight', 'height', 'head'], row: { d: '2026-10-20', weight: 6, height: 62, head: 40 }, select: 'head', series: '头围', unit: 'cm' },
    { type: 'feeding', metrics: ['ml', 'n', 'min'], row: { d: '2026-10-20', ml: 150, n: 3, min: 20 }, select: 'n', series: '次数', unit: '次' },
    { type: 'excretion', metrics: ['stool', 'urine'], row: { d: '2026-10-20', stool: 2, urine: 1 }, select: 'urine', series: '小便', unit: '次' }
  ]
  for (const item of cases) {
    const f = front('statistics-detail')
    f.page._chartVisible = false
    f.page.setData({ typeKey: item.type, typeName: item.type })
    f.page.data.series = { [item.type]: [item.row] }
    f.page.data.dates = { start: '2026-10-18', end: '2026-10-25' }
    f.page.applyType()
    assert.deepEqual(Array.from(f.page.data.metrics, metric => metric.key), item.metrics)
    assert(f.page.data.metrics.filter(metric => metric.hasData).length > 1)
    assert.equal(f.page.data.activeUnit, f.page.data.metrics.find(metric => metric.active)?.unit || '')
    f.page.onMetric({ currentTarget: { dataset: { key: item.select } } })
    assert.equal(f.page.data.metricKeys[0], item.select)
    assert.equal(f.page.data.activeUnit, item.unit)
    assert.equal(f.page._spec.series[0].name, item.series)
  }
  const template = require('node:fs').readFileSync('miniprogram/pages/statistics-detail/index.wxml', 'utf8')
  assert.match(template, /class="metric-switch"/)
  assert.match(template, /bindtap="onMetric"/)
})

test('long date ranges expand the chart and a scrolled tap snaps to a nearby registered date', async () => {
  const requests = []
  const f = front('statistics-detail', { callFunction: async request => {
    requests.push(request.data)
    if (request.data.action === 'daily') return { result: { code: 0, summary: {}, times: {} } }
    return { result: { code: 0, dates: { start: '2026-10-01', end: '2026-11-01' }, series: { feeding: [
      { d: '2026-10-01', ml: 100, n: 1 }, { d: '2026-10-20', ml: 150, n: 2 }, { d: '2026-10-31', ml: 200, n: 3 }
    ] } } }
  } })
  f.page.setData({ typeKey: 'feeding', typeName: '喂养', rangeIndex: 3 })
  f.page._chartVisible = false
  await f.page.load()
  assert(f.page.data.chartWidth > 400, 'a month of dates should exceed the viewport width')
  f.page._chartGeometry = layout(readSeries({
    kind: 'line', gap: 'skip', dates: f.page.data.dates,
    series: [{ name: '奶量', unit: 'ml', points: [
      { x: '2026-10-01', y: 100 }, { x: '2026-10-20', y: 150 }, { x: '2026-10-31', y: 200 }
    ] }]
  }), f.page.data.chartWidth, 240, palette, 44, 14)
  const geometry = f.page._chartGeometry
  geometry.logicalWidth = f.page.data.chartWidth
  geometry.bitmapWidth = 200
  geometry.viewWidth = 200
  const targetX = xAtDate(f.page, '2026-10-20')
  geometry.viewOffset = targetX - 100
  f.page._spec = { selectedDate: f.page.data.selectedDate }
  f.wx.createSelectorQuery = () => ({
    in() { return this }, select() { return this },
    boundingClientRect(callback) { callback({ left: 100 }); return this },
    exec() {}
  })
  f.page.onChartTap({ changedTouches: [{ clientX: 218 }] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.page.data.selectedDate, '2026-10-20')
  assert.equal(requests.filter(request => request.action === 'daily').at(-1).date, '2026-10-20')
})

test('horizontal chart scrolling redraws logical content in a fixed viewport canvas', async () => {
  const f = front('statistics-detail')
  const geometry = layout(readSeries({
    kind: 'line', gap: 'skip', dates: { start: '2026-10-01', end: '2026-10-11' },
    series: [{ name: '体重', unit: 'kg', points: [{ x: '2026-10-01', y: 6 }, { x: '2026-10-10', y: 7 }] }]
  }), 700, 240, palette, 44, 14)
  geometry.bitmapWidth = 200
  geometry.logicalWidth = 700
  geometry.axisFontSize = 14
  geometry.axisFontFamily = 'sans-serif'
  const rects = [], translations = []
  const ctx = {
    save() {}, restore() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, arc() {}, fill() {}, rect(...args) { rects.push(args) }, clip() {}, closePath() {},
    translate(...args) { translations.push(args) },
    setLineDash() {}, fillText() {}, measureText(text) { return { width: String(text).length * 6 } }
  }
  f.page._chartGeometry = geometry
  f.page._chartContext = ctx
  f.page._chartProgress = 1
  f.page._chartViewportWidth = 200
  f.page._chartEstimatedViewport = 200
  f.page.onChartScroll({ detail: { scrollLeft: 180, width: 200 } })
  await new Promise(resolve => setTimeout(resolve, 180))
  assert.equal(geometry.viewOffset, 180)
  assert.equal(geometry.viewWidth, 200)
  assert.deepEqual(rects[0], [0, 0, 200, 240], 'the canvas clip stays at the fixed bitmap origin')
  assert.deepEqual(translations, [[-180, 0]], 'logical chart content follows scrollLeft')
})

test('tapping a scrolled chart maps the touch back through the scroll offset', async () => {
  const f = front('statistics-detail')
  f.page.data.hasData = true
  f.page.data.selectedDate = '2026-10-01'
  f.page._recordDates = new Set(['2026-10-01', '2026-10-06'])
  f.page._chartGeometry = {
    plot: { x: 20, w: 620 },
    start: Date.parse('2026-10-01T00:00:00Z'),
    end: Date.parse('2026-10-11T00:00:00Z'),
    viewOffset: 200, viewWidth: 200, series: []
  }
  f.page._spec = { selectedDate: '2026-10-01' }
  let tapped = ''
  f.page.selectChartDateValue = date => { tapped = date }
  f.wx.createSelectorQuery = () => ({
    in() { return this }, select() { return this },
    boundingClientRect(callback) { callback({ left: 50 }); return this },
    exec() {}
  })
  f.page.onChartTap({ changedTouches: [{ clientX: 150 }] })
  await new Promise(resolve => setImmediate(resolve))
  // physical X = 150 - 50 = 100; logical X = 100 + viewOffset 200 = 300.
  // The nearby registered point is 10-06; the offscreen 10-01 point is ignored.
  assert.equal(tapped, '2026-10-06')
})

test('horizontal chart scrolling clips the trend without changing selection or loading daily data', async () => {
  const { f, requests } = createDailyFixture('feeding')
  await f.page.load()
  await new Promise(resolve => setImmediate(resolve))
  const beforeDaily = requests.filter(request => request.action === 'daily').length
  const beforeTrend = requests.filter(request => request.action === 'trend').length
  const selectedBefore = f.page.data.selectedDate
  const cardsBefore = f.page.data.dayCards
  f.page._chartGeometry = layout(readSeries({
    kind: 'line', gap: 'skip', dates: { start: '2026-10-18', end: '2026-10-25' },
    series: [{ name: '奶量', unit: 'ml', points: [{ x: '2026-10-20', y: 150 }, { x: '2026-10-24', y: 200 }] }]
  }), 700, 240, palette, 44, 14)
  f.page._chartGeometry.logicalWidth = 700
  f.page._chartGeometry.bitmapWidth = 200
  f.page._chartGeometry.viewWidth = 200
  f.page._recordDates = new Set(['2026-10-20', '2026-10-24'])
  f.page._chartViewportWidth = 200
  f.page._chartEstimatedViewport = 200

  const registeredX = xAtDate(f.page, '2026-10-24')
  f.page._chartGeometry.viewOffset = registeredX - 100
  f.page.onChartScroll({ detail: { scrollLeft: registeredX - 100, width: 200 } })
  await new Promise(resolve => setTimeout(resolve, 180))

  assert.equal(f.page.data.selectedDate, selectedBefore)
  assert.equal(f.page.data.dayCards, cardsBefore)
  assert.equal(requests.filter(request => request.action === 'daily').length, beforeDaily)
  assert.equal(requests.filter(request => request.action === 'trend').length, beforeTrend)

  f.page.onChartTap({ detail: { x: 108 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.page.data.selectedDate, '2026-10-24')
  assert.equal(requests.filter(request => request.action === 'daily').length, beforeDaily + 1)
  assert.equal(requests.filter(request => request.action === 'trend').length, beforeTrend)
})

test('tapping a blank date between registered points does not change selection or request daily data', async () => {
  const { f, requests } = createDailyFixture('feeding')
  await f.page.load()
  await new Promise(resolve => setImmediate(resolve))
  const selectedBefore = f.page.data.selectedDate
  const dailyBefore = requests.filter(request => request.action === 'daily').length
  f.page._chartGeometry = layout(readSeries({
    kind: 'line', gap: 'skip', dates: { start: '2026-10-18', end: '2026-10-25' },
    series: [{ name: '奶量', unit: 'ml', points: [
      { x: '2026-10-20', y: 150 }, { x: '2026-10-24', y: 200 }
    ] }]
  }), 700, 240, palette, 44, 14)
  f.page._chartGeometry.viewWidth = 700
  f.page._recordDates = new Set(['2026-10-20', '2026-10-24'])
  const blankX = xAtDate(f.page, '2026-10-22')
  f.page.onChartTap({ detail: { x: blankX } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.page.data.selectedDate, selectedBefore)
  assert.equal(requests.filter(request => request.action === 'daily').length, dailyBefore)

  f.page._chartGeometry.viewWidth = 100
  f.page.onChartTap({ detail: { x: 120 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.page.data.selectedDate, selectedBefore, 'a touch outside the visible viewport is ignored')
  assert.equal(requests.filter(request => request.action === 'daily').length, dailyBefore)
})

test('selectChartDateValue rejects a date without a registered value', async () => {
  const { f, requests } = createDailyFixture('feeding')
  await f.page.load()
  await new Promise(resolve => setImmediate(resolve))
  const selectedBefore = f.page.data.selectedDate
  const dailyBefore = requests.filter(request => request.action === 'daily').length
  f.page.selectChartDateValue('2026-10-22')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.page.data.selectedDate, selectedBefore)
  assert.equal(requests.filter(request => request.action === 'daily').length, dailyBefore)
})

test('refresh builds the tappable date set from every metric and clears it when data is empty', () => {
  const f = front('statistics-detail')
  f.page._chartVisible = false
  f.page.setData({ typeKey: 'growth', dates: { start: '2026-10-01', end: '2026-10-05' }, series: {
    growth: [
      { d: '2026-10-01', weight: 6, height: null, head: null },
      { d: '2026-10-03', weight: null, height: 62, head: null },
      { d: '2026-10-04', weight: null, height: null, head: 40 }
    ]
  } })
  f.page.applyType()
  assert.deepEqual([...f.page._recordDates].sort(), ['2026-10-01', '2026-10-03', '2026-10-04'])
  f.page.setData({ series: { growth: [] } })
  f.page.refresh()
  assert.deepEqual([...f.page._recordDates], [])
})
