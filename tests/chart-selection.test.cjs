const test = require('node:test'), assert = require('node:assert/strict')
const { readSeries, layout, drawAxis, drawFrame, dateAtX, xAtDate, axisLabels, highlightDate, clipViewport, seriesChart } = require('../miniprogram/utils/chart')
const palette = require('../miniprogram/utils/theme').resolve()

function spec(kind = 'line') {
  return readSeries({ kind, zeroBased: kind === 'bar', gap: 'skip', dates: { start: '2026-10-18', end: '2026-10-22' }, series: [
    { name: '记录数', unit: '次', points: [{ x: '2026-10-18', y: 1 }, { x: '2026-10-19', y: 3 }, { x: '2026-10-20', y: 2 }] }
  ] })
}

test('vertical axis labels are exposed for a fixed overlay and grid strokes use a restored dash pattern', () => {
  const model = spec(), geometry = layout(model, 320, 240, palette, 44, 14)
  geometry.axisFontSize = 14
  const labels = [], dashCalls = [], dashAtStroke = []
  let dash = []
  const ctx = {
    save() {}, restore() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { dashAtStroke.push(dash.slice()) }, arc() {}, fill() {}, rect() {}, clip() {}, closePath() {},
    setLineDash(value) { dash = value.slice(); dashCalls.push(value.slice()) },
    fillText(text, x, y) { labels.push({ text, x, y }) },
    measureText(text) { return { width: String(text).length * 6 } }
  }
  drawAxis(ctx, geometry, 1)
  assert.equal(labels.some(label => /次/.test(label.text)), false, 'canvas keeps only horizontal date labels')
  const yLabels = axisLabels(geometry)
  assert(yLabels.length > 0)
  assert(yLabels.every(label => /^\d+(?:\.\d+)?$/.test(label.text)), 'fixed axis labels contain values without units')
  assert(yLabels.every(label => Number.isFinite(label.y)))
  assert.equal(geometry.plot.x + geometry.plot.w, geometry.width - 12)
  drawFrame(ctx, geometry, 1)
  assert(dashCalls.some(value => value.join(',') === '4,4'))
  assert(dashCalls.some(value => value.length === 0))
  assert(dashAtStroke.some(value => value.join(',') === '4,4'))
  assert.deepEqual(dash, [])
})

test('line and bar points receive colored value labels, and selected dates use a bold node without a crosshair', () => {
  for (const kind of ['line', 'bar']) {
    const geometry = layout(spec(kind), 320, 240, palette, 44, 14)
    geometry.axisFontSize = 14; geometry.axisFontFamily = 'sans-serif'
    const labels = [], lineStyles = [], dashCalls = [], arcs = []
    let dash = []
    const ctx = {
      save() {}, restore() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() { lineStyles.push(this.strokeStyle); if (this._selectionLine) this._selectionLine = false },
      arc(x, y, radius) { arcs.push({ x, y, radius }) }, fill() {}, rect() {}, clip() {}, closePath() {},
      setLineDash(value) { dash = value.slice(); dashCalls.push(value.slice()) },
      fillText(text, x, y) { labels.push({ text: String(text), x, y, color: this.fillStyle }) },
      measureText(text) { return { width: String(text).length * 6 } }
    }
    drawFrame(ctx, geometry, 1)
    assert(labels.some(label => label.text === '1'))
    assert(labels.some(label => label.text === '3'))
    const valueLabels = () => labels.filter(label => label.color === palette.accent).map(({ text, x, y }) => ({ text, x, y }))
    const initialLabels = valueLabels()
    assert.equal(initialLabels.length, 3, 'every registered point has a value label')
    const page = { _chartGeometry: geometry, _chartContext: ctx, _chartProgress: 1 }
    const centerX = geometry.plot.x + geometry.plot.w / 2
    assert.equal(dateAtX(page, centerX), '2026-10-20')
    for (const date of ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']) {
      assert.equal(dateAtX(page, xAtDate(page, date)), date)
    }
    const before = lineStyles.length
    labels.length = 0
    highlightDate(page, '2026-10-20')
    assert.equal(geometry.selectedDate, '2026-10-20')
    assert(lineStyles.length > before)
    const firstSelectionLabels = valueLabels()
    labels.length = 0
    highlightDate(page, '2026-10-18')
    assert.deepEqual(valueLabels(), firstSelectionLabels, 'changing the selected date never moves or removes value labels')
    assert.deepEqual(firstSelectionLabels, initialLabels)
    assert(!dashCalls.some(value => value.join(',') === '3,3'), 'selection adds no vertical dashed line')
    assert(arcs.some(arc => arc.radius === 5), 'selection keeps a radius-5 solid point')
  }
})

