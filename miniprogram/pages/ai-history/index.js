const app = getApp(), page = require('../../utils/page')
const sessions = require('../../utils/ai-sessions')
const { setListItemFields, setListFields } = require('../../utils/list-patch')
const ACTION_WIDTH_RPX = 110

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts), now = new Date(), pad = n => (n < 10 ? '0' : '') + n
  const hh = pad(d.getHours()) + ':' + pad(d.getMinutes())
  if (d.toDateString() === now.toDateString()) return '今天 ' + hh
  const yesterday = new Date(now.getTime() - 864e5)
  if (d.toDateString() === yesterday.toDateString()) return '昨天 ' + hh
  const year = d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '年'
  return year + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hh
}

page({
  data: { list: [], loading: true, error: '' },
  onShow() { this.load() },
  async load() {
    if (this._loading) return
    this._loading = true
    this.setData({ loading: true, error: '' })
    try {
      const list = await sessions.listSessions(app.globalData.openid || '')
      if (this._disposed) return
      this._openSwipeKey = ''
      this.setData({ list: list.map(s => ({ sessionId: s.sessionId, title: s.title || '未命名对话', timeText: formatTime(s.updatedAt), swipeX: 0 })), loading: false })
    } catch (error) {
      if (!this._disposed) this.setData({ loading: false, error: '历史对话暂时无法读取，请重试。' })
    } finally { this._loading = false }
  },
  actionWidth() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    return ACTION_WIDTH_RPX * (info.windowWidth || 375) / 750
  },
  onCardTouchStart(event) {
    const touch = event.touches && event.touches[0], id = event.currentTarget.dataset.id
    if (!touch || !id) return
    const item = this.data.list.find(value => value.sessionId === id)
    this._cardGesture = { id, x: touch.clientX, y: touch.clientY, startOffset: item ? item.swipeX || 0 : 0, axis: '' }
  },
  onCardTouchMove(event) {
    const gesture = this._cardGesture, touch = event.touches && event.touches[0]
    if (!gesture || !touch) return
    const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y
    if (!gesture.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'horizontal' : 'vertical'
    if (gesture.axis !== 'horizontal') return
    if (dx < -8 && this._openSwipeKey && this._openSwipeKey !== gesture.id) this.closeSwipe()
    const offset = Math.max(-this.actionWidth(), Math.min(0, gesture.startOffset + dx))
    const index = this.data.list.findIndex(item => item.sessionId === gesture.id)
    setListItemFields(this, 'list', index, { swipeX: offset })
    if (Math.abs(dx) > 12) this._ignoreCardTapUntil = Date.now() + 450
  },
  onCardTouchEnd() {
    const gesture = this._cardGesture
    if (!gesture) return
    if (gesture.axis === 'horizontal') {
      const item = this.data.list.find(value => value.sessionId === gesture.id)
      if (item && item.swipeX < -this.actionWidth() * .42) this.openSwipe(gesture.id)
      else this.closeSwipe()
    }
    this._cardGesture = null
  },
  closeSwipe() {
    this._openSwipeKey = ''
    setListFields(this, 'list', item => item.swipeX ? { swipeX: 0 } : null)
  },
  openSwipe(id) {
    this._openSwipeKey = id
    const offset = -this.actionWidth()
    setListFields(this, 'list', item => {
      const swipeX = item.sessionId === id ? offset : 0
      return item.swipeX === swipeX ? null : { swipeX }
    })
    this._ignoreCardTapUntil = Date.now() + 450
  },
  resetSwipe() {
    this._cardGesture = null
    this._openSwipeKey = ''
    this._ignoreCardTapUntil = 0
    setListFields(this, 'list', item => item.swipeX ? { swipeX: 0 } : null)
  },
  onSelect(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find(value => value.sessionId === id)
    if (!item) return
    // 已滑开的卡片先收起，避免一次点击同时触发删除区与载入对话。
    if (item.swipeX < 0) { this.closeSwipe(); return }
    if (Date.now() < (this._ignoreCardTapUntil || 0)) return
    const channel = this.getOpenerEventChannel()
    if (channel && channel.emit) channel.emit('select', id)
    wx.navigateBack()
  },
  onRemove(e) {
    const id = e.currentTarget.dataset.id
    this.confirmDanger({ object: (this.data.list.find(item => item.sessionId === id) || {}).title || '',
      title: '删除对话',
      content: '删除后无法恢复，确定删除这段对话吗？',
      confirmText: '删除', cancelText: '取消',
      success: async res => {
        if (!res.confirm || this._disposed) return
        try {
          await sessions.removeSession(app.globalData.openid || '', id)
          if (!this._disposed) { this._openSwipeKey = ''; this.load() }
        } catch (error) { if (!this._disposed) wx.showToast({ title: '删除失败，请重试', icon: 'none' }) }
      }
    })
  }
})
