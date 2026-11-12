const theme = require('./theme')
const motion = require('./motion')
module.exports = function themedPage(definition) {
  const load = definition.onLoad, show = definition.onShow, ready = definition.onReady, initial = theme.resolve()
  Page({
    ...definition,
    ...motion.methods,
    noop() {},
    redirectToMine() {
      if (this._redirectingToMine) return
      this._redirectingToMine = true
      wx.switchTab({ url: '/pages/mine/index' })
    },
    data: { ...motion.data, ...definition.data, entryPending: true, themeClass: initial.themeClass, themeAccent: initial.accent, statusBarHeight: 20 },
    applyTheme() {
      const palette = getApp().palette || theme.resolve()
      this.setData({ themeClass: palette.themeClass, themeAccent: palette.accent })
      motion.afterTheme(this)
      const pages = getCurrentPages()
      if (pages[pages.length - 1] === this) theme.nativeColors(palette, this._preservePageBackground)
      if (this.getTabBar && this.getTabBar()) this.getTabBar().refresh(this.route)
      if (this.onPaletteChange) this.onPaletteChange(palette)
    },
    goBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) wx.navigateBack()
      else wx.switchTab({ url: '/pages/index/index' })
    },
    onLoad(options) {
      motion.reset.call(this)
      this._preservePageBackground = !!(options && options.panel)
      this.applyTheme()
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      this.setData({ statusBarHeight: info.statusBarHeight || 20 })
      this._entryReady = (async () => {
        const app = getApp(), core = ['pages/index/index', 'pages/statistics/index', 'pages/mine/index'].includes(this.route)
        if (!core && (!app.globalData.initialized || app._initializing)) await app.init()
        this._entryAllowed = core || app.globalData.loggedIn
        if (!this._entryAllowed) { this.redirectToMine(); return }
        if (load) await load.call(this, options || {})
        this.setData({ entryPending: false })
      })()
      return this._entryReady
    },
    async onShow() {
      motion.reset.call(this)
      this.applyTheme()
      await this._entryReady
      const core = ['pages/index/index', 'pages/statistics/index', 'pages/mine/index'].includes(this.route)
      this._entryAllowed = core || getApp().globalData.loggedIn
      if (!this._entryAllowed) { this.redirectToMine(); return }
      if (this.data.panelMode && this._registrationSaved) { require('./registration').close(this, true); return }
      if (show) return show.call(this)
    },
    async onReady() { await this._entryReady; if (this._entryAllowed && ready) return ready.call(this) },
    onHide() { motion.dispose.call(this); if (definition.onHide) definition.onHide.call(this) },
    onUnload() { motion.dispose.call(this); if (definition.onUnload) definition.onUnload.call(this) }
  })
}