test('scrolling fixes the viewport clip and translates logical content by the scroll offset', () => {
  const geometry = layout(spec(), 700, 240, palette, 44, 14)
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
  const page = { _chartGeometry: geometry, _chartContext: ctx, _chartProgress: 1 }
  assert.equal(clipViewport(page, 150, 200), true)
  assert.equal(geometry.viewOffset, 150)
  assert.equal(geometry.viewWidth, 200)
  assert.deepEqual(rects[0], [0, 0, 200, 240], 'the bitmap clip always starts at its fixed left edge')
  assert.deepEqual(translations, [[-150, 0]], 'logical chart content moves opposite to scrollLeft')
  assert.equal(clipViewport(page, 150, 200), false, 'an unchanged offset does not repaint')
  rects.length = 0; translations.length = 0
  assert.equal(clipViewport(page, 640, 200), true)
  assert.equal(geometry.viewOffset, 500, 'the offset is bounded so the viewport never scrolls past the last date')
  assert.equal(geometry.viewWidth, 200)
  assert.deepEqual(rects[0], [0, 0, 200, 240])
  assert.deepEqual(translations, [[-500, 0]])
  rects.length = 0; translations.length = 0
  drawFrame(ctx, geometry, 1)
  assert.deepEqual(rects[0], [0, 0, 200, 240], 'highlight and animation frames keep the fixed viewport clip')
  assert.deepEqual(translations, [[-500, 0]])
})

test('scrolling during the opening frame completes the translated viewport instead of leaving a blank canvas', () => {
  const geometry = layout(spec(), 700, 240, palette, 44, 14)
  geometry.bitmapWidth = 200
  geometry.logicalWidth = 700
  geometry.axisFontSize = 14
  geometry.axisFontFamily = 'sans-serif'
  const labels = [], rects = [], translations = []
  const ctx = {
    save() {}, restore() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, arc() {}, fill() {}, rect(...args) { rects.push(args) }, clip() {}, closePath() {},
    translate(...args) { translations.push(args) }, setLineDash() {},
    fillText(text) { labels.push(String(text)) },
    measureText(text) { return { width: String(text).length * 6 } }
  }
  let canceled = null
  const page = {
    _chartGeometry: geometry,
    _chartContext: ctx,
    _chartCanvas: { cancelAnimationFrame(id) { canceled = id } },
    _chartRaf: 12,
    _chartProgress: 0
  }

  assert.equal(clipViewport(page, 120, 200), true)
  assert.equal(canceled, 12)
  assert.equal(page._chartRaf, null)
  assert.equal(page._chartProgress, 1)
  assert(labels.length > 0, 'the horizontal axis is painted during the scroll redraw')
  assert.deepEqual(rects[0], [0, 0, 200, 240])
  assert.deepEqual(translations, [[-120, 0]])
})

