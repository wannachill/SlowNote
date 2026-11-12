const page = require('../../utils/page')
const { call, requestId } = require('../../utils/api')
const settingsCache = require('../../utils/ai-settings')
const questionsStore = require('../../utils/common-questions')
const { detectRange, rangeLabel } = require('../../utils/digest')
const { tap } = require('../../utils/haptics')
const RANGES = questionsStore.RANGES
const QUESTION_RANGE_LABELS = RANGES.map(item => item.label)
const CATEGORIES = questionsStore.CATEGORIES
const ALL_CATEGORIES = questionsStore.ALL_CATEGORIES
const ACTION_WIDTH_RPX = 220

function categoryPatch(values) {
  const picked = questionsStore.normalizeCategories(values, ALL_CATEGORIES)
  const all = picked.length === ALL_CATEGORIES.length
  return {
    questionCategoryValues: picked,
    questionCategories: CATEGORIES.map(item => ({ ...item, selected: picked.includes(item.value) })),
    questionAllSelected: all,
    questionCategoryHint: all ? '附带全部记录摘要' : picked.length
      ? '附带：' + picked.map(value => (CATEGORIES.find(item => item.value === value) || {}).label).filter(Boolean).join(' · ')
      : '不附带记录数据，仅按问题文字作答'
  }
}

function categoriesLabel(values) {
  const picked = questionsStore.normalizeCategories(values, ALL_CATEGORIES)
  if (!picked.length) return '不带记录'
  if (picked.length === ALL_CATEGORIES.length) return '全部数据'
  const labels = picked.map(value => (CATEGORIES.find(item => item.value === value) || {}).label).filter(Boolean)
  return labels.length > 2 ? `${labels.slice(0, 2).join('·')} 等${labels.length}类` : labels.join('·')
}

function rangeIndexOf(value) {
  const exact = RANGES.findIndex(item => item.value === value)
  if (exact >= 0) return exact
  if (value === 'yesterday') return RANGES.findIndex(item => item.value === 'day')
  if (value === 'lastWeek') return RANGES.findIndex(item => item.value === 'week')
  if (value === 'lastMonth') return RANGES.findIndex(item => item.value === 'month')
  const days = /^(\d+)d$/.exec(String(value || ''))
  if (days) return RANGES.findIndex(item => item.value === (Number(days[1]) <= 7 ? '7d' : Number(days[1]) <= 30 ? '30d' : 'all'))
  return 1
}

function currentValue(showThinking, prompts) { return JSON.stringify({ showThinking, prompts }) }

const SECTIONS = [
  { name: '对话', items: [
    { view: 'thinking', name: '深度思考', note: '显示在小迈聊天页输入框上方的开关' }
  ] },
  { name: '提示词', items: [
    { view: 'style', name: '回答风格', note: '决定小迈怎么组织和表达回答' },
    { view: 'vision', name: '图片分析', note: '看照片时补充的观察要求' },
    { view: 'report', name: '定时报告', note: '按任务频率生成报告内容的指令' }
  ] },
  { name: '内容', items: [
    { view: 'questions', name: '常见问题', note: '小迈页面下方推荐的问题' }
  ] },
  { name: '只读', items: [
    { view: 'safety', name: '固定安全规则', note: '始终生效，不可修改' }
  ] }
]

const VIEW_TITLES = {
  list: '小迈设置', thinking: '深度思考', style: '回答风格', vision: '图片分析',
  report: '定时报告', questions: '常见问题', safety: '固定安全规则'
}

