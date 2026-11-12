const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs')
const { front, seed, memoryDb, service } = require('./helpers.cjs')

async function enter(options = {}) {
  const f = front('growth', options)
  f.app.globalData.activeBabyId = 'baby-a'
  await f.page.onLoad({ panel: 'growth', date: '2026-10-21' })
  return f
}

async function enterNormal(options = {}) {
  const f = front('growth', options)
  f.app.globalData.activeBabyId = 'baby-a'
  await f.page.onLoad({ date: '2026-10-21' })
  await f.page.onShow()
  return f
}

test('growth quick-entry exposes all three optional measurements and submits them together once', async () => {
  const db = memoryDb(seed(['growth'])), api = service('growthRecord', db), requests = []
  const f = await enter({ callFunction: async request => {
    requests.push(request)
    return { result: await api.main(request.data) }
  } })
  try {
    const wxml = fs.readFileSync('miniprogram/pages/growth/index.wxml', 'utf8').split('<view wx:if="{{panelMode}}"')[1]
    assert.ok(wxml, 'quick-entry registration form must be present')
    assert.ok(!wxml.includes('data-field="measurement"'), 'quick-entry must expose independent fields')
    for (const field of ['height', 'weight', 'head']) {
      assert.match(wxml, new RegExp(`data-field="${field}"`))
      assert.match(wxml, new RegExp(`value="{{${field}}}"`))
    }
    f.page.setData({ height: '65.5', weight: '6.25', head: '41.2' })
    await f.page.submit()
    assert.equal(requests.length, 1)
    assert.deepEqual({ height: requests[0].data.height, weight: requests[0].data.weight, head: requests[0].data.head }, { height: '65.5', weight: '6.25', head: '41.2' })
    assert.equal(db.rows('growth_records').length, 1)
    assert.equal(db.rows('growth_records')[0].height, 65.5)
    assert.equal(db.rows('growth_records')[0].weight, 6.25)
    assert.equal(db.rows('growth_records')[0].head, 41.2)
    assert.equal(db.rows('growth_records')[0].baby_id, 'baby-a')
    assert.ok(requests[0].data.clientRequestId)
    assert.ok(f.calls.some(call => call.icon === 'success'))
  } finally { f.page.onUnload() }
})

test('growth quick-entry accepts any one or more valid measurements and rejects invalid values inline', async () => {
  for (const input of [
    { height: '65', weight: '', head: '' },
    { height: '', weight: '6.2', head: '' },
    { height: '', weight: '', head: '41' },
    { height: '65', weight: '6.2', head: '' },
    { height: '65', weight: '6.2', head: '41' }
  ]) {
    let calls = 0
    const f = await enter({ callFunction: async () => { calls++; return { result: { code: 0 } } } })
    try {
      f.page.setData(input)
      await f.page.submit()
      assert.equal(calls, 1)
      assert.ok(f.calls.some(call => call.icon === 'success'))
    } finally { f.page.onUnload() }
  }
  for (const [field, value] of [['height', '0'], ['height', '251'], ['weight', '0'], ['weight', '301'], ['head', '0'], ['head', '101']]) {
    let calls = 0
    const f = await enter({ callFunction: async () => { calls++; return { result: { code: 0 } } } })
    try {
      f.page.setData({ [field]: value })
      await f.page.submit()
      assert.equal(calls, 0, field + ':' + value)
      assert.match(f.page.data.fieldErrors[field], /有效数值/)
      assert.equal(f.page.data[field], value)
      f.page.onInput({ currentTarget: { dataset: { field } }, detail: { value: field === 'height' ? '65' : field === 'weight' ? '6.2' : '41' } })
      assert.equal(f.page.data.fieldErrors[field], '')
    } finally { f.page.onUnload() }
  }
})

test('growth quick-entry rejects an empty form and retains submission idempotency on response loss', async () => {
  const empty = await enter({ callFunction: async () => ({ result: { code: 0 } }) })
  try {
    await empty.page.submit()
    assert.ok(empty.calls.some(call => call.title === '请至少填写一项'))
    assert.equal(empty.page.data.submitting, false)
  } finally { empty.page.onUnload() }

  const db = memoryDb(seed(['growth'])), api = service('growthRecord', db), ids = []
  const f = await enter({ callFunction: async request => {
    ids.push(request.data.clientRequestId)
    const result = await api.main(request.data)
    if (ids.length === 1) throw Error('response connection lost')
    return { result }
  } })
  try {
    f.page.setData({ height: '65', weight: '6.2', head: '41' })
    await f.page.submit()
    assert.equal(f.page.data.submitting, false)
    assert.equal(f.page.data.weight, '6.2')
    await f.page.submit()
    assert.equal(ids.length, 2)
    assert.equal(ids[0], ids[1])
    assert.equal(db.rows('growth_records').length, 1)
    assert.equal(db.rows('growth_records')[0].head, 41)
  } finally { f.page.onUnload() }
})

