const app = getApp(), page = require('../../utils/page'), theme = require('../../utils/theme')

page({
  data: { colorId: 'blue', themeColors: theme.COLORS, themeStatus: '', statusBarHeight: 20 },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.setData({ statusBarHeight: info.statusBarHeight || 20 })
  },
  onShow() { this.refreshTheme() },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/mine/index' })
  },

  refreshTheme() {
    const pref = theme.preference()
    this.setData({ colorId: pref.color || 'blue', themeStatus: '' })
  },

  onColor(e) { this.changeTheme({ color: e.currentTarget.dataset.color }) },

  async changeTheme(changes) {
    const pref = { ...theme.preference(), ...changes }
    if (!theme.COLORS.some(c => c.id === pref.color)) pref.color = 'blue'
    if (pref.color === this.data.colorId) return
    this.motionSettingChange()
    this.setData({ colorId: pref.color })
    this.prepareThemeReveal(pref)
    const revision = this._prefVersion = (this._prefVersion || 0) + 1
    this.setData({ themeStatus: '正在同步偏好…' })
    const pending = app.setTheme(pref)
    this.setData({ colorId: pref.color })
    const synced = await pending
    if (revision === this._prefVersion) this.setData({ themeStatus: synced ? '已同步到账号' : '已在本机生效，登录或网络恢复后自动同步' })
  }
})
