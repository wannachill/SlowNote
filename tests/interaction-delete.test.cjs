const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { front } = require('./helpers.cjs')
const flush = () => new Promise(resolve => setImmediate(resolve))
const tap = id => ({ currentTarget: { dataset: { id, key: id } } })

for (const spec of [
  { name: 'ai-tasks', list: 'items', field: '_id', remove: 'remove' },
  { name: 'ai-notifications', list: 'items', field: 'id', remove: 'remove' },
  { name: 'baby', list: 'babies', field: 'baby_id', remove: 'deleteBaby' },
  { name: 'ai-history', list: 'list', field: 'sessionId', remove: 'onRemove' }
]) {
  for (const fails of [false, true]) test(`${spec.name}: deletion is immediate, one write, no reload; ${fails ? 'failure restores the row' : 'success keeps it removed'}`, async () => {
    let resolve, reject, writes = 0, listQueries = 0
    const deferred = new Promise((yes, no) => { resolve = yes; reject = no })
    const f = front(spec.name, { callFunction: request => {
      assert.equal(['remove', 'delete'].includes(request.data.action), true)
      assert.ok(request.data.clientRequestId)
      writes++
      return deferred
    } })
    Object.assign(f.app.globalData, { openid: 'user-a', activeBabyId: 'baby-a' })
    const rows = ['a', 'b'].map(id => ({ [spec.field]: id, nickname: id, swipeX: -55 }))
    f.page.setData({ [spec.list]: rows, total: 2 })
    f.app.globalData.babies = [{ baby_id: 'a', nickname: 'a' }, { baby_id: 'b', nickname: 'b' }]
    f.app.globalData.activeBabyId = spec.name === 'baby' ? 'a' : 'baby-a'
    f.app.setActiveBaby = id => { f.app.globalData.activeBabyId = id }
    if (spec.name === 'ai-history') f.wx.cloud.database = () => ({ collection: () => ({
      where() { listQueries++; return { limit() { return this }, async get() { return { data: [{ _id: 'doc-a' }] } } } },
      doc() { return { remove() { writes++; return deferred } } }
    }) })
    let confirm
    f.page.confirmDanger = options => { confirm = options }
    f.page.load = f.page.refresh = () => { throw Error('deletion must not reload') }
    f.page[spec.remove](tap('a'))
    assert.equal(f.page.data[spec.list].length, 2, 'confirmation precedes removal')
    const pending = confirm.success({ confirm: true })
    assert.equal(f.page.data[spec.list].length, 1, 'local removal occurs in confirmation callback')
    assert.equal(f.page.data[spec.list][0][spec.field], 'b')
    if (spec.name === 'ai-notifications') assert.equal(f.page.data.total, 1)
    await flush()
    assert.equal(writes, 1)
    if (fails) reject(Error('offline'))
    else resolve({ result: { code: 0 } })
    await pending
    assert.equal(f.page.data[spec.list].length, fails ? 2 : 1)
    if (fails) {
      assert.equal(f.page.data[spec.list][0][spec.field], 'a')
      assert.equal(f.page.data[spec.list][0].swipeX, 0)
      assert.equal(f.calls.some(call => call.type === 'toast'), true)
    }
    if (spec.name === 'ai-notifications') assert.equal(f.page.data.total, fails ? 2 : 1)
    if (spec.name === 'baby') assert.equal(f.app.globalData.activeBabyId, fails ? 'a' : 'b')
    if (spec.name === 'ai-history') assert.equal(listQueries, 1, 'only the existing by-id lookup, no list query')
    f.page.onUnload()
  })
}

for (const fails of [false, true]) test(`milestone definition removal is local without reload; ${fails ? 'failed request rolls back' : 'one request succeeds'}`, async () => {
  let finish, requests = 0
  const f = front('milestone', { callFunction: request => {
    assert.equal(request.data.action, 'removeDef')
    assert.ok(request.data.clientRequestId)
    requests++
    return new Promise(resolve => { finish = resolve })
  } })
  Object.assign(f.app.globalData, { openid: 'user-a', activeBabyId: 'baby-a' })
  const rows = ['a', 'b'].map((key, index) => ({ key, name: key, month: 1, sort_order: index, done: false, swipeX: 0 }))
  f.page.setData({ all: rows, activeMonth: 1 })
  f.page.applyFilter()
  f.page.load = () => { throw Error('must not reload') }
  const pending = f.page.deleteDefinition(rows[0])
  assert.deepEqual(Array.from(f.page.data.all, item => item.key), ['b'])
  assert.deepEqual(Array.from(f.page.data.visible, item => item.key), ['b'])
  finish({ result: { code: fails ? 503 : 0 } })
  await pending
  assert.equal(requests, 1)
  assert.deepEqual(Array.from(f.page.data.visible, item => item.key), fails ? ['a', 'b'] : ['b'])
  assert.equal(f.page.data.busy, false)
  f.page.onUnload()
})

