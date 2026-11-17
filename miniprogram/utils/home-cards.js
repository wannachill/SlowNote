const { call, requestId, requireWriteAccess, toastError } = require('./api')
const { tap } = require('./haptics')
const { createSwipe } = require('./swipe-gesture')

// Shared by the homepage and daily details; no editing-mode decoration.
function decorate(cards) { return cards.map(card => ({ ...card, swipeX: card.swipeX || 0 })) }

function animateRemoval(page, key) {
  const all = page._allCards, cards = page.data.cards
  const tags = page.data.summaryTags || [], active = page.data.activeTags || []
  const removed = cards.find(card => card.key === key)
  if (Array.isArray(all)) page._allCards = all.filter(card => card.key !== key)
  const remaining = page._allCards || cards.filter(card => card.key !== key)
  const summaryTags = tags.filter(tag => remaining.some(card => (card.tag || card.key) === tag.key)).map(tag => {
    if (!removed || tag.key !== 'feeding' || removed.tag !== 'feeding') return tag
    const count = Math.max(0, tag.count - Number(removed.value || 0))
    return { ...tag, count, value: count + '次' }
  })
  const activeTags = active.filter(key => summaryTags.some(tag => tag.key === key))
  page.setData({ cards: page.visibleCards ? page.visibleCards(remaining, activeTags) : remaining,
    activeTags, summaryTags: summaryTags.map(tag => ({ ...tag, active: activeTags.includes(tag.key), dimmed: activeTags.length > 0 && !activeTags.includes(tag.key) })), cardSettling: true })
  clearTimeout(page._cardRemoveTimer)
  page._cardRemoveTimer = setTimeout(() => {
    page._cardRemoveTimer = null
    if (!page._motionInactive) page.setData({ cardSettling: false })
  }, 200)
  return () => {
    clearTimeout(page._cardRemoveTimer)
    page._cardRemoveTimer = null
    page._allCards = all
    page.setData({ cards: decorate(cards), summaryTags: tags, activeTags: active, cardSettling: false })
  }
}

const methods = {
  ...createSwipe({ list: 'cards', field: 'key', eventKey: 'key' }),
  disposeCardMotion() {
    clearTimeout(this._cardRemoveTimer)
    this._cardRemoveTimer = null
    this.resetSwipe()
  },
  async removeCard(event) {
    if (this.data.cardBusy || this._cardDeletePending || !requireWriteAccess()) return
    const card = this.data.cards.find(card => card.key === event.currentTarget.dataset.key)
    if (!card) return
    const date = this.data.selectedDate, baby = getApp().globalData.activeBabyId || '', session = getApp().globalData.openid || ''
    const current = () => date === this.data.selectedDate && baby === (getApp().globalData.activeBabyId || '') && session === (getApp().globalData.openid || '')
    this.setData({ cardBusy: true })
    const answer = await new Promise(resolve => wx.showModal({ title: '确认删除该登记？', content: date + '「' + card.name + '」对应的全部登记将删除，删除后不可恢复。', confirmText: '删除', cancelText: '取消', success: resolve, fail: () => resolve({ confirm: false }) }))
    if (!answer.confirm || this._motionInactive || !current()) { this.setData({ cardBusy: false }); return }
    const identity = session + '|' + baby + '|' + date + '|' + card.key
    this._cardDeleteIds = this._cardDeleteIds || {}
    const id = this._cardDeleteIds[identity] || (this._cardDeleteIds[identity] = requestId())
    this._cardDeletePending = true
    this._loadVersion = (this._loadVersion || 0) + 1
    this.closeSwipe()
    this.setData({ loading: false })
    const rollback = animateRemoval(this, card.key)
    tap('medium')
    try {
      await call('homeCards', { action: 'deleteDay', category: card.key, recordDate: date, baby_id: baby, clientRequestId: id })
      delete this._cardDeleteIds[identity]
      require('./home-refresh').invalidateRecords()
    } catch (error) {
      if (current()) rollback()
      if (!this._motionInactive) toastError(error)
    } finally {
      this._cardDeletePending = false
      if (current()) this.setData({ cardBusy: false })
    }
  }
}

module.exports = { methods, decorate, animateRemoval, data: { cardBusy: false, cardSettling: false } }
