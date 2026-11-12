const { call } = require('./api')

const RANGE_LABELS = { day: '今天', '7d': '近7天', week: '本周', month: '本月', '30d': '近30天', all: '本年' }
const CHINESE_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function parseNumber(value) {
  if (/^\d+$/.test(value)) return Number(value)
  if (value === '一个') return 1
  const ten = value.indexOf('十')
  if (ten >= 0) {
    const tens = ten === 0 ? 1 : CHINESE_DIGITS[value.slice(0, ten)]
    const ones = value.slice(ten + 1) ? CHINESE_DIGITS[value.slice(ten + 1)] : 0
    return Number.isFinite(tens) && Number.isFinite(ones) ? tens * 10 + ones : 0
  }
  return CHINESE_DIGITS[value]
}

function detectRange(text) {
  const source = String(text || '')
    .replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
  const candidates = []
  const collect = (pattern, resolve) => {
    let match
    while ((match = pattern.exec(source))) {
      const range = resolve(match)
      if (range) candidates.push({ index: match.index, length: match[0].length, range })
      if (!match[0].length) pattern.lastIndex++
    }
  }

  collect(/今天|今日|当天|今早|今上午|刚才/g, () => 'day')
  collect(/昨天|昨晚/g, () => 'yesterday')
  collect(/这周|本周|这一周/g, () => 'week')
  collect(/上周/g, () => 'lastWeek')
  collect(/这个月|本月|这一月/g, () => 'month')
  collect(/上个月/g, () => 'lastMonth')
  collect(/全部时间|所有时间/g, () => 'all')
  collect(/今年|这一年|近一年|最近一年/g, () => 'all')
  collect(/半年|近半年/g, () => 'all')
  collect(/从出生|出生以来|打从出生/g, () => 'all')
  collect(/(?:最近|近|这)\s*([0-9]+|[零一二两三四五六七八九十]+)\s*(?:天|日)/g, match => {
    const days = parseNumber(match[1])
    return days > 0 ? `${Math.min(days, 90)}d` : ''
  })
  collect(/(?:最近|近|这)\s*(一个|[0-9]+|[一二两三四五六七八九十]+)\s*个?月/g, match => {
    const months = parseNumber(match[1])
    return months > 0 ? `${Math.min(months * 30, 90)}d` : ''
  })
  collect(/最近的?|近期/g, match => {
    const tail = source.slice(match.index + match[0].length)
    if (/^\s*(?:-|−|负)\s*(?:\d+|[零一二两三四五六七八九十]+)\s*(?:天|日|个?月)/.test(tail)) return ''
    if (/^\s*(?:0+|零+)\s*(?:天|日|个?月)/.test(tail)) return ''
    if (/^(?:的)?(?:情况)?(?:怎么样|如何|好吗|好不好)[？?。！!]*$/.test(tail)) return ''
    return '7d'
  })

  if (!candidates.length && /成长趋势/.test(source)) return 'all'
  candidates.sort((a, b) => b.index - a.index || b.length - a.length)
  return candidates.length ? candidates[0].range : ''
}

function rangeLabel(kind) {
  const days = /^(\d+)d$/.exec(String(kind || ''))
  if (days) return '近' + days[1] + '天'
  if (kind === 'day') return '今天'
  if (kind === 'yesterday') return '昨天'
  if (kind === 'week') return '本周'
  if (kind === 'lastWeek') return '上周'
  if (kind === 'month') return '本月'
  if (kind === 'lastMonth') return '上个月'
  if (kind === 'all') return '本年'
  return String(kind || '')
}

// 与 common-questions.CATEGORIES 的值保持一致。未传 categories 时为全量（自由提问）。
const SNAPSHOT_CATEGORIES = ['feeding', 'excretion', 'solid', 'growth', 'diary', 'milestone', 'custom']

function buildText(summary, label, categories) {
  const selected = Array.isArray(categories)
    ? categories.filter(item => SNAPSHOT_CATEGORIES.includes(item))
    : SNAPSHOT_CATEGORIES.slice()
  if (!selected.length) return ''
  const has = key => selected.includes(key)
  const s = [`${label}记录摘要：`]
  const f = summary.feeding || {}, byCategory = f.byCategory || {}
  if (has('feeding') && f.count) {
    const c = byCategory
    s.push(`喂养 ${f.count} 次${f.amountMl ? `，约 ${Math.round(f.amountMl)} ml` : ''}（亲喂 ${c.breast ? c.breast.count : 0}、奶瓶 ${c.bottle ? c.bottle.count : 0}、配方奶 ${c.formula ? c.formula.count : 0}、混合 ${c.mixed ? c.mixed.count : 0}）`)
  }
  if (has('excretion')) {
    const e = byCategory.excretion || {}
    const stool = Number(e.stoolCount) || 0, urine = Number(e.urineCount) || 0
    if (stool || urine) s.push(`便便 ${stool} 次、排尿 ${urine} 次`)
  }
  if (has('solid')) {
    const count = Number((byCategory.solid || {}).count) || 0
    if (count) s.push(`辅食 ${count} 次`)
  }
  const g = summary.growth || {}
  if (has('growth') && g.count) {
    const w = g.weight || {}, h = g.height || {}, hd = g.head || {}
    let line = `成长记录 ${g.count} 条`
    if (w.latest != null) line += `；体重最新 ${w.latest} kg${w.gain != null ? `，${w.gain >= 0 ? '增' : '减'} ${Math.abs(w.gain)} kg` : ''}`
    if (h.latest != null) line += `；身高最新 ${h.latest} cm${h.gain != null ? `，${h.gain >= 0 ? '增' : '减'} ${Math.abs(h.gain)} cm` : ''}`
    if (hd.latest != null) line += `；头围最新 ${hd.latest} cm`
    s.push(line)
  }
  if (has('diary') && (summary.diary || {}).count) s.push(`成长日记 ${summary.diary.count} 篇`)
  if (has('milestone') && (summary.milestone || {}).count) s.push(`里程碑 ${summary.milestone.count} 个`)
  if (has('custom') && (summary.custom || {}).count) s.push(`自定义记录 ${summary.custom.count} 条`)
  return s.length > 1 ? s.join('\n') : ''
}

async function fetchSnapshot(babyId, range, categories) {
  if (!babyId) return ''
  if (Array.isArray(categories) && !categories.length) return ''
  const result = await call('statistics', { action: 'range', range, baby_id: babyId })
  return buildText(result.summary, rangeLabel(range), categories)
}

module.exports = { buildText, fetchSnapshot, RANGE_LABELS, SNAPSHOT_CATEGORIES, detectRange, rangeLabel }