test('question removal renders before storage and restores on storage failure', () => {
  const f = front('ai-settings')
  f.app.globalData.openid = 'user-a'
  f.page.loadQuestions()
  const before = f.page.data.questions.length, id = f.page.data.questions[0].id
  f.page.confirmDanger = options => options.success({ confirm: true })
  f.page.loadQuestions = () => { throw Error('must not reload') }
  f.wx.setStorageSync = () => {
    assert.equal(f.page.data.questions.length, before - 1)
    throw Error('storage full')
  }
  f.page.removeQuestion(tap(id))
  assert.equal(f.page.data.questions.length, before)
  assert.equal(f.calls.some(call => call.type === 'toast'), true)
})

test('rollback preserves other row edits and ignores a changed account/date scope', () => {
  const checks = []
  for (const changed of [false, true]) {
    let reject
    const f = front('ai-notifications', { callFunction: () => new Promise((resolve, no) => { reject = no }) })
    Object.assign(f.app.globalData, { openid: 'a', activeBabyId: 'baby-a' })
    f.page.setData({ items: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], total: 2 })
    let pending
    f.page.confirmDanger = options => { pending = options.success({ confirm: true }) }
    f.page.remove(tap('a'))
    f.page.setData({ 'items[0].title': '新标题' })
    if (changed) { f.app.globalData.openid = 'other'; f.page.setData({ startDate: '2026-11-01', total: 10 }) }
    reject(Error('offline'))
    // Return promises to the runner so failures cannot escape as unhandled rejections.
    checks.push(pending.then(() => {
      assert.equal(f.page.data.items.find(item => item.id === 'b').title, '新标题')
      assert.equal(f.page.data.items.some(item => item.id === 'a'), !changed)
      if (changed) assert.equal(f.page.data.total, 10)
    }))
  }
  return Promise.all(checks)
})

test('four editors have one delete action, bounded scrolling, and baby current tag cannot bleed through', () => {
  for (const name of ['baby', 'ai-tasks', 'ai-settings', 'milestone']) {
    const template = fs.readFileSync(`miniprogram/pages/${name}/index.wxml`, 'utf8')
    const style = fs.readFileSync(`miniprogram/pages/${name}/index.wxss`, 'utf8')
    const actions = [...template.matchAll(/<view class="(?:question-)?swipe-actions">([\s\S]*?)<\/view>/g)]
    assert.ok(actions.length, name)
    for (const [, body] of actions) {
      assert.doesNotMatch(body, /编辑|startEdit/)
      assert.equal((body.match(/<button/g) || []).length, 1)
      assert.match(body, /删除/)
    }
    assert.match(template, /scroll-y="\{\{!swipeScrollLocked\}\}"/)
    assert.doesNotMatch(template, /class="(?:baby-row|task-item|question-item|milestone pressable)"[^>]*catchtouchmove="noop"/)
    assert.match(style, /width:\s*calc\(var\(--swipe-action-width\) \/ 2\)/)
    assert.match(style, /height:\s*100vh/)
    assert.match(template, /class="swipe-list-content"/)
    assert.match(style, /\.swipe-list-content\s*\{[^}]*padding-bottom:\s*calc\(var\(--space-m\) \+ env\(safe-area-inset-bottom\)\)/)
  }
  const baby = fs.readFileSync('miniprogram/pages/baby/index.wxss', 'utf8')
  assert.match(baby, /\.baby-swipe\.swipe-open \.baby-row-tag\s*\{[^}]*opacity:\s*0;[^}]*visibility:\s*hidden/)
  assert.match(baby, /\.baby-row\s*\{[^}]*background:\s*var\(--color-surface\);[^}]*overflow:\s*hidden;[^}]*isolation:\s*isolate/s)
  assert.doesNotMatch(baby, /will-change/)
  assert.match(fs.readFileSync('miniprogram/pages/baby/index.wxml', 'utf8'), /bindtap="setCurrentBaby"[^>]*>设为当前宝宝/)
})

