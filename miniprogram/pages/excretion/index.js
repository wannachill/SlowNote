const { dateKey, parseDate } = require('../../utils/date')
const { tap } = require('../../utils/haptics')
const references = require('../../utils/references')
const currentBabyName = require('../../utils/record-scope').currentBabyName
// 便便记录页：独立登记排泄（大便/小便次数与大便状态），数据流走 feedingRecord 云函数（服务端鉴权+幂等，type=excretion）
const SHAPES = ['正常', '偏稀', '偏干', '水样']
const EX_KINDS = [
  { key: 'stool', name: '大便' },
  { key: 'urine', name: '小便' }
]

require('../../utils/page')({
  data: {
    loading: false, loadError: '',
    recordDate: dateKey(), today: dateKey(),
    panel: '',          // '' | excretion
    panelMode: false, cardEditMode: false, recordKey: '', babyName: '',
    exKind: 'stool',
    exCount: '',
    exShape: '',
    shapes: SHAPES,
    exKinds: EX_KINDS,
    refHint: '',
    todayRecords: [],
    editingId: '',
    submitting: false
  },

  onLoad(options) {
    const date = parseDate(options.date) ? options.date : dateKey()
    const panelMode = options.panel === 'excretion' || options.cardEdit === '1'
    this.setData({ recordDate: date, panel: panelMode ? 'excretion' : '', panelMode, cardEditMode: options.cardEdit === '1', recordKey: options.recordKey || '', babyName: currentBabyName() })
    this.refreshHint()
  },
  onShow() { this.setData({ babyName: currentBabyName() }); if (!this.data.panelMode || this.data.cardEditMode) this.loadToday(); this.refreshHint() },
  onDate(e) { if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return; this._requestId = ''; this.setData({ recordDate: e.detail.value }); if (!this.data.panelMode) this.loadToday() },

  openPanel(e) { if (this.data.submitting || this.data.closing) return; this._requestId = ''; tap(); this.setData({ panel: e.currentTarget.dataset.panel, closing: false, editingId: '' }) },
  closePanel(saved) {
    if (!saved && this.data.editingId) this.setData({ editingId: '', exKind: 'stool', exCount: '', exShape: '' })
    require('../../utils/registration').close(this, saved === true)
  },
  startEdit(e) {
    if (this.data.submitting) return
    const record = this.data.todayRecords.find(item => item.id === e.currentTarget.dataset.id)
    if (!record) return
    const payload = record.payload || {}
    this._requestId = ''
    this.setData({ editingId: record.id, panel: 'excretion', panelMode: this.data.cardEditMode || this.data.panelMode, closing: false, exKind: payload.kind || 'stool', exCount: String(payload.count || ''), exShape: payload.shape || '', recordDate: record.recordDate, fieldErrors: {}, fieldShake: '' })
    this.refreshHint()
  },
  refreshHint() {
    const baby = getApp().globalData.baby
    const birthday = (baby && baby.birthday) || ''
    const key = birthday + '|' + this.data.exKind + '|' + dateKey()
    if (key === this._hintKey) return
    this._hintKey = key
    this.setData({ refHint: references.excretionHint(birthday, this.data.exKind) })
  },
  selectShape(e) { if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return; this._requestId = ''; this.clearFieldError('exShape'); this.setData({ exShape: e.currentTarget.dataset.shape }) },
  selectExKind(e) { if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return; this._requestId = ''; this.setData({ exKind: e.currentTarget.dataset.kind, exCount: '', exShape: '', fieldErrors: {} }); this.refreshHint() },

  onInput(e) {
    if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return
    this._requestId = ''
    this.clearFieldError(e.currentTarget.dataset.field)
    if (e.currentTarget.dataset.field === 'exCount') this.clearFieldError('exCount')
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  submitExcretion() {
    const { exKind, exCount, exShape } = this.data
    if (exKind === 'stool' && !(Number(exCount) > 0)) {
      this.showFieldError('exCount', '请填写大便次数')
      return
    }
    if (exKind === 'urine' && !(Number(exCount) > 0)) {
      this.showFieldError('exCount', '请填写排尿次数')
      return
    }
    this.submit({
      kind: exKind,
      count: Number(exCount) || null,
      shape: exShape
    })
  },

  // 统一提交：clientRequestId 幂等键防重复提交
  async submit(payload) {
    if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return
    if (!require('../../utils/api').requireWriteAccess()) return
    const editingId = this.data.editingId
    const clientRequestId = editingId ? '' : (this._requestId || (this._requestId = require('../../utils/api').requestId()))
    this.setData({ submitting: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'feedingRecord',
        data: editingId
          ? { action: 'update', id: editingId, type: 'excretion', payload, recordDate: this.data.recordDate }
          : { action: 'add', type: 'excretion', payload, recordDate: this.data.recordDate, baby_id: getApp().globalData.activeBabyId, clientRequestId }
      })
      const r = res.result
      if (r.code !== 0) throw new Error('RECORD_FAILED')
      this._requestId = ''
      require('../../utils/home-refresh').markSaved(this.data.recordDate)
      wx.showToast({ title: editingId ? '已更新' : '已记录', icon: 'success' })
      tap('medium')
      if (this.data.panelMode) { this.closePanel(true); return }
      this.setData({ exCount: '', exShape: '', editingId: '' })
      this.closePanel(true)
      this.loadToday()
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
        .filter((d) => d.type === 'excretion' && (!this.data.cardEditMode || !this.data.recordKey || this.data.recordKey === 'excretion'))
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
    const kind = p.kind === 'urine' ? '小便' : '大便'
    return `${kind}${p.count ? ' ' + p.count + ' 次' : ''}${p.shape ? ' · ' + p.shape : ''}`
  }
})
