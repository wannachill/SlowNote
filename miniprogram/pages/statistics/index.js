const page = require('../../utils/page'), { call } = require('../../utils/api')
const pageCache = require('../../utils/page-cache')
const { insightHasData, moduleCardOf } = require('../../utils/statistics-insights')
const { tap } = require('../../utils/haptics')

const RANGES = ['今日', '本周', '本月', '全部']
const RANGE_KEYS = ['day', 'week', 'month', 'all']
const MODULES = [
  { key: 'growth', name: '成长' },
  { key: 'feeding', name: '喂养' },
  { key: 'solid', name: '辅食' },
  { key: 'excretion', name: '便便' },
  { key: 'diary', name: '日记' },
  { key: 'custom', name: '自定义' }
]

page({
  data: {
    ranges: RANGES, rangeIndex: 1,
    totals: {}, prevTotals: null, dates: {},
    compareNote: '', hasInsightData: false, moduleCards: [],
    loading: false, error: ''
  },
  async onShow() {
    const app = getApp()
    if (!app.globalData.initialized || app._initializing) await app.init()
    return this.load()
  },
  onPullDownRefresh() { return this.load(true).finally(() => wx.stopPullDownRefresh()) },
  onRange(e) {
    const index = Number(e.detail.value)
    if (index === this.data.rangeIndex) return
    this.setData({ rangeIndex: index })
    this.load()
  },
  onSessionChange() {
    this._version = (this._version || 0) + 1
    this._renderedScope = ''
    this.setData({ totals: {}, prevTotals: null, dates: {}, compareNote: '', hasInsightData: false, moduleCards: [] })
    return this.load(true)
  },
  // force=true 时忽略缓存新鲜度（下拉刷新 / 切换宝宝），但仍先渲染已有内容，避免整页闪骨架。
  async load(force = false) {
    const version = this._version = (this._version || 0) + 1
    const range = RANGE_KEYS[this.data.rangeIndex]
    const params = { range, baby_id: getApp().globalData.activeBabyId || '' }
    const scopeKey = range + '|' + params.baby_id
    const cached = pageCache.read('statistics.trend', params)
    if (cached) {
      this.render(cached, range, params)
      if (!force) return
    } else if (this._renderedScope !== scopeKey) {
      this.setData({ loading: true, error: '', compareNote: '', hasInsightData: false, moduleCards: [] })
    }
    try {
      const result = await call('statistics', { action: 'trend', ...params })
      if (version !== this._version) return
      // 只缓存概况需要的字段，series 由统计详情页自行请求，避免无用数据占本地存储。
      pageCache.write('statistics.trend', params, { range: result.range, dates: result.dates, totals: result.totals, prevTotals: result.prevTotals })
      this.render(result, range, params)
    } catch (error) {
      if (version === this._version) this.setData({ error: error.message || '简报暂时无法读取，请重试' })
    } finally {
      if (version === this._version) this.setData({ loading: false })
    }
  },
  render(result, range, params) {
    const totals = result.totals || {}
    const prevTotals = result.prevTotals || null
    const rangeKey = result.range || range
    this._renderedScope = range + '|' + ((params && params.baby_id) || '')
    this.setData({
      totals,
      prevTotals,
      dates: result.dates || {},
      compareNote: rangeKey === 'week' ? '较上周' : rangeKey === 'month' ? '较上月' : '',
      hasInsightData: insightHasData(totals),
      moduleCards: MODULES.map(item => ({ name: item.name, ...moduleCardOf(item.key, totals, prevTotals, rangeKey) }))
        .filter(card => !card.empty),
      loading: false,
      error: ''
    })
  },
  openDetail(e) {
    const type = e.currentTarget.dataset.type
    if (!MODULES.some(item => item.key === type)) return
    const card = this.data.moduleCards.find(item => item.key === type)
    if (!card || card.empty) return
    tap('light')
    wx.navigateTo({ url: `/pages/statistics-detail/index?type=${type}&range=${RANGE_KEYS[this.data.rangeIndex]}` })
  },
  askXiaoMai() {
    tap('light')
    wx.navigateTo({ url: '/pages/ai-chat/index' })
  },
  goHome() { wx.switchTab({ url: '/pages/index/index' }) },
})
