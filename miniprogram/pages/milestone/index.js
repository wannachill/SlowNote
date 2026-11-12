// 发育里程碑：按整月龄管理个性化清单并记录达成情况。
const app = getApp()
const { tap } = require('../../utils/haptics')
const confetti = require('../../utils/confetti')
const milestoneOverview = require('../../utils/milestone-overview')
const pageCache = require('../../utils/page-cache')
const { ageMonth } = require('../../utils/date')
const DOMAINS = ['大运动', '精细动作', '语言', '社交', '其他']
const MONTHS = Array.from({ length: 36 }, (_, index) => index + 1)
const CLIENT_ID = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const sameData = (left, right) => JSON.stringify(left) === JSON.stringify(right)

require('../../utils/page')({
  data: {
    loading: false, loadError: '', months: MONTHS, activeMonth: 1, monthScrollInto: 'month-1', visible: [], all: [], busy: false,
    definition: null, domains: DOMAINS, domainIndex: 0, formMonth: 1, formName: '', savingDef: false,
    operatingKey: '',
    actionError: '', draggingKey: '', dropIndex: -1
  },
  onReady() { confetti.init(this, { canvasId: '#milestone-confetti', measureId: '#milestone-confetti-measure' }) },
  onHide() { confetti.stop(this); this.cancelCardGestures() },
  onUnload() { confetti.stop(this); this.cancelCardGestures() },
  async onShow() {
    if (!app.globalData.initialized) await app.init()
    const current = ageMonth((app.globalData.baby && app.globalData.baby.birthday) || '')
    const activeMonth = current == null || current < 1 ? 1 : current
    const monthScrollInto = `month-${activeMonth}`
    if (this.data.activeMonth !== activeMonth || this.data.monthScrollInto !== monthScrollInto) this.setData({ activeMonth, monthScrollInto })
    this.load()
  },
  onSessionChange() {
    this._listVersion = (this._listVersion || 0) + 1
    this._loadedOnce = false
    this._loadedScope = ''
    const current = ageMonth((app.globalData.baby && app.globalData.baby.birthday) || '')
    const activeMonth = current == null || current < 1 ? 1 : current
    this.setData({ activeMonth, monthScrollInto: `month-${activeMonth}`, all: [], visible: [], loading: false, loadError: '' })
    return this.load()
  },
  onPullDownRefresh() { return this.load(true).finally(() => wx.stopPullDownRefresh()) },
  async load(force = false) {
    const version = this._listVersion = (this._listVersion || 0) + 1
    const babyId = app.globalData.activeBabyId || ''
    // Account identity is intentionally omitted; app.logout() clears page-cache entries.
    const params = { babyId }
    const scopeKey = JSON.stringify(params)
    this._openSwipeKey = ''
    const cached = force ? null : pageCache.read('milestone', params)
    if (cached !== null) {
      this.applyList(cached, babyId, scopeKey)
      if (pageCache.fresh('milestone', params)) return
    }
    const hasCurrentData = this._loadedOnce && this._loadedScope === scopeKey
    if (!hasCurrentData && this.data.all.length) {
      this.setData({ all: [], visible: [], loading: true, loadError: '', actionError: '' })
    } else if (!hasCurrentData) {
      this.setData({ loading: true, loadError: '', actionError: '' })
    } else {
      this.setData({ loading: false, loadError: '', actionError: '' })
    }
    try {
      const response = await wx.cloud.callFunction({ name: 'milestoneRecord', data: { action: 'list', baby_id: babyId } })
      const result = response.result
      if (version !== this._listVersion) return
      if (!result || result.code !== 0) throw new Error(result && result.message ? `读取失败：${result.message}` : '未能读取记录，请重试')
      pageCache.write('milestone', params, result)
      this.applyList(result, babyId, scopeKey)
    } catch (error) {
      if (version === this._listVersion) {
        if (hasCurrentData) wx.showToast({ title: '网络有些慢，已保留上次数据', icon: 'none' })
        else this.setData({ loadError: error.message && !error.errMsg ? error.message : '网络有些慢，请检查连接后重试' })
      }
    } finally {
      if (version === this._listVersion && this.data.loading) this.setData({ loading: false })
    }
  },
  invalidateData() {
    pageCache.invalidate('milestone')
    milestoneOverview.invalidate()
  },
  applyList(result, babyId, scopeKey) {
    const months = result.months || MONTHS
    const all = result.milestones || []
    const activeMonth = months.includes(this.data.activeMonth) ? this.data.activeMonth : (months[0] || 1)
    const visible = this.visibleForMonth(all, activeMonth)
    const scopeChanged = this._loadedScope !== scopeKey
    const changed = scopeChanged || !sameData(this.data.all, all) || !sameData(this.data.months, months) || this.data.activeMonth !== activeMonth || !sameData(this.data.visible, visible)
    this._loadedOnce = true
    this._loadedScope = scopeKey
    milestoneOverview.store(all, babyId, (app.globalData.baby && app.globalData.baby.birthday) || '')
    const updates = { loading: false, loadError: '', actionError: '' }
    if (changed) Object.assign(updates, {
      months,
      activeMonth,
      all,
      visible
    })
    const needsUpdate = Object.keys(updates).some(key => !sameData(this.data[key], updates[key]))
    if (needsUpdate) this.setData(updates)
  },
  visibleForMonth(items, month) {
    return items.filter(item => Number(item.month) === Number(month)).sort((a, b) => a.sort_order - b.sort_order).map(item => ({
      ...item,
      swipeX: item.key === this._openSwipeKey ? -this.actionWidth() : 0,
      dragY: 0
    }))
  },
  applyFilter() {
    const list = this.visibleForMonth(this.data.all, this.data.activeMonth)
    this.setData({ visible: list })
  },
  onMonth(event) {
    const month = Number(event.currentTarget.dataset.month)
    if (!Number.isInteger(month)) return
    this.setData({ activeMonth: month, monthScrollInto: `month-${month}` })
    this.applyFilter()
  },
  actionWidth() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    return 220 * (info.windowWidth || 375) / 750
  },
  onMonthSwipeStart(event) {
    const touch = event.touches && event.touches[0]
    if (!touch) return
    const targetData = event.target && event.target.dataset || {}
    this._monthSwipeStart = { x: touch.clientX, y: touch.clientY, fromCard: !!targetData.cardGesture }
  },
  onMonthSwipeEnd(event) {
    const start = this._monthSwipeStart, touch = event.changedTouches && event.changedTouches[0]
    this._monthSwipeStart = null
    if (!start || !touch) return
    const dx = touch.clientX - start.x, dy = touch.clientY - start.y
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.25) return
    if (start.fromCard) return
    const next = Math.max(1, Math.min(36, Number(this.data.activeMonth) + (dx < 0 ? 1 : -1)))
    if (next !== this.data.activeMonth) {
      this.setData({ activeMonth: next, monthScrollInto: `month-${next}` })
      this.applyFilter()
    }
  },
  onCardTouchStart(event) {
    const touch = event.touches && event.touches[0], key = event.currentTarget.dataset.key
    if (!touch || !key) return
    const item = this.data.visible.find(value => value.key === key)
    this._cardGesture = { key, x: touch.clientX, y: touch.clientY, startOffset: item ? item.swipeX || 0 : 0, axis: '' }
  },
  onCardTouchMove(event) {
    const gesture = this._cardGesture, touch = event.touches && event.touches[0]
    if (!gesture || !touch) return
    const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y
    if (this.data.draggingKey === gesture.key) {
      const dragY = dy
      const centers = this._dragCenters || []
      const currentY = gesture.y + dy
      let dropIndex = this.data.visible.findIndex(item => {
        const center = centers.find(value => value.key === item.key)
        return center && currentY < center.y
      })
      if (dropIndex < 0) dropIndex = this.data.visible.length - 1
      this.setData({ dropIndex, visible: this.data.visible.map(item => ({ ...item, dragY: item.key === gesture.key ? dragY : 0 })) })
      return
    }
    if (!gesture.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'horizontal' : 'vertical'
    if (gesture.axis !== 'horizontal') return
    if (dx < -8 && this._openSwipeKey && this._openSwipeKey !== gesture.key) this.closeSwipe()
    const offset = Math.max(-this.actionWidth(), Math.min(0, gesture.startOffset + dx))
    this.setData({ visible: this.data.visible.map(item => ({ ...item, swipeX: item.key === gesture.key ? offset : item.swipeX })) })
    if (Math.abs(dx) > 12) this._ignoreCardTapUntil = Date.now() + 450
  },
  onCardTouchEnd() {
    const gesture = this._cardGesture
    if (!gesture) return
    if (this.data.draggingKey === gesture.key) {
      this.finishDrag(gesture.key)
    } else if (gesture.axis === 'horizontal') {
      const item = this.data.visible.find(value => value.key === gesture.key)
      const open = item && item.swipeX < -this.actionWidth() * .42
      if (open) this.openSwipe(gesture.key)
      else this.closeSwipe()
    }
    this._cardGesture = null
  },
  cancelCardGestures() {
    this._cardGesture = null
    this._dragCenters = []
    this._openSwipeKey = ''
    if (this.data.draggingKey) this.setData({ draggingKey: '', dropIndex: -1, visible: this.data.visible.map(item => ({ ...item, dragY: 0, swipeX: 0 })) })
  },
  closeSwipe() {
    this._openSwipeKey = ''
    this.setData({ visible: this.data.visible.map(item => ({ ...item, swipeX: 0 })) })
  },
  openSwipe(key) {
    this._openSwipeKey = key
    const offset = -this.actionWidth()
    this.setData({ visible: this.data.visible.map(item => ({ ...item, swipeX: item.key === key ? offset : 0 })) })
    this._ignoreCardTapUntil = Date.now() + 450
  },
  toggleDone(event) {
    const item = this.data.visible.find(value => value.key === event.currentTarget.dataset.key)
    if (!item) return
    if (item.swipeX < 0) { this.closeSwipe(); return }
    if (Date.now() < (this._ignoreCardTapUntil || 0) || this.data.draggingKey || this.data.busy) return
    if (item.done) return this.uncheck({ currentTarget: { dataset: { key: item.key } } })
    return this.check({ currentTarget: { dataset: { key: item.key } } })
  },
  async check(event) {
    const item = this.data.visible.find(value => value.key === event.currentTarget.dataset.key)
    if (this.data.busy || !item || item.done) return
    this.setData({ busy: true, operatingKey: item.key, actionError: '' })
    try {
      const recordDate = this.today()
      const response = await wx.cloud.callFunction({ name: 'milestoneRecord', data: { action: 'check', key: item.key, recordDate, baby_id: app.globalData.activeBabyId, clientRequestId: CLIENT_ID() } })
      if (!response.result || response.result.code !== 0) throw new Error('MILESTONE_FAILED')
      this.invalidateData()
      this.updateCompletion(item.key, true, recordDate)
      this.load(true)
      confetti.celebrate(this); tap('medium')
    } catch (error) { this.setData({ actionError: '记录失败，请重试' }) }
    finally { this.setData({ busy: false, operatingKey: '' }) }
  },
  async uncheck(event) {
    const item = this.data.visible.find(value => value.key === event.currentTarget.dataset.key)
    if (this.data.busy || this._uncheckPromptKey || !item || !item.done) return
    this._uncheckPromptKey = item.key
    let confirmed = false
    try {
      confirmed = await new Promise(resolve => wx.showModal({
        title: '取消成长里程碑打卡',
        content: `确定取消「${item.name}」的打卡吗？`,
        confirmText: '取消打卡',
        cancelText: '保留打卡',
        success: result => resolve(!!result.confirm),
        fail: () => resolve(false)
      }))
    } catch (error) {
      confirmed = false
    } finally {
      this._uncheckPromptKey = ''
    }
    if (!confirmed || this.data.busy) return
    return this.performUncheck(item)
  },
  async performUncheck(item) {
    if (this.data.busy || !item || !item.done) return
    const recordDate = item.recordDate || ''
    this.setData({ busy: true, operatingKey: item.key, actionError: '' })
    this.updateCompletion(item.key, false, '')
    try {
      const response = await wx.cloud.callFunction({ name: 'milestoneRecord', data: { action: 'uncheck', key: item.key, baby_id: app.globalData.activeBabyId } })
      if (!response.result || response.result.code !== 0) throw new Error('MILESTONE_FAILED')
      this.invalidateData()
      this.load(true)
      tap()
    } catch (error) {
      this.updateCompletion(item.key, true, recordDate)
      this.setData({ actionError: '操作失败，请重试' })
    }
    finally { this.setData({ busy: false, operatingKey: '' }) }
  },
  updateCompletion(key, done, recordDate) {
    const visibleIndex = this.data.visible.findIndex(item => item.key === key)
    const allIndex = this.data.all.findIndex(item => item.key === key)
    const patch = {}
    if (visibleIndex >= 0) {
      patch[`visible[${visibleIndex}].done`] = done
      patch[`visible[${visibleIndex}].recordDate`] = recordDate
    }
    if (allIndex >= 0) {
      patch[`all[${allIndex}].done`] = done
      patch[`all[${allIndex}].recordDate`] = recordDate
    }
    if (Object.keys(patch).length) this.setData(patch)
  },
  startAdd() { this.setData({ definition: { key: '', source: 'custom' }, formName: '', domainIndex: 0, formMonth: this.data.activeMonth }) },
  startEdit(event) {
    const item = this.data.visible.find(value => value.key === event.currentTarget.dataset.key)
    if (!item) return
    this._openSwipeKey = ''
    this.setData({
      visible: this.data.visible.map(value => ({ ...value, swipeX: 0 })),
      definition: item,
      formName: item.name,
      domainIndex: Math.max(0, DOMAINS.indexOf(item.domain)),
      formMonth: Number(item.month)
    })
  },
  closeDefinition() { if (!this.data.savingDef) this.setData({ definition: null }) },
  onName(event) { this.setData({ formName: event.detail.value }) },
  onDomain(event) { this.setData({ domainIndex: Number(event.detail.value) || 0 }) },
  onFormMonth(event) { this.setData({ formMonth: Number(event.detail.value) + 1 || this.data.activeMonth }) },
  async saveDefinition() {
    const definition = this.data.definition, name = this.data.formName.trim(), month = Number(this.data.formMonth)
    if (!definition || this.data.savingDef) return
    if (!name || name.length > 120 || !MONTHS.includes(month)) { wx.showToast({ title: '请填写名称并选择月龄', icon: 'none' }); return }
    this.setData({ savingDef: true })
    const action = definition.key ? 'updateDef' : 'addDef'
    try {
      const response = await wx.cloud.callFunction({ name: 'milestoneRecord', data: { action, ...(definition.key ? { key: definition.key } : {}), name, domain: DOMAINS[this.data.domainIndex], month, baby_id: app.globalData.activeBabyId, clientRequestId: CLIENT_ID() } })
      if (!response.result || response.result.code !== 0) throw new Error('MILESTONE_DEF_FAILED')
      this.invalidateData(); this.setData({ activeMonth: month, monthScrollInto: `month-${month}`, definition: null }); await this.load(true)
    } catch (error) { wx.showToast({ title: '保存失败，请重试', icon: 'none' }) }
    finally { this.setData({ savingDef: false }) }
  },
  confirmRemoveDefinition(event) {
    const item = this.data.visible.find(value => value.key === event.currentTarget.dataset.key)
    if (!item || this.data.busy) return
    this.closeSwipe()
    wx.showModal({ title: '删除成长里程碑', content: `删除「${item.name}」及其打卡记录？此操作不可撤销。`, confirmText: '删除', confirmColor: '#b42318', success: result => { if (result.confirm) this.deleteDefinition(item) } })
  },
  async deleteDefinition(item) {
    this.setData({ busy: true })
    try {
      const response = await wx.cloud.callFunction({ name: 'milestoneRecord', data: { action: 'removeDef', key: item.key, baby_id: app.globalData.activeBabyId, clientRequestId: CLIENT_ID() } })
      if (!response.result || response.result.code !== 0) throw new Error('MILESTONE_REMOVE_FAILED')
      this.invalidateData(); await this.load(true)
    } catch (error) { wx.showToast({ title: '删除失败，请重试', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
  async beginDrag(event) {
    const key = event.currentTarget.dataset.key
    if (!key || this.data.busy || this.data.definition) return
    this._ignoreCardTapUntil = Date.now() + 500
    this._openSwipeKey = ''
    tap('medium')
    const centers = await new Promise(resolve => {
      const query = wx.createSelectorQuery().in(this)
      query.selectAll('.milestone-swipe').boundingClientRect(rects => resolve((rects || []).map((rect, index) => ({ key: this.data.visible[index] && this.data.visible[index].key, y: rect.top + rect.height / 2 }))))
      query.exec()
    }).catch(() => [])
    this._dragCenters = centers
    this.setData({ draggingKey: key, dropIndex: this.data.visible.findIndex(item => item.key === key) })
  },
  finishDrag(key) {
    const from = this.data.visible.findIndex(item => item.key === key), to = Math.max(0, Math.min(this.data.visible.length - 1, this.data.dropIndex))
    const list = this.data.visible.map(item => ({ ...item, dragY: 0, swipeX: 0 }))
    if (from >= 0 && to !== from) {
      const moved = list.splice(from, 1)[0]
      list.splice(to, 0, moved)
    }
    this._dragCenters = []
    this._openSwipeKey = ''
    this._ignoreCardTapUntil = Date.now() + 500
    this.setData({ visible: list, draggingKey: '', dropIndex: -1 })
    if (from >= 0 && to !== from) this.saveOrder(list)
  },
  async saveOrder(list) {
    this.setData({ busy: true })
    try {
      const response = await wx.cloud.callFunction({ name: 'milestoneRecord', data: { action: 'reorder', month: this.data.activeMonth, keys: list.map(item => item.key), baby_id: app.globalData.activeBabyId, clientRequestId: CLIENT_ID() } })
      if (!response.result || response.result.code !== 0) throw new Error('MILESTONE_ORDER_FAILED')
      this.invalidateData()
      await this.load(true)
    } catch (error) { wx.showToast({ title: '排序保存失败，请重试', icon: 'none' }); await this.load() }
    finally { this.setData({ busy: false }) }
  },
  today() {
    const date = new Date(), pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }
})
