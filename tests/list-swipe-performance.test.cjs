const test = require('node:test')
const assert = require('node:assert/strict')
const { front } = require('./helpers.cjs')

const cases = [
  { page: 'index', list: 'cards', field: 'key', eventKey: 'key', start: 'onCardTouchStart', move: 'onCardTouchMove' },
  { page: 'ai-tasks', list: 'items', field: '_id', eventKey: 'id', start: 'onCardTouchStart', move: 'onCardTouchMove' },
  { page: 'ai-notifications', list: 'items', field: 'id', eventKey: 'id', start: 'onCardTouchStart', move: 'onCardTouchMove' },
  { page: 'ai-history', list: 'list', field: 'sessionId', eventKey: 'id', start: 'onCardTouchStart', move: 'onCardTouchMove' },
  { page: 'baby', list: 'babies', field: 'baby_id', eventKey: 'id', start: 'onCardTouchStart', move: 'onCardTouchMove' },
  { page: 'ai-settings', list: 'questions', field: 'id', eventKey: 'id', start: 'onQuestionCardTouchStart', move: 'onQuestionCardTouchMove' },
  { page: 'milestone', list: 'visible', field: 'key', eventKey: 'key', start: 'onCardTouchStart', move: 'onCardTouchMove' }
]

test('swipe movement only sends the changed row field to setData', () => {
  for (const item of cases) {
    const { page } = front(item.page)
    const rows = ['a', 'b', 'c'].map(id => ({ [item.field]: id, swipeX: 0, dragY: 0 }))
    page.setData({ [item.list]: rows })
    const untouched = [page.data[item.list][0], page.data[item.list][2]]
    const updates = []
    const setData = page.setData
    page.setData = function (patch, callback) {
      updates.push(patch)
      return setData.call(this, patch, callback)
    }

    page[item.start]({
      currentTarget: { dataset: { [item.eventKey]: 'b' } },
      target: { dataset: {} },
      touches: [{ clientX: 200, clientY: 50 }]
    })
    page[item.move]({ touches: [{ clientX: 100, clientY: 50 }] })

    assert.deepEqual(Object.keys(updates.at(-1)), [`${item.list}[1].swipeX`], item.page)
    const width = page.actionWidth ? page.actionWidth() : page.questionActionWidth()
    assert.equal(page.data[item.list][1].swipeX, Math.max(-width, -100), item.page)
    assert.equal(page.data[item.list][0], untouched[0], `${item.page} keeps the first row object`)
    assert.equal(page.data[item.list][2], untouched[1], `${item.page} keeps the third row object`)
  }
})

test('milestone drag movement only sends the dragged row and changed drop index', () => {
  const { page } = front('milestone')
  page.setData({
    visible: [{ key: 'a', swipeX: 0, dragY: 0 }, { key: 'b', swipeX: 0, dragY: 0 }, { key: 'c', swipeX: 0, dragY: 0 }],
    draggingKey: 'b', dropIndex: 1
  })
  page._dragCenters = [{ key: 'a', y: 50 }, { key: 'b', y: 100 }, { key: 'c', y: 200 }]
  page.onCardTouchStart({ currentTarget: { dataset: { key: 'b' } }, touches: [{ clientX: 100, clientY: 100 }] })
  const updates = []
  const setData = page.setData
  page.setData = function (patch, callback) {
    updates.push(patch)
    return setData.call(this, patch, callback)
  }

  page.onCardTouchMove({ touches: [{ clientX: 100, clientY: 150 }] })

  assert.deepEqual(Object.keys(updates.at(-1)).sort(), ['dropIndex', 'visible[1].dragY'])
  assert.equal(page.data.visible[1].dragY, 50)
  assert.equal(page.data.dropIndex, 2)
})


test('all seven lists lock only horizontal gestures and always release on end, cancel, hide and unload', () => {
  for (const item of cases) {
    const { page } = front(item.page)
    page.setData({ [item.list]: [{ [item.field]: 'a', swipeX: 0 }] })
    const start = () => page[item.start]({ currentTarget: { dataset: { [item.eventKey]: 'a' } }, touches: [{ clientX: 200, clientY: 50 }] })
    const end = item.page === 'ai-settings' ? 'onQuestionCardTouchEnd' : 'onCardTouchEnd'
    const cancel = item.page === 'ai-settings' ? 'onQuestionCardTouchCancel' : 'onCardTouchCancel'
    for (const finish of [end, cancel, 'onHide', 'onUnload']) {
      start()
      page[item.move]({ touches: [{ clientX: 180, clientY: 49 }] })
      assert.equal(page.data.swipeScrollLocked, true, item.page + ' locks horizontally')
      page[finish]()
      assert.equal(page.data.swipeScrollLocked, false, item.page + ' releases on ' + finish)
    }
    start()
    page[item.move]({ touches: [{ clientX: 199, clientY: 100 }] })
    assert.equal(page.data.swipeScrollLocked, false, item.page + ' allows vertical scrolling')
    page[end]()
    start()
    page[item.move]({ touches: [{ clientX: 188, clientY: 62 }] })
    assert.equal(page.data.swipeScrollLocked, false, item.page + ' diagonal locks vertically at ratio <= 1.15')
    page[item.move]({ touches: [{ clientX: 100, clientY: 62 }] })
    assert.equal(page.data.swipeScrollLocked, false, item.page + ' direction remains locked')
    page[cancel]()
    start()
    page[item.move]({ touches: [{ clientX: 170, clientY: 50 }] })
    page[item.move]({ touches: [] })
    assert.equal(page.data.swipeScrollLocked, false, item.page + ' missing touch releases lock')
  }
})

test('unexpected row update failure still unlocks the scroll-view', () => {
  const { page } = front('ai-tasks')
  page.setData({ items: [{ _id: 'a', swipeX: 0 }] })
  const setData = page.setData
  let failed = false
  page.setData = function (patch, done) {
    if (!failed && Object.keys(patch).some(key => key.endsWith('.swipeX'))) { failed = true; throw Error('render failed') }
    setData.call(this, patch, done)
  }
  page.onCardTouchStart({ currentTarget: { dataset: { id: 'a' } }, touches: [{ clientX: 200, clientY: 50 }] })
  assert.throws(() => page.onCardTouchMove({ touches: [{ clientX: 100, clientY: 50 }] }), /render failed/)
  assert.equal(page.data.swipeScrollLocked, false)
  assert.equal(page._cardGesture, null)
})
