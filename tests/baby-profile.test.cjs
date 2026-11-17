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

test('tapping opens the editor and its explicit action switches the baby', () => {
  const { page, app } = withBabies()
  page.refresh()
  page.onCardTap({ currentTarget: { dataset: { id: 'baby-b' } } })
  assert.equal(app.globalData.activeBabyId, 'baby-a')
  assert.equal(page.data.editingBabyId, 'baby-b')
  page.setCurrentBaby()
  assert.equal(app.globalData.activeBabyId, 'baby-b')
  assert.equal(page.data.panel, false)
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

test('partial baby cleanup keeps the deleted profile removed and retries with the same request', async () => {
  const f = withBabies(), requests = [], dialogs = []
  f.app.globalData.openid = 'user-a'
  f.page.refresh()
  f.wx.showModal = options => { dialogs.push(options) }
  f.wx.cloud.callFunction = async ({ data }) => { requests.push(data); return { result: { code: 0, babyDeleted: true, pending: requests.length === 1 ? { ai_sessions: { code: 503 } } : {} } } }
  let action
  f.page.confirmDanger = options => { action = options }
  f.page.deleteBaby({ currentTarget: { dataset: { id: 'baby-a' } } })
  await action.success({ confirm: true })
  assert.equal(f.page.data.babies.some(row => row.baby_id === 'baby-a'), false)
  assert.equal(f.app.globalData.activeBabyId, 'baby-b')
  assert.equal(f.calls.some(call => call.title === '已删除'), false)
  assert.match(dialogs[0].content, /档案已删除/)
  const key = f.page.babyDeletionKey('user-a')
  assert.equal(f.storage[key][0].babyDeleted, true)
  await dialogs[0].success({ confirm: true })
  dialogs[0].complete()
  assert.equal(requests.length, 2)
  assert.equal(requests[0].clientRequestId, requests[1].clientRequestId)
  assert.equal(f.storage[key].length, 0)
})

test('baby cleanup survives reentry, stays account-scoped and never restores an acknowledged deletion', async () => {
  const f = withBabies(), dialogs = []
  f.app.globalData.openid = 'user-a'
  const job = { babyId: 'baby-a', clientRequestId: 'persisted-delete-001', babyDeleted: true }
  f.storage[f.page.babyDeletionKey('user-a')] = [job]
  f.app.globalData.babies = f.app.globalData.babies.filter(row => row.baby_id !== 'baby-a')
  f.wx.showModal = options => { dialogs.push(options) }
  await f.page.onShow()
  assert.equal(dialogs.length, 1)
  f.wx.cloud.callFunction = async () => { throw Error('offline') }
  await dialogs[0].success({ confirm: true })
  dialogs[0].complete()
  assert.equal(f.page.data.babies.some(row => row.baby_id === 'baby-a'), false)
  assert.equal(f.storage[f.page.babyDeletionKey('user-a')].length, 1)
  f.app.globalData.openid = 'user-b'
  await f.page.onShow()
  assert.equal(dialogs.length, 1, 'another account must not receive the old cleanup job')
})

test('baby deletion with a lost response persists its original request for a safe later retry', async () => {
  const f = withBabies()
  f.app.globalData.openid = 'user-a'
  f.page.refresh()
  const requests = []
  f.wx.cloud.callFunction = async ({ data }) => { requests.push(data); throw Error('response lost') }
  let action
  f.page.confirmDanger = options => { action = options }
  f.page.deleteBaby({ currentTarget: { dataset: { id: 'baby-a' } } })
  await action.success({ confirm: true })
  assert.equal(f.page.data.babies.length, 2, 'unknown deletion keeps the existing rollback contract')
  const jobs = f.storage[f.page.babyDeletionKey('user-a')]
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].clientRequestId, requests[0].clientRequestId)
  f.wx.cloud.callFunction = async ({ data }) => { requests.push(data); return { result: { code: 0, babyDeleted: true, pending: {} } } }
  await f.page.runBabyDeletion(jobs[0], 'user-a')
  assert.equal(requests[1].clientRequestId, requests[0].clientRequestId)
  assert.equal(f.page.data.babies.length, 1)
})

test('baby delete confirmation cannot cross an account switch or send an unpersisted request', async () => {
  for (const accountSwitch of [true, false]) {
    const f = withBabies()
    f.app.globalData.openid = 'user-a'
    f.page.refresh()
    let action, writes = 0
    f.page.confirmDanger = options => { action = options }
    f.wx.cloud.callFunction = async () => { writes++; return { result: { code: 0 } } }
    f.page.deleteBaby({ currentTarget: { dataset: { id: 'baby-a' } } })
    if (accountSwitch) f.app.globalData.openid = 'user-b'
    else f.wx.setStorageSync = () => { throw Error('storage full') }
    await action.success({ confirm: true })
    assert.equal(writes, 0)
    assert.equal(f.page.data.babies.length, 2)
  }
})
