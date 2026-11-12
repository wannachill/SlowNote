const test = require('node:test')
const assert = require('node:assert/strict')
const { front, load } = require('./helpers.cjs')
const { readSeries, layout, drawAxis } = require('../miniprogram/utils/chart')

test('daily bars have equal widths and center on date slots at the plot edges', () => {
  const f = front('statistics')
  const rectangles = []
  const arcs = []
  let path = null
  const ctx = {
    beginPath() { path = { left: null, right: null } },
    moveTo(x, y) { if (path && !path.first) path.first = { x, y } },
    lineTo(x, y) { if (path && path.first && !path.second) path.second = { x, y } },
    rect(x, y, width) { if (path) { path.left = x; path.right = x + width } },
    arc(x, y, radius) { arcs.push({ x, y, radius }) },
    fill() { if (path && path.left !== null) rectangles.push({ left: path.left, right: path.right }) },
    measureText(value) { return { width: String(value).length * 6 } },
    clearRect() {}, setTransform() {}, scale() {}, save() {}, restore() {},
    quadraticCurveTo() {}, closePath() {}, stroke() {}, clip() {}, fillText() {}
  }
  const canvas = { getContext: () => ctx }
  const probe = { display: 'none', transitionDuration: '0ms', borderTopLeftRadius: '0px', fontSize: '0px', fontFamily: 'sans-serif' }
  f.wx.createSelectorQuery = () => {
    const entries = []
    let selector = ''
    return {
      in() { return this },
      select(value) { selector = value; return this },
      fields(options, callback) { entries.push({ selector, options, callback }); return this },
      exec(callback) {
        for (const entry of entries) {
          if (entry.selector === '.chart-motion-probe') entry.callback(probe)
          else entry.callback({ node: canvas, width: 320, height: 240 })
        }
        callback()
      }
    }
  }

  const spec = {
    kind: 'bar', zeroBased: true, gap: 'zero',
    dates: { start: '2026-10-18', end: '2026-10-25' },
    series: [{ name: '次数', unit: '次', points: [
      { x: '2026-10-18', y: 2 }, { x: '2026-10-21', y: 4 }, { x: '2026-10-24', y: 1 }
    ] }]
  }
  const chart = load('miniprogram/utils/chart.js', {
    wx: f.wx,
    getApp: () => f.app,
    setTimeout(callback) { callback(); return 1 },
    clearTimeout() {}
  })
  const page = { _chartVisible: true, _chartMeasure: { width: 320, height: 240 } }
  chart.seriesChart(page, '#statisticsChart', spec)

  const geometry = page._chartGeometry
  const slot = geometry.plot.w / ((geometry.end - geometry.start) / 86400000)
  const expected = geometry.series[0].points.filter(point => point.v > 0).map(point => point.x + slot / 2)
  const widths = rectangles.map(rect => rect.right - rect.left)
  const centers = rectangles.map(rect => (rect.left + rect.right) / 2)

  assert.equal(rectangles.length, 3)
  assert(widths.every(width => Math.abs(width - widths[0]) < 1e-6))
  assert(centers.every((center, index) => Math.abs(center - expected[index]) < 1e-6))

  rectangles.length = 0
  const sparseSpec = {
    kind: 'bar', zeroBased: true, gap: 'zero',
    dates: { start: '2026-10-21', end: '2026-10-22' },
    series: [{ name: '次数', unit: '次', points: [{ x: '2026-10-21', y: 1 }] }]
  }
  chart.seriesChart(page, '#statisticsChart', sparseSpec)
  const sparseGeometry = page._chartGeometry
  const sparseSlot = sparseGeometry.plot.w / ((sparseGeometry.end - sparseGeometry.start) / 86400000)
  assert.equal(rectangles.length, 1)
  assert(rectangles[0].right - rectangles[0].left <= 24)
  assert.equal((rectangles[0].left + rectangles[0].right) / 2, sparseGeometry.series[0].points[0].x + sparseSlot / 2)

  arcs.length = 0
  const lineSpec = {
    kind: 'line', gap: 'skip',
    dates: { start: '2026-10-18', end: '2026-10-25' },
    series: [{ name: '喂养次数', unit: '次', points: [
      { x: '2026-10-18', y: 2 }, { x: '2026-10-21', y: 4 }, { x: '2026-10-24', y: 1 }
    ] }]
  }
  chart.seriesChart(page, '#statisticsDetailChart', lineSpec)
  const lineGeometry = page._chartGeometry
  assert.equal(arcs.length, 3)
  assert.deepEqual(arcs.map(point => [point.x, point.y]), lineGeometry.series[0].points.map(point => [point.x, point.y]))
  assert(arcs.every(point => point.radius === 3))

  arcs.length = 0
  const singlePointSpec = {
    kind: 'line', gap: 'skip',
    dates: { start: '2026-10-18', end: '2026-10-25' },
    series: [{ name: '日记', unit: '篇', points: [{ x: '2026-10-21', y: 1 }] }]
  }
  chart.seriesChart(page, '#statisticsDetailChart', singlePointSpec)
  assert.equal(arcs.length, 1, 'a lone real observation remains visible')
})

test('short chart ranges omit month bands while longer ranges retain them', () => {
  const palette = require('../miniprogram/utils/theme').resolve()
  const labelsFor = (start, end) => {
    const spec = { kind: 'line', dates: { start, end }, series: [{ name: '体重', unit: 'kg', points: [{ x: start, y: 6 }, { x: end, y: 6.2 }] }] }
    const geometry = layout(readSeries(spec), 320, 240, palette, 42, 14)
    const labels = []
    const ctx = { save() {}, restore() {}, measureText(value) { return { width: String(value).length * 6 } }, fillText(text, x, y) { labels.push({ text, y }) } }
    geometry.axisFontSize = 14
    geometry.axisFontFamily = 'sans-serif'
    drawAxis(ctx, geometry, 1)
    return labels
  }
  const shortLabels = labelsFor('2026-10-28', '2026-11-04')
  assert(!shortLabels.some(label => /月/.test(label.text)))
  const longLabels = labelsFor('2026-10-01', '2026-11-15')
  assert(longLabels.some(label => /月/.test(label.text)))
})
