const app = getApp(), page = require('../../utils/page')
const sessions = require('../../utils/ai-sessions')
const { removeListItem, filterRemoved } = require('../../utils/list-patch')
const { createSwipe } = require('../../utils/swipe-gesture')

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
  ...createSwipe({ list: 'list', field: 'sessionId' }),
  data: { list: [], loading: true, error: '' },
  onShow() { this.load() },
  async load() {
    if (this._loading) return
    this.onCardTouchCancel()
    this._loading = true
    this.setData({ loading: true, error: '' })
    try {
      const list = await sessions.listSessions(app.globalData.openid || '')
      if (this._disposed) return
      this._openSwipeKey = ''
      this.setData({ list: filterRemoved(this, 'list', 'sessionId', list).map(s => ({ sessionId: s.sessionId, title: s.title || '未命名对话', timeText: formatTime(s.updatedAt), swipeX: 0 })), loading: false })
    } catch (error) {
      if (!this._disposed) this.setData({ loading: false, error: '历史对话暂时无法读取，请重试。' })
    } finally { this._loading = false }
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
        if (!res.confirm || this._motionInactive || this._deletePending) return
        this._deletePending = true
        this.setData({ loading: false })
        const openid = app.globalData.openid || ''
        this.resetSwipe()
        const rollback = removeListItem(this, 'list', 'sessionId', id)
        if (!rollback) { this._deletePending = false; return }
        try {
          await sessions.removeSession(openid, id)
        } catch (error) {
          rollback()
          if (!this._disposed) wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        } finally { this._deletePending = false }
      }
    })
  }
})
