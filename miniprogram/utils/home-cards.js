const { call, requestId, requireWriteAccess, toastError } = require('./api')
const { tap } = require('./haptics')

function decorate(cards) {
  return cards.map((card, index) => ({
    ...card,
    wiggleStyle: '--card-wiggle-duration:' + (260 + index % 4 * 23) + 'ms;--card-wiggle-delay:-' + (index * 71 % 290) + 'ms;'
  }))
}

function animateRemoval(page, key) {
  const index = page.data.cards.findIndex(card => card.key === key)
  page.setData({ cardDeletingKey: key, cardSettling: true })
  clearTimeout(page._cardRemoveTimer)
  page._cardRemoveTimer = setTimeout(() => {
    if (page._motionInactive) return
    const cards = page.data.cards.filter(card => card.key !== key)
    // 同步本地全量缓存，避免 load() 命中缓存时把已删除卡片“复活”出来
    if (Array.isArray(page._allCards)) page._allCards = page._allCards.filter(card => card.key !== key)
    page.setData({ cards, cardDeletingKey: '', cardSettling: false }, () => {
      if (page._motionInactive) return
      page.finishCardEdit(() => page.load())
    })
  }, index < 0 ? 0 : 200)
}

const methods = {
  beginCardEdit() {
    if (this.data.cardBusy || this.data.cardSettling || this.data.cardDeletingKey || this.data.panel || this._motionInactive || this.data.cardEditing || !this.data.cards.length) return
    this.setData({ cards: decorate(this.data.cards), cardEditing: true })
    tap('medium')
  },
  finishCardEdit(callback) {
    if (this.data.cardBusy || this.data.cardSettling || this.data.cardDeletingKey) return
    this.disposeCardMotion()
    const update = { cards: decorate(this.data.cards), cardEditing: false, cardSettling: false, cardDeletingKey: '' }
    if (typeof callback === 'function') this.setData(update, callback)
    else this.setData(update)
  },
  disposeCardMotion() {
    clearTimeout(this._cardRemoveTimer)
    this._cardRemoveTimer = null
  },
  async removeCard(event) {
    if (!this.data.cardEditing || this.data.cardBusy || this._cardDeletePending || this.data.cardSettling || this.data.cardDeletingKey || !requireWriteAccess()) return
    const card = this.data.cards.find(card => card.key === event.currentTarget.dataset.key)
    if (!card) return
    const date = this.data.selectedDate, baby = getApp().globalData.activeBabyId || '', session = getApp().globalData.openid || ''
    this.setData({ cardBusy: true })
    const answer = await new Promise(resolve => wx.showModal({ title: '确认删除该登记？', content: date + '「' + card.name + '」对应的全部登记将删除，删除后不可恢复。', confirmText: '删除', cancelText: '取消', success: resolve, fail: () => resolve({ confirm: false }) }))
    if (!answer.confirm || this._motionInactive || date !== this.data.selectedDate || baby !== (getApp().globalData.activeBabyId || '') || session !== (getApp().globalData.openid || '')) { this.setData({ cardBusy: false }); return }
    const identity = session + '|' + baby + '|' + date + '|' + card.key
    this._cardDeleteIds = this._cardDeleteIds || {}
    const id = this._cardDeleteIds[identity] || (this._cardDeleteIds[identity] = requestId())
    this._cardDeletePending = true
    try {
      await call('homeCards', { action: 'deleteDay', category: card.key, recordDate: date, baby_id: baby, clientRequestId: id })
      delete this._cardDeleteIds[identity]
      require('./home-refresh').invalidateRecords()
      if (this._motionInactive || date !== this.data.selectedDate || baby !== (getApp().globalData.activeBabyId || '') || session !== (getApp().globalData.openid || '')) return
      tap('medium'); animateRemoval(this, card.key)
    } catch (error) {
      if (!this._motionInactive) toastError(error)
    } finally {
      this._cardDeletePending = false
      this.setData({ cardBusy: false })
    }
  }
}

module.exports = { methods, decorate, animateRemoval, data: { cardEditing: false, cardBusy: false, cardSettling: false, cardDeletingKey: '' } }
