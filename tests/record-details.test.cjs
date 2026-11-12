const test = require('node:test')
const assert = require('node:assert/strict')
const { load, memoryDb } = require('./helpers.cjs')

const details = load('cloudfunctions/_shared/record-details.js')

test('共享类别枚举与常见问题七类一致', () => {
  const questions = load('miniprogram/utils/common-questions.js')
  assert.deepEqual(Array.from(details.CATEGORY_KEYS), Array.from(questions.CATEGORIES, item => item.value))
})

test('明细按日期倒序渲染，仅包含选中类别的白名单字段', async () => {
  const data = {
    feeding: [
      { type: 'feed', payload: { mode: 'bottle', amountMl: 120 }, record_date: '2026-10-19', openid: 'hidden-openid', _id: 'hidden-id' },
      { type: 'solid', payload: { name: '南瓜泥' }, record_date: '2026-10-21' },
      { type: 'excretion', payload: { kind: 'urine', count: 2 }, record_date: '2026-10-20' }
    ],
    diary: [{ content: '宝宝第一次翻身', record_date: '2026-10-19', client_request_id: 'hidden-request' }],
    milestone: [{ milestone_key: 'lift_head', domain: '大运动', baby_id: 'baby-a', record_date: '2026-10-21' }],
    growth: [{ weight: 6.2, record_date: '2026-10-21' }],
    custom: [{ category: 'custom', label: '睡眠', value: 10, unit: '小时', record_date: '2026-10-21' }]
  }
  const db = memoryDb({ milestone_defs: [
    { _id: 'safe-definition', openid: 'user-a', baby_id: 'baby-a', key: 'lift_head', name: '俯卧时能抬起头', domain: '大运动', month: 2 },
    { _id: 'other-scope', openid: 'user-b', baby_id: 'baby-a', key: 'lift_head', name: '错误家庭的名称', domain: '语言', month: 2 }
  ] })
  const text = await details.buildDetails(data, ['milestone', 'diary'], { db, scope: { openid: 'user-a' }, babyId: 'baby-a', range: '7d' })
  assert.match(text, /成长日记 1 篇/)
  assert.match(text, /里程碑 1 个/)
  assert.match(text, /俯卧时能抬起头/)
  assert.match(text, /宝宝第一次翻身/)
  assert(text.indexOf('2026-10-21') < text.indexOf('2026-10-19'), '具体登记按日期倒序')
  for (const hidden of ['错误家庭的名称', '南瓜泥', '奶瓶', '排尿', '6.2', '睡眠', 'hidden-openid', 'hidden-id', 'hidden-request']) assert(!text.includes(hidden), hidden)
  assert.equal(await details.buildDetails(data, []), '', '空类别不产生明细')
})

test('里程碑定义缺失时退回存储 key，不跨 scope 借用名称', async () => {
  const db = memoryDb({ milestone_defs: [{ _id: 'other', openid: 'user-b', baby_id: 'baby-a', key: 'roll', name: '能自己翻身' }] })
  const text = await details.buildDetails({ milestone: [{ milestone_key: 'roll', record_date: '2026-10-21', baby_id: 'baby-a' }] }, ['milestone'], { db, scope: { openid: 'user-a' } })
  assert.match(text, /里程碑：roll/)
  assert.doesNotMatch(text, /能自己翻身/)
})

test('日记正文与备注按字数截断，超量记录明确标出未展开数量', async () => {
  const diary = Array.from({ length: 25 }, (_, index) => ({ record_date: `2026-10-${String(25 - index).padStart(2, '0')}`, content: '日'.repeat(50) }))
  const text = await details.buildDetails({ diary }, ['diary'])
  assert.equal((text.match(/｜成长日记｜/g) || []).length, details.MAX_RECORDS_PER_CATEGORY)
  assert.match(text, /另有 5 条未展开/)
  assert(Array.from(text).length <= details.DETAILS_LIMIT)
  const longDiary = await details.buildDetails({ diary: [{ record_date: '2026-10-21', content: '日'.repeat(500) }] }, ['diary'])
  assert.match(longDiary, /日{120}…/)

  const note = '备'.repeat(100)
  const custom = await details.buildDetails({ custom: [{ category: 'custom', label: '观察', value: 1, unit: '次', note, record_date: '2026-10-21' }] }, ['custom'])
  assert(custom.includes('备'.repeat(details.NOTE_TEXT_LIMIT)))
  assert(!custom.includes('备'.repeat(details.NOTE_TEXT_LIMIT + 1)))
})

test('不同类别同源记录各自过滤，长文本总量受共享预算限制', async () => {
  const data = { feeding: [
    { type: 'feed', payload: { mode: 'breast', durationMin: 15 }, record_date: '2026-10-21' },
    { type: 'solid', payload: { name: '苹果泥' }, record_date: '2026-10-20' },
    { type: 'excretion', payload: { kind: 'stool', count: 1, shape: '软便' }, record_date: '2026-10-19' }
  ] }
  const feeding = await details.buildDetails(data, ['feeding'])
  assert.match(feeding, /亲喂/)
  assert.doesNotMatch(feeding, /苹果泥|软便/)
  const solid = await details.buildDetails(data, ['solid'])
  assert.match(solid, /苹果泥/)
  assert.doesNotMatch(solid, /亲喂|软便/)
  const excretion = await details.buildDetails(data, ['excretion'])
  assert.match(excretion, /软便/)
  assert.doesNotMatch(excretion, /亲喂|苹果泥/)

  const large = await details.buildDetails({ diary: Array.from({ length: 20 }, (_, index) => ({ record_date: `2026-10-${String(21 - index).padStart(2, '0')}`, content: '长'.repeat(500) })) }, ['diary'])
  assert(Array.from(large).length <= details.DETAILS_LIMIT)
  assert.match(large, /另有 \d+ 条未展开/)
})

test('明细脱敏覆盖用户输入中的身份字段与云文件标识', async () => {
  const llm = load('cloudfunctions/_shared/llm.js')
  const rendered = await details.buildDetails({ diary: [{
    record_date: '2026-10-21',
    content: '小满第一次翻身；openid: user-a；baby_id: baby-a；fileID: cloud://private/photo.jpg；created_at: 2026-10-21T09:30:00Z；safe@example.com'
  }] }, ['diary'])
  const safe = llm.redact(rendered, ['小满', '2026-09-10', 'user-a'])
  for (const secret of ['小满', 'user-a', 'baby-a', 'cloud://private/photo.jpg', '2026-10-21T09:30:00Z', 'safe@example.com']) assert(!safe.includes(secret), secret)
  assert.match(safe, /第一次翻身/)
})
