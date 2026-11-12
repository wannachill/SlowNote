const test = require('node:test'), assert = require('node:assert/strict')
const { front } = require('./helpers.cjs')

function milestoneFixture() {
  const milestones = [
    { key: 'one', source: 'builtin', month: 1, name: '会抬头', domain: '大运动', sort_order: 0, done: false },
    { key: 'two', month: 1, name: '会微笑', domain: '社交', sort_order: 1, done: true, recordDate: '2026-11-01' }
  ]
  const requests = []
  const f = front('milestone', { callFunction: async request => {
    requests.push(request.data)
    const data = request.data
    if (data.action === 'list') return { result: { code: 0, milestones, months: Array.from({ length: 36 }, (_, index) => index + 1) } }
    if (data.action === 'check') { milestones.find(item => item.key === data.key).done = true; return { result: { code: 0 } } }
    if (data.action === 'uncheck') { milestones.find(item => item.key === data.key).done = false; return { result: { code: 0 } } }
    if (data.action === 'updateDef') { Object.assign(milestones.find(item => item.key === data.key), data); return { result: { code: 0 } } }
    if (data.action === 'removeDef') { const index = milestones.findIndex(item => item.key === data.key); if (index >= 0) milestones.splice(index, 1); return { result: { code: 0 } } }
    return { result: { code: 0 } }
  } })
  f.app.globalData.activeBabyId = 'baby-a'
  return { ...f, requests, milestones }
}

