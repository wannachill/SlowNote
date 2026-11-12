const test = require('node:test')
const assert = require('node:assert/strict')
const { front } = require('./helpers.cjs')

function withBabies() {
  const babies = [
    { baby_id: 'baby-a', nickname: '小满', birthday: '2026-09-10', gender: 'male', avatar: '' },
    { baby_id: 'baby-b', nickname: '小豆', birthday: '2026-01-01', gender: 'female', avatar: '' }
  ]
  const app = {
    palette: null,
    globalData: { loggedIn: true, initialized: true, activeBabyId: 'baby-a', babies: babies.slice() },
    setActiveBaby(id) { this.globalData.activeBabyId = id },
    async init() {}
  }
  return front('baby', { app })
}

test('baby list highlights the current profile and the add panel resets the form', () => {
  const { page } = withBabies()
  page.refresh()
  assert.equal(page.data.babies.length, 2)
  assert.equal(page.data.babies[0].active, true)
  assert.equal(page.data.babies[1].active, false)
  page.openPanel()
  assert.equal(page.data.panel, true)
  assert.equal(page.data.editingBabyId, '')
  assert.equal(page.data.baby.nickname, '')
  assert.equal(page.data.baby.gender, 'male')
  assert.equal(page.data.genderIndex, 0)
})

test('editing a baby prefills the sheet and closes any open swipe', () => {
  const { page } = withBabies()
  page.refresh()
  page.setData({ babies: page.data.babies.map(b => ({ ...b, swipeX: b.baby_id === 'baby-a' ? -100 : 0 })) })
  page.startEdit({ currentTarget: { dataset: { id: 'baby-b' } } })
  assert.equal(page.data.panel, true)
  assert.equal(page.data.editingBabyId, 'baby-b')
  assert.equal(page.data.baby.nickname, '小豆')
  assert.equal(page.data.genderIndex, 1)
  // The swipe is reset when the sheet opens.
  assert.equal(page.data.babies[0].swipeX, 0)
})

test('tapping a card switches the current baby unless a swipe is open', () => {
  const { page, app } = withBabies()
  page.refresh()
  page.onCardTap({ currentTarget: { dataset: { id: 'baby-b' } } })
  assert.equal(app.globalData.activeBabyId, 'baby-b')
  page.setData({ babies: page.data.babies.map(b => ({ ...b, swipeX: b.baby_id === 'baby-a' ? -100 : 0 })) })
  page.onCardTap({ currentTarget: { dataset: { id: 'baby-a' } } })
  assert.equal(app.globalData.activeBabyId, 'baby-b', 'tap on an open swipe must not switch the baby')
  assert.equal(page.data.babies[0].swipeX, 0, 'the open swipe closes on tap')
})

test('left swipe opens exactly one card at a time', () => {
  const { page } = withBabies()
  page.refresh()
  const id = 'baby-a'
  page.onCardTouchStart({ touches: [{ clientX: 200, clientY: 100 }], currentTarget: { dataset: { id } } })
  page.onCardTouchMove({ touches: [{ clientX: 120, clientY: 102 }] })
  assert.ok(page.data.babies.find(b => b.baby_id === id).swipeX < 0, 'card slides left while dragging')
  page.onCardTouchEnd()
  assert.equal(page.data.babies.find(b => b.baby_id === id).swipeX, -page.actionWidth(), 'snaps open past threshold')
  // Swiping a second card closes the first.
  page.onCardTouchStart({ touches: [{ clientX: 200, clientY: 100 }], currentTarget: { dataset: { id: 'baby-b' } } })
  page.onCardTouchMove({ touches: [{ clientX: 100, clientY: 100 }] })
  page.onCardTouchEnd()
  const open = page.data.babies.filter(b => b.swipeX < 0)
  assert.equal(open.length, 1, 'only one card stays open')
  assert.equal(open[0].baby_id, 'baby-b', 'the second card is the open one')
  assert.equal(page.data.babies.find(b => b.baby_id === 'baby-b').swipeX, -page.actionWidth(), 'open card is fully revealed')
})
