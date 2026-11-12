const app = getApp()
const page = require('../../utils/page')
const { call } = require('../../utils/api')
const { dateKey, week, monthDays, shiftMonth, addDays, ageText, ageMonth } = require('../../utils/date')
const { CATEGORIES } = require('../../utils/categories')
const { dailyCards, dailySummary } = require('../../utils/viewmodels')
const { avatarSrc } = require('../../utils/avatar')
const { tap } = require('../../utils/haptics')
const homeCards = require('../../utils/home-cards')
const pageCache = require('../../utils/page-cache')
const milestoneOverview = require('../../utils/milestone-overview')
const summaryTagState = (tags, active) => tags.map(tag => ({ ...tag, active: active.indexOf(tag.key) >= 0, dimmed: active.length > 0 && active.indexOf(tag.key) < 0 }))
page({
  ...homeCards.methods,
  data: { ...homeCards.data, nickname: '宝宝', age: '', avatarSrc: '/images/boy.png', selectedDate: dateKey(), week: [], monthDays: [], calendarExpanded: false, monthLabel: '', cards: [], summaryTags: [], activeTags: [], categories: [], milestoneEntry: { label: '成长里程碑', month: null, done: 0, total: 0 }, panel: false, loading: false, refreshing: false, error: '', loggedIn: false, dateLabel: '', today: dateKey() },
  onLoad() { this.setData(homeCards.data); this.setDate(this.data.selectedDate, false) },
  async onShow() {
    if (!app.globalData.initialized || app._initializing) await app.init()
    this.refreshProfile()
    this.loadMilestoneEntry()
    this.load()
  },
  onPullDownRefresh() { return this.load(true).finally(() => wx.stopPullDownRefresh()) },
  onScrollRefresh() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    const request = this.onPullDownRefresh()
    if (request && request.finally) request.finally(() => this.setData({ refreshing: false }))
    else this.setData({ refreshing: false })
  },
  onSessionChange() { this.disposeCardMotion(); this._loadVersion = (this._loadVersion || 0) + 1; this._allCards = []; this._allCardsDate = ''; this._allCardsBabyId = ''; app.globalData.homeRefresh = null; this.setData({ ...homeCards.data, cards: [], summaryTags: [], activeTags: [], milestoneEntry: { label: '成长里程碑', month: null, done: 0, total: 0 }, loggedIn: false, panel: false }); this.showTabBar(true); this.loadMilestoneEntry() },
  refreshProfile() {
    const baby = app.globalData.baby || {}
    this.setData({ nickname: baby.nickname || '宝宝', age: ageText(baby.birthday), avatarSrc: avatarSrc(baby), loggedIn: app.globalData.loggedIn, categories: CATEGORIES.slice(), today: dateKey() })
  },
  async loadMilestoneEntry() {
    if (!app.globalData.loggedIn || !app.globalData.activeBabyId) {
      this.setData({ milestoneEntry: { label: '成长里程碑', month: null, done: 0, total: 0 } })
      return
    }
    const babyId = app.globalData.activeBabyId
    const birthday = (app.globalData.baby && app.globalData.baby.birthday) || ''
    const month = ageMonth(birthday)
    const fallback = { label: month != null ? `${month}月龄成长里程碑：已达成 0/0 项` : '成长里程碑', month, done: 0, total: 0 }
    this.setData({ milestoneEntry: fallback })
    const overview = await milestoneOverview.load()
    if (!overview || babyId !== app.globalData.activeBabyId) return
    const label = overview.month != null
      ? `${overview.month}月龄成长里程碑：已达成 ${overview.done}/${overview.total} 项`
      : '成长里程碑'
    this.setData({ milestoneEntry: { ...overview, label } })
  },
  setDate(date, load = true) {
    if (this.data.cardBusy || this.data.cardSettling || this.data.cardDeletingKey) return
    this.finishCardEdit()
    this.setData({ selectedDate: date, activeTags: [], monthLabel: Number(date.slice(0, 4)) + '年' + Number(date.slice(5, 7)) + '月', dateLabel: date === dateKey() ? '今天' : date.slice(5).replace('-', '月') + '日', week: week(date), monthDays: monthDays(date) })
    if (load) this.load()
  },
  selectDate(e) { this.setData({ calendarExpanded: false }); this.setDate(e.currentTarget.dataset.date) },
  moveWeek(e) {
    const offset = Number(e.currentTarget.dataset.offset)
    this.setDate(this.data.calendarExpanded ? shiftMonth(this.data.selectedDate, offset) : addDays(this.data.selectedDate, offset * 7))
    if (this.data.calendarExpanded) this.loadMonthMarks()
  },
  goToday() { this.setData({ calendarExpanded: false }); this.setDate(dateKey()) },
  toggleCalendar() { this.setData({ calendarExpanded: !this.data.calendarExpanded }); if (this.data.calendarExpanded) this.loadMonthMarks() },
  async loadMonthMarks() {
    const date = this.data.selectedDate
    try {
      const result = await call('statistics', { action: 'calendar', date, baby_id: app.globalData.activeBabyId })
      if (date !== this.data.selectedDate || !this.data.calendarExpanded) return
      this.setData({ monthDays: monthDays(date).map(d => ({ ...d, recorded: result.marks.includes(d.date) })) })
    } catch (error) { this.setData({ error: error.message }) }
  },
  // force=true 时忽略 60 秒缓存（下拉刷新 / 刚保存过），但仍先渲染已有内容，避免整页闪骨架。
  async load(force = false) {
    if (this.data.cardBusy || this.data.cardSettling || this.data.cardDeletingKey) return
    this.finishCardEdit()
    const version = this._loadVersion = (this._loadVersion || 0) + 1
    const date = this.data.selectedDate, days = week(date)
    if (!app.globalData.loggedIn) {
      this._allCards = []
      this._allCardsDate = ''
      this._allCardsBabyId = ''
      app.globalData.homeRefresh = null
      this.setData({ cards: [], summaryTags: [], loading: false, error: '' })
      return
    }
    const babyId = app.globalData.activeBabyId || ''
    if (!babyId) {
      this._allCards = []
      this._allCardsDate = ''
      this._allCardsBabyId = ''
      this.setData({ cards: [], summaryTags: [], loading: false, error: '' })
      return
    }
    const refresh = app.globalData.homeRefresh
    const mustRefresh = !!force || !!(refresh && refresh.date === date)
    const params = { date, baby_id: babyId }
    const cached = mustRefresh ? null : pageCache.read('home.daily', params)
    const hasCachedCards = !!(this._allCards && this._allCards.length && this._allCardsDate === date && this._allCardsBabyId === babyId)
    if (cached) {
      this.applyDaily(cached, date, days)
      if (!mustRefresh) return
    } else if (hasCachedCards) this.setData({ cards: this.visibleCards(this._allCards), loading: false, error: '' })
    else this.setData({ loading: true, error: '', cards: [], summaryTags: [] })
    try {
      const r = await call('statistics', { action: 'daily', date, weekStart: days[0].date, baby_id: babyId })
      if (version !== this._loadVersion) return
      pageCache.write('home.daily', params, r)
      this.applyDaily(r, date, days)
    } catch (error) { if (version === this._loadVersion && !cached && !hasCachedCards) this.setData({ error: error.message }) }
    finally {
      if (version === this._loadVersion) {
        this.setData({ loading: false })
        if (refresh && app.globalData.homeRefresh === refresh) app.globalData.homeRefresh = null
      }
    }
  },
  applyDaily(r, date, days) {
    const all = homeCards.decorate(dailyCards(r.summary, r.times))
    this._allCards = all
    this._allCardsDate = date
    this._allCardsBabyId = app.globalData.activeBabyId || ''
    this.setData({
      cards: this.visibleCards(all),
      summaryTags: summaryTagState(dailySummary(r.summary), this.data.activeTags || []),
      week: days.map(d => ({ ...d, recorded: r.marks.includes(d.date) })),
      loading: false,
      error: ''
    })
    if (this.data.calendarExpanded) this.loadMonthMarks()
  },
  visibleCards(all, tags) {
    const active = tags == null ? (this.data.activeTags || []) : tags
    if (!active.length) return all
    return homeCards.decorate(all.filter(card => active.indexOf(card.tag) >= 0))
  },
  toggleTag(e) {
    if (this.data.cardEditing || this.data.cardBusy || this.data.cardSettling || this.data.cardDeletingKey) return
    const key = e.currentTarget.dataset.key
    if (!key) return
    const all = this._allCards
    if (!all || !all.length) return
    const active = (this.data.activeTags || []).slice()
    const index = active.indexOf(key)
    if (index >= 0) active.splice(index, 1)
    else active.push(key)
    this.setData({ activeTags: active, cards: this.visibleCards(all, active), summaryTags: summaryTagState(this.data.summaryTags, active) })
  },
  showTabBar(visible) { const tab = this.getTabBar && this.getTabBar(); if (tab) tab.setData({ hidden: !visible }) },
  openPanel() {
    if (this.data.cardBusy || this.data.cardSettling || this.data.cardDeletingKey) return
    this.finishCardEdit()
    if (!this.data.loggedIn) { this.goMine(); return }
    if (this.data.selectedDate > dateKey()) { wx.showToast({ title: '可以记录今天或过去的日期', icon: 'none' }); return }
    const babyId = app.globalData.activeBabyId || ''
    const hasCurrentScope = Array.isArray(this._allCards) && this._allCardsDate === this.data.selectedDate && this._allCardsBabyId === babyId
    if (!hasCurrentScope) {
      this._allCards = []
      this._allCardsDate = ''
      this._allCardsBabyId = ''
      this.setData({ cards: [], summaryTags: [] })
      this.load()
    }
    tap()
    this.setData({ panel: true, closing: false }); this.showTabBar(false)
  },
  closePanel() {
    if (this.data.closing) return
    this.setData({ closing: true })
    require('../../utils/motion').closeLater(this, () => {
      this.setData({ panel: false, closing: false })
      this.showTabBar(true)
    })
  },
  onHide() { this.disposeCardMotion(); this.setData({ ...homeCards.data, cards: homeCards.decorate(this.data.cards), panel: false, closing: false }); this.showTabBar(true) },
  onUnload() { this.disposeCardMotion() },
  chooseCategory(e) {
    const item = this.data.categories.find(c => c.key === e.currentTarget.dataset.key)
    if (!item) return
    tap()
    this.setData({ panel: false, closing: false }); this.showTabBar(true)
    wx.navigateTo({ url: item.url + (item.url.includes('?') ? '&' : '?') + 'date=' + this.data.selectedDate })
  },
  openCard(e) {
    if (this.data.cardEditing || this.data.cardBusy || this.data.cardSettling || this.data.cardDeletingKey) return
    const [path, query = ''] = e.currentTarget.dataset.url.split('?')
    const key = e.currentTarget.dataset.key || ''
    const params = query.split('&').filter(value => value && !/^(date|cardEdit|recordKey)=/.test(value))
    if (key && key !== 'milestone') params.push('cardEdit=1', 'recordKey=' + encodeURIComponent(key))
    params.push('date=' + this.data.selectedDate)
    wx.navigateTo({ url: path + '?' + params.join('&') })
  },
  openMilestones() { wx.navigateTo({ url: '/pages/milestone/index' }) },
  goMine() { wx.switchTab({ url: '/pages/mine/index' }) }
})
