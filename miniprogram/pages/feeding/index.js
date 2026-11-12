const { dateKey, parseDate } = require('../../utils/date')
const { tap } = require('../../utils/haptics')
const references = require('../../utils/references')
const formatNumber = require('../../utils/format-number')
const currentBabyName = require('../../utils/record-scope').currentBabyName
// 喂奶记录页：独立登记喂养（亲喂时长 / 瓶喂·配方奶奶量 ml），数据流走 feedingRecord 云函数（服务端鉴权+幂等）
const FEED_TYPES = [
  { key: 'breast', name: '亲喂' },
  { key: 'bottle', name: '瓶喂' },
  { key: 'formula', name: '配方奶' }
]
const TYPE_LABEL = { breast: '亲喂', bottle: '瓶喂', formula: '配方奶', mixed: '混合' }

require('../../utils/page')({
  data: {
    loading: false, loadError: '',
    recordDate: dateKey(), today: dateKey(),
    panel: '',          // '' | feed
    panelMode: false, cardEditMode: false, recordKey: '', babyName: '',
    feedType: 'breast',
    duration: '',
    amount: '',
    feedTypes: FEED_TYPES,
    refHint: '',
    todayRecords: [],
    editingId: '',
    submitting: false
  },

  onLoad(options) {
    const date = parseDate(options.date) ? options.date : dateKey()
    const panelMode = options.panel === 'feed' || options.cardEdit === '1'
    this.setData({ recordDate: date, panel: panelMode ? 'feed' : '', panelMode, cardEditMode: options.cardEdit === '1', recordKey: options.recordKey || options.mode || '', babyName: currentBabyName(), feedType: FEED_TYPES.some(t => t.key === options.mode) ? options.mode : 'breast' })
    this.refreshHint()
  },
  onShow() { this.setData({ babyName: currentBabyName() }); if (!this.data.panelMode || this.data.cardEditMode) this.loadToday(); this.refreshHint() },
  onDate(e) { if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return; this._requestId = ''; this.setData({ recordDate: e.detail.value }); if (!this.data.panelMode) this.loadToday() },

  openPanel(e) { if (this.data.submitting || this.data.closing) return; this._requestId = ''; tap(); this.setData({ panel: e.currentTarget.dataset.panel, closing: false, editingId: '' }) },
  closePanel(saved) {
    if (!saved && this.data.editingId) this.setData({ editingId: '', duration: '', amount: '' })
    require('../../utils/registration').close(this, saved === true)
  },
  startEdit(e) {
    if (this.data.submitting) return
    const record = this.data.todayRecords.find(item => item.id === e.currentTarget.dataset.id)
    if (!record) return
    const payload = record.payload || {}, breast = payload.mode === 'breast'
    this._requestId = ''
    this.setData({
      editingId: record.id, panel: 'feed', panelMode: this.data.cardEditMode || this.data.panelMode, closing: false, feedType: payload.mode || 'breast',
      duration: breast ? String(payload.durationMin || '') : '',
      amount: breast ? '' : String(payload.amountMl || ''), recordDate: record.recordDate,
      fieldErrors: {}, fieldShake: ''
    })
    this.refreshHint()
  },
  refreshHint() {
    const baby = getApp().globalData.baby
    const birthday = (baby && baby.birthday) || ''
    const key = birthday + '|' + this.data.feedType + '|' + dateKey()
    if (key === this._hintKey) return
    this._hintKey = key
    this.setData({ refHint: references.feedingHint(birthday, this.data.feedType) })
  },
  selectType(e) { if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return; this._requestId = ''; this.setData({ feedType: e.currentTarget.dataset.type, fieldErrors: {} }); this.refreshHint() },

  onInput(e) {
    if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return
    this._requestId = ''
    this.clearFieldError(e.currentTarget.dataset.field)
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  // 喂奶：亲喂填时长，其余填奶量（ml）
  submitFeed() {
    const { feedType, duration, amount } = this.data
    const isBreast = feedType === 'breast'
    const value = isBreast ? Number(duration) : Number(amount)
    if (!value || value <= 0) {
      this.showFieldError(isBreast ? 'duration' : 'amount', '请填写有效数值')
      return
    }
    this.submit('feed', isBreast
      ? { mode: feedType, durationMin: value }
      : { mode: feedType, amountMl: value })
  },

  // 统一提交：clientRequestId 幂等键防重复提交
  async submit(type, payload) {
    if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return
    if (!require('../../utils/api').requireWriteAccess()) return
    const editingId = this.data.editingId
    const clientRequestId = editingId ? '' : (this._requestId || (this._requestId = require('../../utils/api').requestId()))
    this.setData({ submitting: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'feedingRecord',
        data: editingId
          ? { action: 'update', id: editingId, type, payload, recordDate: this.data.recordDate }
          : { action: 'add', type, payload, recordDate: this.data.recordDate, baby_id: getApp().globalData.activeBabyId, clientRequestId }
      })
      const r = res.result
      if (r.code !== 0) throw new Error('RECORD_FAILED')
      this._requestId = ''
      require('../../utils/home-refresh').markSaved(this.data.recordDate)
      wx.showToast({ title: editingId ? '已更新' : '已记录', icon: 'success' })
      tap('medium')
      if (this.data.panelMode) { this.closePanel(true); return }
      this.setData({ duration: '', amount: '', editingId: '' })
      this.closePanel(true)
      if (!this.data.panelMode) this.loadToday()
    } catch (e) {
      wx.showToast({ title: '记录失败，请重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  async loadToday() {
    if (this.data.panelMode && !this.data.cardEditMode) return
    const version = this._listVersion = (this._listVersion || 0) + 1
    this.setData({ loading: true, loadError: '' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'feedingRecord',
        data: { action: 'listDate', recordDate: this.data.recordDate, baby_id: getApp().globalData.activeBabyId }
      })
      const r = res.result
      if (version !== this._listVersion) return
      if (!r || r.code !== 0) throw new Error('未能读取记录，请重试')
      const records = (r.records || [])
        .filter((d) => d.type === 'feed')
        .filter((d) => !this.data.cardEditMode || !['breast', 'bottle', 'formula', 'mixed'].includes(this.data.recordKey) || (d.payload || {}).mode === this.data.recordKey)
        .map((d) => ({
          id: d.id,
          time: this.formatTime(d.created_at),
          desc: this.describe(d), payload: d.payload || {}, recordDate: d.record_date
        }))
      this.setData({ todayRecords: records }, () => {
        if (!this.data.cardEditMode || this._cardEditOpened) return
        this._cardEditOpened = true
        if (records.length) this.startEdit({ currentTarget: { dataset: { id: records[0].id } } })
      })
    } catch (error) {
      if (version === this._listVersion) this.setData({ loadError: error.message && !error.errMsg ? error.message : '网络有些慢，请检查连接后重试' })
    } finally {
      if (version === this._listVersion) this.setData({ loading: false })
    }
  },

  formatTime(ts) {
    const d = new Date(new Date(ts).getTime() + 8 * 3600000)
    const p = (n) => (n < 10 ? '0' + n : n)
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  },

  describe(d) {
    const p = d.payload || {}
    if (d.type !== 'feed') return '喂养记录'
    const mode = TYPE_LABEL[p.mode] || '喂奶'
    return p.durationMin ? `${mode} ${formatNumber(p.durationMin, 2)} 分钟` : `${mode} ${formatNumber(p.amountMl, 2)} ml`
  }
})
