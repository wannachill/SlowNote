const { parseDate, dateKey } = require('./date')

// 月龄（整月）。与 utils/date.js ageText() 的 months 算法逐行一致，避免两处口径不同。
function monthAge(birthday, today) {
  const birth = parseDate(birthday)
  const now = parseDate(today || dateKey())
  if (!birth || !now || birth > now) return null
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth()
  const anniversary = m => new Date(
    birth.getFullYear(),
    birth.getMonth() + m,
    Math.min(birth.getDate(), new Date(birth.getFullYear(), birth.getMonth() + m + 1, 0).getDate()),
    12
  )
  if (anniversary(months) > now) months--
  return months
}

const STAGES = [
  { key: '0-1', min: 0, max: 1 },
  { key: '1-2', min: 1, max: 2 },
  { key: '2-3', min: 2, max: 3 },
  { key: '3-4', min: 3, max: 4 },
  { key: '4-6', min: 4, max: 6 },
  { key: '6-9', min: 6, max: 9 },
  { key: '9-12', min: 9, max: 12 },
  { key: '12-24', min: 12, max: 24 },
  { key: '24-36', min: 24, max: 36 },
  { key: '36-', min: 36, max: Infinity }
]

function stageOf(months) {
  if (typeof months !== 'number' || months < 0) return null
  const hit = STAGES.find(s => months >= s.min && months < s.max)
  return hit ? hit.key : null
}

// 提示区间按需求稿录入，不是经临床核验的统一标准。北京儿童医院原文按不同月龄给出
// 更细的频次/奶量；其中部分数值与本表合并后的年龄段并不一致，发布前应逐项复核。
// 不给「每次量」——母乳无法测量，且各来源分歧大。
const FEEDING = {
  '0-1': { times: [8, 12], total: [500, 750] },
  '1-2': { times: [7, 10], total: [500, 750] },
  '2-3': { times: [6, 8], total: [600, 800] },
  '3-4': { times: [6, 8], total: [800, 1000] },
  '4-6': { times: [6, 8], total: [750, 1000] },
  '6-9': { times: [5, 6], total: [800, 1000] },
  '9-12': { times: [4, 5], total: [600, 800] },
  '12-24': { times: [3, 4], total: [400, 600] },
  '24-36': { times: [2, 3], total: [300, 500] },
  '36-': { times: [2, 3], total: [300, 500] }
}

// 亲喂单侧时长（分钟），按需求稿分段录入；一岁后不再给时长，发布前需逐项复核。
const BREAST = {
  '0-1': [10, 20], '1-2': [15, 20], '2-3': [15, 20], '3-4': [15, 20], '4-6': [15, 20],
  '6-9': [15, 20], '9-12': [15, 20], '12-24': null, '24-36': null, '36-': null
}

// 排泄提示按需求稿分段录入。引用文章描述的是新生儿且区分喂养方式，不能覆盖本表所有月龄；
// 加辅食后个体差异过大，改给一句定性提示而不是数字。发布前应由专业人员复核。
const EXCRETION = {
  '0-1': { stool: [2, 5], urine: [6, 8] },
  '1-2': { stool: [1, 3], urine: [6, 8] },
  '2-3': { stool: [1, 3], urine: [6, 8] },
  '3-4': { stool: [1, 3], urine: [6, 8] },
  '4-6': { stool: [1, 3], urine: [6, 8] },
  '6-9': { stool: null, urine: null, note: '加辅食后次数差异变大，看性状比看次数更有意义' },
  '9-12': { stool: null, urine: null, note: '加辅食后次数差异变大，看性状比看次数更有意义' },
  '12-24': { stool: null, urine: null, note: '这个阶段隔天一次也常见，重点看性状' },
  '24-36': { stool: null, urine: null, note: '这个阶段隔天一次也常见，重点看性状' },
  '36-': { stool: null, urine: null, note: '这个阶段隔天一次也常见，重点看性状' }
}

// 辅食提示按需求稿录入。上海市技术规范表 2 支持按月龄安排餐次，但不直接支持本表所有克数区间；
// 克数仅作产品提示草案，发布前应由专业人员复核。
const SOLID = {
  '0-1': null, '1-2': null, '2-3': null, '3-4': null,
  '4-6': { meals: null, amount: null, note: '满 6 月龄再开始添加辅食' },
  '6-9': { meals: [1, 2], amount: [20, 75] },
  '9-12': { meals: [2, 3], amount: [50, 75] },
  '12-24': { meals: [3, 3], amount: [50, 100] },
  '24-36': { meals: [3, 3], amount: [75, 150] },
  '36-': { meals: [3, 3], amount: [75, 150] }
}