for (const fails of [false, true]) test(`chat question deletion persists once; ${fails ? 'failure restores pairs' : 'success keeps removal'}`, async () => {
  let finish, reject, saves = 0
  const f = front('ai-chat')
  f.app.globalData.openid = 'user-a'
  f.page._sessionId = 'session-a'
  f.page._nodeCache = Object.create(null)
  f.page._reasonCache = Object.create(null)
  const messages = [{ id: 'u1', role: 'user', content: 'Q1' }, { id: 'a1', role: 'assistant', content: 'A1' }, { id: 'u2', role: 'user', content: 'Q2' }]
  f.page.setData({ messages, picked: { u1: true } })
  f.wx.cloud.database = () => ({ collection: () => ({
    where() { return { limit() { return this }, async get() { return { data: [{ _id: 'doc-a' }] } } } },
    doc() { return { update() { saves++; return new Promise((yes, no) => { finish = yes; reject = no }) } } }
  }) })
  let modal
  f.wx.showModal = options => { modal = options }
  f.page.deletePicked()
  assert.equal(f.page.data.messages.length, 3)
  const pending = modal.success({ confirm: true })
  assert.deepEqual(Array.from(f.page.data.messages, item => item.id), ['u2'])
  await flush()
  assert.equal(saves, 1)
  f.page.setData({ question: '删除请求期间的新问题' })
  const currentMessages = f.page.data.messages
  await f.page.send()
  assert.equal(f.page.data.messages, currentMessages, 'a pending deletion cannot race with a new answer save')
  if (fails) reject(Error('offline'))
  else finish({})
  await pending
  assert.deepEqual(Array.from(f.page.data.messages, item => item.id), fails ? ['u1', 'a1', 'u2'] : ['u2'])
  if (fails) assert.equal(f.calls.some(call => call.title === '删除失败，请重试'), true)
})

test('record forms have no separate cloud-delete modal; chat has one explicit pair-delete path', () => {
  for (const name of ['feeding', 'solid', 'excretion', 'growth', 'diary', 'custom-record']) {
    const script = fs.readFileSync(`miniprogram/pages/${name}/index.js`, 'utf8')
    assert.doesNotMatch(script, /wx\.showModal|confirmDanger/)
  }
  const chat = fs.readFileSync('miniprogram/pages/ai-chat/index.js', 'utf8')
  assert.equal((chat.match(/wx\.showModal\(/g) || []).length, 4)
  assert.match(chat, /title: '删除问答'/)
  assert.match(chat, /await this\._persist\(true\)/)
})

test('older autosaves cannot finish after a newer explicit session deletion', async () => {
  const { load } = require('./helpers.cjs')
  let finishOld
  const writes = []
  const wx = { cloud: { database: () => ({ collection: () => ({
    where() { return { limit() { return this }, async get() { return { data: [{ _id: 'session-doc' }] } } } },
    doc() { return {
      update({ data }) {
        writes.push(data.messages[0].content)
        return writes.length === 1 ? new Promise(resolve => { finishOld = resolve }) : Promise.resolve()
      },
      async remove() { writes.push('removed') }
    } }
  }) }) } }
  const sessions = load('miniprogram/utils/ai-sessions.js', { wx, getApp: () => ({ globalData: { activeBabyId: 'baby-a' } }) })
  const old = sessions.saveSession('user-a', 'session-a', [{ role: 'user', content: 'before deletion' }])
  await flush()
  const updated = sessions.saveSession('user-a', 'session-a', [{ role: 'user', content: 'remaining question' }], true)
  const removed = sessions.removeSession('user-a', 'session-a')
  await flush()
  assert.deepEqual(writes, ['before deletion'], 'later writes wait for the older autosave')
  finishOld()
  await Promise.all([old, updated, removed])
  assert.deepEqual(writes, ['before deletion', 'remaining question', 'removed'])
})

test('a list response started before report deletion cannot resurrect the removed card', async () => {
  let finishList, finishRemove
  const f = front('ai-notifications', { callFunction: ({ data }) => new Promise(resolve => {
    if (data.action === 'list') finishList = resolve
    else finishRemove = resolve
  }) })
  f.page.setData({ items: [{ id: 'a', swipeX: 0 }, { id: 'b', swipeX: 0 }], total: 2 })
  const loading = f.page.load()
  let deleting
  f.page.confirmDanger = options => { deleting = options.success({ confirm: true }) }
  f.page.remove(tap('a'))
  assert.equal(f.page.data.loading, false)
  finishList({ result: { code: 0, items: [{ id: 'a' }, { id: 'b' }], total: 2 } })
  await loading
  assert.deepEqual(Array.from(f.page.data.items, item => item.id), ['b'])
  finishRemove({ result: { code: 0 } })
  await deleting
  assert.equal(f.page.data.total, 1)
})
