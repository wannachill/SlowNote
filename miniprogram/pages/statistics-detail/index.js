const page = require('../../utils/page'), { call } = require('../../utils/api')
const pageCache = require('../../utils/page-cache')
const { seriesChart, cancel: cancelChart, dateAtX, xAtDate, highlightDate, axisLabels, clipViewport } = require('../../utils/chart')
const { dailyCards } = require('../../utils/viewmodels')
const homeCards = require('../../utils/home-cards')
const { dateKey, week } = require('../../utils/date')
const {
  RANGE_KEYS, MAX_SERIES, TYPES, EMPTY, domainOf,
  metricPoints, paneCountOf, cardsForType
} = require('../../utils/statistics-detail-core')

const HIT_MIN = 20
const sameData = (left, right) => JSON.stringify(left) === JSON.stringify(right)
function setDataIfChanged(target, updates, done) {
  const changed = Object.keys(updates).some(key => !sameData(target.data[key], updates[key]))
  if (changed) target.setData(updates, done)
  else if (done) done()
  return changed
}

function findType(key) { return TYPES.find(type => type.key === key) || TYPES[0] }

page({
  data: {
    typeKey: 'growth', typeName: '成长', title: '成长趋势',
    rangeIndex: 1, dates: {}, series: {},
    metrics: [], metricKeys: [],
    chartKind: 'line', legend: [], chartPaneCount: 1, activeUnit: '', hasData: false,
    emptyTitle: '', emptyNote: '', loading: false, error: '', selectedDate: '', chartWidth: 320, chartScrollLeft: 0, chartScrollable: false, yAxisLabels: [], axisOverlayWidth: 56, dayCards: [], dayLoading: false, dayError: ''
  },
  onLoad(options = {}) {
    const type = findType(options.type)
    const selectedRange = RANGE_KEYS.indexOf(options.range)
    this.setData({
      typeKey: type.key,
      typeName: type.name,
      title: `${type.name}趋势`,
      rangeIndex: selectedRange >= 0 ? selectedRange : 1
    })
  },
  async onShow() {
    this._chartVisible = true
    this._forceChartDraw = true
    const title = `${this.data.typeName}趋势`
    if (this.data.title !== title) this.setData({ title })
    const app = getApp()
    if (!app.globalData.initialized || app._initializing) await app.init()
    return this.load()
  },
  onHide() { this._chartVisible = false; this.cancelDayLoad(); this.cancelChartScroll(); cancelChart(this) },
  onUnload() { this._chartVisible = false; this.cancelDayLoad(); this.cancelChartScroll(); cancelChart(this) },
  onSessionChange() {
    this._version = (this._version || 0) + 1
    this.cancelDayLoad()
    this._trendScopeKey = ''
    this._dayScopeKey = ''
    this._loadedTrendOnce = false
    this._loadedDayOnce = false
    this._spec = null
    this._recordDates = new Set()
    this.setData({
      title: `${this.data.typeName}趋势`, series: {}, dates: {}, metrics: [], metricKeys: [],
      selectedDate: '', hasData: false, legend: [], dayCards: [], dayError: '', error: ''
    })
    return this.load()
  },
  onPaletteChange() { if (this.data.hasData) this.refresh(true) },
  onMetric(e) {
    const key = e.currentTarget.dataset.key
    const type = findType(this.data.typeKey)
    if (!type || this.data.metrics.length <= 1 || !this.data.metrics.some(metric => metric.key === key)) return
    const keys = type.multi
      ? (this.data.metricKeys.includes(key) ? this.data.metricKeys.filter(item => item !== key) : this.data.metricKeys.length >= MAX_SERIES ? this.data.metricKeys.slice(1).concat(key) : this.data.metricKeys.concat(key))
      : [key]
    if (!keys.length) return
    this.setData({ metricKeys: keys })
    this.refresh()
  },
  cancelDayLoad() {
    if (this._dayTimer) clearTimeout(this._dayTimer)
    this._dayTimer = null
    this._dayVersion = (this._dayVersion || 0) + 1
  },
  cancelChartScroll() {
    if (this._chartClipTimer) clearTimeout(this._chartClipTimer)
    this._chartClipTimer = null
  },
  // Coalesce scroll events into one repaint per frame; the canvas itself is
  // clipped in chart.js so its native layer can never leak out of the card.
  applyChartClip(scrollLeft, viewportWidth) {
    const width = Number(viewportWidth) || 0
    if (!(width > 0)) return
    this._chartClipLeft = Math.max(0, Number(scrollLeft) || 0)
    this._chartClipWidth = width
    if (this._chartClipTimer) return
    this._chartClipTimer = setTimeout(() => {
      this._chartClipTimer = null
      clipViewport(this, this._chartClipLeft, this._chartClipWidth)
    }, 16)
  },
  onChartGeometry(geometry) {
    if (!geometry) return
    const axisOverlayWidth = Math.ceil(Math.max(24, (Number(geometry.axisLabelWidth) || 44) + 8))
    const axisWidthChanged = axisOverlayWidth !== this.data.axisOverlayWidth
    this.setData({
      yAxisLabels: axisLabels(geometry),
      axisOverlayWidth
    }, () => {
      if (!axisWidthChanged) return
      wx.createSelectorQuery().in(this).select('.chart-scroll').boundingClientRect(rect => {
        if (!rect || !rect.width) return this.draw()
        this._chartViewportWidth = rect.width
        const chartWidth = Math.max(this.data.chartWidth, rect.width)
        this.setData({ chartWidth, chartScrollable: chartWidth > rect.width }, () => this.draw())
      }).exec()
    })
    this.applyChartClip(this.data.chartScrollLeft, this._chartViewportWidth || this._chartEstimatedViewport || 0)
    if (!this.data.selectedDate) return
    const pointX = xAtDate(this, this.data.selectedDate)
    if (pointX == null) return
    const position = () => {
      const system = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const scale = (Number(system.windowWidth) || 375) / 750
      const width = this._chartViewportWidth || Math.max(180, (Number(system.windowWidth) || 375) - 178 * scale - (Number(this.data.axisOverlayWidth) || 56))
      const maxScroll = Math.max(0, this.data.chartWidth - width)
      this.setData({ chartScrollable: this.data.chartWidth > width, chartScrollLeft: Math.max(0, Math.min(maxScroll, pointX - width / 2)) })
      this.applyChartClip(this.data.chartScrollLeft, width)
    }
    if (this._chartViewportWidth) { position(); return }
      wx.createSelectorQuery().in(this).select('.chart-scroll').boundingClientRect(rect => {
      if (rect && rect.width) this._chartViewportWidth = rect.width
      position()
    }).exec()
  },
  onChartScroll(event) {
    const detail = event.detail || {}
    if (detail.width) this._chartViewportWidth = detail.width
    this.applyChartClip(detail.scrollLeft, this._chartViewportWidth || this._chartEstimatedViewport || 0)
  },
  onChartTap(event) {
    if (!this.data.hasData) return
    const touch = event && event.changedTouches && event.changedTouches[0]
    const detail = event && event.detail || {}
    const clientX = touch && Number(touch.clientX)
    const localX = touch && Number(touch.x)
    const detailX = Number(detail.x)
    if (!Number.isFinite(clientX) && !Number.isFinite(localX) && !Number.isFinite(detailX)) return
    const version = this._version, token = this._chartToken
    const select = rect => {
      if (version !== this._version || token !== this._chartToken || !this.data.hasData) return
      // .chart-plot-viewport is the clipped plot area, so this X excludes the fixed axis.
      // The painted geometry is shifted by -viewOffset, so add it back before
      // finding the nearest real observation.
      const physicalX = Number.isFinite(clientX) && rect ? clientX - rect.left : Number.isFinite(localX) ? localX : detailX
      const geometry = this._chartGeometry
      if (!geometry || !Number.isFinite(physicalX)) return
      const offset = Number(geometry.viewOffset) || 0
      const viewWidth = Number(geometry.viewWidth) || Number(this._chartViewportWidth) || Number(this._chartEstimatedViewport) || Number(this.data.chartWidth) || 0
      if (!(viewWidth > 0) || physicalX < 0 || physicalX >= viewWidth) return
      const logicalX = physicalX + offset
      const slot = geometry.plot.w / Math.max((geometry.end - geometry.start) / 86400000, 1)
      const threshold = Math.max(HIT_MIN, slot / 2)
      let nearest = null
      for (const date of this._recordDates || []) {
        const pointX = xAtDate(this, date)
        if (pointX == null || pointX < offset || pointX >= offset + viewWidth) continue
        const distance = Math.abs(pointX - logicalX)
        if (!nearest || distance < nearest.distance) nearest = { date, distance }
      }
      if (nearest && nearest.distance <= threshold) this.selectChartDateValue(nearest.date)
    }
    if (Number.isFinite(clientX)) {
      wx.createSelectorQuery().in(this).select('.chart-plot-viewport').boundingClientRect(select).exec()
      return
    }
    select(null)
  },
  selectChartDateValue(selectedDate) {
    if (!selectedDate || selectedDate === this.data.selectedDate) return
    if (!this._recordDates || !this._recordDates.has(selectedDate)) return
    if (this._spec) this._spec.selectedDate = selectedDate
    this.setData({ selectedDate })
    highlightDate(this, selectedDate)
    if (this._dayTimer) clearTimeout(this._dayTimer)
    this.loadDayDetails(selectedDate)
  },
  async loadDayDetails(date, force = false) {
    this.cancelDayLoad()
    const version = this._dayVersion, selectedDate = date || this.data.selectedDate
    if (!selectedDate) return
    const babyId = getApp().globalData.activeBabyId || ''
    // Account identity is intentionally omitted; app.logout() clears page-cache entries.
    const params = { babyId, dateKey: selectedDate, range: RANGE_KEYS[this.data.rangeIndex], type: this.data.typeKey }
    const scopeKey = JSON.stringify(params)
    const sameScope = this._loadedDayOnce && this._dayScopeKey === scopeKey
    const cached = force ? null : pageCache.read('statDetail', params)
    const applyResult = result => {
      const cards = homeCards.decorate(cardsForType(dailyCards(result.summary, result.times), this.data.typeKey))
      this._loadedDayOnce = true
      this._dayScopeKey = scopeKey
      setDataIfChanged(this, { dayCards: cards, dayError: '', dayLoading: false })
    }
    if (cached !== null) {
      applyResult(cached)
      if (pageCache.fresh('statDetail', params)) return
    }
    if (!sameScope && this.data.dayCards.length) this.setData({ dayCards: [], dayLoading: true, dayError: '' })
    else setDataIfChanged(this, { dayLoading: !sameScope, dayError: '' })
    try {
      const weekStart = week(selectedDate)[0].date
      const result = await call('statistics', { action: 'daily', date: selectedDate, weekStart, baby_id: babyId })
      if (version !== this._dayVersion || selectedDate !== this.data.selectedDate || babyId !== (getApp().globalData.activeBabyId || '')) return
      pageCache.write('statDetail', params, result)
      applyResult(result)
    } catch (error) {
      if (version === this._dayVersion) {
        if (sameScope) wx.showToast({ title: '网络有些慢，已保留上次数据', icon: 'none' })
        else this.setData({ dayCards: [], dayError: error.message || '当天记录暂时无法读取' })
      }
    } finally {
      if (version === this._dayVersion && this.data.dayLoading) this.setData({ dayLoading: false })
    }
  },
  async load(force = false) {
    const version = this._version = (this._version || 0) + 1
    const app = getApp()
    // Account identity is intentionally omitted; app.logout() clears page-cache entries.
    const params = {
      babyId: app.globalData.activeBabyId || '',
      range: RANGE_KEYS[this.data.rangeIndex],
      type: this.data.typeKey
    }
    const scopeKey = JSON.stringify(params)
    const sameScope = this._loadedTrendOnce && this._trendScopeKey === scopeKey
    const cached = force ? null : pageCache.read('statDetail', params)
    if (cached !== null) {
      if (!sameScope && !this.data.hasData) setDataIfChanged(this, { loading: true, error: '' })
      this._trendScopeKey = scopeKey
      this._loadedTrendOnce = true
      this.applyTrend(cached, !sameScope)
      if (pageCache.fresh('statDetail', params)) return
    }
    if (!sameScope) {
      cancelChart(this)
      this.cancelDayLoad()
      this.cancelChartScroll()
      this._recordDates = new Set()
      this._spec = null
      this._dayScopeKey = ''
      this._loadedDayOnce = false
      setDataIfChanged(this, {
        loading: true, error: '', hasData: false, legend: [], activeUnit: '',
        dayCards: [], dayError: '', series: cached === null ? {} : (cached.series || {}),
        dates: cached === null ? {} : (cached.dates || {})
      })
    } else {
      setDataIfChanged(this, { loading: false, error: '' })
      if (sameScope && this.data.hasData && this._forceChartDraw) {
        this._forceChartDraw = false
        this.draw()
      }
    }
    try {
      const result = await call('statistics', {
        action: 'trend',
        range: params.range,
        baby_id: params.babyId
      })
      if (version !== this._version) return
      pageCache.write('statDetail', params, result)
      this._trendScopeKey = scopeKey
      this._loadedTrendOnce = true
      this.applyTrend(result, !sameScope)
    } catch (error) {
      if (version === this._version) {
        if (sameScope && this.data.hasData) wx.showToast({ title: '网络有些慢，已保留上次数据', icon: 'none' })
        else this.setData({ error: error.message || '统计详情暂时无法读取，请重试' })
      }
    } finally {
      if (version === this._version && this.data.loading) this.setData({ loading: false })
    }
  },
  applyTrend(result, forceDraw = false) {
    const updates = { error: '' }
    const series = result.series || {}, dates = result.dates || {}
    if (!sameData(this.data.series, series)) updates.series = series
    if (!sameData(this.data.dates, dates)) updates.dates = dates
    setDataIfChanged(this, updates, () => this.applyType(forceDraw))
  },
  applyType(forceDraw = false) {
    const type = findType(this.data.typeKey)
    const metrics = (type.metrics.length ? type.metrics : (this.data.series.custom || []).map(group => ({ key: group.label, name: group.label, unit: group.unit || '' })))
      .map(metric => ({ ...metric }))
    const pointsByKey = metricPoints(this.data.series || {}, type)
    const allKeys = metrics.map(metric => metric.key)
    const filled = allKeys.filter(key => (pointsByKey[key] || []).length)
    const keys = type.multi ? allKeys.filter(key => filled.includes(key)).slice(0, MAX_SERIES) : [filled[0] || allKeys[0]].filter(Boolean)
    const recordDays = Object.values(pointsByKey).flat().map(point => point.d).filter(Boolean).sort()
    const selectedDate = recordDays.includes(this.data.selectedDate)
      ? this.data.selectedDate
      : (recordDays.length ? recordDays[recordDays.length - 1] : dateKey())
    setDataIfChanged(this, {
      typeName: type.name,
      title: `${type.name}趋势`,
      metrics,
      metricKeys: keys,
      selectedDate
    }, () => this.refresh(forceDraw))
  },
  refresh(forceDraw = false) {
    const type = findType(this.data.typeKey)
    const pointsByKey = metricPoints(this.data.series || {}, type)
    const palette = getApp().palette || {}
    const colors = [palette.accent, palette.secondary, palette.accentInk]
    const items = this.data.metrics.map(metric => ({
      key: metric.key, name: metric.name, unit: metric.unit,
      points: (pointsByKey[metric.key] || []).map(point => ({ x: point.d, y: point.y }))
    }))
    const keys = this.data.metricKeys.filter(key => pointsByKey[key])
    const specSeries = keys.map(key => items.find(item => item.key === key)).filter(item => item && item.points.length > 0)
    const hasData = specSeries.length > 0
    const recordDates = [...new Set(Object.values(pointsByKey).flat().map(point => point.d).filter(Boolean))]
    const legend = type.kind === 'bar' && specSeries.length > 1 ? specSeries.map((item, index) => ({
      name: item.name || '',
      unit: item.unit && item.name.indexOf(item.unit) < 0 ? item.unit : '',
      color: colors[index]
    })) : []
    const empty = EMPTY[type.key] || EMPTY.fallback
    const main = specSeries.length ? specSeries[specSeries.length - 1] : null
    const activeUnit = main && main.unit ? main.unit : ''
    this._recordDates = hasData ? new Set(recordDates) : new Set()
    const nextSpec = hasData ? { kind: type.kind, series: specSeries, zeroBased: type.kind === 'bar', gap: type.gap, dates: domainOf(this.data.dates), selectedDate: this.data.selectedDate } : null
    const specChanged = !sameData(this._spec, nextSpec)
    this._spec = nextSpec
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const screenWidth = Math.max(240, Number(windowInfo.windowWidth) || 375)
    const scale = screenWidth / 750
    const availableWidth = Math.max(180, screenWidth - 178 * scale - (Number(this.data.axisOverlayWidth) || 56))
    this._chartEstimatedViewport = availableWidth
    const slotWidth = 44 * scale
    const spanDays = Math.max(1, Math.ceil((new Date(domainOf(this.data.dates).end + 'T00:00:00Z') - new Date(domainOf(this.data.dates).start + 'T00:00:00Z')) / 86400000))
    const chartWidth = Math.ceil(Math.max(availableWidth, (slotWidth * (spanDays + 1) + 52 * scale) / 0.84))
    const updates = {
      metrics: this.data.metrics.map(metric => ({ ...metric, active: this.data.metricKeys.includes(metric.key), hasData: (pointsByKey[metric.key] || []).length > 0 })),
      hasData, legend, chartKind: type.kind, activeUnit, chartWidth,
      chartScrollable: hasData && this._chartViewportWidth ? chartWidth > this._chartViewportWidth : hasData && this.data.chartScrollable,
      chartPaneCount: hasData ? Math.max(1, paneCountOf(type.kind, specSeries)) : 1,
      emptyTitle: empty[0],
      emptyNote: empty[1], loading: false, error: ''
    }
    const shouldDraw = specChanged || forceDraw || this._forceChartDraw
    if (specChanged) updates.yAxisLabels = []
    this._forceChartDraw = false
    setDataIfChanged(this, updates, () => {
      if (!hasData) cancelChart(this)
      else if (shouldDraw) this.draw()
      if (hasData) this.loadDayDetails(this.data.selectedDate)
    })
  },
  draw() {
    if (!this._chartVisible || !this.data.hasData || !this._spec) return
    this._chartLogicalWidth = this.data.chartWidth
    seriesChart(this, '#statisticsDetailChart', this._spec)
  }
})
