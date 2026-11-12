// Presentation state only. No API calls, storage, navigation or business validation.
const DURATION = { sheet: 400, feedback: 350, setting: 300, error: 250 }
function later(page, key, callback, delay) {
  page._motionTimers = page._motionTimers || {}
  clearTimeout(page._motionTimers[key])
  page._motionTimers[key] = setTimeout(() => {
    delete page._motionTimers[key]
    if (!page._motionInactive) callback()
  }, delay)
}
function reset() {
  this._motionInactive = false
}
function dispose() {
  this._motionInactive = true
  Object.keys(this._motionTimers || {}).forEach(key => clearTimeout(this._motionTimers[key]))
  this._motionTimers = {}
  this._motionConfirmOptions = null
  this._motionConfirmSettling = false
  this._motionThemeOrigin = null
  this._motionThemePrepared = false
  this._motionRippleVersion = (this._motionRippleVersion || 0) + 1
  this.setData({ motionRippleId: '', motionChoiceGroup: '', motionSetting: false, motionConfirm: null, themeReveal: false, themeBefore: null, fieldShake: '' })
  // A hidden page must not return with an interrupted closing state.
  if (this.data.closing) {
    const patch = { closing: false }
    if (!this.data.panelMode && Object.prototype.hasOwnProperty.call(this.data, 'panel')) patch.panel = typeof this.data.panel === 'string' ? '' : false
    if (Object.prototype.hasOwnProperty.call(this.data, 'sheet')) patch.sheet = null
    if (Object.prototype.hasOwnProperty.call(this.data, 'showJoin')) patch.showJoin = false
    this.setData(patch)
  }
  require('./reveal').dispose(this)
}
const methods = {
  motionPress(e) {
    if (this._motionInactive || !e.currentTarget.id || !wx.createSelectorQuery) return
    const id = e.currentTarget.id, point = (e.touches && e.touches[0]) || e.detail || {}
    const version = this._motionRippleVersion = (this._motionRippleVersion || 0) + 1
    const query = wx.createSelectorQuery().in(this)
    query.select('#' + id).fields({ rect: true, size: true }, rect => {
      if (!rect || !rect.width || !rect.height || this._motionInactive || version !== this._motionRippleVersion) return
      const x = Number.isFinite(point.clientX) ? point.clientX - rect.left : rect.width / 2
      const y = Number.isFinite(point.clientY) ? point.clientY - rect.top : rect.height / 2
      const size = Math.ceil(Math.hypot(rect.width, rect.height) * 2)
      this.setData({ motionRippleId: id, motionRipplePhase: version % 2 ? 'a' : 'b', motionRippleStyle: '--ripple-x:' + x + 'px;--ripple-y:' + y + 'px;--ripple-size:' + size + 'px;' })
      later(this, 'ripple', () => this.setData({ motionRippleId: '' }), DURATION.feedback)
    }).exec()
  },
  motionChoose(e) {
    if (this._motionInactive || this.data.submitting || this.data.sending || this.data.saving || this.data.attaching) return
    const { motionGroup, motionIndex } = e.currentTarget.dataset
    this.setData({ motionChoiceGroup: '', motionChoiceIndex: Number(motionIndex) || 0 }, () => {
      if (!this._motionInactive) this.setData({ motionChoiceGroup: motionGroup || '' })
    })
    later(this, 'choice', () => this.setData({ motionChoiceGroup: '' }), DURATION.feedback)
  },
  motionSettingChange(e) {
    if (this._motionInactive) return
    this.setData({ motionSetting: false, motionSettingKey: e && e.currentTarget && e.currentTarget.dataset.id || '' }, () => { if (!this._motionInactive) this.setData({ motionSetting: true }) })
    later(this, 'setting', () => this.setData({ motionSetting: false }), DURATION.setting)
  },
  showFieldError(field, text) {
    this.setData({ ['fieldErrors.' + field]: text, fieldShake: '' }, () => { if (!this._motionInactive) this.setData({ fieldShake: field }) })
    later(this, 'error', () => this.setData({ fieldShake: '' }), DURATION.error)
  },
  clearFieldError(field) {
    if (this.data.fieldErrors[field]) this.setData({ ['fieldErrors.' + field]: '', fieldShake: '' })
  },
  captureThemeOrigin(e) {
    const point = e.touches && e.touches[0]
    if (point) this._motionThemeOrigin = { x: point.clientX, y: point.clientY }
  },
  prepareThemeReveal(pref) {
    const next = require('./theme').resolve(pref)
    if (next.themeClass === this.data.themeClass) return
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const width = info.windowWidth || 375, height = info.windowHeight || 800
    const point = this._motionThemeOrigin || { x: width / 2, y: Math.min(height / 2, (this.data.statusBarHeight || 20) + 100) }
    const x = Math.max(0, Math.min(width, point.x)), y = Math.max(0, Math.min(height, point.y))
    const radius = Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y)))
    const { themeClass, themeAccent, statusBarHeight, themeStatus } = this.data
    // Freeze the old visual behind the live page. Storage/sync still happens immediately.
    this.setData({ themeBefore: { themeClass, themeAccent, statusBarHeight, themeStatus, motionFrozen: true }, themeReveal: false,
      themeRevealStyle: '--reveal-x:' + x + 'px;--reveal-y:' + y + 'px;--reveal-radius:' + radius + 'px;' })
    this._motionThemePrepared = true
  },
  confirmDanger(options) {
    if (this._motionConfirmOptions || this._motionInactive) return
    this._motionConfirmOptions = options
    this.setData({ motionConfirm: { title: options.title, content: options.content, object: options.object || '', confirmText: options.confirmText || '删除', closing: false } })
  },
  cancelDanger() { this.finishDanger(false) },
  acceptDanger() { this.finishDanger(true) },
  finishDanger(confirm) {
    if (!this._motionConfirmOptions || this._motionConfirmSettling) return
    this._motionConfirmSettling = true
    this.setData({ 'motionConfirm.closing': true })
    later(this, 'confirm', () => {
      const options = this._motionConfirmOptions
      this._motionConfirmOptions = null
      this._motionConfirmSettling = false
      this.setData({ motionConfirm: null })
      const result = { confirm, cancel: !confirm, errMsg: 'showModal:ok' }
      if (options && options.success) options.success(result)
      if (options && options.complete) options.complete(result)
    }, DURATION.sheet)
  },
  motionBlock() {}
}
function afterTheme(page) {
  if (!page._motionThemePrepared) return
  page._motionThemePrepared = false
  page.setData({ themeReveal: true })
  later(page, 'theme', () => page.setData({ themeReveal: false, themeBefore: null }), DURATION.sheet)
}
module.exports = { methods, reset, dispose, afterTheme, DURATION, closeLater: (page, callback) => later(page, 'sheet', callback, DURATION.sheet),
  data: { fieldErrors: {}, fieldShake: '', motionRippleId: '', motionRippleStyle: '', motionRipplePhase: 'a', motionChoiceGroup: '', motionChoiceIndex: -1, motionSetting: false, motionSettingKey: '', motionConfirm: null, themeReveal: false, themeBefore: null, themeRevealStyle: '' } }