test('seriesChart lays out logical dates on a viewport-sized bitmap', async () => {
  const previousWx = global.wx
  const previousGetApp = global.getApp
  const clearRects = [], rects = [], translations = []
  const ctx = {
    setTransform() {}, scale() {}, clearRect(...args) { clearRects.push(args) },
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    arc() {}, fill() {}, rect(...args) { rects.push(args) }, clip() {}, closePath() {},
    translate(...args) { translations.push(args) }, setLineDash() {}, fillText() {},
    measureText(text) { return { width: String(text).length * 6 } }
  }
  const canvas = { getContext() { return ctx } }
  const page = {
    data: { chartWidth: 700, chartScrollLeft: 200 },
    _chartLogicalWidth: 700, _chartViewportWidth: 200, _chartVisible: true
  }
  const callbacks = []
  global.getApp = () => ({ palette })
  global.wx = {
    getSystemInfoSync() { return { pixelRatio: 1, windowWidth: 375 } },
    createSelectorQuery() {
      let selector = ''
      return {
        in() { return this },
        select(value) { selector = value; return this },
        fields(_options, callback) { callbacks.push({ selector, callback }); return this },
        exec(done) {
          callbacks.splice(0).forEach(entry => entry.callback(entry.selector === '.chart-motion-probe'
            ? { display: 'none', fontSize: '14px', borderTopLeftRadius: '8px', transitionDuration: '0ms' }
            : { node: canvas, width: 200, height: 240 }))
          done()
        }
      }
    }
  }
  try {
    seriesChart(page, '#chart', {
      kind: 'line', gap: 'skip', dates: { start: '2026-10-01', end: '2026-10-11' },
      series: [{ name: '体重', unit: 'kg', points: [{ x: '2026-10-01', y: 6 }, { x: '2026-10-10', y: 7 }] }]
    })
    await new Promise(resolve => setTimeout(resolve, 130))
    assert.deepEqual(page._chartSize, { width: 200, height: 240 }, 'the bitmap stays viewport-sized')
    assert.equal(page._chartGeometry.width, 700, 'the date layout uses the full logical width')
    assert.equal(page._chartGeometry.logicalWidth, 700)
    assert.equal(page._chartGeometry.bitmapWidth, 200)
    assert.deepEqual(rects[0], [0, 0, 200, 240])
    assert.deepEqual(translations, [[-200, 0]])
    assert.deepEqual(clearRects[0], [0, 0, 200, 240])
    assert.equal(clipViewport(page, 640, 200), true)
    assert.equal(page._chartGeometry.viewOffset, 500, 'scroll offset is bounded by logicalWidth - viewWidth')
    assert(rects.some(rect => rect.join(',') === '0,0,200,240'), 'redraw keeps the clip fixed to the viewport bitmap')
    assert.deepEqual(translations.at(-1), [-500, 0])
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
    if (previousGetApp === undefined) delete global.getApp
    else global.getApp = previousGetApp
  }
})

