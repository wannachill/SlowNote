// 历史报告：定时报告生成的全部站内通知。卡片左滑删除，点击查看完整正文。
const page = require('../../utils/page')
const { call, requestId, toastError } = require('../../utils/api')
const { tap } = require('../../utils/haptics')
const { dateKey } = require('../../utils/date')
const { setListItemFields, setListFields } = require('../../utils/list-patch')
// 报告正文与小迈回答共用同一套 Markdown 子集渲染，标题/加粗/列表在这里同样生效。
const parseMarkdown = require('../../utils/markdown')
// 历史报告只有「删除」一个动作，轨道宽度取全局 --swipe-action-width 的一半（110rpx），
// 使删除按钮与「常见问题」页（两个动作平分 220rpx）的单个按钮等宽。
const ACTION_WIDTH_RPX = 110

function dateLabel(value) {
  const [year, month, day] = String(value || '').split('-').map(Number)
  return year && month && day ? `${year}年${month}月${day}日` : ''
}

// 卡片标签只标「渠道 + 微信送达结果」，尽量短：
// 微信已送达（用户开启微信通知且推送成功）/ 站内信（用户未开启微信通知，仅留存站内）/ 微信未送达（已开启但模板未配或发送失败）。
function wechatStatus(delivery) {
  if (delivery && delivery.status === 'sent') return { wechatText: '微信已送达', wechatClass: 'status-sent' }
  if (delivery && delivery.message === 'WECHAT_NOTIFY_DISABLED') return { wechatText: '站内信', wechatClass: 'status-off' }
  return { wechatText: '微信未送达', wechatClass: 'status-error' }
}

