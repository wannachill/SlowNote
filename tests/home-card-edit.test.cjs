const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs')
const { front } = require('./helpers.cjs')

const date = '2026-10-21'
const flush = () => new Promise(resolve => setImmediate(resolve))
const record = (fields = {}) => ({ _id: 'record-1', id: 'record-1', record_date: date, created_at: '2026-10-21T01:00:00.000Z', ...fields })

const cases = [
  {
    page: 'feeding', name: 'feedingRecord', options: { panel: 'feed', recordKey: 'breast' },
    row: record({ type: 'feed', payload: { mode: 'breast', durationMin: 18 } }),
    values: page => [page.data.feedType, page.data.duration, page.data.amount],
    expected: ['breast', '18', ''],
    save: page => page.submitFeed()
  },
  {
    page: 'solid', name: 'feedingRecord', options: { panel: 'solid', recordKey: 'solid' },
    row: record({ type: 'solid', payload: { name: '南瓜泥', note: '两勺' } }),
    values: page => [page.data.solidName, page.data.solidNote],
    expected: ['南瓜泥', '两勺'],
    save: page => page.submitSolid()
  },
  {
    page: 'excretion', name: 'feedingRecord', options: { panel: 'excretion', recordKey: 'excretion' },
    row: record({ type: 'excretion', payload: { kind: 'stool', count: 1, shape: '正常' } }),
    values: page => [page.data.exKind, page.data.exCount, page.data.exShape],
    expected: ['stool', '1', '正常'],
    save: page => page.submitExcretion()
  },
  {
    page: 'growth', name: 'growthRecord', options: { panel: 'growth', recordKey: 'growth' },
    row: record({ height: 65.5, weight: 6.2, head: 41 }),
    values: page => [page.data.height, page.data.weight, page.data.head],
    expected: ['65.5', '6.2', '41'],
    save: page => page.submit()
  },
  {
    page: 'diary', name: 'diaryRecord', options: { panel: '1', recordKey: 'diary' },
    row: record({ content: '第一次翻身', images: [] }),
    values: page => [page.data.content, page.data.images.length],
    expected: ['第一次翻身', 0],
    save: page => page.submit()
  },
  {
    page: 'custom-record', name: 'customRecord', options: { panel: '1', recordKey: 'custom' },
    row: record({ category: 'custom', label: '午睡', value: 42, unit: '分钟', note: '午后' }),
    values: page => [page.data.label, page.data.value, page.data.unit, page.data.note],
    expected: ['午睡', '42', '分钟', '午后'],
    save: page => page.save()
  }
]

for (const entry of cases) {
  test(`${entry.page} homepage card opens its prefilled editor directly and updates the record`, async () => {
    const requests = []
    const f = front(entry.page, { callFunction: async request => {
      requests.push(request)
      if (['list', 'listDate'].includes(request.data.action)) return { result: { code: 0, records: [entry.row] } }
      return { result: { code: 0, data: { id: 'record-1' } } }
    } })
    f.app.globalData.activeBabyId = 'baby-a'
    f.app.globalData.openid = 'user-a'
    f.wx.pageScrollTo = () => {}
    await f.page.onLoad({ cardEdit: '1', date, ...entry.options })
    await f.page.onShow()
    await flush()

    assert.equal(f.page.data.cardEditMode, true)
    assert.equal(f.page.data.recordDate, date)
    assert.equal(f.page.data.editingId, 'record-1')
    assert.equal(f.page.data.panelMode, true)
    assert.deepEqual(entry.values(f.page), entry.expected)

    await entry.save(f.page)
    await flush()
    const update = requests.find(request => request.data.action === 'update')
    assert.ok(update, 'saving an existing card record must update it')
    assert.equal(update.name, entry.name)
    assert.equal(update.data.id, 'record-1')
    assert.equal(f.app.globalData.homeRefresh.date, date)
    f.page.onUnload()
  })
}

test('record editor pages expose no record-delete controls', () => {
  for (const page of ['feeding', 'solid', 'excretion', 'growth', 'diary', 'custom-record']) {
    const template = fs.readFileSync(`miniprogram/pages/${page}/index.wxml`, 'utf8')
    assert.doesNotMatch(template, /record-delete-symbol|removeRecord|deleteSelectedDateRecord|删除该天记录/, page)
  }
})
