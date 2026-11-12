const test = require('node:test'), assert = require('node:assert/strict')
const { load, front } = require('./helpers.cjs')

const calls = []
// vm 沙箱里的数组与宿主 realm 原型不同，deepStrictEqual 会误判，统一转普通对象再比较。
const plain = value => JSON.parse(JSON.stringify(value))
const digest = load('miniprogram/utils/digest.js', {}, { './api': { call: async (name, payload) => {
  calls.push({ name, payload })
  const selected = payload.categories || questionsAll
  const lines = []
  if (selected.includes('feeding')) lines.push('2026-10-21｜喂养｜喂养（奶瓶），奶量 120 ml')
  if (selected.includes('diary')) lines.push('2026-10-21｜成长日记｜日记：宝宝今天笑了')
  if (selected.includes('milestone')) lines.push('2026-10-21｜里程碑｜里程碑（大运动）：俯卧时能抬起头')
  return { summary: sample(), details: `近7天记录概览：${selected.join('、')}\n${lines.join('\n')}`, detailsLimit: 1800 }
} } })
const questionsAll = ['feeding', 'excretion', 'solid', 'growth', 'diary', 'milestone', 'custom']

function sample() {
  return {
    feeding: {
      count: 5, amountMl: 221,
      byCategory: {
        breast: { count: 2 }, bottle: { count: 2 }, formula: { count: 1 }, mixed: { count: 0 },
        excretion: { count: 8, stoolCount: 3, urineCount: 5 },
        solid: { count: 2 }
      }
    },
    growth: { count: 3, weight: { latest: 4, gain: -2 }, height: { latest: 40, gain: -18 }, head: { latest: 40 }, trend: [] },
    diary: { count: 1 }, milestone: { count: 1 }, custom: { count: 1, entries: [] }
  }
}

test('数据类型清单与快照输出类别保持一致', () => {
  const storage = {}
  const questions = load('miniprogram/utils/common-questions.js', {
    wx: { getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value } }
  })
  assert.deepEqual(plain(questions.CATEGORIES.map(item => item.value)), plain(digest.SNAPSHOT_CATEGORIES), '配置选项与快照输出类别必须一一对应')
  assert.deepEqual(plain(questions.ALL_CATEGORIES), ['feeding', 'excretion', 'solid', 'growth', 'diary', 'milestone', 'custom'])
})

test('未指定类别时为全量摘要，且补上便便/排尿/辅食数据', () => {
  const text = digest.buildText(sample(), '近7天')
  assert.match(text, /^近7天记录摘要：/)
  assert.match(text, /喂养 5 次，约 221 ml/)
  assert.match(text, /便便 3 次、排尿 5 次/, '便便与排尿不再被摘要遗漏')
  assert.match(text, /辅食 2 次/)
  assert.match(text, /成长记录 3 条/)
  assert.match(text, /成长日记 1 篇/)
  assert.match(text, /里程碑 1 个/)
  assert.match(text, /自定义记录 1 条/)
})

test('只看便便问题时仅发送便便数据，不再把全量记录丢给模型', () => {
  const text = digest.buildText(sample(), '近7天', ['excretion'])
  assert.match(text, /便便 3 次、排尿 5 次/)
  assert.doesNotMatch(text, /喂养 5 次/)
  assert.doesNotMatch(text, /成长记录/)
  assert.doesNotMatch(text, /成长日记|里程碑|自定义记录|辅食/)
  assert.equal(text.split('\n').length, 2)
})

test('多选类别按顺序输出，非法值与重复值被规整', () => {
  const text = digest.buildText(sample(), '今天', ['growth', 'excretion', 'growth', 'not-a-type'])
  assert.equal(text.split('\n').length, 3)
  assert.match(text.split('\n')[1], /便便 3 次/, '按固定类别顺序输出，不按传入顺序')
  assert.match(text.split('\n')[2], /成长记录 3 条/)
  assert.equal(digest.buildText(sample(), '今天', []), '', '空选不附带任何记录')
})

test('未记录便便时不产生空行，摘要为空则不附带', () => {
  const s = sample()
  s.feeding.byCategory.excretion = { count: 0, stoolCount: 0, urineCount: 0 }
  assert.equal(digest.buildText(s, '今天', ['excretion']), '')
  const empty = { feeding: { count: 0, byCategory: {} }, growth: { count: 0 }, diary: { count: 0 }, milestone: { count: 0 }, custom: { count: 0 } }
  assert.equal(digest.buildText(empty, '今天'), '')
})

test('fetchSnapshot 空选时不请求云端，正常选类别时透传范围与宝宝', async () => {
  calls.length = 0
  assert.equal(await digest.fetchSnapshot('baby-1', '7d', []), '')
  assert.equal(calls.length, 0, '空选应避免无意义的云函数调用')
  const text = await digest.fetchSnapshot('baby-1', '7d', ['feeding'])
  assert.match(text, /喂养（奶瓶），奶量 120 ml/)
  assert.doesNotMatch(text, /宝宝今天笑了|俯卧时能抬起头/)
  assert.deepEqual(plain(calls[0]), { name: 'statistics', payload: { action: 'range', range: '7d', baby_id: 'baby-1', categories: ['feeding'] } })
})

test('问题快照展示选中类别的具体登记明细而非仅计数', async () => {
  calls.length = 0
  const text = await digest.fetchSnapshot('baby-1', '7d', ['milestone'])
  assert.match(text, /俯卧时能抬起头/)
  assert.doesNotMatch(text, /宝宝今天笑了|喂养（奶瓶）/)
})

test('推荐问题点击把自己的数据类型传给 send', async () => {
  const f = front('ai-chat')
  f.page._disposed = false
  let sent
  f.page.send = async (text, range, categories) => { sent = { text, range, categories } }
  await f.page.onSuggest({ currentTarget: { dataset: { s: {
    text: '最近的大便和消化情况正常吗', range: '7d', categories: ['excretion', 'feeding']
  } } } })
  assert.deepEqual(sent, { text: '最近的大便和消化情况正常吗', range: '7d', categories: ['excretion', 'feeding'] })
})

test('内置问题按语义预填类别，旧数据无类别时回退全量', () => {
  const storage = {}
  const questions = load('miniprogram/utils/common-questions.js', {
    wx: { getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value } }
  })
  const stool = questions.DEFAULT_POOL.find(item => /大便/.test(item.text))
  assert.deepEqual(plain(stool.categories), ['excretion', 'feeding'])
  const growth = questions.DEFAULT_POOL.find(item => /身高体重/.test(item.text))
  assert.deepEqual(plain(growth.categories), ['growth'])

  questions.saveAll([
    { id: 'd5', text: stool.text, builtin: true, pinned: false },
    { id: 'old', text: '一条旧自定义问题', range: '7d', builtin: false }
  ])
  const loaded = questions.loadAll()
  assert.deepEqual(plain(loaded.find(item => item.id === 'd5').categories), ['excretion', 'feeding'], '恢复默认后仍按文案回填类别')
  assert.deepEqual(plain(loaded.find(item => item.id === 'old').categories), plain(questions.ALL_CATEGORIES), '旧数据保持兼容的全量行为')
})
