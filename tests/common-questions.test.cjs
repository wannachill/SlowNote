const test = require('node:test'), assert = require('node:assert/strict')
const { load, front } = require('./helpers.cjs')

// 纯函数 detectRange 不需要 wx；common-questions 在 load（模块顶层）阶段不触碰 wx，仅函数内部用到。
const digest = load('miniprogram/utils/digest.js', {})
const storage = {}
const wx = {
  getStorageSync: key => storage[key],
  setStorageSync: (key, value) => { storage[key] = value },
  removeStorageSync: key => { delete storage[key] }
}
const questions = load('miniprogram/utils/common-questions.js', { wx })

test('默认问题库为 9 条、无死字段 range、文案约束合规', () => {
  const pool = questions.DEFAULT_POOL
  assert.equal(pool.length, 9, '默认问题应为 9 条')
  for (const item of pool) {
    assert.equal(typeof item.text, 'string', '每条问题应有 text')
    assert.ok(item.text.trim().length > 0, '文案不可为空')
    assert.ok(item.text.length <= 40, '文案不超过 40 字，对齐自定义上限')
    assert.equal('range' in item, false, 'DEFAULT_POOL 不再携带死字段 range')
  }
  // 文案互不重复
  const texts = pool.map(p => p.text)
  assert.equal(new Set(texts).size, texts.length, '默认问题文案应互不重复')
})

test('每条默认问题都能从文字识别到取数窗口（点击会带入最近数据，不空口问）', () => {
  for (const item of questions.DEFAULT_POOL) {
    const range = digest.detectRange(item.text)
    assert.ok(range && range.length > 0, `「${item.text}」应命中时间范围，实际为「${range}」`)
  }
})

test('loadAll 为旧问题补范围并保留用户显式配置', () => {
  questions.saveAll([
    { id: 'old', text: '宝宝最近睡眠怎么样', builtin: false },
    { id: 'configured', text: '一个没有时间词的问题', range: 'all', builtin: false }
  ])
  const loaded = questions.loadAll()
  assert.equal(loaded.find(item => item.id === 'old').range, digest.detectRange('宝宝最近睡眠怎么样'))
  assert.equal(loaded.find(item => item.id === 'configured').range, 'all')
  assert.deepEqual(JSON.parse(JSON.stringify(questions.RANGES.map(item => item.value))), ['day', '7d', 'week', 'month', '30d', 'all'])
})

test('loadAll 为默认问题补齐可识别范围，batch 保留配置范围', () => {
  const defaults = questions.DEFAULT_POOL.map((item, index) => ({ id: 'd' + index, ...item, builtin: true, pinned: false }))
  questions.saveAll(defaults)
  const loaded = questions.loadAll()
  for (const item of loaded) {
    assert.ok(item.range, `「${item.text}」应有范围`)
    assert.equal(item.range, digest.detectRange(item.text))
  }
  const configured = { id: 'pinned', text: '无时间词', range: 'month', builtin: true, pinned: false }
  assert.equal(questions.batch([configured], 1)[0].range, 'month')
})

test('年份与长期口语能识别到全部时间窗口', () => {
  for (const text of ['宝宝今年长得怎么样', '回顾宝宝这一年的变化', '宝宝近一年的成长', '宝宝从出生到现在的变化', '出生以来的发育情况']) {
    const range = digest.detectRange(text)
    assert.equal(range, 'all', `「${text}」应命中全部时间，实际为「${range}」`)
  }
})

test('自定义问题按账号隔离，旧共享数据只迁移一次', () => {
  const accountStorage = {
    [questions.STORAGE_KEY]: [{ id: 'old-user', text: '旧账号的问题', builtin: false }]
  }
  const accountQuestions = openid => load('miniprogram/utils/common-questions.js', {
    getApp: () => ({ globalData: { openid } }),
    wx: {
      getStorageSync: key => accountStorage[key],
      setStorageSync: (key, value) => { accountStorage[key] = value },
      removeStorageSync: key => { delete accountStorage[key] }
    }
  })

  const firstAccount = accountQuestions('user-a')
  assert.equal(firstAccount.loadAll().some(item => item.id === 'old-user'), true, '旧数据保留给首次迁移账号')
  assert.equal(Object.hasOwn(accountStorage, questions.STORAGE_KEY), false, '迁移后移除共享键')

  const secondAccount = accountQuestions('user-b')
  assert.equal(secondAccount.loadAll().some(item => item.id === 'old-user'), false, '后续账号不会读取旧账号问题')
  assert.ok(accountStorage[`${questions.STORAGE_KEY}:user-a`])
  assert.ok(accountStorage[`${questions.STORAGE_KEY}:user-b`])
})

test('恢复默认后问题对象不含 range 字段，且数量与默认库一致', () => {
  const restored = questions.DEFAULT_POOL.map((q, i) => ({ id: 'd' + (i + 1), text: q.text, builtin: true, pinned: false }))
  assert.equal(restored.length, questions.DEFAULT_POOL.length)
  for (const q of restored) assert.equal('range' in q, false, '恢复默认构造的问题不应带 range')
  questions.saveAll(restored)
  const loaded = questions.loadAll()
  for (const q of loaded) assert.equal(q.range, digest.detectRange(q.text), `「${q.text}」应在读取时回填范围`)
})

test('推荐问题点击优先使用配置范围，不依赖问题文案推断', async () => {
  const f = front('ai-chat')
  f.page._disposed = false
  let sent
  f.page.send = async (text, range) => { sent = { text, range } }
  await f.page.onSuggest({ currentTarget: { dataset: { s: { text: '没有任何范围词的问题', range: 'all' } } } })
  assert.deepEqual(sent, { text: '没有任何范围词的问题', range: 'all' })
  assert.equal(f.page.data.question, '没有任何范围词的问题')
})