page({
  data: { items: [], loading: false, error: '', panel: false, closing: false, current: null, reportNodes: [],
    startDate: '', endDate: '', startDateLabel: '', endDateLabel: '', today: '', total: 0, hasMore: false },

  onShow() {
    const today = dateKey()
    const startDate = this.data.startDate || `${today.slice(0, 7)}-01`
    const endDate = this.data.endDate || today
    this.setData({ today, startDate, endDate, startDateLabel: dateLabel(startDate), endDateLabel: dateLabel(endDate) })
    return this.load()
  },
  onHide() { this.resetSwipe() },
  onUnload() { this.resetSwipe() },

  onStartDate(event) { return this.changeDate('startDate', event.detail.value) },
  onEndDate(event) { return this.changeDate('endDate', event.detail.value) },
  changeDate(key, value) {
    let start = key === 'startDate' ? value : this.data.startDate
    let end = key === 'endDate' ? value : this.data.endDate
    if (end > this.data.today) { wx.showToast({ title: '请选择有效的起止日期', icon: 'none' }); return }
    if (start > end) {
      if (key === 'startDate') end = value
      else { wx.showToast({ title: '请选择有效的起止日期', icon: 'none' }); return }
    }
    this.setData({ startDate: start, endDate: end, startDateLabel: dateLabel(start), endDateLabel: dateLabel(end) })
    this.resetSwipe()
    return this.load()
  },
  loadMore() { if (!this.data.loading && this.data.hasMore) return this.load(true) },
  async load(append = false) {
    append = append === true
    const version = this._listVersion = (this._listVersion || 0) + 1
    // A refresh must not leave an in-flight gesture behind; the open card is restored below.
    this._cardGesture = null
    this.setData({ loading: true, error: '' })
    try {
      const offset = append ? this.data.items.length : 0
      const result = await call('aiNotifications', { action: 'list', offset,
        startDate: this.data.startDate, endDate: this.data.endDate })
      if (version !== this._listVersion) return
      const openKey = this._openSwipeKey
      this.setData({
        total: result.total === undefined ? result.items.length : result.total,
        hasMore: !!result.hasMore,
        items: (append ? this.data.items : []).concat(result.items.map(item => ({
          ...item,
          title: item.title || '小迈定时报告',
          swipeX: openKey && openKey === item.id ? -this.actionWidth() : 0,
          dateText: new Date(new Date(item.created_at).getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' '),
          ...wechatStatus(item.delivery)
        })))
      })
    } catch (error) { if (version === this._listVersion) this.setData({ error: error.message }) }
    finally { if (version === this._listVersion) this.setData({ loading: false }) }
  },

  actionWidth() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    return ACTION_WIDTH_RPX * (info.windowWidth || 375) / 750
  },
  onCardTouchStart(event) {
    const touch = event.touches && event.touches[0], id = event.currentTarget.dataset.id
    if (!touch || !id) return
    const item = this.data.items.find(value => value.id === id)
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
    const index = this.data.items.findIndex(item => item.id === gesture.id)
    setListItemFields(this, 'items', index, { swipeX: offset })
    if (Math.abs(dx) > 12) this._ignoreCardTapUntil = Date.now() + 450
  },
  onCardTouchEnd() {
    const gesture = this._cardGesture
    if (!gesture) return
    if (gesture.axis === 'horizontal') {
      const item = this.data.items.find(value => value.id === gesture.id)
      if (item && item.swipeX < -this.actionWidth() * .42) this.openSwipe(gesture.id)
      else this.closeSwipe()
    }
    this._cardGesture = null
  },
  closeSwipe() {
    this._openSwipeKey = ''
    setListFields(this, 'items', item => item.swipeX ? { swipeX: 0 } : null)
  },
  openSwipe(id) {
    this._openSwipeKey = id
    const offset = -this.actionWidth()
    setListFields(this, 'items', item => {
      const swipeX = item.id === id ? offset : 0
      return item.swipeX === swipeX ? null : { swipeX }
    })
    this._ignoreCardTapUntil = Date.now() + 450
  },
  resetSwipe() {
    this._cardGesture = null
    this._openSwipeKey = ''
    this._ignoreCardTapUntil = 0
    setListFields(this, 'items', item => item.swipeX ? { swipeX: 0 } : null)
  },

  onCardTap(event) {
    const id = event.currentTarget.dataset.id
    const item = this.data.items.find(value => value.id === id)
    if (!item) return
    // An open swipe card collapses first: tapping must not also open the detail.
    if (item.swipeX < 0) { this.closeSwipe(); return }
    if (Date.now() < (this._ignoreCardTapUntil || 0)) return
    tap()
    this.resetSwipe()
    // 正文最长可达数千字，按报告 ID 缓存解析结果，重复打开不重复生成节点。
    const cache = this._nodesCache = this._nodesCache || {}
    const nodes = cache[item.id] || (cache[item.id] = parseMarkdown(item.content || ''))
    this.setData({ panel: true, closing: false, current: item, reportNodes: nodes })
    if (!item.read) this.markRead(item.id)
  },
  closePanel() {
    if (this.data.closing) return
    this.setData({ closing: true })
    require('../../utils/motion').closeLater(this, () => this.setData({ panel: false, closing: false, current: null, reportNodes: [] }))
  },
  // rich-text 不支持 selectable，用显式复制按钮保留原来的长按复制能力。
  copyReport() {
    const content = this.data.current && this.data.current.content
    if (!content) return
    wx.setClipboardData({ data: content, success: () => wx.showToast({ title: '已复制', icon: 'none' }) })
  },

  async markRead(id) {
    try {
      await call('aiNotifications', { action: 'read', id, clientRequestId: requestId() })
      this.setData({
        items: this.data.items.map(item => item.id === id ? { ...item, read: true } : item),
        current: this.data.current && this.data.current.id === id ? { ...this.data.current, read: true } : this.data.current
      })
    } catch (error) { toastError(error) }
  },

  goTasks() { wx.navigateTo({ url: '/pages/ai-tasks/index' }) },

  remove(event) {
    const id = event.currentTarget.dataset.id
    const item = this.data.items.find(value => value.id === id)
    this.confirmDanger({
      object: (item && item.dateText) || '',
      title: '删除这份报告',
      content: '删除后不可恢复。',
      success: async result => {
        if (!result.confirm) return
        try {
          await call('aiNotifications', { action: 'remove', id, clientRequestId: requestId() })
          this._openSwipeKey = ''
          wx.showToast({ title: '已删除', icon: 'success' })
          this.load()
        } catch (error) { toastError(error) }
      }
    })
  }
})