test('growth page queries only the selected date and prefills its measurements for update', async () => {
  const listed = []
  const f = await enterNormal({ callFunction: async request => {
    if (request.name === 'growthRecord') listed.push(request)
    return { result: { code: 0, records: request.data.recordDate === '2026-10-21'
      ? [{ _id: 'today', record_date: '2026-10-21', height: 65.5, weight: 6.25, head: 41.2 }]
      : [] } }
  } })
  try {
    assert.equal(listed.length, 1)
    assert.equal(listed[0].data.action, 'listDate')
    assert.equal(listed[0].data.recordDate, '2026-10-21')
    assert.equal(listed[0].data.baby_id, 'baby-a')
    assert.equal(f.page.data.editingId, 'today')
    assert.deepEqual([f.page.data.height, f.page.data.weight, f.page.data.head], ['65.5', '6.25', '41.2'])
    f.page.setData({ weight: '6.4' })
    await f.page.submit()
    assert.equal(listed.length, 2)
    assert.equal(listed[1].data.action, 'update')
    assert.equal(listed[1].data.id, 'today')
  } finally { f.page.onUnload() }
})

test('growth date switching clears fields when the selected date has no record', async () => {
  const requests = []
  const f = await enterNormal({ callFunction: async request => {
    if (request.name === 'growthRecord') requests.push(request)
    return { result: { code: 0, records: request.data.recordDate === '2026-10-21'
      ? [{ _id: 'today', record_date: '2026-10-21', height: 65, weight: 6.2 }]
      : [] } }
  } })
  try {
    assert.equal(f.page.data.editingId, 'today')
    f.page.onDate({ detail: { value: '2026-10-20' } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests.length, 2)
    assert.equal(requests[1].data.action, 'listDate')
    assert.equal(requests[1].data.recordDate, '2026-10-20')
    assert.equal(f.page.data.editingId, '')
    assert.deepEqual([f.page.data.height, f.page.data.weight, f.page.data.head], ['', '', ''])
  } finally { f.page.onUnload() }
})

test('growth homepage card opens a prefilled full-screen editor without a delete control', async () => {
  const requests = []
  const f = front('growth', { callFunction: async request => {
    if (request.name === 'growthRecord') requests.push(request)
    return { result: { code: 0, records: [{ _id: 'today', record_date: '2026-10-21', height: 65, weight: 6.2, head: 41 }] } }
  } })
  f.app.globalData.activeBabyId = 'baby-a'
  await f.page.onLoad({ cardEdit: '1', recordKey: 'growth', date: '2026-10-21' })
  await f.page.onShow()
  try {
    assert.equal(f.page.data.panelMode, true)
    assert.equal(f.page.data.editingId, 'today')
    assert.deepEqual([f.page.data.height, f.page.data.weight, f.page.data.head], ['65', '6.2', '41'])
    assert.equal(requests.length, 1)
    const template = fs.readFileSync('miniprogram/pages/growth/index.wxml', 'utf8')
    assert.doesNotMatch(template, /deleteSelectedDateRecord|删除该天记录/)
  } finally { f.page.onUnload() }
})

test('growth form layouts keep date first and three measurement fields in both entry modes', async () => {
  const template = fs.readFileSync('miniprogram/pages/growth/index.wxml', 'utf8')
  const style = fs.readFileSync('miniprogram/pages/growth/index.wxss', 'utf8')
  const normal = template.split('<view wx:if="{{panelMode}}"')[0]
  const panel = template.split('<view wx:if="{{panelMode}}"')[1]
  for (const form of [normal, panel]) {
    const dateField = form.indexOf('class="field"><text class="field-label">记录日期')
    assert.ok(dateField >= 0 && dateField < form.indexOf('class="row"'))
    assert.ok(form.indexOf('class="select-value pressable"', dateField) > dateField)
    for (const field of ['height', 'weight', 'head']) assert.match(form, new RegExp(`data-field="${field}"`))
  }
  assert.doesNotMatch(template, /date-row|date-value|date-picker/)
  assert.doesNotMatch(template, /history-card|history-swipe|wx:for="\{\{records\}\}"/)
  assert.doesNotMatch(style, /history-card|history-swipe|\.record-date|\.record-growth-desc|\.record-measure/)
})
