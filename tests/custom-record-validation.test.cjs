const fs = require('node:fs'), test = require('node:test'), assert = require('node:assert/strict')
const { front, seed, memoryDb, service } = require('./helpers.cjs')
const date = '2026-10-21'
const event = (field, value) => ({ currentTarget: { dataset: { field } }, detail: { value } })

async function enter(options = {}, category = 'custom', panel = true) {
  const f = front('custom-record', options)
  f.app.globalData.activeBabyId = 'baby-a'
  await f.page.onLoad({ category, panel: panel ? '1' : '', date })
  return f
}

test('custom quantity with a unit gets an inline error without sending or losing the draft', async () => {
  for (const panel of [false, true]) {
    let writes = 0
    const f = await enter({ callFunction: async request => { if (request.data.action === 'add') writes++; return { result: { code: 0, records: [] } } } }, 'custom', panel)
    try {
      f.page.setData({ label: '吃药', value: '10ml', unit: '次', note: 'AD' })
      await f.page.save()
      assert.equal(writes, 0)
      assert.match(f.page.data.fieldErrors.value, /数字/)
      assert.match(f.page.data.fieldErrors.value, /数值只填数字/)
      assert.doesNotMatch(f.page.data.fieldErrors.value, /点选/)
      assert.equal(f.page.data.value, '10ml')
      assert.equal(f.page.data.unit, '次')
      assert.equal(f.page.data.note, 'AD')
      assert.equal(f.page.data.submitting, false)
      assert.ok(!f.calls.some(call => call.icon === 'success'))
      f.page.onInput(event('note', 'AD补充'))
      assert.ok(f.page.data.fieldErrors.value, 'editing a note must retain the quantity error')
      f.page.onInput(event('value', '10'))
      assert.equal(f.page.data.fieldErrors.value, '')
      f.page.onInput(event('unit', 'ml'))
      await f.page.save()
      assert.equal(writes, 1)
      assert.ok(f.calls.some(call => call.icon === 'success'))
    } finally { f.page.onUnload() }
  }
})

test('custom numeric values and omitted quantities persist through the unchanged cloud contract', async () => {
  const unitPage = await enter()
  try {
    assert.equal(Object.hasOwn(unitPage.page.data, 'units'), false)
    unitPage.page._id = 'retry-id'
    unitPage.page.onInput(event('unit', 'kilograms'))
    assert.equal(unitPage.page.data.unit, 'kilograms')
    assert.equal(unitPage.page._id, '')
  } finally { unitPage.page.onUnload() }
  const markup = fs.readFileSync('miniprogram/pages/custom-record/index.wxml', 'utf8')
  assert.match(markup, /wx:if="\{\{loading && !records\.length\}\}" class="status-block skeleton-loading"/)
  assert.doesNotMatch(markup, /wx:if="\{\{loading\}\}" class="status-block skeleton-loading"/)
  const unitInputs = [...markup.matchAll(/<input[^>]*data-field="unit"[^>]*\/>/g)].map(match => match[0])
  assert.equal(unitInputs.length, 2)
  for (const input of unitInputs) {
    assert.match(input, /class="input"/)
    assert.match(input, /value="\{\{unit\}\}"/)
    assert.match(input, /maxlength="6"/)
    assert.match(input, /placeholder="如：次、ml、g、kg、分钟"/)
  }
  assert.doesNotMatch(markup, /selectUnit|wx:for="\{\{units\}\}"/)
  const cases = [['10', 10], ['10.5', 10.5], ['0', 0], ['', null], ['   ', null], [' 10 ', 10], ['999999', 999999]]
  for (const [draft, expected] of cases) {
    const db = memoryDb(seed()), api = service('customRecord', db), requests = []
    const f = await enter({ callFunction: async request => { requests.push(request); return { result: await api.main(request.data) } } })
    try {
      f.page.setData({ label: '吃药', value: draft, unit: 'ml', note: 'AD' })
      await f.page.save()
      const rows = db.rows('custom_records')
      assert.equal(rows.length, 1, draft)
      assert.equal(rows[0].value, expected)
      assert.equal(rows[0].unit, 'ml')
      assert.equal(rows[0].note, 'AD')
      assert.equal(rows[0].baby_id, 'baby-a')
      assert.equal(requests[0].data.action, 'add')
      assert.equal(requests[0].data.category, 'custom')
      assert.ok(requests[0].data.clientRequestId)
      assert.ok(f.calls.some(call => call.icon === 'success'))
      assert.equal(f.page.data.closing, true)
      assert.equal(f.page.data.value, draft, 'draft remains while the registration sheet closes')
    } finally { f.page.onUnload() }
  }
})

test('custom numeric validation matches the existing server bounds', async () => {
  for (const value of ['-1', '1000000', 'NaN', 'Infinity', '10ml']) {
    let writes = 0
    const f = await enter({ callFunction: async () => { writes++; return { result: { code: 0 } } } })
    try {
      f.page.setData({ label: '记录', value })
      await f.page.save()
      assert.equal(writes, 0, 'custom:' + value)
      assert.ok(f.page.data.fieldErrors.value)
      assert.equal(f.page.data.value, value)
      assert.equal(f.page.data.submitting, false)
    } finally { f.page.onUnload() }
  }
})

test('retry after a lost save response reuses the request identity and never duplicates the record', async () => {
  const db = memoryDb(seed()), api = service('customRecord', db), requests = []
  const f = await enter({ callFunction: async request => {
    requests.push(request.data)
    const result = await api.main(request.data)
    if (requests.length === 1) throw Error('response connection lost')
    return { result }
  } })
  try {
    f.page.setData({ label: '吃药', value: '10', unit: 'ml', note: 'AD' })
    await f.page.save()
    assert.equal(f.page.data.value, '10')
    assert.equal(f.page.data.submitting, false)
    assert.ok(!f.calls.some(call => call.icon === 'success'))
    await f.page.save()
    assert.equal(requests.length, 2)
    assert.equal(requests[0].clientRequestId, requests[1].clientRequestId)
    assert.equal(db.rows('custom_records').length, 1)
    assert.ok(f.calls.some(call => call.icon === 'success'))
  } finally { f.page.onUnload() }
})

test('custom saves require login while module grants are no longer needed', async () => {
  let writes = 0
  const signedOut = await enter({ callFunction: async () => { writes++; return { result: { code: 0 } } } })
  try {
    signedOut.app.globalData.loggedIn = false
    signedOut.page.setData({ label: '吃药', value: '10', unit: 'ml' })
    await signedOut.page.save()
    assert.equal(writes, 0)
    assert.ok(signedOut.calls.some(call => call.title && call.title.includes('登录')))
  } finally { signedOut.page.onUnload() }
  const db = memoryDb(seed([])), api = service('customRecord', db)
  const permitted = await enter({ callFunction: async request => ({ result: await api.main(request.data) }) })
  try {
    permitted.page.setData({ label: '吃药', value: '10', unit: 'ml', note: 'AD' })
    await permitted.page.save()
    assert.equal(db.rows('custom_records').length, 1)
    assert.ok(permitted.calls.some(call => call.icon === 'success'))
    assert.ok(!permitted.calls.some(call => call.title && call.title.includes('尚未开放')))
  } finally { permitted.page.onUnload() }
})