test('checking has no prompt and confirmed unchecking immediately restores the empty state', async () => {
  const f = milestoneFixture()
  await f.page.load()
  const untouchedCard = f.page.data.visible[1]
  let modal
  let modalCount = 0
  f.wx.showModal = options => { modal = options; modalCount++ }
  await f.page.check({ currentTarget: { dataset: { key: 'one' } } })
  assert.equal(f.requests.find(request => request.action === 'check').recordDate, f.page.today())
  assert.equal(f.page.data.visible.find(item => item.key === 'one').done, true)
  assert.equal(f.page.data.visible.find(item => item.key === 'one').recordDate, f.page.today())
  assert.equal(f.page.data.visible[1], untouchedCard, 'checking one item should not replace other card objects')
  assert.equal(modalCount, 0, 'checking should not ask for confirmation')
  assert.equal(Object.hasOwn(f.page.data, 'sheet'), false)
  assert.equal(f.calls.some(call => call.type === 'toast'), false)

  let finishUncheck
  f.wx.cloud.callFunction = ({ data }) => {
    f.requests.push(data)
    if (data.action === 'uncheck') return new Promise(resolve => {
      finishUncheck = () => {
        const item = f.page.data.all.find(value => value.key === 'two')
        if (item) { item.done = false; item.recordDate = '' }
        resolve({ result: { code: 0 } })
      }
    })
    if (data.action === 'list') return Promise.resolve({ result: { code: 0, months: f.page.data.months, milestones: f.page.data.all } })
    return Promise.resolve({ result: { code: 0 } })
  }
  const unchecking = f.page.uncheck({ currentTarget: { dataset: { key: 'two' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(modalCount, 1)
  assert.equal(modal.title, '取消成长里程碑打卡')
  assert.equal(modal.confirmText, '取消打卡')
  assert.equal(modal.cancelText, '保留打卡')
  assert.equal(f.requests.filter(request => request.action === 'uncheck').length, 0, 'confirmation must precede the cloud request')
  modal.success({ confirm: true })
  await new Promise(resolve => setImmediate(resolve))
  let item = f.page.data.visible.find(value => value.key === 'two')
  assert.equal(item.done, false, 'the card immediately switches to its original unchecked state')
  assert.equal(item.recordDate, '')
  assert.equal(Object.hasOwn(item, 'unchecking'), false, 'there is no faded check intermediate state')
  assert.equal(f.page.data.busy, true)
  assert.equal(finishUncheck instanceof Function, true)
  finishUncheck()
  await unchecking
  assert.equal(f.requests.filter(request => request.action === 'uncheck').length, 1)
  item = f.page.data.visible.find(value => value.key === 'two')
  assert.equal(item.done, false)
  assert.equal(item.recordDate, '')
  assert.equal(Object.hasOwn(f.page.data, 'sheet'), false)
  assert.equal(f.calls.some(call => call.type === 'toast'), false)
  f.page.onUnload()
})

test('declining uncheck confirmation leaves the completion and date untouched', async () => {
  const f = milestoneFixture()
  await f.page.load()
  let modal
  f.wx.showModal = options => { modal = options }

  const unchecking = f.page.uncheck({ currentTarget: { dataset: { key: 'two' } } })
  await new Promise(resolve => setImmediate(resolve))
  modal.success({ confirm: false, cancel: true })
  await unchecking

  const item = f.page.data.visible.find(value => value.key === 'two')
  assert.equal(item.done, true)
  assert.equal(item.recordDate, '2026-11-01')
  assert.equal(f.requests.filter(request => request.action === 'uncheck').length, 0)
  assert.equal(f.page.data.busy, false)
  f.page.onUnload()
})

test('check and uncheck only mark the operated card disabled while a request is pending', async () => {
  const f = milestoneFixture()
  await f.page.load()
  const template = require('node:fs').readFileSync('miniprogram/pages/milestone/index.wxml', 'utf8')
  assert.equal((template.match(/disabled="\{\{busy && operatingKey === item\.key\}\}"/g) || []).length, 2)

  let finishRequest
  const finishes = []
  f.wx.cloud.callFunction = ({ data }) => {
    if (data.action === 'list') return Promise.resolve({ result: { code: 0, months: f.page.data.months, milestones: f.page.data.all } })
    return new Promise(resolve => { finishes.push(() => resolve({ result: { code: 0 } })) })
  }
  const checking = f.page.check({ currentTarget: { dataset: { key: 'one' } } })
  assert.equal(f.page.data.busy, true)
  assert.equal(f.page.data.operatingKey, 'one')
  finishRequest = finishes.shift()
  finishRequest()
  await checking
  assert.equal(f.page.data.operatingKey, '')

  const unchecking = f.page.uncheck({ currentTarget: { dataset: { key: 'two' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.page.data.busy, true)
  assert.equal(f.page.data.operatingKey, 'two')
  assert.equal(f.page.data.visible.find(item => item.key === 'two').done, false)
  assert.equal(f.page.data.visible.find(item => item.key === 'two').recordDate, '')
  finishRequest = finishes.shift()
  finishRequest()
  await unchecking
  assert.equal(f.page.data.operatingKey, '')
  f.page.onUnload()
})

test('swipe edit opens the selected definition and delete uses delete wording for built-in items', async () => {
  const f = milestoneFixture()
  await f.page.load()
  f.page.openSwipe('one')
  f.page.startEdit({ currentTarget: { dataset: { key: 'one' } } })
  assert.equal(f.page.data.definition.key, 'one')
  assert.equal(f.page.data.formName, '会抬头')
  assert.equal(f.page.data.visible[0].swipeX, 0)
  f.page.setData({ formName: '会稳稳抬头' })
  await f.page.saveDefinition()
  assert.equal(f.requests.some(request => request.action === 'updateDef' && request.name === '会稳稳抬头'), true)
  assert.equal(f.page.data.visible.find(item => item.key === 'one').name, '会稳稳抬头')

  f.page.setData({ definition: null })
  f.page.openSwipe('one')
  let modal
  f.wx.showModal = options => { modal = options }
  f.page.confirmRemoveDefinition({ currentTarget: { dataset: { key: 'one' } } })
  assert.equal(modal.title, '删除成长里程碑')
  assert.equal(modal.confirmText, '删除')
  modal.success({ confirm: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.requests.some(request => request.action === 'removeDef' && request.key === 'one'), true)
  assert.equal(f.page.data.visible.some(item => item.key === 'one'), false)
  f.page.onUnload()
})

test('tapping a milestone card toggles completion directly and keeps the detail sheet removed', async () => {
  const f = milestoneFixture()
  await f.page.load()
  let prompts = 0
  f.wx.showModal = options => { prompts++; options.success({ confirm: true }) }
  await f.page.toggleDone({ currentTarget: { dataset: { key: 'one' } } })
  assert.equal(f.requests.find(request => request.action === 'check').recordDate, f.page.today())
  assert.equal(prompts, 0, 'checking by tapping the card should not ask for confirmation')
  await f.page.toggleDone({ currentTarget: { dataset: { key: 'two' } } })
  assert.equal(prompts, 1, 'unchecking by tapping the card should ask for confirmation')
  assert.equal(f.requests.filter(request => request.action === 'uncheck').length, 1)
  assert.equal(Object.hasOwn(f.page.data, 'sheet'), false)
  assert.equal(f.calls.some(call => call.type === 'toast'), false)
  const template = require('node:fs').readFileSync('miniprogram/pages/milestone/index.wxml', 'utf8')
  const style = require('node:fs').readFileSync('miniprogram/pages/milestone/index.wxss', 'utf8')
  assert.doesNotMatch(style, /\.done-check\.completed\.unchecking/)
  assert.doesNotMatch(template, /unchecking/)
  assert.match(style, /\.done-check\s*\{[^}]*transition:\s*background-color var\(--motion-quick\) ease, border-color var\(--motion-quick\) ease, color var\(--motion-quick\) ease/s)
  f.page.onUnload()
})

test('failed uncheck restores the original completion date after the optimistic clear', async () => {
  const f = milestoneFixture()
  await f.page.load()
  let finishUncheck
  f.wx.cloud.callFunction = ({ data }) => {
    if (data.action === 'uncheck') return new Promise(resolve => { finishUncheck = () => resolve({ result: { code: 1 } }) })
    return Promise.resolve({ result: { code: 0 } })
  }
  const unchecking = f.page.uncheck({ currentTarget: { dataset: { key: 'two' } } })
  await new Promise(resolve => setImmediate(resolve))
  let item = f.page.data.visible.find(value => value.key === 'two')
  assert.equal(item.done, false)
  assert.equal(item.recordDate, '')
  finishUncheck()
  await unchecking
  item = f.page.data.visible.find(value => value.key === 'two')
  assert.equal(item.done, true)
  assert.equal(item.recordDate, '2026-11-01')
  assert.equal(f.page.data.actionError, '操作失败，请重试')
  f.page.onUnload()
})

test('horizontal card swipe reveals actions while a long press reorders with one reorder request', async () => {
  const f = milestoneFixture()
  await f.page.load()
  f.page.onCardTouchStart({ currentTarget: { dataset: { key: 'one' } }, touches: [{ clientX: 200, clientY: 100 }] })
  f.page.onCardTouchMove({ touches: [{ clientX: 90, clientY: 102 }] })
  f.page.onCardTouchEnd()
  assert.equal(f.page.data.visible[0].swipeX < 0, true)
  assert.equal(f.page._openSwipeKey, 'one')

  f.page.closeSwipe()
  f.wx.createSelectorQuery = () => ({
    in() { return this },
    selectAll() { return this },
    boundingClientRect(callback) { callback([{ top: 0, height: 80 }, { top: 90, height: 80 }]); return this },
    exec() {}
  })
  f.page.onCardTouchStart({ currentTarget: { dataset: { key: 'one' } }, touches: [{ clientX: 140, clientY: 30 }] })
  await f.page.beginDrag({ currentTarget: { dataset: { key: 'one' } } })
  f.page.onCardTouchMove({ touches: [{ clientX: 142, clientY: 170 }] })
  f.page.onCardTouchEnd()
  await new Promise(resolve => setImmediate(resolve))
  const reorder = f.requests.find(request => request.action === 'reorder')
  assert.deepEqual(reorder.keys, ['two', 'one'])
  assert.equal(f.page.data.draggingKey, '')
  f.page.onUnload()
})

test('horizontal swipe on the month content changes month and updates the pill scroll target', async () => {
  const f = milestoneFixture()
  await f.page.load()
  f.page.setData({ activeMonth: 2, monthScrollInto: 'month-2' })
  f.page.onMonthSwipeStart({ target: { dataset: {} }, touches: [{ clientX: 240, clientY: 40 }] })
  f.page.onMonthSwipeEnd({ changedTouches: [{ clientX: 150, clientY: 44 }] })
  assert.equal(f.page.data.activeMonth, 3)
  assert.equal(f.page.data.monthScrollInto, 'month-3')
  assert.equal(f.page.data.visible.length, 0)
  f.page.onMonthSwipeStart({ target: { dataset: {} }, touches: [{ clientX: 150, clientY: 40 }] })
  f.page.onMonthSwipeEnd({ changedTouches: [{ clientX: 240, clientY: 42 }] })
  assert.equal(f.page.data.activeMonth, 2)
  assert.equal(f.page.data.monthScrollInto, 'month-2')
  f.page.onMonthSwipeStart({ target: { dataset: { cardGesture: true } }, touches: [{ clientX: 240, clientY: 40 }] })
  f.page.onMonthSwipeEnd({ changedTouches: [{ clientX: 150, clientY: 44 }] })
  assert.equal(f.page.data.activeMonth, 2, 'leftward card swipe remains owned by the horizontal row action')
  f.page.onUnload()
})
