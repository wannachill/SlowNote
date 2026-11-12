const { dateKey, parseDate } = require('../../utils/date')
const { tap } = require('../../utils/haptics')
const references = require('../../utils/references')
const currentBabyName = require('../../utils/record-scope').currentBabyName
const milestoneOverview = require('../../utils/milestone-overview')
// 成长页按选定日期维护当天一条多指标记录。
require('../../utils/page')({
  data: {
    lookupLoading: false, lookupError: '',
    milestoneEntry: { label: '成长里程碑', month: null, done: 0, total: 0 },
    height: '',
    weight: '',
    head: '',
    recordDate: '',
    today: dateKey(),
    panelMode: false, cardEditMode: false, babyName: '',
    growthType: 'height',
    measurement: '',
    growthTypes: [
      { key: 'height', name: '身高', unit: 'cm' },
      { key: 'weight', name: '体重', unit: 'kg' },
      { key: 'head', name: '头围', unit: 'cm' }
    ],
    refHint: '',
    editingId: '',
    submitting: false
  },

  onLoad(options) {
    this.setData({
      recordDate: parseDate(options.date) ? options.date : dateKey(),
      panelMode: options.panel === 'growth' || options.cardEdit === '1', cardEditMode: options.cardEdit === '1', babyName: currentBabyName()
    })
    this.refreshHint()
  },

  onShow() {
    this.setData({ babyName: currentBabyName() })
    this.refreshHint()
    if (!this.data.panelMode) this.loadMilestoneEntry()
    if (this.data.cardEditMode || (!this.data.panelMode && !this.data.entryPending)) return this.loadSelectedDateRecord()
  },

  onSessionChange() {
    this.setData({ babyName: currentBabyName(), milestoneEntry: { label: '成长里程碑', month: null, done: 0, total: 0 } })
    if (!this.data.panelMode) this.loadMilestoneEntry()
  },

  async loadMilestoneEntry() {
    const overview = await milestoneOverview.load()
    if (!overview || this.data.panelMode) return
    const label = overview.month != null
      ? `${overview.month}月龄成长里程碑：已达成 ${overview.done}/${overview.total} 项`
      : '成长里程碑'
    this.setData({ milestoneEntry: { ...overview, label } })
  },

  closePanel(saved) { require('../../utils/registration').close(this, saved === true) },
  refreshHint() {
    const baby = getApp().globalData.baby
    const birthday = (baby && baby.birthday) || ''
    const key = birthday + '|' + dateKey()
    if (key === this._hintKey) return
    this._hintKey = key
    this.setData({ refHint: references.growthHint(birthday) })
  },

  goMilestone() {
    wx.navigateTo({ url: '/pages/milestone/index' })
  },

  onInput(e) {
    if (this.data.submitting || this.data.closing) return
    this._requestId = ''
    this.clearFieldError(e.currentTarget.dataset.field)
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  selectGrowthType(e) {
    if (this.data.submitting || this.data.closing) return
    this._requestId = ''
    if (!this.data.growthTypes.some(item => item.key === e.currentTarget.dataset.type)) return
    this.setData({ growthType: e.currentTarget.dataset.type, measurement: '', fieldErrors: {} })
  },

  onDate(e) {
    if (this.data.submitting || this.data.closing || this.data.lookupLoading) return
    this._requestId = ''
    this.setData({ recordDate: e.detail.value }, () => {
      if (!this.data.panelMode || this.data.cardEditMode) this.loadSelectedDateRecord()
    })
  },

  async loadSelectedDateRecord() {
    if (this.data.panelMode && !this.data.cardEditMode) return
    const version = this._recordLookupVersion = (this._recordLookupVersion || 0) + 1
    const date = this.data.recordDate
    const babyId = getApp().globalData.activeBabyId || ''
    this.setData({
      lookupLoading: true,
      lookupError: '',
      editingId: '', height: '', weight: '', head: '', fieldErrors: {}, fieldShake: ''
    })
    try {
      const response = await wx.cloud.callFunction({ name: 'growthRecord', data: { action: 'listDate', recordDate: date, baby_id: babyId } })
      const result = response && response.result
      if (version !== this._recordLookupVersion || date !== this.data.recordDate || babyId !== (getApp().globalData.activeBabyId || '')) return
      if (!result || result.code !== 0) throw new Error('未能读取当天记录，请重试')
      const record = (result.records || [])[0]
      this.setData({
        editingId: record ? record._id : '',
        height: record && record.height != null ? String(record.height) : '',
        weight: record && record.weight != null ? String(record.weight) : '',
        head: record && record.head != null ? String(record.head) : '',
        fieldErrors: {},
        fieldShake: ''
      })
    } catch (error) {
      if (version === this._recordLookupVersion && date === this.data.recordDate) {
        this.setData({ lookupError: error.message && !error.errMsg ? error.message : '网络有些慢，请检查连接后重试' })
      }
    } finally {
      if (version === this._recordLookupVersion) this.setData({ lookupLoading: false })
    }
  },

  async submit() {
    if (this.data.submitting || this.data.closing || (this.data.cardEditMode && (this.data.lookupLoading || this.data.lookupError))) return
    const { height, weight, head, recordDate, panelMode, growthType, measurement } = this.data
    if (!require('../../utils/api').requireWriteAccess()) return
    const values = { height, weight, head }
    if (panelMode && measurement && !values[growthType]) values[growthType] = measurement
    const limits = { height: [1, 250], weight: [0.1, 300], head: [1, 100] }
    const errors = {}
    let firstInvalid = ''
    Object.entries(values).forEach(([field, raw]) => {
      if (raw === '' || raw == null) return
      const value = Number(raw), bounds = limits[field]
      if (!Number.isFinite(value) || value < bounds[0] || value > bounds[1]) {
        errors[field] = `请输入 ${bounds[0]}～${bounds[1]} 之间的有效数值`
        if (!firstInvalid) firstInvalid = field
      }
    })
    if (Object.keys(errors).length) {
      this.setData({ fieldErrors: errors })
      this.showFieldError(firstInvalid, errors[firstInvalid])
      return
    }
    this.setData({ fieldErrors: {}, fieldShake: '' })
    if (!values.height && !values.weight && !values.head) {
      wx.showToast({ title: '请至少填写一项', icon: 'none' })
      return
    }
    if (this.data.submitting || this.data.closing) return
    const editingId = this.data.editingId
    const clientRequestId = editingId ? '' : (this._requestId || (this._requestId = require('../../utils/api').requestId()))
    this.setData({ submitting: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'growthRecord',
        data: editingId
          ? { action: 'update', id: editingId, height: values.height, weight: values.weight, head: values.head, recordDate }
          : { action: 'add', height: values.height, weight: values.weight, head: values.head, recordDate, baby_id: getApp().globalData.activeBabyId, clientRequestId }
      })
      const r = res.result
      if (r.code !== 0) throw new Error('RECORD_FAILED')
      this._requestId = ''
      require('../../utils/home-refresh').markSaved(recordDate)
      wx.showToast({ title: editingId ? '已更新' : '已保存', icon: 'success' })
      tap('medium')
      if (this.data.panelMode) { this.closePanel(true); return }
      this.setData({ editingId: editingId || (r.data && r.data.id) || '', measurement: '', lookupError: '' })
    } catch (e) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
