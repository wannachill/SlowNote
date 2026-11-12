const theme = require('./utils/theme')
const network = require('./utils/net')
App({
  globalData: {
    openid: '',
    nickname: '',
    loggedIn: false,
    initialized: false,
    online: null,
    netError: null,
    homeRefresh: null,
    milestoneOverview: null,
    milestoneOverviewRequest: null,
    milestoneOverviewRevision: 0,
    babies: [],         // 宝宝档案列表（支持多宝宝）
    activeBabyId: '',   // 当前宝宝 id
    baby: null          // 当前宝宝对象（{ baby_id, nickname, birthday, gender, avatar }）
  },
  palette: theme.resolve(),
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: 'cloud1-d6gil7n3u02d7414e', traceUser: false })
    }
    this.palette = theme.resolve()
    if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(({ isConnected }) => {
      this._networkRevision = (this._networkRevision || 0) + 1
      network.setOnline(!!isConnected)
      if (isConnected && wx.getStorageSync('slownote_theme_pending')) this.syncTheme()
    })
    const networkRevision = this._networkRevision = (this._networkRevision || 0) + 1
    if (wx.getNetworkType) wx.getNetworkType({
      success: ({ networkType }) => {
        if (networkRevision === this._networkRevision) network.setOnline(networkType !== 'none')
      },
      fail: () => {
        if (networkRevision === this._networkRevision) network.setOnline(null)
      }
    })
    if (!wx.getStorageSync('slownote_signed_out')) this.init()
    else this.globalData.initialized = true
  },
  // 未读数不再做底栏角标提示（用户要求「我的」Tab 不展示数字角标），仅在历史报告页展示未读圆点。

  // 初始化登录建档
  async init(force = false) {
    if (wx.getStorageSync('slownote_signed_out') && !force) return
    const generation = this._sessionGeneration || 0
    if (this._initializing && this._initializingGeneration === generation) return this._initializing
    this._initializingGeneration = generation
    const pending = this.initializeSession(generation).finally(() => {
      if (this._initializing === pending) this._initializing = null
    })
    this._initializing = pending
    return pending
  },
  async initializeSession(generation) {
    if (wx.cloud) {
      try {
        const res = await wx.cloud.callFunction({ name: 'login', data: {} })
        const r = res.result
        if (generation !== (this._sessionGeneration || 0)) return
        if (r && r.code === 0) {
          this.globalData.openid = r.openid
          this.globalData.nickname = r.nickname || ''
          this.globalData.loggedIn = true
          wx.removeStorageSync('slownote_signed_out')
        }
      } catch (e) { /* 弱网/未部署时保持未登录态 */ }

    }
    this.globalData.initialized = true
    if (this.globalData.loggedIn) await this.loadProfile()
  },

  async loadProfile() {
    const revision = this._themeRevision || 0, generation = this._sessionGeneration || 0
    try {
      const r = (await wx.cloud.callFunction({ name: 'babyProfile', data: { action: 'get' } })).result
      if (generation !== (this._sessionGeneration || 0)) return
      if (r && r.code === 0) {
        this.globalData.babies = r.babies || []
        const remembered = wx.getStorageSync('slownote_active_baby')
        const target = this.globalData.babies.find(b => b.baby_id === remembered) || this.globalData.babies[0] || null
        this.globalData.activeBabyId = target ? target.baby_id : ''
        this.globalData.baby = target ? { ...target } : null
        wx.setStorageSync('slownote_active_baby', this.globalData.activeBabyId)
        if (r.theme_pref && revision === (this._themeRevision || 0) && !wx.getStorageSync('slownote_theme_pending')) {
          const legacySystemTheme = r.theme_pref.mode === 'system'
          this.applyTheme(r.theme_pref)
          if (legacySystemTheme) wx.setStorageSync('slownote_theme_pending', true)
        }
      }
    } catch (error) { if (generation === (this._sessionGeneration || 0)) this.globalData.profileUnavailable = true }
    if (wx.getStorageSync('slownote_theme_pending')) this.syncTheme()
  },
  // 切换当前宝宝（多宝宝档案中选一个），通知各页面刷新
  setActiveBaby(babyId) {
    const baby = this.globalData.babies.find(b => b.baby_id === babyId) || null
    this.globalData.activeBabyId = baby ? baby.baby_id : ''
    this.globalData.baby = baby ? { ...baby } : null
    wx.setStorageSync('slownote_active_baby', this.globalData.activeBabyId)
    getCurrentPages().forEach(page => { if (page.onSessionChange) page.onSessionChange() })
  },
  applyTheme(pref) {
    pref = this.migrateTheme(pref)
    theme.save(pref)
    this.palette = theme.resolve(pref)
    getCurrentPages().forEach(page => { if (page.applyTheme) page.applyTheme() })
  },
  // 兼容旧版仅含 mode（light/dark/system）的主题偏好：不再有独立明暗模式，
  // 深色 / 跟随系统(设备为深色) 统一映射为“深色”主题色，其余映射为默认蓝。
  migrateTheme(pref) {
    const colorIds = theme.COLORS.map(c => c.id)
    if (pref && typeof pref === 'object' && colorIds.includes(pref.color)) return { color: pref.color }
    if (!pref || typeof pref !== 'object') return { color: 'blue' }
    if (pref.mode === 'dark') return { color: 'dark' }
    if (pref.mode === 'system') {
      const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {})
      return { color: (info && info.theme === 'dark') ? 'dark' : 'blue' }
    }
    return { color: 'blue' }
  },
  setTheme(pref) {
    this._themeRevision = (this._themeRevision || 0) + 1
    this.applyTheme(pref)
    wx.setStorageSync('slownote_theme_pending', true)
    return this.syncTheme()
  },
  async syncTheme() {
    if (!this.globalData.loggedIn) return false
    const pref = theme.preference(), revision = this._themeRevision || 0, generation = this._sessionGeneration || 0
    this._themeSync = (this._themeSync || Promise.resolve()).catch(() => false).then(async () => {
      if (!this.globalData.loggedIn || generation !== (this._sessionGeneration || 0)) return false
      try {
        const r = (await wx.cloud.callFunction({ name: 'babyProfile', data: { action: 'theme', theme_pref: pref, clientRequestId: `theme-${Date.now()}-${revision}` } })).result
        if (generation !== (this._sessionGeneration || 0)) return false
        if (r.code !== 0) return false
        if (revision === (this._themeRevision || 0) && generation === (this._sessionGeneration || 0)) wx.removeStorageSync('slownote_theme_pending')
        return true
      } catch (error) { return false }
    })
    return this._themeSync
  },
  logout() {
    this._sessionGeneration = (this._sessionGeneration || 0) + 1
    wx.setStorageSync('slownote_signed_out', true)
    require('./utils/page-cache').clear()
    require('./utils/ai-settings').clearCache()
    Object.assign(this.globalData, { openid: '', nickname: '', babies: [], activeBabyId: '', baby: null, loggedIn: false, initialized: true })
    getCurrentPages().forEach(page => { if (page.onSessionChange) page.onSessionChange() })
  }
})
