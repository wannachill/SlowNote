const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { load, memoryDb, seed, service, front } = require('./helpers.cjs')

test('enabled allowlist permits listed users and rejects unlisted users with a stable 403', async () => {
  const data = seed(); data.allowlist = [{ _id: 'allowed', openid: 'user-a', remark: 'family' }]
  const db = memoryDb(data), api = service('statistics', db, { env: { ALLOWLIST_ENABLED: 'true' } })
  assert.equal((await api.main({ action: 'trend', range: 'all' })).code, 0)
  api.state.openid = 'user-b'
  const denied = await api.main({ action: 'trend', range: 'all' })
  assert.equal(denied.code, 403); assert.equal(denied.message, 'NOT_ALLOWED')
})

test('allowlist is disabled by default and only literal true enables it', async () => {
  const db = memoryDb(seed())
  assert.equal((await service('statistics', db).main({ range: 'all' })).code, 0)
  assert.equal((await service('statistics', db, { env: { ALLOWLIST_ENABLED: 'false' } }).main({ range: 'all' })).code, 0)
})

test('every endpoint rejects outsiders before business validation, preserving 401 identity errors', async () => {
  const db = memoryDb(seed()), env = { ALLOWLIST_ENABLED: 'true' }
  for (const name of ['aiChat', 'asrProxy', 'aiSettings', 'aiTasks', 'babyProfile', 'homeCards', 'feedingRecord', 'growthRecord', 'diaryRecord', 'customRecord', 'milestoneRecord', 'statistics', 'aiNotifications']) {
    const denied = await service(name, db, { env }).main({})
    assert.equal(denied.code, 403, name)
    assert.equal(denied.message, 'NOT_ALLOWED', name)
  }
  const unsigned = await service('statistics', db, { env, openid: '' }).main({})
  assert.equal(unsigned.code, 401); assert.equal(unsigned.message, 'UNAUTHORIZED')
  const missing = await service('statistics', db, { env, openid: 'not-created' }).main({})
  assert.equal(missing.code, 401); assert.equal(missing.message, 'USER_NOT_FOUND')
})

test('enabled allowlist fails closed when collection is missing or lookup throws', async () => {
  const db = memoryDb(seed()), original = db.collection.bind(db)
  db.collection = name => { if (name === 'allowlist') throw Error('missing or unavailable'); return original(name) }
  const result = await service('statistics', db, { env: { ALLOWLIST_ENABLED: 'true' } }).main({ range: 'all' })
  assert.equal(result.code, 403); assert.equal(result.message, 'NOT_ALLOWED')
})

test('allowlist cache is per openid, expires within TTL, and does not cache lookup failures', async () => {
  let now = 1000
  class TestDate extends Date { static now() { return now } }
  const env = { ALLOWLIST_ENABLED: 'true' }, runtime = load('cloudfunctions/_shared/runtime.js', { process: { env }, Date: TestDate })
  const db = memoryDb({ allowlist: [] }), query = db.collection.bind(db)
  let lookups = 0
  db.collection = name => {
    const collection = query(name)
    if (name === 'allowlist') {
      const where = collection.where
      collection.where = value => { lookups++; return where.call(collection, value) }
    }
    return collection
  }
  assert.equal(await runtime.isAllowed(db, 'user-a'), false)
  db.rows('allowlist').push({ _id: 'a', openid: 'user-a' })
  assert.equal(await runtime.isAllowed(db, 'user-a'), false)
  assert.equal(await runtime.isAllowed(db, 'user-b'), false, 'cache entries are scoped by openid')
  now += 60001
  assert.equal(await runtime.isAllowed(db, 'user-a'), true)
  assert.equal(lookups, 3)
  db.rows('allowlist').splice(0)
  assert.equal(await runtime.isAllowed(db, 'user-a'), true, 'a cached grant lasts at most the TTL')
  now += 60001
  assert.equal(await runtime.isAllowed(db, 'user-a'), false, 'revocation takes effect after TTL')

  const failing = memoryDb({}), failingCollection = failing.collection.bind(failing)
  let outage = true
  failing.collection = name => { if (name === 'allowlist' && outage) throw Error('temporary outage'); return failingCollection(name) }
  assert.equal(await runtime.isAllowed(failing, 'user-a'), false)
  outage = false
  failing.rows('allowlist').push({ _id: 'a', openid: 'user-a' })
  assert.equal(await runtime.isAllowed(failing, 'user-a'), true, 'errors are denied but not cached')
})

