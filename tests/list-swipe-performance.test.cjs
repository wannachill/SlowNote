const test = require('node:test')
const assert = require('node:assert/strict')
const { front } = require('./helpers.cjs')

const cases = [
  { page: 'ai-tasks', list: 'items', field: '_id', eventKey: 'id', start: 'onCardTouchStart', move: 'onCardTouchMove' },
  { page: 'ai-notifications', list: 'items', field: 'id', eventKey: 'id', start: 'onCardTouchStart', move: 'onCardTouchMove' },
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
