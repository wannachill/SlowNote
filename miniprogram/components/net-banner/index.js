const network = require('../../utils/net')

Component({
  options: { styleIsolation: 'apply-shared' },
  data: { visible: false, offline: false, message: '' },
  lifetimes: {
    attached() {
      this._netActive = true
      this._netUnsubscribe = network.subscribe(state => this.applyNetworkState(state))
    },
    detached() {
      this._netActive = false
      if (this._netUnsubscribe) this._netUnsubscribe()
      this._netUnsubscribe = null
      clearTimeout(this._netTimer)
      this._netTimer = null
    }
  },
  methods: {
    applyNetworkState(state) {
      clearTimeout(this._netTimer)
      this._netTimer = null
      if (state.online === false) {
        this.setData({ visible: true, offline: true, message: '当前离线，云端操作暂不可用' })
        return
      }
      if (state.error) {
        const errorId = state.error.id
        this.setData({ visible: true, offline: false, message: '网络异常，请稍后重试' })
        this._netTimer = setTimeout(() => {
          this._netTimer = null
          if (!this._netActive) return
          const current = network.getState()
          if (current.error && current.error.id === errorId) network.clearError()
        }, 3000)
        return
      }
      this.setData({ visible: false, offline: false, message: '' })
    }
  }
})