test('dense line labels retain every registered value, including the selected date', () => {
  const dates = Array.from({ length: 30 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`)
  const model = readSeries({
    kind: 'line', gap: 'skip', selectedDate: '2026-10-15',
    dates: { start: dates[0], end: '2026-10-31' },
    series: [{ name: '体重', unit: 'kg', points: dates.map((date, index) => ({ x: date, y: index + 10 })) }]
  })
  const geometry = layout(model, 320, 240, palette, 44, 14)
  geometry.axisFontSize = 14
  geometry.axisFontFamily = 'sans-serif'
  const labels = []
  const ctx = {
    save() {}, restore() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, arc() {}, fill() {}, rect() {}, clip() {}, closePath() {},
    setLineDash() {}, fillText(text, x, y) { labels.push({ text: String(text), x, y, color: this.fillStyle, align: this.textAlign }) },
    measureText(text) { return { width: String(text).length * 7 } }
  }
  drawFrame(ctx, geometry, 1)
  const pointLabels = labels.filter(label => label.color === palette.accent && label.y <= geometry.plot.y + geometry.plot.h)
  assert.equal(pointLabels.length, dates.length, 'dense labels are repositioned instead of silently dropped')
  assert(pointLabels.some(label => label.text === '10'), 'minimum value is labeled')
  assert(pointLabels.some(label => label.text === '39'), 'maximum value is labeled')
  assert(pointLabels.some(label => label.text === '24'), 'selected date value is labeled')
  assert.equal(pointLabels.find(label => label.text === '10').align, 'left', 'first point label stays attached to the point without clamping')
})

test('three consecutive two-digit values remain labeled after selecting the middle point', () => {
  const geometry = layout(readSeries({
    kind: 'line', gap: 'skip', dates: { start: '2026-10-01', end: '2026-10-04' },
    series: [{ name: '记录数', unit: '次', points: [
      { x: '2026-10-01', y: 12 }, { x: '2026-10-02', y: 23 }, { x: '2026-10-03', y: 34 }
    ] }]
  }), 320, 240, palette, 44, 14)
  geometry.axisFontSize = 14
  geometry.axisFontFamily = 'sans-serif'
  const labels = []
  const ctx = {
    save() {}, restore() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, arc() {}, fill() {}, rect() {}, clip() {}, closePath() {}, setLineDash() {},
    fillText(text, x, y) { labels.push({ text: String(text), x, y, color: this.fillStyle }) },
    measureText(text) { return { width: String(text).length * 7 } }
  }
  const page = { _chartGeometry: geometry, _chartContext: ctx, _chartProgress: 1 }
  drawFrame(ctx, geometry, 1)
  const before = labels.filter(label => label.color === palette.accent).map(({ text, x, y }) => ({ text, x, y }))
  labels.length = 0
  highlightDate(page, '2026-10-02')
  const after = labels.filter(label => label.color === palette.accent).map(({ text, x, y }) => ({ text, x, y }))
  assert.deepEqual(after, before)
  assert.deepEqual(after.map(label => label.text), ['12', '23', '34'])
})

test('point labels stay fully inside the currently visible right viewport edge', () => {
  const geometry = layout(readSeries({
    kind: 'line', gap: 'skip', dates: { start: '2026-10-01', end: '2026-10-11' },
    series: [{ name: '体重', unit: 'kg', points: [{ x: '2026-10-01', y: 6 }, { x: '2026-10-10', y: 7 }] }]
  }), 700, 240, palette, 44, 14)
  geometry.bitmapWidth = 200
  geometry.logicalWidth = 700
  geometry.viewOffset = 425
  geometry.viewWidth = 200
  geometry.axisFontSize = 14
  geometry.axisFontFamily = 'sans-serif'
  const labels = []
  const ctx = {
    save() {}, restore() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, arc() {}, fill() {}, rect() {}, clip() {}, closePath() {}, translate() {}, setLineDash() {},
    fillText(text, x, y) { labels.push({ text: String(text), x, y, color: this.fillStyle, align: this.textAlign }) },
    measureText(text) { return { width: String(text).length * 6 } }
  }
  drawFrame(ctx, geometry, 1)
  const last = labels.find(label => label.color === palette.accent && label.text === '7')
  assert(last)
  assert.equal(last.align, 'right')
  assert(last.x + 2 <= geometry.viewOffset + geometry.viewWidth, 'the full label fits before the visible right edge')
  assert(last.x - String(last.text).length * 6 >= geometry.viewOffset, 'the label is not clipped at the viewport left edge')
})

test('line value labels move away from crossing segments', () => {
  const model = readSeries({
    kind: 'line', gap: 'skip', selectedDate: '2026-10-02',
    dates: { start: '2026-10-01', end: '2026-10-04' },
    series: [{ name: '记录数', unit: '次', points: [
      { x: '2026-10-01', y: 20 }, { x: '2026-10-02', y: 10 }, { x: '2026-10-03', y: 30 }
    ] }]
  })
  const geometry = layout(model, 320, 240, palette, 44, 14)
  geometry.axisFontSize = 14
  geometry.axisFontFamily = 'sans-serif'
  const series = geometry.series[0]
  const point = series.points[1]
  point.x = geometry.plot.x + geometry.plot.w * 0.55
  point.y = series.pane.y + series.pane.h * 0.55
  series.points[0].x = point.x - 60
  series.points[0].y = point.y + 50
  series.points[2].x = point.x + 10
  series.points[2].y = point.y - 50
  const labels = []
  const ctx = {
    save() {}, restore() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, arc() {}, fill() {}, rect() {}, clip() {}, closePath() {}, setLineDash() {},
    fillText(text, x, y) { labels.push({ text: String(text), x, y, color: this.fillStyle }) },
    measureText(text) { return { width: String(text).length * 7 } }
  }

  drawFrame(ctx, geometry, 1)

  const selectedLabel = labels.find(label => label.text === '10')
  assert(selectedLabel, 'the selected value remains labeled when a safe position exists')
  assert(selectedLabel.y > point.y, 'the label moves below the selected point to avoid the steep segment')
})
