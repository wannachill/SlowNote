const app = getApp(), page = require('../../utils/page'), { call, requestId } = require('../../utils/api')
const { fetchSnapshot, detectRange, rangeLabel } = require('../../utils/digest')
const photos = require('../../utils/ai-photos')
const store = require('../../utils/common-questions')
const sessions = require('../../utils/ai-sessions')
const parseMarkdown = require('../../utils/markdown')
const aiSettings = require('../../utils/ai-settings')
const SNAPSHOT_PREVIEW_LINES = 5
const INPUT_HOLD_MS = 350
const INPUT_HOLD_MOVE_TOLERANCE = 12
page({
  data: { messages: [], messageViews: [], typingMessageId: '', activeMessageId: '', activeMessageIndex: -1, activeQuestionSummary: '', pickMode: false, picked: {}, pickedCount: 0, editing: null, quote: null, focusInput: false, thinkOpen: {}, question: '', images: [], liveTranscript: '', selecting: false, sending: false, keyboardHeight: 0, scrollInto: '', showJumpBottom: false, error: '', attachLabel: '', attaching: false, commonList: [], showThinking: false, thinkingSettingsReady: false, statusBarHeight: 20 },
  onLoad(options) {
    this._disposed = false
    this._batch = []
    this._nodeCache = Object.create(null)
    this._reasonCache = Object.create(null)
    this._autoFollow = true
    const id = options && options.sessionId
    this._sessionId = id || ('s' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
    const cachedSettings = aiSettings.readCache()
    const hasCachedThinkingSetting = cachedSettings && typeof cachedSettings.showThinking === 'boolean'
    const showThinking = false
    let seedQuestion = ''
    if (options && typeof options.seed === 'string' && options.seed) {
      try { seedQuestion = decodeURIComponent(options.seed) } catch (error) { seedQuestion = options.seed }
    }
    this.setData({ showThinking, thinking: false, thinkingSettingsReady: hasCachedThinkingSetting && !cachedSettings.showThinking, ...(seedQuestion ? { question: seedQuestion, focusInput: true } : {}) })
    this.buildCommon()
    if (id) this.loadSession(id)
  },
  onShow() { this.refreshAISettings() },
  onReady() { this.measureList() },
  async refreshAISettings() {
    const openid = app.globalData.openid || ''
    try {
      const settings = await call('aiSettings', { action: 'get' })
      if (openid !== (app.globalData.openid || '')) return
      if (typeof settings.showThinking !== 'boolean') {
        this.setData({ showThinking: false, thinking: false, thinkingSettingsReady: true })
        return
      }
      aiSettings.writeCache(settings, openid)
      let thinkingPreference = false
      try { thinkingPreference = wx.getStorageSync('ai.thinking') === true } catch (error) {}
      this.setData({ showThinking: settings.showThinking, thinking: settings.showThinking && thinkingPreference, thinkingSettingsReady: true })
    } catch (error) {
      this.setData({ showThinking: false, thinking: false, thinkingSettingsReady: true })
    }
  },
  onUnload() {
    this.clearInputHold()
    this._inputTouchActive = false
    const stopVoice = this._voiceActive && !this._voiceStopping
    const voiceMode = this._voiceMode
    this._disposed = true
    this._voiceCancelled = true
    this._voiceStopping = false
    this._voiceActive = false
    this.data.liveTranscript = ''
    this.data.recording = false
    this.data.selecting = false
    if (stopVoice) {
      try {
        if (voiceMode === 'plugin' && this._siManager) this._siManager.stop()
        else if (voiceMode === 'recorder' && this._recorder) this._recorder.stop()
      } catch (error) {}
    }
    this._cancelTyping()
    this._cancelReasoningPlayback()
  },
  onInput(e) { if (!this.data.sending && !this.data.attaching) this.setData({ question: e.detail.value }) },
  onKeyboardHeight(e) {
    if (this._disposed) return
    this.setData({ keyboardHeight: Math.max(0, Number(e.detail.height) || 0) }, () => {
      this.measureList(() => this._forceFollow())
    })
  },
  measureList(done) {
    if (this._disposed) return
    wx.createSelectorQuery().in(this).select('.chat-list').boundingClientRect(rect => {
      if (rect && rect.height) this._listHeight = rect.height
      if (done) done()
    }).exec()
  },
  _followPatch(patch) {
    if (!this._autoFollow) return patch
    const next = this.data.scrollInto === 'chat-bottom-a' ? 'chat-bottom-b' : 'chat-bottom-a'
    return { ...patch, scrollInto: next }
  },
  _forceFollow() {
    this._autoFollow = true
    const patch = this._followPatch({ showJumpBottom: false })
    this.setData(patch)
  },
  onChatScroll(e) {
    if (!this._listHeight) return
    const { scrollTop, scrollHeight } = e.detail
    const distance = scrollHeight - scrollTop - this._listHeight
    const atBottom = distance <= 80
    if (atBottom === this._autoFollow && atBottom === !this.data.showJumpBottom) return
    this._autoFollow = atBottom
    if (this.data.showJumpBottom !== !atBottom) this.setData({ showJumpBottom: !atBottom })
  },
  jumpToBottom() {
    this._autoFollow = true
    this.setData(this._followPatch({ showJumpBottom: false }))
  },
  // —— 常问问题：固定问题 + 内置随机一批，默认展示、可换一批 ——
  buildCommon() {
    const all = store.loadAll()
    const pinned = all.filter(q => q.pinned)
    const batch = this._batch.length ? this._batch : (this._batch = store.batch(all, 4))
    this.setData({ commonList: pinned.concat(batch) })
  },
  refreshCommon() {
    const all = store.loadAll()
    const next = store.batch(all, 4)
    const cur = this.data.commonList.map(s => s.text).join('|')
    this._batch = next.map(s => s.text).join('|') === cur ? store.batch(all, 4) : next
    this.buildCommon()
  },
  // —— 新建对话 / 历史对话 ——
  newSession() {
    if (this.data.sending || this.data.selecting || this.data.attaching || this.data.pickMode) return
    if (!this.data.messages.length) { wx.showToast({ title: '当前已经是新对话', icon: 'none' }); return }
    wx.showModal({
      title: '开始新对话',
      content: '当前对话已自动保存。',
      confirmText: '开始新对话', cancelText: '取消',
      success: res => {
        if (!res.confirm || this._disposed) return
        this._cancelTyping()
        this._cancelReasoningPlayback()
        this._sessionId = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        this._nodeCache = Object.create(null)
        this._reasonCache = Object.create(null)
        this._typingMessageId = ''
        this._autoFollow = true
        this.setData(this._followPatch({ messages: [], messageViews: [], typingMessageId: '', activeMessageId: '', activeMessageIndex: -1, activeQuestionSummary: '', pickMode: false, picked: {}, pickedCount: 0, editing: null, quote: null, focusInput: false, thinkOpen: {}, question: '', images: [], error: '', showJumpBottom: false }))
      }
    })
  },
  openHistory() {
    if (this.data.sending || this.data.attaching || this.data.pickMode) return
    wx.navigateTo({
      url: '/pages/ai-history/index',
      success: res => {
        this._historyChannel = res.eventChannel
        res.eventChannel.on('select', id => this.loadSession(id))
      }
    })
  },
  onThinkingChange(e) {
    if (!this.data.showThinking || this.data.sending || this.data.attaching) return
    const next = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.next
    // switch 已移除，保留 detail 分支是为了兼容既有测试。
    const thinking = next === undefined ? e.detail.value === true : next === true || next === 'true'
    try { wx.setStorageSync('ai.thinking', thinking) } catch (error) {}
    this.setData({ thinking, error: '' })
  },
  async loadSession(id) {
    if (!id || this._loading || this._disposed) return
    this._cancelTyping()
    this._cancelReasoningPlayback()
    this._loading = true
    wx.showLoading({ title: '载入对话…', mask: true })
    try {
      const doc = await sessions.getSession(app.globalData.openid || '', id)
      if (this._disposed) return
      wx.hideLoading()
      if (!doc || !Array.isArray(doc.messages) || !doc.messages.length) { wx.showToast({ title: '对话不存在或已删除', icon: 'none' }); return }
      const messages = doc.messages.map(m => ({ ...m, images: (m.images || []).map(f => ({ id: f, path: f })) }))
      this._sessionId = id
      this._nodeCache = Object.create(null)
      this._reasonCache = Object.create(null)
      this._autoFollow = true
      this.setData(this._followPatch({ messages, messageViews: this._messageViews(messages, {}), typingMessageId: '', activeMessageId: '', activeMessageIndex: -1, activeQuestionSummary: '', pickMode: false, picked: {}, pickedCount: 0, editing: null, quote: null, focusInput: false, thinkOpen: {}, question: '', images: [], error: '', showJumpBottom: false }))
      wx.showToast({ title: '已载入历史对话', icon: 'none' })
    } catch (error) {
      if (!this._disposed) { wx.hideLoading(); wx.showToast({ title: '载入失败，请稍后重试', icon: 'none' }) }
    } finally { this._loading = false }
  },
  _persist() {
    if (!this.data.messages.length) {
      sessions.removeSession(app.globalData.openid || '', this._sessionId).catch(() => {})
      return
    }
    sessions.saveSession(app.globalData.openid || '', this._sessionId, this.data.messages)
  },
  _reasonNodes(message) {
    const reasons = this._reasonCache || (this._reasonCache = Object.create(null))
    if (!message.reasoning) return []
    return Object.prototype.hasOwnProperty.call(reasons, message.id)
      ? reasons[message.id]
      : (reasons[message.id] = parseMarkdown(message.reasoning))
  },
  _thinkLabel(message) {
    if (!message.thinking && !message.reasoning) return ''
    if (!message.reasoning) return '已深度思考 · 本次未返回思考过程'
    return (message.thinkingMs || 0) > 0 ? `已深度思考（用时 ${Math.round(message.thinkingMs / 1000)} 秒）` : '已深度思考'
  },
  _messageViews(messages, picked = this.data.picked || {}) {
    const cache = this._nodeCache || (this._nodeCache = Object.create(null))
    let currentUserId = ''
    return (messages || []).map(message => {
      if (message.role === 'user') currentUserId = message.id
      const pairUserId = message.role === 'user' ? message.id : currentUserId
      return {
        ...message,
        snapshotPreview: String(message.snapshot || '').split('\n').slice(0, SNAPSHOT_PREVIEW_LINES).join('\n'),
        snapshotHasMore: String(message.snapshot || '').split('\n').length > SNAPSHOT_PREVIEW_LINES || Array.from(String(message.snapshot || '')).length > SNAPSHOT_PREVIEW_LINES * 32,
        snapshotExpanded: !!message.snapshotExpanded,
        pairUserId,
        pickUser: message.role === 'user',
        pickSelected: !!(pairUserId && picked[pairUserId]),
        nodes: Object.prototype.hasOwnProperty.call(cache, message.id)
          ? cache[message.id]
          : (cache[message.id] = parseMarkdown(message.content)),
        reasonNodes: this._reasonNodes(message),
        thinkLabel: this._thinkLabel(message)
      }
    })
  },
  toggleThink(e) { const id = e.currentTarget.dataset.id; if (id) this.setData({ ['thinkOpen.' + id]: !this.data.thinkOpen[id] }) },
  toggleSnapshot(e) {
    const index = Number(e.currentTarget.dataset.i)
    const message = this.data.messages[index]
    if (!message || !message.snapshot) return
    const messages = this.data.messages.slice()
    messages[index] = { ...message, snapshotExpanded: !message.snapshotExpanded }
    this.setData({ messages, messageViews: this._messageViews(messages) })
  },
  showMessageActions(e) {
    const message = this.data.messages[Number(e.currentTarget.dataset.i)]
    if (message) this.setData({ activeMessageId: message.id })
  },
  onQuestionLongPress(e) {
    if (this.data.sending || this.data.typingMessageId || this.data.selecting || this.data.recording || this.data.attaching || this.data.pickMode) return
    const message = this.data.messages[Number(e.currentTarget.dataset.i)]
    if (message && message.role === 'user') {
      this.setData({ activeMessageIndex: Number(e.currentTarget.dataset.i), activeQuestionSummary: Array.from(message.content || '').slice(0, 20).join('') })
      this.showMessageActions(e)
    }
  },
  onMessageTap(e) {
    const index = Number(e.currentTarget.dataset.i)
    if (this.data.pickMode) { this.togglePickedPair(index); return }
    const message = this.data.messages[index]
    if (this.data.activeMessageId && message && message.id !== this.data.activeMessageId) this.dismissMessageActions()
  },
  dismissMessageActions() { if (this.data.activeMessageId) this.setData({ activeMessageId: '' }) },
  quoteMessage(e) {
    const message = this.data.messages[Number(e.currentTarget.dataset.i)]
    if (!message || !message.content || this.data.sending) { this.dismissMessageActions(); return }
    this.dismissMessageActions()
    this.setData({ quote: { role: message.role, text: Array.from(message.content).slice(0, 200).join('') }, focusInput: true })
  },
  clearQuote() { this.setData({ quote: null, focusInput: false }) },
  editMessage(e) {
    const message = this.data.messages[Number(e.currentTarget.dataset.i)]
    this.dismissMessageActions()
    if (!message || message.role !== 'user' || this.data.sending) return
    if (message.images && message.images.length) wx.showToast({ title: '原照片已清理，本次按文字提问', icon: 'none' })
    this._editingDraft = { question: this.data.question, images: this.data.images.slice(), quote: this.data.quote }
    this.setData({ editing: { id: message.id }, question: message.content || '', images: [], quote: null, focusInput: true })
  },
  cancelEditing() {
    const draft = this._editingDraft || { question: '', images: [], quote: null }
    this._editingDraft = null
    this.setData({ editing: null, ...draft, focusInput: false })
  },
  beginPickMode() {
    const index = this.data.activeMessageIndex
    const message = this.data.messages[this.data.activeMessageIndex]
    this.dismissMessageActions()
    if (!message || this.data.sending || this.data.typingMessageId || this.data.selecting || this.data.recording || this.data.attaching) return
    const user = message.role === 'user' ? message : this.data.messages.slice(0, index).reverse().find(item => item.role === 'user')
    if (!user) return
    const picked = { [user.id]: true }
    this.setData({ pickMode: true, picked, pickedCount: 1, messageViews: this._messageViews(this.data.messages, picked) })
  },
  togglePickedPair(index) {
    const message = this.data.messageViews[index]
    const userId = message && message.pairUserId
    if (!this.data.pickMode || !userId) return
    const picked = { ...this.data.picked }
    if (picked[userId]) delete picked[userId]
    else picked[userId] = true
    this.setData({ picked, pickedCount: Object.keys(picked).length, messageViews: this._messageViews(this.data.messages, picked) })
  },
  cancelPickMode() { this.setData({ pickMode: false, picked: {}, pickedCount: 0, messageViews: this._messageViews(this.data.messages, {}) }) },
  deletePicked() {
    const ids = Object.keys(this.data.picked || {})
    if (!ids.length || this.data.sending || this.data.typingMessageId) return
    wx.showModal({
      title: '删除问答',
      content: `将删除 ${ids.length} 组问答，删除后无法恢复`,
      confirmText: '删除', cancelText: '取消',
      success: result => {
        if (!result.confirm || this._disposed) return
        const selected = new Set(ids), removed = new Set()
        let currentUserId = ''
        const messages = this.data.messages.filter(message => {
          if (message.role === 'user') currentUserId = message.id
          const pairUserId = message.role === 'user' ? message.id : currentUserId
          if (selected.has(pairUserId)) { removed.add(message.id); return false }
          return true
        })
        removed.forEach(id => { delete this._nodeCache[id]; delete this._reasonCache[id] })
        this.setData({ pickMode: false, picked: {}, pickedCount: 0, messages, messageViews: this._messageViews(messages, {}) })
        this._persist()
      }
    })
  },
  _cancelTyping() {
    if (this._typingTimer) clearTimeout(this._typingTimer)
    this._typingTimer = null
    this._typingMessageId = ''
    if (this._typingResolve) { const resolve = this._typingResolve; this._typingResolve = null; resolve(false) }
  },
  _cancelReasoningPlayback() {
    if (this._reasoningTimer) clearTimeout(this._reasoningTimer)
    this._reasoningTimer = null
    this._reasoningMessageId = ''
    if (this._reasoningResolve) { const resolve = this._reasoningResolve; this._reasoningResolve = null; resolve(false) }
  },
  _playReasoning(message) {
    const content = message && message.reasoning
    if (!content) return Promise.resolve(true)
    const chars = Array.from(content)
    const total = chars.length
    const interval = 60
    const steps = 18
    const index = this.data.messages.findIndex(item => item.id === message.id)
    if (index < 0) return Promise.resolve(false)
    const nodesKey = `messageViews[${index}].reasonNodes`
    this._reasoningMessageId = message.id
    return new Promise(resolve => {
      this._reasoningResolve = resolve
      let frame = 0
      const tick = () => {
        if (this._disposed || this._reasoningMessageId !== message.id) {
          this._reasoningTimer = null
          if (this._reasoningResolve === resolve) this._reasoningResolve = null
          resolve(false)
          return
        }
        frame += 1
        const cursor = Math.min(total, Math.ceil(total * frame / steps))
        const patch = this._followPatch({})
        if (frame >= steps) {
          this._reasonCache[message.id] = parseMarkdown(content)
          patch[nodesKey] = this._reasonCache[message.id]
          patch[`messageViews[${index}].thinkLabel`] = this._thinkLabel(message)
          patch[`messageViews[${index}].reasoningPlaying`] = false
          this._reasoningTimer = null
          this._reasoningMessageId = ''
          this.setData(patch, () => {
            if (this._reasoningResolve === resolve) this._reasoningResolve = null
            resolve(true)
          })
          return
        }
        patch[nodesKey] = parseMarkdown(chars.slice(0, cursor).join(''))
        this.setData(patch)
        this._reasoningTimer = setTimeout(tick, interval)
      }
      this._reasoningTimer = setTimeout(tick, interval)
    })
  },
  _startTyping(messageId, content) {
    if (!content) {
      this.setData(this._followPatch({ typingMessageId: '', messageViews: this._messageViews(this.data.messages) }))
      return Promise.resolve()
    }
    const chars = Array.from(content)
    const total = chars.length
    const targetMs = Math.max(1200, Math.min(2000, total * 8))
    const interval = 80
    const steps = Math.max(1, Math.ceil(targetMs / interval))
    const step = Math.max(1, Math.ceil(total / steps))
    this._typingMessageId = messageId
    const typingIndex = this.data.messages.findIndex(m => m.id === messageId)
    const nodesKey = 'messageViews[' + typingIndex + '].nodes'
    return new Promise(resolve => {
      this._typingResolve = resolve
      let index = 0
      const tick = () => {
        if (this._disposed || this._typingMessageId !== messageId) {
          this._typingTimer = null
          if (this._typingResolve === resolve) this._typingResolve = null
          resolve()
          return
        }
        index = Math.min(total, index + step)
        const shown = chars.slice(0, index).join('')
        if (index >= total) {
          this._typingTimer = null
          this._typingMessageId = ''
          this.setData(this._followPatch({ typingMessageId: '', messageViews: this._messageViews(this.data.messages) }), () => {
            if (this._typingResolve === resolve) this._typingResolve = null
            resolve()
          })
          return
        }
        const patch = this._followPatch({})
        patch[nodesKey] = parseMarkdown(shown)
        this.setData(patch)
        this._typingTimer = setTimeout(tick, interval)
      }
      tick()
    })
  },
  _copyMessage(index) {
    const message = this.data.messages[index]
    if (!message || !message.content) return
    wx.setClipboardData({ data: message.content, success: () => wx.showToast({ title: '已复制', icon: 'none' }) })
  },
  copyMessage(e) {
    const index = Number(e.currentTarget.dataset.i)
    this.dismissMessageActions()
    this._copyMessage(index)
  },
  // —— 图片 ——
  async choosePhotos() {
    if (this.data.sending || this.data.selecting || this.data.attaching || this.data.images.length >= 3) return
    this.setData({ selecting: true, error: '' })
    try {
      const images = await photos.choose(3 - this.data.images.length)
      if (!this._disposed) {
        const updates = { images: this.data.images.concat(images) }
        if (this.data.showThinking && !this.data.thinking) updates.thinking = true
        this.setData(updates)
      }
    } catch (error) { if (!this._disposed) this.setData({ error: error.message }) }
    finally { if (!this._disposed) this.setData({ selecting: false }) }
  },
  removePhoto(e) {
    if (!this.data.sending && !this.data.selecting) this.setData({ images: this.data.images.filter(p => p.id !== e.currentTarget.dataset.id) })
  },
  previewPhoto(e) {
    const current = e.currentTarget.dataset.src
    const history = this.data.messages.reduce((all, m) => all.concat(m.images || []), [])
    const urls = this.data.images.concat(history).map(p => p.path)
    if (urls.includes(current)) wx.previewImage({ current, urls: [...new Set(urls)] })
  },
  // —— 语音输入：长按输入框说话，优先实时识别，插件不可用时由 asrProxy 转写 ——
  clearInputHold() {
    if (this._inputHoldTimer) { clearTimeout(this._inputHoldTimer); this._inputHoldTimer = null }
  },
  // textarea 与外层 view 同时绑定：原生组件不冒泡时仍能收到手势，重复派发由 _inputTouchActive 去重。
  onInputTouchStart(e) {
    if (this._inputTouchActive || this.data.sending || this.data.selecting || this.data.attaching || this.data.recording) return
    const touch = e.touches && e.touches[0]
    this._inputTouchActive = true
    this._inputTouchX = touch ? touch.clientX : 0
    this._inputTouchY = touch ? touch.clientY : 0
    this._inputTouchMoved = false
    this.clearInputHold()
    this._inputHoldTimer = setTimeout(() => {
      this._inputHoldTimer = null
      if (this._disposed || !this._inputTouchActive || this._inputTouchMoved) return
      this.startVoice()
    }, INPUT_HOLD_MS)
  },
  onInputTouchMove(e) {
    if (!this._inputTouchActive) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    if (Math.abs(touch.clientX - this._inputTouchX) > INPUT_HOLD_MOVE_TOLERANCE || Math.abs(touch.clientY - this._inputTouchY) > INPUT_HOLD_MOVE_TOLERANCE) {
      this._inputTouchMoved = true
      this.clearInputHold()
    }
  },
  onInputTouchEnd() {
    if (!this._inputTouchActive) return
    this._inputTouchActive = false
    this.clearInputHold()
    if (this._voiceActive) this.stopVoice({ type: 'touchend' })
  },
  onInputTouchCancel() {
    if (!this._inputTouchActive) return
    this._inputTouchActive = false
    this.clearInputHold()
    if (this._voiceActive) this.stopVoice({ type: 'touchcancel' })
  },
  getVoiceManager() {
    if (this._siManager !== undefined) return this._siManager
    this._siManager = null
    try {
      const plugin = requirePlugin('WechatSI')
      const manager = plugin.getRecordRecognitionManager()
      if (!manager || this._siHandlersRegistered) return this._siManager
      manager.onStart(() => {
        if (this._disposed || !this._voiceActive || this._voiceStopping || this._voiceMode !== 'plugin') return
        this.setData({ recording: true, liveTranscript: '', error: '' })
      })
      manager.onRecognize(res => {
        if (this._disposed || !this._voiceActive || this._voiceStopping || this._voiceCancelled || this._voiceMode !== 'plugin') return
        this.setData({ liveTranscript: res && res.result || '' })
      })
      manager.onStop(res => this.finishLiveVoice(res))
      manager.onError(() => {
        if (this._voiceMode === 'plugin' && this._voiceActive) this.failVoice('语音识别失败，请重试')
      })
      this._siManager = manager
      this._siHandlersRegistered = true
    } catch (error) {
      this._siManager = null
    }
    return this._siManager
  },
  startVoice() {
    if (this.data.sending || this.data.selecting || this.data.attaching || this.data.recording) return
    this._voiceStarted = Date.now()
    this._voiceCancelled = false
    this._voiceStopping = false
    this._voiceActive = true
    try { wx.hideKeyboard() } catch (error) {}
    this.setData({ recording: true, liveTranscript: '', error: '', focusInput: false })
    const manager = this.getVoiceManager()
    if (manager) {
      this._voiceMode = 'plugin'
      try {
        manager.start({ duration: 60000, lang: 'zh_CN' })
        return
      } catch (error) {
        this._siManager = null
        this._voiceMode = 'recorder'
      }
    } else this._voiceMode = 'recorder'
    try {
      const recorder = this._recorder || (this._recorder = wx.getRecorderManager())
      if (recorder.offStop) recorder.offStop()
      recorder.onStop(res => this.finishVoice(res))
      recorder.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'mp3' })
    } catch (error) {
      this.failVoice('无法启动录音，请重试')
    }
  },
  stopVoice(event) {
    if (!this._voiceActive || this._voiceStopping) return
    this._voiceCancelled = !!(event && event.type === 'touchcancel')
    this._voiceStopping = true
    this.setData({ recording: false, liveTranscript: '', selecting: true })
    try {
      if (this._voiceMode === 'plugin') this._siManager.stop()
      else this._recorder.stop()
    } catch (error) {
      this.failVoice('语音识别失败，请重试')
    }
  },
  finishLiveVoice(res) {
    if (this._disposed || !this._voiceActive || this._voiceMode !== 'plugin') return
    const cancelled = this._voiceCancelled
    this._voiceActive = false
    this._voiceCancelled = false
    this._voiceStopping = false
    this.setData({ recording: false, liveTranscript: '', selecting: !cancelled })
    if (cancelled) return
    const text = String(res && res.result || '').trim()
    if (text) { this.finishVoiceText(text); return }
    if (res && res.tempFilePath) { this.transcribeWithAsr(res.tempFilePath); return }
    this.setData({ selecting: false })
    wx.showToast({ title: '没有听清，请再试一次', icon: 'none' })
  },
  failVoice(message) {
    if (this._disposed) return
    this._voiceActive = false
    this._voiceCancelled = false
    this._voiceStopping = false
    this.setData({ recording: false, liveTranscript: '', selecting: false, error: message })
  },
  finishVoiceText(text) {
    if (this._disposed) return
    const value = String(text || '').trim()
    if (value) {
      const question = this.data.question
      this.setData({ question: question ? `${question} ${value}` : value, liveTranscript: '', recording: false, selecting: false, error: '' })
    } else {
      this.setData({ liveTranscript: '', recording: false, selecting: false })
      wx.showToast({ title: '没有听清，请再试一次', icon: 'none' })
    }
  },
  finishVoice(res) {
    if (this._disposed || !this._voiceActive || this._voiceMode !== 'recorder') return
    const cancelled = this._voiceCancelled
    this._voiceActive = false
    this._voiceCancelled = false
    this._voiceStopping = false
    this.setData({ recording: false, liveTranscript: '', selecting: !cancelled && !!(res && res.tempFilePath) })
    if (cancelled || !res || !res.tempFilePath) return
    return this.transcribeWithAsr(res.tempFilePath)
  },
  async transcribeWithAsr(tempFilePath) {
    if (this._disposed || !tempFilePath) return
    this.setData({ selecting: true, liveTranscript: '', recording: false })
    const seconds = (Date.now() - this._voiceStarted || 0) / 1000
    if (seconds < 1) {
      wx.showToast({ title: '说话时间太短', icon: 'none' })
      this.setData({ selecting: false })
      return
    }
    let audioFileID = ''
    try {
      const ext = (tempFilePath.split('.').pop() || 'mp3').toLowerCase()
      const upload = await wx.cloud.uploadFile({ cloudPath: `audio/${app.globalData.openid}/${Date.now()}.${ext}`, filePath: tempFilePath })
      audioFileID = upload.fileID || ''
      if (this._disposed) return
      const result = await call('asrProxy', { consent: true, fileID: upload.fileID })
      if (this._disposed) return
      if (!result.configured) { wx.showToast({ title: '语音转写服务未配置', icon: 'none' }); return }
      const text = (result.text || '').trim()
      if (text) this.finishVoiceText(text)
      else wx.showToast({ title: '没有听清，请再试一次', icon: 'none' })
    } catch (error) { if (!this._disposed) wx.showToast({ title: '语音转写失败，请重试', icon: 'none' }) }
    finally {
      if (audioFileID && wx.cloud && wx.cloud.deleteFile) {
        try { await wx.cloud.deleteFile({ fileList: [audioFileID] }) } catch (error) {}
      }
      if (!this._disposed) this.setData({ selecting: false, liveTranscript: '', recording: false })
    }
  },
  // —— 提问 ——
  async onSuggest(e) {
    if (this.data.sending || this.data.selecting || this.data.attaching || this.data.pickMode || this._preparing) return
    const s = e.currentTarget.dataset.s
    const range = (s && s.range) || detectRange(s.text)
    this.setData({ question: s.text })
    if (!this._disposed) await this.send(s.text, range, s && s.categories)
  },
  async _requestAnswer({ requestMessages, snapshot = '', fileIDs = [], thinking = false, replaceId = '' }) {
    this._cancelReasoningPlayback()
    const response = await call('aiChat', {
      consent: true,
      imageConsent: true,
      images: fileIDs,
      snapshot,
      thinking,
      messages: requestMessages.filter(m => !m.failed).slice(-10).map(m => ({
        role: m.role,
        content: ((m.quoted ? `关于这条${m.quoted.role === 'user' ? '提问' : '回答'}：${m.quoted.text}\n` : '') + m.content).slice(0, 4000)
      }))
    })
    if (this._disposed) return
    if (response.unavailable || !response.configured) throw new Error(response.configured ? '小迈暂时没有连上，请稍后重试' : fileIDs.length ? '图片分析尚未配置，请稍后重试' : '问答服务尚未配置，请稍后重试')
    const answer = {
      id: replaceId || 'm' + requestId(), role: 'assistant', content: response.text, status: '小迈',
      thinking: thinking === true, reasoning: thinking ? (response.reasoning || '') : '', thinkingMs: response.elapsed || 0
    }
    const oldMessages = this.data.messages
    const answerIndex = replaceId ? oldMessages.findIndex(message => message.id === replaceId) : -1
    const completeMessages = oldMessages.slice()
    if (answerIndex >= 0) completeMessages[answerIndex] = answer
    else completeMessages.push(answer)
    delete this._nodeCache[answer.id]
    delete this._reasonCache[answer.id]
    const reasoningPlaying = Boolean(answer.reasoning)
    const messageViews = this._messageViews(completeMessages.slice(0, answerIndex >= 0 ? answerIndex : oldMessages.length))
      .concat({ ...answer, nodes: [], reasonNodes: [], reasoningPlaying, thinkLabel: reasoningPlaying ? '正在深度思考' : this._thinkLabel(answer) })
      .concat(answerIndex >= 0 ? this._messageViews(completeMessages.slice(answerIndex + 1)) : [])
    this._autoFollow = true
    const update = this._followPatch({ messages: completeMessages, messageViews, typingMessageId: answer.id, showJumpBottom: false })
    update['thinkOpen.' + answer.id] = false
    this.setData(update)
    this._persist()
    if (reasoningPlaying && !await this._playReasoning(answer)) return
    await this._startTyping(answer.id, answer.content)
  },
  async askAgain(e) {
    this._cancelReasoningPlayback()
    if (this.data.sending || this.data.selecting || this.data.attaching) return
    const index = Number(e.currentTarget.dataset.i)
    const selected = this.data.messages[index]
    const user = selected && selected.role === 'user'
      ? selected
      : this.data.messages.slice(0, index).reverse().find(message => message.role === 'user')
    if (!user || !user.content) return
    const question = user.content
    const hasDraft = Boolean((this.data.question || '').trim() || this.data.images.length)
    this.dismissMessageActions()
    const sendAgain = () => {
      if (user.images && user.images.length) wx.showToast({ title: '原照片已清理，本次按文字重新提问', icon: 'none' })
      this.send(question, detectRange(question), user.categories)
    }
    if (!hasDraft) { sendAgain(); return }
    wx.showModal({
      title: '重新提问',
      content: '当前未发送的文字和照片将被清除，是否继续？',
      confirmText: '重新提问',
      cancelText: '保留草稿',
      success: result => {
        if (!result.confirm || this._disposed) return
        this.setData({ question: '', images: [] }, sendAgain)
      }
    })
  },
  _replaceEditedQuestion(text, editIndex) {
    const current = this.data.editing
    const index = Number.isInteger(editIndex) ? editIndex : this.data.messages.findIndex(message => current && message.id === current.id)
    if (!current || index < 0 || this.data.sending) return
    const trailingCount = this.data.messages.slice(index + 1).filter(message => message.role === 'user').length
    const replace = () => this._submitEditedQuestion(text, index)
    if (!trailingCount) { replace(); return }
    wx.showModal({
      title: '修改提问',
      content: `修改后，这条之后的 ${trailingCount} 条对话会被清除`,
      confirmText: '继续修改', cancelText: '取消',
      success: result => { if (result.confirm && !this._disposed) replace() }
    })
  },
  async _submitEditedQuestion(text, index) {
    if (this.data.sending || this._disposed) return
    this.setData({ sending: true, attaching: false, error: '', question: '', images: [], editing: null, quote: null, focusInput: false })
    this._editingDraft = null
    let snapshot = ''
    const range = detectRange(text)
    const editedCategories = (this.data.messages[index] || {}).categories
    if (range) {
      this.setData({ attaching: true, attachLabel: `正在读取${rangeLabel(range)}记录…` })
      try { snapshot = await fetchSnapshot(app.globalData.activeBabyId, range, editedCategories) } catch (error) {}
      finally { if (!this._disposed) this.setData({ attaching: false, attachLabel: '' }) }
      if (this._disposed) return
    }
    const previous = this.data.messages
    const oldUser = previous[index]
    if (!oldUser || oldUser.role !== 'user') { this.setData({ sending: false }); return }
    const user = { ...oldUser, content: text.trim(), snapshot, images: [], quoted: null, failed: false }
    const removed = previous.slice(index + 1)
    removed.forEach(message => { delete this._nodeCache[message.id]; delete this._reasonCache[message.id] })
    delete this._nodeCache[user.id]
    delete this._reasonCache[user.id]
    const messages = previous.slice(0, index).concat(user)
    this._autoFollow = true
    this.setData(this._followPatch({ messages, messageViews: this._messageViews(messages), typingMessageId: '', showJumpBottom: false }))
    this._persist()
    try {
      await this._requestAnswer({ requestMessages: messages, snapshot: user.snapshot, thinking: this.data.thinking === true })
    } catch (error) {
      if (!this._disposed) {
        const failed = messages.map(message => message.id === user.id ? { ...message, failed: true } : message)
        this.setData({ messages: failed, messageViews: this._messageViews(failed), typingMessageId: '', error: (error.message || '发送失败') + '，内容已保留。' })
        this._persist()
      }
    } finally {
      if (!this._disposed) this.setData({ sending: false, attaching: false, typingMessageId: '' })
    }
  },
  async send(suggestedQuestion, suggestedRange, suggestedCategories) {
    if (this.data.sending || this.data.selecting || this.data.attaching || this.data.pickMode || this._preparing) return
    const currentQuestion = typeof suggestedQuestion === 'string' ? suggestedQuestion : this.data.question
    if (!currentQuestion.trim() && !this.data.images.length) return
    if (this.data.editing) { this._replaceEditedQuestion(currentQuestion); return }
    this._preparing = true
    try { if (this._disposed) return } finally { this._preparing = false }
    if (this.data.sending || this.data.selecting || this.data.attaching || this.data.pickMode) return
    const draft = { question: currentQuestion, images: this.data.images.slice(), thinking: this.data.thinking === true }
    const question = draft.question.trim() || (draft.images.length > 1 ? '请帮我分析这些照片，说明能观察到的情况和需要留意的地方。' : '请帮我分析这张照片，说明能观察到的情况和需要留意的地方。')
    if (!draft.question.trim() && !draft.images.length) return
    const isSuggestion = typeof suggestedQuestion === 'string'
    const range = isSuggestion ? suggestedRange : detectRange(question)
    const categories = isSuggestion ? suggestedCategories : undefined
    let snapshot = ''
    if (range) {
      this.setData({ attaching: true, attachLabel: `正在读取${rangeLabel(range)}记录…`, error: '' })
      try { snapshot = await fetchSnapshot(app.globalData.activeBabyId, range, categories) } catch (error) {}
      finally { if (!this._disposed) this.setData({ attaching: false, attachLabel: '' }) }
      if (this._disposed) return
    }
    const user = { id: 'm' + requestId(), role: 'user', content: question, snapshot, images: draft.images, ...(this.data.quote ? { quoted: this.data.quote } : {}), ...(Array.isArray(categories) ? { categories } : {}) }
    const editing = this.data.editing
    const editIndex = editing ? this.data.messages.findIndex(message => message.id === editing.id) : -1
    if (editing && editIndex < 0) { this.setData({ editing: null }); return }
    const messages = editIndex >= 0 ? this.data.messages.slice(0, editIndex).concat(user) : this.data.messages.concat(user)
    const fileIDs = []
    this._autoFollow = true
    this.setData(this._followPatch({ sending: true, question: '', images: [], quote: null, editing: null, focusInput: false, error: '', messages, messageViews: this._messageViews(messages), typingMessageId: '', showJumpBottom: false }))
    try {
      await photos.upload(draft.images, app.globalData.openid, fileIDs, () => this._disposed)
      if (this._disposed) return
      await this._requestAnswer({ requestMessages: messages, snapshot: user.snapshot, fileIDs, thinking: draft.thinking })
    } catch (error) {
      if (!this._disposed) {
        const hint = draft.thinking ? '，深度思考可能较慢，可关闭后重试' : ''
        const failedMessages = this.data.messages.map(m => m.id === user.id ? { ...m, failed: true } : m)
        this.setData({ messages: failedMessages, messageViews: this._messageViews(failedMessages), typingMessageId: '', ...draft, error: (error.message || '发送失败') + hint + '，内容已保留。' })
      }
    } finally {
      await photos.cleanup(fileIDs)
      if (!this._disposed) this.setData({ sending: false, typingMessageId: '' })
    }
  }
})