// 每月增长量（体重 g / 身高 cm / 头围 cm）按需求稿粗分段录入。
// WHO 生长速度表按性别及规定时间间隔列出增量/百分位，本表不是 WHO 标准区间的直接转录。
const GROWTH = {
  '0-1': { weight: [600, 1000], height: [3.0, 4.0], head: [1.5, 2.0] },
  '1-2': { weight: [600, 1000], height: [2.5, 3.5], head: [1.5, 2.0] },
  '2-3': { weight: [600, 1000], height: [2.5, 3.5], head: [1.0, 2.0] },
  '3-4': { weight: [450, 600], height: [2.0, 2.5], head: [1.0, 1.5] },
  '4-6': { weight: [450, 600], height: [2.0, 2.5], head: [1.0, 1.5] },
  '6-9': { weight: [250, 400], height: [1.2, 1.5], head: [0.5, 1.0] },
  '9-12': { weight: [250, 400], height: [1.2, 1.5], head: [0.5, 1.0] },
  '12-24': { weight: [150, 250], height: [1.0, 1.2], head: [0.3, 0.5] },
  '24-36': { weight: [100, 200], height: [0.7, 1.0], head: [0.2, 0.3] },
  '36-': { weight: [150, 250], height: [0.4, 0.6], head: [0.1, 0.2] }
}

function ageLabel(months) {
  if (months === 0) return '未满月'
  if (months < 12) return months + ' 月龄'
  const years = Math.floor(months / 12)
  const rest = months % 12
  return rest ? years + ' 岁 ' + rest + ' 个月' : years + ' 岁'
}

function feedingHint(birthday, type) {
  const months = monthAge(birthday)
  if (months === null) return ''
  const stage = stageOf(months)
  if (!stage) return ''
  const label = ageLabel(months)
  if (type === 'breast') {
    const dur = BREAST[stage]
    const feed = FEEDING[stage]
    const parts = []
    if (feed) parts.push('每天 ' + feed.times[0] + '–' + feed.times[1] + ' 次')
    if (dur) parts.push('单侧 ' + dur[0] + '–' + dur[1] + ' 分钟')
    return parts.length ? label + ' · ' + parts.join('，') : ''
  }
  const feed = FEEDING[stage]
  if (!feed) return ''
  return label + ' · 每天 ' + feed.times[0] + '–' + feed.times[1] + ' 次，合计 ' + feed.total[0] + '–' + feed.total[1] + ' ml'
}

function excretionHint(birthday, kind) {
  const months = monthAge(birthday)
  if (months === null) return ''
  const stage = stageOf(months)
  if (!stage) return ''
  const entry = EXCRETION[stage]
  if (!entry) return ''
  const range = kind === 'urine' ? entry.urine : entry.stool
  if (!range) return kind === 'stool' ? entry.note || '' : ''
  return ageLabel(months) + ' · 每天 ' + range[0] + '–' + range[1] + ' 次'
}

function solidHint(birthday) {
  const months = monthAge(birthday)
  if (months === null) return ''
  const stage = stageOf(months)
  if (!stage) return ''
  const entry = SOLID[stage]
  if (!entry) return ''
  if (!entry.meals) return entry.note || ''
  return ageLabel(months) + ' · 每天 ' + entry.meals[0] + (entry.meals[1] > entry.meals[0] ? '–' + entry.meals[1] : '') + ' 餐，一餐约 ' + entry.amount[0] + '–' + entry.amount[1] + ' g'
}

function growthHint(birthday) {
  const months = monthAge(birthday)
  if (months === null) return ''
  const stage = stageOf(months)
  if (!stage) return ''
  const entry = GROWTH[stage]
  if (!entry) return ''
  const one = n => n.toFixed(1)
  return ageLabel(months) + ' · 每月约长：体重 ' + entry.weight[0] + '–' + entry.weight[1] + ' g，身高 ' + one(entry.height[0]) + '–' + one(entry.height[1]) + ' cm'
}

module.exports = { monthAge, stageOf, feedingHint, excretionHint, solidHint, growthHint, STAGES }
