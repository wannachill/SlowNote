const app = getApp(), page = require('../../utils/page')
const { toastError } = require('../../utils/api')
const { avatarSrc } = require('../../utils/avatar')
const { dateKey, parseDate } = require('../../utils/date')

function daysSince(birthday, today = dateKey()) {
  const birth = parseDate(birthday), current = parseDate(today)
  if (!birth || !current || birth > current) return null
  const birthUtc = Date.UTC(birth.getFullYear(), birth.getMonth(), birth.getDate())
  const currentUtc = Date.UTC(current.getFullYear(), current.getMonth(), current.getDate())
  return Math.round((currentUtc - birthUtc) / 86400000)
}

page({
  data: { loggedIn: false, loggingIn: false, refreshing: false, avatarSrc: '/images/boy.png', babyNickname: '宝宝', babyAgeDays: null },

  onLoad() {
    if (!app.globalData.initialized) app.init().then(() => this.refresh())
    else if (app.globalData.loggedIn) app.loadProfile().then(() => this.refresh())
    else this.refresh()
  },
  onShow() { this.refresh() },
  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh()
    if (app.globalData.loggedIn) return app.init(true).then(() => app.loadProfile()).then(() => this.refresh()).finally(done)
    done()
  },
  onScrollRefresh() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    const request = this.onPullDownRefresh()
    if (request && request.finally) request.finally(() => this.setData({ refreshing: false }))
    else this.setData({ refreshing: false })
  },

  refresh() {
    const g = app.globalData
    const baby = g.baby || {}
    this.setData({ loggedIn: g.loggedIn, avatarSrc: avatarSrc(baby), babyNickname: baby.nickname || '宝宝', babyAgeDays: daysSince(baby.birthday) })
  },

  async login() {
    if (this.data.loggingIn) return
    this.setData({ loggingIn: true })
    try { await app.init(true); await app.loadProfile(); this.refresh(); if (!app.globalData.loggedIn) throw new Error('暂未连上微信登录，请重试') }
    catch (error) { toastError(error) } finally { this.setData({ loggingIn: false }) }
  },
  logout() {
    wx.showModal({ title: '退出登录', content: '退出后不会删除宝宝记录，重新登录后可继续查看。', success: r => { if (r.confirm) { app.logout(); this.refresh() } } })
  },
  goBaby() { if (this.data.loggedIn) wx.navigateTo({ url: '/pages/baby/index' }) },
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) }
})