// 云函数不存在、缺依赖、超时都会被 utils/api 统一包装成“网络慢”。
// 这里还原真实原因，否则每次云端问题都会被误判成网络问题。
function failureHint(error) {
  const code = error && error.code
  const server = error && error.serverMessage
  const origin = (error && error.origin) || {}
  const raw = [error && error.message, error && error.errMsg, origin.message, origin.errMsg, origin.code, server].filter(Boolean).join(' ')
  if (/Cannot find module/i.test(raw)) return '云函数缺少共享依赖，请重新部署 aiSettings。'
  if (/FunctionName|ResourceNotFound|FUNCTION_NOT_FOUND|-501000/i.test(raw)) return '云函数 aiSettings 尚未部署。'
  if (/timeout|超时|-504003/i.test(raw)) return '云函数执行超时，请稍后重试。'
  // 这两个字符串只存在于旧版云函数里：当前版本已不再做多余字段校验。
  if (server === 'INVALID_SETTINGS') return '云端仍是旧版云函数（返回 INVALID_SETTINGS）。'
  if (server === 'INVALID_ACTION') return '云函数不支持 get 动作，可能部署到了别的函数。'
  if (code === 400) return '云端拒绝了请求（' + (server || '400') + '）。'
  if (code === 401) return '登录状态已失效，请重新进入小程序。'
  if (code === 503) return '云端服务暂不可用，请查看云函数日志。'
  return '请检查网络后重试。'
}

// 保存失败最常见的原因是集合没建，这种错误必须说清楚，否则用户只会反复重试。
function toastSaveError(error) {
  const title = error && error.code === 501 ? '数据库集合 ai_settings 尚未创建' : (error && error.message) || '暂未完成，请重试'
  wx.showToast({ title, icon: 'none' })
}

