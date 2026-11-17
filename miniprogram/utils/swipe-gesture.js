const { setListItemFields, setListFields } = require('./list-patch')

// All swipe lists own a bounded scroll-view. Never catch vertical touchmove on rows.
function lock(page, locked) {
  if (page.data.swipeScrollLocked !== locked) page.setData({ swipeScrollLocked: locked })
}
function createSwipe(config) {
  const { list, field, eventKey = 'id' } = config
  const methods = {
    actionWidth() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      return 110 * (info.windowWidth || 375) / 750
    },
    onCardTouchStart(event) {
      methods.onCardTouchCancel.call(this)
      const touch = event.touches && event.touches[0]
      const id = event.currentTarget.dataset[eventKey]
      if (!touch || !id || (event.target && event.target.dataset || {}).noSwipe) return
      const item = (this.data[list] || []).find(value => value[field] === id)
      if (!item) return
      this._cardGesture = { id, key: id, x: touch.clientX, y: touch.clientY, startOffset: item.swipeX || 0, axis: '' }
    },
    onCardTouchMove(event) {
      const gesture = this._cardGesture, touch = event.touches && event.touches[0]
      if (!gesture || !touch) { methods.onCardTouchCancel.call(this); return }
      try {
        const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y
        if (!gesture.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'horizontal' : 'vertical'
        if (gesture.axis !== 'horizontal') return
        lock(this, true)
        if (dx < -8 && this._openSwipeKey && this._openSwipeKey !== gesture.id) methods.closeSwipe.call(this)
        const index = (this.data[list] || []).findIndex(item => item[field] === gesture.id)
        if (index < 0) { methods.onCardTouchCancel.call(this); return }
        setListItemFields(this, list, index, { swipeX: Math.max(-methods.actionWidth.call(this), Math.min(0, gesture.startOffset + dx)) })
        if (Math.abs(dx) > 12) this._ignoreCardTapUntil = Date.now() + 450
      } catch (error) { methods.onCardTouchCancel.call(this); throw error }
    },
    onCardTouchEnd() {
      const gesture = this._cardGesture
      try {
        if (!gesture || gesture.axis !== 'horizontal') return
        const item = (this.data[list] || []).find(value => value[field] === gesture.id)
        if (item && item.swipeX < -methods.actionWidth.call(this) * .42) methods.openSwipe.call(this, gesture.id)
        else methods.closeSwipe.call(this)
      } finally { this._cardGesture = null; lock(this, false) }
    },
    onCardTouchCancel() {
      const moved = this._cardGesture && this._cardGesture.axis === 'horizontal'
      this._cardGesture = null
      lock(this, false)
      if (moved) { methods.closeSwipe.call(this); this._ignoreCardTapUntil = Date.now() + 450 }
    },
    closeSwipe() {
      this._openSwipeKey = ''
      setListFields(this, list, item => item.swipeX ? { swipeX: 0 } : null)
    },
    openSwipe(id) {
      this._openSwipeKey = id
      setListFields(this, list, item => ({ swipeX: item[field] === id ? -methods.actionWidth.call(this) : 0 }))
      this._ignoreCardTapUntil = Date.now() + 450
    },
    resetSwipe() {
      methods.onCardTouchCancel.call(this)
      methods.closeSwipe.call(this)
      this._ignoreCardTapUntil = 0
    }
  }
  return methods
}
module.exports = { createSwipe, lock, data: { swipeScrollLocked: false } }