function makeReport(data) {
  const db = memoryDb(data), cloud = { DYNAMIC_CURRENT_ENV: 'test', init() {}, database: () => db, getWXContext: () => ({}) }
  let asks = 0
  const report = load('cloudfunctions/aiReport/index.js', { process: { env: { ALLOWLIST_ENABLED: 'true' } } }, {
    'wx-server-sdk': cloud,
    './lib/llm': { ask: async () => { asks++; return { text: 'report', configured: true } }, DISCLAIMER: '', redact: value => value },
    './lib/aggregation': { aggregate: async () => ({ data: {} }) },
    './lib/record-details': { buildDetails: async () => '', MESSAGE_LIMIT: 100, clipText: value => value },
    './lib/ai-settings': { loadSettings: async () => ({}), compose: () => '' }
  })
  return { db, report, asks: () => asks }
}
const reportTask = () => ({ _id: 'task', openid: 'user-a', enabled: true, next_run_at: new Date(0), lease_until: new Date(0), frequency: 'daily', time: '21:00', weekday: 1, categories: [], consent: true, notify: false })
const reportNow = new Date('2026-10-21T12:00:00.000Z')

test('aiReport skips non-allowlisted tasks before claiming or invoking the model', async () => {
  const task = reportTask()
  const { db, report, asks } = makeReport({ ...seed(), allowlist: [], ai_tasks: [{ ...task }] })
  assert.equal(await report.processTask(task, reportNow), false)
  assert.equal(asks(), 0)
  assert.equal(db.rows('ai_tasks')[0].enabled, true, 'the unauthorized task is skipped before claim')
})

test('aiReport processes an allowlisted task and invokes the model', async () => {
  const task = reportTask()
  const { db, report, asks } = makeReport({ ...seed(), allowlist: [{ _id: 'allow', openid: 'user-a' }], ai_tasks: [{ ...task }] })
  assert.equal(await report.processTask(task, reportNow), true, JSON.stringify(db.rows('ai_tasks')))
  assert.equal(asks(), 1)
  assert.equal(db.rows('ai_notifications').length, 1)
})

test('login remains open and the mine tab displays and copies the current denied openid', async () => {
  const db = memoryDb(seed()), login = service('login', db, { openid: 'new-family-member', env: { ALLOWLIST_ENABLED: 'true' } })
  const signedIn = await login.main()
  assert.equal(signedIn.code, 0)
  assert.equal(signedIn.openid, 'new-family-member')
  assert.equal(db.rows('users').some(row => row.openid === 'new-family-member'), true)

  const f = front('mine')
  f.app.globalData = { ...f.app.globalData, loggedIn: true, notAllowed: true, openid: 'new-family-member' }
  f.page.refresh()
  assert.equal(f.page.data.notAllowed, true)
  assert.equal(f.page.data.openid, 'new-family-member')
  f.page.copyOpenid()
  assert.ok(f.calls.some(call => call.type === 'copy' && call.data === 'new-family-member'))
  assert.ok(f.calls.some(call => call.type === 'toast' && call.title === '已复制，请发送给管理员'))
  const template = fs.readFileSync('miniprogram/pages/mine/index.wxml', 'utf8')
  assert.match(template, /本小程序仅限家庭成员使用，请联系管理员/)
  assert.match(template, /请复制下方 openid 并发送给管理员开通权限/)
  assert.match(template, /openid：\{\{openid\}\}/)
  assert.match(template, /wx:if="\{\{notAllowed && openid\}\}"/)
  assert.match(template, /selectable="\{\{true\}\}"/)

  const normal = front('mine')
  normal.app.globalData = { ...normal.app.globalData, loggedIn: true, notAllowed: false, openid: 'allowed-user' }
  normal.page.refresh()
  normal.page.copyOpenid()
  assert.equal(normal.page.data.openid, '')
  assert.equal(normal.calls.some(call => call.type === 'copy' || call.type === 'toast'), false)
  assert.doesNotMatch(template, /openid：\{\{openid\}\}[^\n]*wx:if="\{\{!notAllowed\}\}"/)
})