page({
  data: {
    ready: false, loading: true, saving: false, dirty: false, error: '',
    view: 'list', navTitle: VIEW_TITLES.list, sections: SECTIONS, values: {},
    showThinking: true, prompts: { style: '', vision: '', report: '' },
    defaults: { style: '', vision: '', report: '' }, limits: {}, custom: {}, safety: '',
    questions: [], questionRanges: QUESTION_RANGE_LABELS,
    questionsPanel: false, questionsClosing: false, questionSaving: false,
    editingQuestionId: '', questionText: '', questionRangeIndex: 1, questionPinned: false,
    ...categoryPatch(ALL_CATEGORIES)
  },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.setData({ statusBarHeight: info.statusBarHeight || 20 })
    this.loadQuestions()
    const cached = settingsCache.readCache()
    if (cached && cached.defaults && cached.prompts && typeof cached.showThinking === 'boolean') {
      this.applySettings(cached, false)
      this.setData({ loading: true })
    }
    this.refreshSettings()
  },
  onShow() { if (this.data.view === 'questions') this.loadQuestions() },
  onHide() {
    this.resetQuestionSwipe()
    if (this.data.questionsPanel) this.setData({ questionsPanel: false, questionsClosing: false, questionSaving: false })
  },
  onUnload() { this.resetQuestionSwipe() },
  applySettings(value, persist = true, cacheOpenid = getApp().globalData.openid || '') {
    const state = {
      ready: true,
      loading: false,
      error: '',
      showThinking: value.showThinking === true,
      prompts: { style: value.prompts.style, vision: value.prompts.vision, report: value.prompts.report },
      defaults: value.defaults,
      limits: value.limits,
      custom: value.custom || {},
      safety: value.safety
    }
    this._savedValue = currentValue(state.showThinking, state.prompts)
    this.setData({ ...state, dirty: false })
    this.syncValues()
    if (persist) settingsCache.writeCache(state, cacheOpenid)
  },
  async refreshSettings() {
    const openid = getApp().globalData.openid || ''
    try {
      const value = await call('aiSettings', { action: 'get' })
      if (openid !== (getApp().globalData.openid || '')) return
      if (!value || !value.defaults || !value.prompts || typeof value.showThinking !== 'boolean') throw new Error('配置数据格式不正确')
      this.applySettings(value, true, openid)
    } catch (error) {
      if (openid !== (getApp().globalData.openid || '')) return
      const hint = failureHint(error)
      if (this.data.ready) this.setData({ loading: false, error: '暂时读不到最新设置，当前显示上次同步的内容。' })
      else this.setData({ loading: false, error: '设置暂时无法加载：' + hint })
    }
  },
  onPromptInput(e) {
    if (this.data.saving) return
    const key = e.currentTarget.dataset.key
    if (!['style', 'vision', 'report'].includes(key)) return
    const value = e.detail.value
    const custom = !!value.trim() && value !== this.data.defaults[key]
    this.setData({ ['prompts.' + key]: value, ['custom.' + key]: custom }, () => {
      this.updateDirty()
      this.syncValues()
    })
  },
  onThinkingToggle(e) {
    if (this.data.saving) return
    this.setData({ showThinking: e.detail.value === true }, () => {
      this.updateDirty()
      this.syncValues()
    })
  },
  updateDirty() {
    this.setData({ dirty: currentValue(this.data.showThinking, this.data.prompts) !== this._savedValue })
  },
  loadQuestions() {
    const questions = questionsStore.loadAll().map(question => {
      const range = question.range || detectRange(question.text) || ''
      return {
        ...question,
        range,
        rangeLabel: rangeLabel(range),
        categoriesLabel: categoriesLabel(question.categories),
        swipeX: question.id === this._openSwipeKey ? -this.questionActionWidth() : 0
      }
    })
    this.setData({ questions }, () => this.syncValues())
  },
  refreshQuestions() { this.loadQuestions() },
  syncValues() {
    const custom = this.data.custom || {}
    this.setData({ values: {
      thinking: this.data.showThinking ? '已开启' : '已关闭',
      style: custom.style ? '已自定义' : '默认',
      vision: custom.vision ? '已自定义' : '默认',
      report: custom.report ? '已自定义' : '默认',
      questions: (this.data.questions || []).length + ' 条',
      safety: '不可修改'
    } })
  },
  openSection(e) {
    const view = e.currentTarget.dataset.view
    if (!Object.prototype.hasOwnProperty.call(VIEW_TITLES, view) || view === 'list') return
    this.setData({ view, navTitle: VIEW_TITLES[view] }, () => {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 })
      if (view === 'questions') this.loadQuestions()
    })
  },
  showSections() {
    this.resetQuestionSwipe()
    if (this.data.questionsPanel) this.setData({ questionsPanel: false, questionsClosing: false })
    this.setData({ view: 'list', navTitle: VIEW_TITLES.list }, () => {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    })
  },
  questionActionWidth() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    return ACTION_WIDTH_RPX * (info.windowWidth || 375) / 750
  },
  resetQuestionForm() {
    this.closeQuestionSwipe()
    this.setData({ editingQuestionId: '', questionText: '', questionRangeIndex: 1, questionPinned: false, ...categoryPatch(ALL_CATEGORIES) })
  },
  onQuestionCategoryTap(event) {
    const value = event.currentTarget.dataset.value
    if (!ALL_CATEGORIES.includes(value)) return
    const current = this.data.questionCategoryValues || []
    const next = current.includes(value) ? current.filter(item => item !== value) : current.concat(value)
    this.setData(categoryPatch(next))
  },
  toggleAllQuestionCategories() {
    this.setData(categoryPatch(this.data.questionAllSelected ? [] : ALL_CATEGORIES))
  },
  openQuestionPanel() {
    tap()
    this.resetQuestionForm()
    this.setData({ questionsPanel: true, questionsClosing: false })
  },
  closeQuestionPanel() {
    if (this.data.questionsClosing || this.data.questionSaving) return
    this.setData({ questionsClosing: true })
    require('../../utils/motion').closeLater(this, () => this.setData({ questionsPanel: false, questionsClosing: false }))
  },
  startEditQuestion(event) {
    const id = event.currentTarget.dataset.id
    const question = this.data.questions.find(item => item.id === id)
    if (!question) return
    this.closeQuestionSwipe()
    tap()
    this.setData({
      editingQuestionId: id,
      questionText: question.text,
      questionRangeIndex: rangeIndexOf(question.range || detectRange(question.text) || ''),
      questionPinned: !!question.pinned,
      ...categoryPatch(question.categories),
      questionsPanel: true,
      questionsClosing: false
    })
  },
  onQuestionInput(event) { this.setData({ questionText: event.detail.value }) },
  onQuestionRange(event) {
    const index = Number(event.detail.value)
    if (Number.isInteger(index) && index >= 0 && index < RANGES.length) this.setData({ questionRangeIndex: index })
  },
  onQuestionPin(event) {
    this.motionSettingChange(event)
    this.setData({ questionPinned: event.detail.value === true })
  },
  saveQuestion() {
    if (this.data.questionSaving) return
    const text = (this.data.questionText || '').trim()
    if (!text) { wx.showToast({ title: '请输入问题内容', icon: 'none' }); return }
    if (text.length > 40) { wx.showToast({ title: '问题最多 40 字', icon: 'none' }); return }
    const range = RANGES[this.data.questionRangeIndex] || RANGES[1]
    const categories = questionsStore.normalizeCategories(this.data.questionCategoryValues, ALL_CATEGORIES)
    const editingId = this.data.editingQuestionId
    const questions = questionsStore.loadAll()
    if (questions.some(question => question.id !== editingId && question.text === text)) {
      wx.showToast({ title: '已存在相同问题', icon: 'none' })
      return
    }
    let next
    if (editingId) {
      if (!questions.some(question => question.id === editingId)) return
      next = questions.map(question => question.id === editingId
        ? { ...question, text, range: range.value, pinned: this.data.questionPinned, categories }
        : question)
    } else {
      next = questions.concat({
        id: 'q' + requestId(), text, range: range.value, builtin: false, pinned: this.data.questionPinned, categories
      })
    }
    this.setData({ questionSaving: true })
    let saved = false
    try {
      questionsStore.saveAll(next)
      this.loadQuestions()
      wx.showToast({ title: editingId ? '问题已修改' : '问题已添加', icon: 'success' })
      saved = true
    } catch (error) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ questionSaving: false })
    }
    if (saved) this.closeQuestionPanel()
  },
  onQuestionCardTouchStart(event) {
    const touch = event.touches && event.touches[0], id = event.currentTarget.dataset.id
    const target = event.target && event.target.dataset || {}
    if (!touch || !id || target.noSwipe) return
    const question = this.data.questions.find(item => item.id === id)
    this._cardGesture = { id, x: touch.clientX, y: touch.clientY, startOffset: question ? question.swipeX || 0 : 0, axis: '' }
  },
  onQuestionCardTouchMove(event) {
    const gesture = this._cardGesture, touch = event.touches && event.touches[0]
    if (!gesture || !touch) return
    const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y
    if (!gesture.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'horizontal' : 'vertical'
    if (gesture.axis !== 'horizontal') return
    if (dx < -8 && this._openSwipeKey && this._openSwipeKey !== gesture.id) this.closeQuestionSwipe()
    const offset = Math.max(-this.questionActionWidth(), Math.min(0, gesture.startOffset + dx))
    this.setData({ questions: this.data.questions.map(item => ({ ...item, swipeX: item.id === gesture.id ? offset : item.swipeX })) })
    if (Math.abs(dx) > 12) this._ignoreCardTapUntil = Date.now() + 450
  },
  onQuestionCardTouchEnd() {
    const gesture = this._cardGesture
    if (!gesture) return
    if (gesture.axis === 'horizontal') {
      const question = this.data.questions.find(item => item.id === gesture.id)
      if (question && question.swipeX < -this.questionActionWidth() * .42) this.openQuestionSwipe(gesture.id)
      else this.closeQuestionSwipe()
    }
    this._cardGesture = null
  },
  closeQuestionSwipe() {
    this._openSwipeKey = ''
    if (this.data.questions.some(item => item.swipeX)) this.setData({ questions: this.data.questions.map(item => ({ ...item, swipeX: 0 })) })
  },
  openQuestionSwipe(id) {
    this._openSwipeKey = id
    const offset = -this.questionActionWidth()
    this.setData({ questions: this.data.questions.map(item => ({ ...item, swipeX: item.id === id ? offset : 0 })) })
    this._ignoreCardTapUntil = Date.now() + 450
  },
  onQuestionCardTap(event) {
    const question = this.data.questions.find(item => item.id === event.currentTarget.dataset.id)
    if (question && question.swipeX < 0) this.closeQuestionSwipe()
  },
  resetQuestionSwipe() {
    this._cardGesture = null
    this._openSwipeKey = ''
    this._ignoreCardTapUntil = 0
    if ((this.data.questions || []).some(item => item.swipeX)) this.setData({ questions: this.data.questions.map(item => ({ ...item, swipeX: 0 })) })
  },
  removeQuestion(e) {
    const id = e.currentTarget.dataset.id
    const question = questionsStore.loadAll().find(item => item.id === id)
    if (!question) return
    this.closeQuestionSwipe()
    this.confirmDanger({
      object: question.text,
      title: '删除问题',
      content: question.builtin ? '删除后该默认问题将不再展示，可在上方「恢复默认」中找回。' : '删除后该问题将不再展示。',
      confirmText: '删除',
      success: result => {
        if (!result.confirm) return
        questionsStore.saveAll(questionsStore.loadAll().filter(item => item.id !== id))
        this.loadQuestions()
      }
    })
  },
  restoreBuiltinQuestions() {
    const custom = questionsStore.loadAll().filter(question => !question.builtin)
    const defaults = questionsStore.DEFAULT_POOL.map((question, index) => ({
      id: 'd' + (index + 1), text: question.text, builtin: true, pinned: false,
      categories: questionsStore.normalizeCategories(question.categories, ALL_CATEGORIES)
    }))
    questionsStore.saveAll(defaults.concat(custom))
    this.refreshQuestions()
  },
  onRestoreQuestions() {
    if (this.data.saving) return
    this.confirmDanger({
      title: '恢复内置常见问题',
      content: '将还原系统内置问题，被删除的内置问题会找回；你自定义的问答会保留。',
      confirmText: '恢复默认',
      success: result => {
        if (!result.confirm) return
        this.restoreBuiltinQuestions()
        wx.showToast({ title: '已恢复默认问题', icon: 'success' })
      }
    })
  },
  async save() {
    if (!this.data.ready || this.data.saving || !this.data.dirty) return
    const openid = getApp().globalData.openid || ''
    this.setData({ saving: true, error: '' })
    try {
      const value = await call('aiSettings', {
        action: 'save',
        showThinking: this.data.showThinking,
        prompts: this.data.prompts
      })
      if (openid !== (getApp().globalData.openid || '')) return
      this.applySettings(value, true, openid)
      wx.showToast({ title: '小迈设置已保存', icon: 'success' })
    } catch (error) { toastSaveError(error) }
    finally { this.setData({ saving: false }) }
  },
  restoreDefaults() {
    if (!this.data.ready || this.data.saving) return
    this.confirmDanger({
      title: '恢复小迈默认设置',
      content: '将恢复默认提示词、重新显示深度思考按钮，并恢复内置常见问题。自定义问题会保留。',
      confirmText: '恢复默认',
      success: async result => {
        if (!result.confirm) return
        const openid = getApp().globalData.openid || ''
        this.setData({ saving: true, error: '' })
        try {
          const value = await call('aiSettings', { action: 'reset' })
          if (openid !== (getApp().globalData.openid || '')) return
          this.applySettings(value, true, openid)
          this.restoreBuiltinQuestions()
          wx.showToast({ title: '已恢复默认设置', icon: 'success' })
        } catch (error) { toastSaveError(error) }
        finally { this.setData({ saving: false }) }
      }
    })
  },
  onBack() {
    if (this.data.view !== 'list') {
      this.showSections()
      return
    }
    const leave = () => {
      const pages = getCurrentPages()
      if (pages.length > 1) wx.navigateBack()
      else wx.switchTab({ url: '/pages/mine/index' })
    }
    if (!this.data.dirty) { leave(); return }
    this.confirmDanger({
      title: '放弃未保存的更改？',
      content: '离开后，本次修改不会保存。',
      confirmText: '放弃更改',
      success: result => { if (result.confirm) leave() }
    })
  }
})
