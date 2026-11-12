// 定时报告：报告任务管理（数据类型多选 + 数据范围 + 每天/每周/每月）+ 站内通知与订阅授权入口。
// 报告内容始终先落在 ai_notifications；微信订阅消息仅在有可用授权时尽力发送。
const page = require('../../utils/page'), { call, requestId, toastError } = require('../../utils/api')
const { tap } = require('../../utils/haptics')
// 数据类型与常见问题页保持一致：feeding / excretion / solid 同源于喂养记录，但可分别选择。
const ALL = [
  { key: 'feeding', name: '喂养' },
  { key: 'excretion', name: '便便排尿' },
  { key: 'solid', name: '辅食' },
  { key: 'growth', name: '成长' },
  { key: 'diary', name: '成长日记' },
  { key: 'milestone', name: '里程碑' },
  { key: 'custom', name: '自定义' }
]
// 数据范围与频率解耦：频率决定多久出一份报告，范围决定这份报告看多久的数据。
const RANGES = [
  { key: 'auto', name: '跟随频率' },
  { key: 'today', name: '今天' },
  { key: '3d', name: '近 3 天' },
  { key: '7d', name: '近 7 天' },
  { key: '30d', name: '近 30 天' }
]
const RANGE_NAMES = { auto: '跟随频率', today: '今天', '3d': '近 3 天', '7d': '近 7 天', '30d': '近 30 天' }
const RANGE_DAYS = { today: 1, '3d': 3, '7d': 7, '30d': 30 }
const AUTO_RANGE_NAMES = { daily: '今天', weekly: '近 7 天', monthly: '上月整月' }
function rangeName(frequency, range) {
  if (frequency === 'monthly') return AUTO_RANGE_NAMES.monthly
  return range && range !== 'auto' ? (RANGE_NAMES[range] || AUTO_RANGE_NAMES[frequency] || '今天') : (AUTO_RANGE_NAMES[frequency] || '今天')
}
function rangeDays(frequency, range) {
  return RANGE_DAYS[range] || (frequency === 'weekly' ? 7 : 1)
}
// 范围与频率不一致时如实说明后果：重叠（范围更大）或漏记（范围更小）。
function rangeHint(frequency, range) {
  const days = rangeDays(frequency, range), span = frequency === 'weekly' ? 7 : 1
  const base = '每份报告分析' + rangeName(frequency, range) + '的记录'
  if (days > span) return base + '，相邻报告会有重叠。'
  if (days < span) return base + '，两次报告之间的记录不会进入报告。'
  return base + '。'
}
const LEGACY_CATEGORY_NAMES = { outdoor: '户外' }
const STATUS = { completed: '已生成报告', not_configured: 'AI 尚未配置，已写入站内通知', unavailable: '连接暂不可用，已写入站内通知', permission_changed: '数据使用同意已撤回，任务已暂停', retry_pending: '本次暂未完成，下次轮询重试' }
// 仅在出现非正常运行状态时展示状态标签，正常/等待态不打扰用户。
const STATUS_TAG = { not_configured: ['未配置AI', 'status-warn'], unavailable: ['AI暂不可用', 'status-warn'], permission_changed: ['已暂停', 'status-pause'], retry_pending: ['本次未完成', 'status-warn'] }
const FREQUENCIES = ['daily', 'weekly', 'monthly']
// Keep in sync with --swipe-action-width in app.wxss.
const ACTION_WIDTH_RPX = 220

