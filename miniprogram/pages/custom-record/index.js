const page = require('../../utils/page'), { call, requestId, toastError, requireWriteAccess } = require('../../utils/api')
const { dateKey, parseDate } = require('../../utils/date')
const { tap } = require('../../utils/haptics')
const formatNumber = require('../../utils/format-number')
const currentBabyName = require('../../utils/record-scope').currentBabyName
page({
  data: { category: 'custom', panelMode: false, cardEditMode: false, babyName: '', label: '', value: '', unit: '', note: '', editingId: '', recordDate: dateKey(), today: dateKey(), submitting: false, loading: false, records: [], error: '' },
  onLoad(options) { this.setData({ category: 'custom', panelMode: options.panel === '1' || options.cardEdit === '1', cardEditMode: options.cardEdit === '1', babyName: currentBabyName(), recordDate: parseDate(options.date) ? options.date : dateKey() }) },
  onShow() { this.setData({ babyName: currentBabyName() }); if (!this.data.panelMode || this.data.cardEditMode) this.load() },
  closePanel(saved) { require('../../utils/registration').close(this, saved === true) },
  onInput(e) { if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return; this._id = ''; this.clearFieldError(e.currentTarget.dataset.field); this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  onDate(e) { if (this.data.submitting || this.data.closing) return; this._id = ''; this.setData({ recordDate: e.detail.value }); if (!this.data.panelMode) this.load() },
  async load() {
    if (this.data.panelMode && !this.data.cardEditMode) return
    const version = this._listVersion = (this._listVersion || 0) + 1
    const date = this.data.recordDate
    this.setData({ loading: true, error: '' })
    try {
      const r = await call('customRecord', { action: 'list', recordDate: date, baby_id: getApp().globalData.activeBabyId })
      if (version === this._listVersion && date === this.data.recordDate) {
        const records = r.records.filter(r => r.category === this.data.category).map(item => ({ ...item, valueText: item.value == null ? '' : formatNumber(item.value, item.unit === '次' ? 0 : 2) }))
        this.setData({ records, error: '' }, () => {
          if (this.data.cardEditMode && !this._cardEditOpened && records.length) {
            this._cardEditOpened = true
            this.editRecord({ currentTarget: { dataset: { id: records[0]._id } } })
          }
        })
      }
    } catch (error) {
      if (version === this._listVersion) this.setData({ error: error.message, records: [] })
    } finally {
      if (version === this._listVersion) this.setData({ loading: false })
    }
  },
  editRecord(e) {
    if (this.data.submitting) return
    const record = this.data.records.find(item => item._id === e.currentTarget.dataset.id)
    if (!record) return
    this._id = ''
    this.setData({ panelMode: true, editingId: record._id, label: record.label || '', value: record.value == null ? '' : String(record.value), unit: record.unit || '', note: record.note || '', fieldErrors: {}, fieldShake: '' })
  },
  async save() {
    if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return
    if (!requireWriteAccess()) return
    if (!this.data.label.trim()) { wx.showToast({ title: '给这笔记录起个名字', icon: 'none' }); return }
    const value = String(this.data.value == null ? '' : this.data.value).trim()
    const number = Number(value)
    if (value !== '' && (!Number.isFinite(number) || number < 0 || number > 999999)) {
      this.showFieldError('value', '数值只填数字')
      return
    }
    this.clearFieldError('value')
    const editingId = this.data.editingId
    if (!editingId) this._id = this._id || requestId()
    this.setData({ submitting: true })
    try {
      await call('customRecord', {
        action: editingId ? 'update' : 'add', ...(editingId ? { id: editingId } : { baby_id: getApp().globalData.activeBabyId, clientRequestId: this._id }),
        category: 'custom', label: this.data.label, value, unit: this.data.unit, note: this.data.note, recordDate: this.data.recordDate
      })
      this._id = ''
      require('../../utils/home-refresh').markSaved(this.data.recordDate)
      wx.showToast({ title: editingId ? '已更新' : '已记录', icon: 'success' }); tap('medium')
      if (this.data.panelMode) { this.closePanel(true); return }
      this.setData({ label: '', value: '', unit: '', note: '', editingId: '' }); this.load()
    } catch (error) { toastError(error) } finally { this.setData({ submitting: false }) }
  }
})
