const app = getApp(), page = require('../../utils/page')
const { call, requestId, toastError } = require('../../utils/api')
const { dateKey } = require('../../utils/date')
const { avatarSrc } = require('../../utils/avatar')
const { tap } = require('../../utils/haptics')
const { closeLater } = require('../../utils/motion')
const GENDERS = ['male', 'female']
// Keep in sync with --swipe-action-width in app.wxss.
const ACTION_WIDTH_RPX = 220

page({
  data: {
    babies: [], activeBabyId: '', editingBabyId: '',
    baby: { nickname: '', birthday: '', gender: 'male', avatar: '' },
    avatarSrc: '/images/boy.png',
    genders: ['男宝宝', '女宝宝'], genderIndex: 0,
    saving: false, uploading: false, today: dateKey(),
    panel: false, closing: false
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.setData({ statusBarHeight: info.statusBarHeight || 20 })
    if (!app.globalData.initialized) app.init().then(() => this.refresh())
    else if (app.globalData.loggedIn) app.loadProfile().then(() => this.refresh())
    else this.refresh()
  },
  onShow() { this.refresh() },
  onHide() { this.resetSwipe() },
  onUnload() { this.resetSwipe() },
  onSessionChange() { this.refresh() },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/mine/index' })
  },

  refresh() {
    this.resetSwipe()
    const g = app.globalData
    const babies = (g.babies || []).map(b => ({ ...b, avatar: avatarSrc(b), active: b.baby_id === g.activeBabyId, swipeX: 0 }))
    this.setData({ babies, activeBabyId: g.activeBabyId })
  },

  // Swipe gestures mirror ai-tasks: one open card at a time, actions revealed on the right.
  actionWidth() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    return ACTION_WIDTH_RPX * (info.windowWidth || 375) / 750
  },
  onCardTouchStart(event) {
    const touch = event.touches && event.touches[0], id = event.currentTarget.dataset.id
    if (!touch || !id) return
    const item = this.data.babies.find(value => value.baby_id === id)
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
    this.setData({ babies: this.data.babies.map(item => ({ ...item, swipeX: item.baby_id === gesture.id ? offset : item.swipeX })) })
    if (Math.abs(dx) > 12) this._ignoreCardTapUntil = Date.now() + 450
  },
  onCardTouchEnd() {
    const gesture = this._cardGesture
    if (!gesture) return
    if (gesture.axis === 'horizontal') {
      const item = this.data.babies.find(value => value.baby_id === gesture.id)
      if (item && item.swipeX < -this.actionWidth() * .42) this.openSwipe(gesture.id)
      else this.closeSwipe()
    }
    this._cardGesture = null
  },
  closeSwipe() {
    this._openSwipeKey = ''
    this.setData({ babies: this.data.babies.map(item => ({ ...item, swipeX: 0 })) })
  },
  openSwipe(id) {
    this._openSwipeKey = id
    const offset = -this.actionWidth()
    this.setData({ babies: this.data.babies.map(item => ({ ...item, swipeX: item.baby_id === id ? offset : 0 })) })
    this._ignoreCardTapUntil = Date.now() + 450
  },
  resetSwipe() {
    this._cardGesture = null
    this._openSwipeKey = ''
    this._ignoreCardTapUntil = 0
    const babies = this.data.babies || []
    if (babies.some(item => item.swipeX)) this.setData({ babies: babies.map(item => ({ ...item, swipeX: 0 })) })
  },
  onCardTap(event) {
    const id = event.currentTarget.dataset.id
    const item = this.data.babies.find(value => value.baby_id === id)
    if (item && item.swipeX < 0) { this.closeSwipe(); return }
    if (Date.now() < (this._ignoreCardTapUntil || 0)) return
    this.switchBaby(id)
  },

  switchBaby(id) {
    if (id === this.data.activeBabyId) return
    app.setActiveBaby(id)
    this.refresh()
  },

  // Sheet: add and edit share one panel, matching the ai-tasks pattern.
  openPanel() {
    tap()
    this.setData({
      panel: true, closing: false, editingBabyId: '',
      baby: { nickname: '', birthday: dateKey(), gender: 'male', avatar: '' },
      avatarSrc: '/images/boy.png', genderIndex: 0, fieldErrors: {}
    })
  },
  startEdit(event) {
    const id = event.currentTarget.dataset.id
    const baby = app.globalData.babies.find(b => b.baby_id === id)
    if (!baby) return
    this.closeSwipe()
    tap()
    this.setData({
      panel: true, closing: false, editingBabyId: id,
      baby: { nickname: baby.nickname || '', birthday: baby.birthday || dateKey(), gender: baby.gender === 'female' ? 'female' : 'male', avatar: baby.avatar || '' },
      avatarSrc: avatarSrc(baby),
      genderIndex: baby.gender === 'female' ? 1 : 0, fieldErrors: {}
    })
  },
  closePanel() {
    if (this.data.closing || this.data.saving) return
    this.setData({ closing: true })
    closeLater(this, () => this.setData({ panel: false, closing: false }))
  },

  onBabyInput(e) { if (this.data.saving) return; this.clearFieldError('nickname'); this.setData({ 'baby.nickname': e.detail.value }) },
  onBirthday(e) { if (this.data.saving) return; this.clearFieldError('birthday'); this.setData({ 'baby.birthday': e.detail.value }) },
  onGender(e) { if (this.data.saving) return; const i = Number(e.detail.value); this.setData({ genderIndex: i, 'baby.gender': GENDERS[i] }) },

  async saveBaby() {
    if (this.data.saving) return
    if (!this.data.baby.nickname.trim()) { this.showFieldError('nickname', '给宝宝填个昵称吧'); return }
    if (!this.data.baby.birthday) { this.showFieldError('birthday', '请选择宝宝的生日'); return }
    if (this.data.baby.gender !== 'male' && this.data.baby.gender !== 'female') { this.showFieldError('gender', '请选择宝宝的性别'); return }
    this.setData({ saving: true }); this._saveId = this._saveId || requestId()
    try {
      const result = await call('babyProfile', { action: 'save', babyId: this.data.editingBabyId || '', ...this.data.baby, clientRequestId: this._saveId })
      this._saveId = ''
      const saved = result.baby
      const babies = app.globalData.babies.slice()
      const i = babies.findIndex(b => b.baby_id === saved.baby_id)
      if (i > -1) babies[i] = { ...babies[i], ...saved }; else babies.unshift(saved)
      app.globalData.babies = babies
      app.setActiveBaby(saved.baby_id)
      wx.showToast({ title: this.data.editingBabyId ? '已保存' : '已添加宝宝', icon: 'success' })
      tap('medium')
      this.setData({ panel: false, closing: false })
      this.refresh()
    } catch (error) { toastError(error) } finally { this.setData({ saving: false }) }
  },

  deleteBaby(e) {
    const id = e.currentTarget.dataset.id
    const baby = app.globalData.babies.find(b => b.baby_id === id)
    if (!id || !baby) return
    this.closeSwipe()
    this.confirmDanger({ object: baby.nickname, title: '删除宝宝档案', content: '将删除该宝宝的档案及其关联记录，此操作不可恢复。', success: async r => {
      if (!r.confirm) return
      try {
        await call('babyProfile', { action: 'delete', babyId: id, clientRequestId: requestId() })
        app.globalData.babies = app.globalData.babies.filter(b => b.baby_id !== id)
        if (app.globalData.activeBabyId === id) app.setActiveBaby(app.globalData.babies.length ? app.globalData.babies[0].baby_id : '')
        wx.showToast({ title: '已删除', icon: 'success' })
        this.refresh()
      } catch (error) { toastError(error) }
    } })
  },

  changeAvatar() {
    wx.showActionSheet({ itemList: ['拍照', '从相册选择', '恢复默认头像'], success: async res => {
      if (res.tapIndex === 2) { this.saveAvatar(''); return }
      try {
        const media = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: [res.tapIndex === 0 ? 'camera' : 'album'] })
        const file = media.tempFiles[0]
        this.setData({ uploading: true })
        const ext = (file.tempFilePath.split('.').pop() || 'jpg').toLowerCase()
        const upload = await wx.cloud.uploadFile({ cloudPath: `avatars/${app.globalData.openid}/${this.data.editingBabyId || 'default'}/${Date.now()}.${ext}`, filePath: file.tempFilePath })
        await this.saveAvatar(upload.fileID)
      } catch (error) { toastError(error) } finally { this.setData({ uploading: false }) }
    } })
  },
  async saveAvatar(avatar) {
    if (this._avatarBusy) return
    this._avatarBusy = true
    this.setData({ saving: true }); this._saveId = this._saveId || requestId()
    try {
      const result = await call('babyProfile', { action: 'save', babyId: this.data.editingBabyId || '', nickname: this.data.baby.nickname || '宝宝', birthday: this.data.baby.birthday || '', gender: this.data.baby.gender || 'unknown', avatar, clientRequestId: this._saveId })
      this._saveId = ''
      const saved = result.baby
      const babies = app.globalData.babies.slice()
      const i = babies.findIndex(b => b.baby_id === saved.baby_id)
      if (i > -1) babies[i] = { ...babies[i], ...saved }; else babies.unshift(saved)
      app.globalData.babies = babies
      app.setActiveBaby(saved.baby_id)
      this.setData({ 'baby.avatar': avatar, avatarSrc: avatarSrc(saved) })
      wx.showToast({ title: avatar ? '头像已更新' : '已恢复默认', icon: 'success' })
    } catch (error) { toastError(error) } finally { this._avatarBusy = false; this.setData({ saving: false }) }
  }
})