page({
  data: {
    items: [], categories: [], ranges: RANGES, range: 'auto', rangeHint: '', frequencies: ['每天', '每周', '每月'], frequencyIndex: 0,
    weekdays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'], weekday: 1,
    time: '20:00', consent: false, saving: false, loading: false, error: '', templateId: '',
    panel: false, closing: false, editingId: '', reportTitle: '', allSelected: false
  },

  onShow() {
    // Do not wipe a prefilled edit form when the page is shown again with the sheet open.
    if (!this.data.editingId && !this.data.panel) this.resetForm()
    this.load()
  },
  onHide() { this.resetSwipe() },
  onUnload() { this.resetSwipe() },

  async load() {
    // A refresh must not leave an in-flight gesture behind; the open card is restored below.
    this._cardGesture = null
    this.setData({ loading: true, error: '' })
    try {
      const r = await call('aiTasks', { action: 'list' })
      const openKey = this._openSwipeKey
      const items = (r.items || []).map(item => ({
        ...item,
        swipeX: openKey && openKey === item._id ? -this.actionWidth() : 0,
        categoriesText: item.categories.map(k => (ALL.find(c => c.key === k) || {}).name || LEGACY_CATEGORY_NAMES[k] || k).join('、'),
        scheduleText: item.frequency === 'monthly' ? '每月 1 日 ' + item.time : (item.frequency === 'weekly' ? '每' + this.data.weekdays[item.weekday] : '每天') + ' ' + item.time,
        headline: item.report_title || '定时报告',
        statusText: STATUS[item.last_status] || '等待下一次报告',
        statusTag: STATUS_TAG[item.last_status] ? STATUS_TAG[item.last_status][0] : '',
        statusClass: STATUS_TAG[item.last_status] ? STATUS_TAG[item.last_status][1] : '',
        reportTitle: item.report_title || ''
      }))
      this.setData({ templateId: r.templateId || '', items })
    } catch (error) { this.setData({ error: error.message }) } finally { this.setData({ loading: false }) }
  },

  // Swipe gestures mirror the baby profile page: one open card at a time, native switch excluded.
  actionWidth() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    return ACTION_WIDTH_RPX * (info.windowWidth || 375) / 750
  },
  onCardTouchStart(event) {
    const touch = event.touches && event.touches[0], id = event.currentTarget.dataset.id
    const target = event.target && event.target.dataset || {}
    if (!touch || !id || target.noSwipe) return
    const item = this.data.items.find(value => value._id === id)
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
    this.setData({ items: this.data.items.map(item => ({ ...item, swipeX: item._id === gesture.id ? offset : item.swipeX })) })
    if (Math.abs(dx) > 12) this._ignoreCardTapUntil = Date.now() + 450
  },
  onCardTouchEnd() {
    const gesture = this._cardGesture
    if (!gesture) return
    if (gesture.axis === 'horizontal') {
      const item = this.data.items.find(value => value._id === gesture.id)
      if (item && item.swipeX < -this.actionWidth() * .42) this.openSwipe(gesture.id)
      else this.closeSwipe()
    }
    this._cardGesture = null
  },
  closeSwipe() {
    this._openSwipeKey = ''
    this.setData({ items: this.data.items.map(item => ({ ...item, swipeX: 0 })) })
  },
  openSwipe(id) {
    this._openSwipeKey = id
    const offset = -this.actionWidth()
    this.setData({ items: this.data.items.map(item => ({ ...item, swipeX: item._id === id ? offset : 0 })) })
    this._ignoreCardTapUntil = Date.now() + 450
  },
  onCardTap(event) {
    const item = this.data.items.find(value => value._id === event.currentTarget.dataset.id)
    if (item && item.swipeX < 0) this.closeSwipe()
  },
  resetSwipe() {
    this._cardGesture = null
    this._openSwipeKey = ''
    this._ignoreCardTapUntil = 0
    const items = this.data.items || []
    if (items.some(item => item.swipeX)) this.setData({ items: items.map(item => ({ ...item, swipeX: 0 })) })
  },

  resetForm() {
    this._id = ''
    this.setData({
      categories: ALL.map(c => ({ ...c, selected: false })),
      range: 'auto', rangeHint: rangeHint('daily', 'auto'),
      frequencyIndex: 0, weekday: 1, time: '20:00', consent: false, editingId: '', reportTitle: '', allSelected: false
    })
  },
  openPanel() { tap(); this.resetForm(); this.setData({ panel: true, closing: false }) },
  closePanel() {
    if (this.data.closing || this.data.saving) return
    this.setData({ closing: true })
    require('../../utils/motion').closeLater(this, () => this.setData({ panel: false, closing: false }))
  },
  startEdit(event) {
    const id = event.currentTarget.dataset.id
    const item = this.data.items.find(value => value._id === id)
    if (!item) return
    this.closeSwipe()
    tap()
    const picked = item.categories || []
    this._id = ''
    this.setData({
      categories: ALL.map(c => ({ ...c, selected: picked.includes(c.key) })),
      range: item.range || 'auto',
      rangeHint: rangeHint(item.frequency, item.range || 'auto'),
      frequencyIndex: Math.max(0, FREQUENCIES.indexOf(item.frequency)),
      weekday: Number.isInteger(item.weekday) ? item.weekday : 1,
      time: item.time || '20:00',
      reportTitle: item.report_title || '',
      allSelected: picked.length === ALL.length,
      consent: true,
      editingId: id,
      panel: true,
      closing: false
    })
  },

  selectCategory(e) { if (this.data.saving) return; this._id = ''; this.setData({ categories: this.data.categories.map(c => c.key === e.currentTarget.dataset.key ? { ...c, selected: !c.selected } : c) }); this.syncAllSelected() },
  toggleAllCategories() { if (this.data.saving) return; this._id = ''; const allSelected = this.data.categories.every(c => c.selected); this.setData({ categories: this.data.categories.map(c => ({ ...c, selected: !allSelected })) }); this.syncAllSelected() },
  syncAllSelected() { const categories = this.data.categories; this.setData({ allSelected: categories.length > 0 && categories.every(c => c.selected) }) },
  selectRange(e) { if (this.data.saving) return; this._id = ''; this.setData({ range: e.currentTarget.dataset.key, rangeHint: rangeHint(FREQUENCIES[this.data.frequencyIndex], e.currentTarget.dataset.key) }) },
  onFrequency(e) {
    if (this.data.saving) return
    this._id = ''
    const frequencyIndex = Number(e.detail.value)
    // 月度任务固定分析上月整月，范围选择不适用，回落到 auto。
    const range = frequencyIndex === 2 ? 'auto' : this.data.range
    this.setData({ frequencyIndex, range, rangeHint: rangeHint(FREQUENCIES[frequencyIndex] || 'daily', range) })
  },
  onWeekday(e) { if (this.data.saving) return; this._id = ''; this.setData({ weekday: Number(e.detail.value) }) },
  onTime(e) { if (this.data.saving) return; this._id = ''; this.setData({ time: e.detail.value }) },
  onConsent(e) { this.motionSettingChange(e); if (this.data.saving) return; this._id = ''; this.setData({ consent: e.detail.value }) },
  onReportTitle(e) { if (this.data.saving) return; this._id = ''; this.setData({ reportTitle: (e.detail.value || '').slice(0, 20) }) },

  async save() {
    if (this.data.saving) return
    const categories = this.data.categories.filter(c => c.selected).map(c => c.key)
    if (!categories.length || !this.data.consent) { wx.showToast({ title: '请选择数据类型并确认数据使用说明', icon: 'none' }); return }
    const editingId = this.data.editingId
    const clientRequestId = this._id || (this._id = requestId())
    const payload = {
      action: editingId ? 'update' : 'save',
      categories,
      report_title: this.data.reportTitle,
      range: this.data.frequencyIndex === 2 ? 'auto' : this.data.range,
      frequency: FREQUENCIES[this.data.frequencyIndex] || 'daily',
      time: this.data.time,
      weekday: this.data.weekday,
      consent: true,
      baby_id: getApp().globalData.activeBabyId,
      clientRequestId
    }
    if (editingId) payload.id = editingId
    this.setData({ saving: true })
    try {
      await call('aiTasks', payload)
      this._id = ''
      wx.showToast({ title: editingId ? '已保存修改' : '已保存', icon: 'success' })
      tap('medium')
      this.setData({ panel: false, closing: false })
      this.resetForm()
      this.load()
    } catch (error) { toastError(error) } finally { this.setData({ saving: false }) }
  },

  async toggle(e) { this.motionSettingChange(e); try { await call('aiTasks', { action: 'toggle', id: e.currentTarget.dataset.id, enabled: e.detail.value, clientRequestId: requestId() }); this.load() } catch (error) { toastError(error); this.load() } },
  remove(e) {
    const id = e.currentTarget.dataset.id
    this.confirmDanger({ object: (this.data.items.find(item => item._id === id) || {}).categoriesText || '', title: '删除报告任务', content: '已生成的站内通知会保留。', success: async r => { if (!r.confirm) return; try { await call('aiTasks', { action: 'remove', id, clientRequestId: requestId() }); this._openSwipeKey = ''; this.load() } catch (error) { toastError(error) } } })
  },
  // 开关状态即用户偏好，立即乐观落库并保持开启；订阅授权弹窗由微信自行展示，
  // 不额外弹 toast（开关翻转本身就是反馈），授权与否都不再回退开关、也不刷新列表。
  onNotifyChange(e) {
    const id = e.currentTarget.dataset.id, value = e.detail.value
    this._setNotify(id, value)
    if (value && this.data.templateId) wx.requestSubscribeMessage({ tmplIds: [this.data.templateId] })
  },
  _setNotify(id, notify) {
    // 乐观更新：立即反映开关状态，不等云端往返；云端失败再回退该卡片，全程不刷新列表。
    this.setData({ items: this.data.items.map(item => item._id === id ? { ...item, notify } : item) })
    call('aiTasks', { action: 'setNotify', id, notify, clientRequestId: requestId() })
      .catch(error => {
        this.setData({ items: this.data.items.map(item => item._id === id ? { ...item, notify: !notify } : item) })
        toastError(error)
      })
  }
})
