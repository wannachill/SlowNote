const theme = require('../utils/theme')
Component({
  options: { styleIsolation: 'apply-shared' },
  data: { themeClass: theme.resolve().themeClass, selected: 0, tabMotionReady: false, hidden: false, tabs: [{ path: 'pages/index/index', text: '首页', icon: 'home' }, { path: 'pages/statistics/index', text: '小迈', icon: 'logo' }, { path: 'pages/mine/index', text: '我的', icon: 'mine' }] },
  lifetimes: {
    attached() { this._tabBarActive = true; this.refresh(undefined, false); this._tabBarReady = true },
    detached() { this._tabBarActive = false }
  },
  pageLifetimes: { show() { this.refresh() } },
  methods: {
    refresh(route, animate) {
      const app = getApp(), pages = getCurrentPages(), current = route || (pages.length && pages[pages.length - 1].route)
      const selected = Math.max(0, this.data.tabs.findIndex(t => t.path === current))
      const changed = selected !== this.data.selected
      const updates = { themeClass: (app.palette || theme.resolve()).themeClass }
      if (changed) {
        updates.selected = selected
        if (animate === undefined ? this._tabBarReady : animate) updates.tabMotionReady = true
      }
      this.setData(updates)
    },
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index)
      const app = getApp()
      if (this._switchingTab || app._tabSwitchPending || !this.data.tabs[index] || index === this.data.selected) return
      this._switchingTab = true
      app._tabSwitchPending = true
      const release = () => {
        clearTimeout(this._switchTimer)
        this._switchTimer = setTimeout(() => {
          this._switchTimer = null
          this._switchingTab = false
          app._tabSwitchPending = false
        }, 300)
      }
      this.setData({ selected: index, tabMotionReady: true }, () => {
        try {
          wx.switchTab({
            url: '/' + this.data.tabs[index].path,
            fail: () => this.refresh(undefined, false),
            complete: release
          })
        } catch (error) {
          app._tabSwitchPending = false
          this._switchingTab = false
          this.refresh(undefined, false)
        }
      })
    }
  }
})
