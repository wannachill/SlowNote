const { dateKey, parseDate } = require('../../utils/date')
const { tap } = require('../../utils/haptics')
const currentBabyName = require('../../utils/record-scope').currentBabyName
// 成长日记页：图文日常记录 + 时光轴视图
// 图片先上传云存储得到 fileID，再随文字写入 diary_records
const app = getApp()
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const invokeWx = (method, options) => new Promise((resolve, reject) => method({ ...options, success: resolve, fail: reject }))

require('../../utils/page')({
  data: {
    loading: false, loadError: '',
    recordDate: dateKey(), today: dateKey(),
    panelMode: false, cardEditMode: false, babyName: '',
    content: '',
    images: [],      // 本地临时路径（已选未发布）
    editingId: '',
    records: [],     // 按日期分组的时光轴
    reveal: {},
    submitting: false
  },

  onLoad(options) { this.setData({ panelMode: options.panel === '1' || options.cardEdit === '1', cardEditMode: options.cardEdit === '1', babyName: currentBabyName(), recordDate: parseDate(options.date) ? options.date : dateKey() }) },
  onDate(e) { if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return; this._requestId = ''; this.setData({ recordDate: e.detail.value }); if (this.data.cardEditMode && !this.data.panelMode) this.loadRecords() },
  async onShow() {
    if (!app.globalData.initialized) await app.init()
    this.setData({ babyName: currentBabyName() })
    if (!this.data.panelMode || this.data.cardEditMode) this.loadRecords()
  },

  closePanel(saved) { require('../../utils/registration').close(this, saved === true) },

  onPullDownRefresh() {
    require('../../utils/reveal').reset(this)
    this.loadRecords().then(() => wx.stopPullDownRefresh())
  },

  onInput(e) { if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return; this._requestId = ''; this.clearFieldError('content'); this.setData({ content: e.detail.value }) },

  startEdit(e) {
    if (this.data.submitting) return
    let record = null
    this.data.records.some(day => {
      record = day.items.find(item => item.id === e.currentTarget.dataset.id) || null
      return !!record
    })
    if (!record) return
    this._requestId = ''
    this._uploadedImages = null
    this.setData({ panelMode: this.data.cardEditMode || this.data.panelMode, editingId: record.id, content: record.content || '', images: (record.images || []).slice(), recordDate: record.recordDate, fieldErrors: {}, fieldShake: '' })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  cancelEdit() {
    this._requestId = ''
    this._uploadedImages = null
    this.setData({ editingId: '', content: '', images: [], recordDate: dateKey(), fieldErrors: {}, fieldShake: '' })
  },

  chooseImages() {
    if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return
    this._requestId = ''; this._uploadedImages = null
    const remain = 3 - this.data.images.length
    if (remain <= 0) return
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return
        try {
          const files = []
          for (const file of res.tempFiles || []) {
            let path = file.tempFilePath
            if (wx.compressImage) {
              try { path = (await invokeWx(wx.compressImage, { src: path, quality: 75 })).tempFilePath || path }
              catch (error) { /* Keep the original and validate its actual size and format below. */ }
            }
            const info = await invokeWx(wx.getImageInfo, { src: path })
            if (!['jpg', 'jpeg', 'png', 'webp'].includes(String(info.type || '').toLowerCase())) throw new Error('DIARY_IMAGE_FORMAT')
            const fileInfo = await invokeWx(options => wx.getFileSystemManager().getFileInfo(options), { filePath: path })
            if (!fileInfo.size || fileInfo.size > MAX_IMAGE_BYTES) throw new Error('DIARY_IMAGE_SIZE')
            files.push(path)
          }
          if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return
          this.setData({ images: this.data.images.concat(files) })
        } catch (error) {
          wx.showToast({ title: error.message === 'DIARY_IMAGE_SIZE' ? '图片过大，请裁剪后重试' : '请选择 JPG、PNG 或 WebP 图片', icon: 'none' })
        }
      }
    })
  },

  removeImage(e) {
    if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return
    this._requestId = ''; this._uploadedImages = null
    const images = this.data.images.slice()
    images.splice(e.currentTarget.dataset.idx, 1)
    this.setData({ images })
  },

  async submit() {
    if (this.data.submitting || this.data.closing || (this.data.cardEditMode && this.data.loading)) return
    const { content, images } = this.data
    const editingId = this.data.editingId
    if (!require('../../utils/api').requireWriteAccess()) return
    if (this.data.panelMode && !this.data.cardEditMode ? !content.trim() : !content.trim() && !images.length) {
      if (this.data.panelMode) this.showFieldError('content', '请填写日记内容')
      else wx.showToast({ title: '写点什么或加张照片', icon: 'none' })
      return
    }
    if (this.data.submitting || this.data.closing) return
    const clientRequestId = editingId ? '' : (this._requestId || (this._requestId = require('../../utils/api').requestId()))
    this.setData({ submitting: true })
    try {
      // 1. 图片上传到云存储
      const fileIDs = editingId ? [] : (this._uploadedImages || [])
      if (editingId) {
        for (const image of images) {
          if (image.startsWith('cloud://')) { fileIDs.push(image); continue }
          const ext = (image.split('.').pop() || 'jpg').toLowerCase()
          const cloudPath = `diary/${app.globalData.openid}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          const up = await wx.cloud.uploadFile({ cloudPath, filePath: image })
          fileIDs.push(up.fileID)
        }
      } else {
        for (const tmp of images.slice(fileIDs.length)) {
          const ext = (tmp.split('.').pop() || 'jpg').toLowerCase()
          const cloudPath = `diary/${app.globalData.openid}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          const up = await wx.cloud.uploadFile({ cloudPath, filePath: tmp })
          fileIDs.push(up.fileID)
          this._uploadedImages = fileIDs
        }
      }
      // 2. 写入日记记录
      const res = await wx.cloud.callFunction({
        name: 'diaryRecord',
        data: editingId
          ? { action: 'update', id: editingId, content: content.trim(), images: fileIDs, recordDate: this.data.recordDate }
          : { action: 'add', content: content.trim(), images: fileIDs, recordDate: this.data.recordDate, baby_id: app.globalData.activeBabyId, clientRequestId }
      })
      const r = res.result
      if (r.code !== 0) throw new Error('RECORD_FAILED')
      this._requestId = ''; this._uploadedImages = null
      require('../../utils/home-refresh').markSaved(this.data.recordDate)
      wx.showToast({ title: editingId ? '已更新' : '已记下', icon: 'success' })
      tap('medium')
      if (this.data.panelMode) { this.closePanel(true); return }
      this.setData({ content: '', images: [], editingId: '' })
      this.loadRecords()
    } catch (e) {
      wx.showToast({ title: '发布失败，请重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  async loadRecords() {
    if (this.data.panelMode && !this.data.cardEditMode) return
    const version = this._listVersion = (this._listVersion || 0) + 1
    this.setData({ loading: true, loadError: '' })
    try {
      const res = await wx.cloud.callFunction({ name: 'diaryRecord', data: { action: 'list', baby_id: app.globalData.activeBabyId } })
      const r = res.result
      if (version !== this._listVersion) return
      if (!r || r.code !== 0) throw new Error('未能读取记录，请重试')
      const records = this.data.cardEditMode
        ? (r.records || []).filter(item => item.record_date === this.data.recordDate)
        : (r.records || [])
      const groups = this.groupByDate(records)
      this.setData({ records: groups }, () => {
        if (this.data.cardEditMode && !this._cardEditOpened) {
          this._cardEditOpened = true
          const first = groups[0] && groups[0].items[0]
          if (first) this.startEdit({ currentTarget: { dataset: { id: first.id } } })
        }
        if (!this.data.panelMode) this.observeReveal()
      })
    } catch (error) {
      if (version === this._listVersion) this.setData({ loadError: error.message && !error.errMsg ? error.message : '网络有些慢，请检查连接后重试' })
    } finally {
      if (version === this._listVersion) this.setData({ loading: false })
    }
  },

  observeReveal() {
    require('../../utils/reveal').observe(this, { selector: '.reveal-target' })
  },

  // 按日期分组为时光轴
  groupByDate(records) {
    const map = {}
    records.forEach((d) => {
      const date = d.record_date || this.formatDate(d.created_at)
      if (!map[date]) map[date] = { date, items: [] }
      map[date].items.push({
        id: d._id,
        recordDate: d.record_date || date,
        time: this.formatTime(d.created_at),
        content: d.content,
        images: d.images || []
      })
    })
    return Object.keys(map).map((k) => map[k])
  },

  // 预览图片
  preview(e) {
    const src = e.currentTarget.dataset.src
    const urls = []
    this.data.records.forEach((day) => day.items.forEach((r) => (r.images || []).forEach((i) => urls.push(i))))
    wx.previewImage({ current: src, urls })
  },

  formatDate(ts) {
    return new Date(new Date(ts).getTime() + 8 * 3600000).toISOString().slice(0, 10)
  },

  formatTime(ts) {
    const d = new Date(new Date(ts).getTime() + 8 * 3600000)
    const p = (n) => (n < 10 ? '0' + n : n)
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  }
})
