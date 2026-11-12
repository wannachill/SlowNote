// 常见问题统一库：默认问题（内置）+ 用户自定义，单存储源。
// 内置问题不可改文案，可固定展示或删除（删除后不再进入随机池）。
// DEFAULT_POOL 保留纯文本；loadAll 为旧问题补出默认范围与数据类型。
// 覆盖宝妈最关心的 9 个互不重叠维度：每日看护、喂养摄入、睡眠作息、成长曲线、便便消化、发育里程碑、安全警惕、月度复盘、长期成长趋势。
const { detectRange } = require('./digest')
const RANGES = [
  { label: '今天', value: 'day' },
  { label: '近7天', value: '7d' },
  { label: '本周', value: 'week' },
  { label: '本月', value: 'month' },
  { label: '近30天', value: '30d' },
  { label: '本年', value: 'all' }
]
// 记录摘要的可选数据类型，顺序与 digest.buildText 的输出顺序一致。
// feeding / excretion / solid 同源于 feeding_records，但可分别选择。
const CATEGORIES = [
  { value: 'feeding', label: '喂养' },
  { value: 'excretion', label: '便便排尿' },
  { value: 'solid', label: '辅食' },
  { value: 'growth', label: '成长' },
  { value: 'diary', label: '成长日记' },
  { value: 'milestone', label: '里程碑' },
  { value: 'custom', label: '自定义' }
]
const ALL_CATEGORIES = CATEGORIES.map(item => item.value)
// 内置问题按语义预设取数类别，避免每次提问都把全量记录发给模型。
const DEFAULT_POOL = [
  { text: '宝宝今天的记录有什么要留意的吗', categories: ALL_CATEGORIES.slice() },
  { text: '分析一下最近的喂养和喝奶量够不够', categories: ['feeding'] },
  { text: '宝宝最近的睡眠和作息规律怎么样', categories: ['feeding', 'excretion', 'diary'] },
  { text: '宝宝最近的身高体重增长正常吗', categories: ['growth'] },
  { text: '最近的大便和消化情况正常吗', categories: ['excretion', 'feeding'] },
  { text: '宝宝最近有没有新掌握的本领', categories: ['milestone', 'diary'] },
  { text: '最近有没有需要留意或警惕的情况', categories: ALL_CATEGORIES.slice() },
  { text: '总结宝宝这一个月的整体情况', categories: ALL_CATEGORIES.slice() },
  { text: '宝宝从出生到现在的整体成长趋势怎么样', categories: ['growth', 'milestone', 'feeding'] }
]
const STORAGE_KEY = 'slownote_common_questions'
const LEGACY_KEY = 'slownote_common_custom'

// User-authored questions are local account data; legacy shared keys have no provable owner and are discarded.
function storageKey() {
  let openid = ''
  try { openid = getApp().globalData.openid || '' } catch (error) {}
  return `${STORAGE_KEY}:${openid || 'anonymous'}`
}

// 去掉非法/重复值并保留用户的选择顺序；空数组是合法选择（不附带记录）。
function normalizeCategories(value, fallback) {
  if (!Array.isArray(value)) return (fallback || ALL_CATEGORIES).slice()
  const picked = new Set(), result = []
  for (const item of value) {
    if (ALL_CATEGORIES.includes(item) && !picked.has(item)) { picked.add(item); result.push(item) }
  }
  return result
}
function loadAll() {
  const key = storageKey()
  let list = wx.getStorageSync(key)
  if (!Array.isArray(list) || !list.length) {
    list = DEFAULT_POOL.map((d, i) => ({ id: 'd' + (i + 1), text: d.text, builtin: true, pinned: false }))
    wx.setStorageSync(key, list)
    wx.removeStorageSync(STORAGE_KEY)
    wx.removeStorageSync(LEGACY_KEY)
  }
  const defaults = new Map(DEFAULT_POOL.map(item => [item.text, item.categories]))
  return list
    .filter(q => typeof q.text === 'string' && q.text.trim())
    .filter(q => q.text.trim() !== '你好')
    .map(q => ({
      ...q,
      range: q.range || detectRange(q.text) || '',
      categories: normalizeCategories(q.categories, defaults.get(q.text) || ALL_CATEGORIES)
    }))
}
function saveAll(list) { wx.setStorageSync(storageKey(), list) }
// 从内置问题（未固定的）随机取 size 条。
function batch(list, size) {
  const pool = list.filter(q => q.builtin && !q.pinned).slice()
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
  return pool.slice(0, size)
}
module.exports = { DEFAULT_POOL, RANGES, CATEGORIES, ALL_CATEGORIES, STORAGE_KEY, normalizeCategories, loadAll, saveAll, batch }