test('mine hides and cannot copy a missing openid, and clipboard failure explains the fallback', () => {
  const noId = front('mine')
  noId.app.globalData = { ...noId.app.globalData, notAllowed: true, openid: '' }
  noId.page.refresh()
  noId.page.copyOpenid()
  assert.equal(noId.page.data.openid, '')
  assert.equal(noId.calls.some(call => call.type === 'copy'), false)

  const failed = front('mine', { clipboardFail: true })
  failed.app.globalData = { ...failed.app.globalData, notAllowed: true, openid: 'copy-fail-user' }
  failed.page.refresh()
  failed.page.copyOpenid()
  assert.ok(failed.calls.some(call => call.type === 'toast' && call.title === '复制失败，请长按 openid 手动复制'))
})

test('initializeSession probes once and skips profile loading for denied accounts', async () => {
  const f = front('mine')
  let definition, profileCalls = 0, checks = 0
  const callOrder = []
  f.wx.cloud.callFunction = async ({ name }) => {
    callOrder.push(name)
    if (name === 'login') return { result: { code: 0, openid: 'outsider' } }
    if (name === 'aiSettings') { checks++; return { result: { code: 403, message: 'NOT_ALLOWED' } } }
    if (name === 'babyProfile') profileCalls++
    return { result: { code: 0 } }
  }
  load('miniprogram/app.js', { wx: f.wx, App: value => { definition = value }, getCurrentPages: () => [] })
  await definition.init()
  assert.equal(definition.globalData.notAllowed, true)
  assert.equal(definition.globalData.openid, 'outsider')
  assert.equal(profileCalls, 0)
  assert.equal(checks, 1)
  assert.deepEqual(callOrder.slice(0, 2), ['login', 'aiSettings'])
  assert.equal(f.calls.filter(call => call.type === 'toast').length, 0)
  definition.logout()
  assert.equal(definition.globalData.notAllowed, false)
})

test('a denied client call does not send cloud requests or emit automatic toasts', async () => {
  const f = front('mine'); let requests = 0
  f.app.globalData.notAllowed = true
  f.wx.cloud.callFunction = async () => { requests++; return { result: { code: 0 } } }
  const api = load('miniprogram/utils/api.js', { wx: f.wx, getApp: () => f.app })
  await assert.rejects(api.call('aiChat', {}), error => error.code === 403 && error.serverMessage === 'NOT_ALLOWED')
  assert.equal(requests, 0)
  assert.equal(f.calls.length, 0)
})

test('aiSettings access probe is lightweight and TIMER_ONLY remains enforced', async () => {
  const data = seed(); data.allowlist = [{ _id: 'a', openid: 'user-a' }]
  const db = memoryDb(data), collection = db.collection.bind(db)
  db.collection = name => { if (name === 'ai_settings') throw Error('probe must not read prompts'); return collection(name) }
  assert.equal((await service('aiSettings', db, { env: { ALLOWLIST_ENABLED: 'true' } }).main({ action: 'checkAccess' })).code, 0)
  const report = service('aiReport', db, { env: { ALLOWLIST_ENABLED: 'true' } })
  const denied = await report.main({ Type: 'Timer' })
  assert.equal(denied.code, 403); assert.equal(denied.message, 'TIMER_ONLY')
})
