const app = getApp(), page = require('../../utils/page')
const sessions = require('../../utils/ai-sessions')

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
      this.setData({ list: list.map(s => ({ sessionId: s.sessionId, title: s.title || '未命名对话', timeText: formatTime(s.updatedAt) })), loading: false })
    } catch (error) {
      if (!this._disposed) this.setData({ loading: false, error: '历史对话暂时无法读取，请重试。' })
    } finally { this._loading = false }
  },
  onSelect(e) {
    const id = e.currentTarget.dataset.id
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
          if (!this._disposed) this.load()
        } catch (error) { if (!this._disposed) wx.showToast({ title: '删除失败，请重试', icon: 'none' }) }
      }
    })
  }
})
