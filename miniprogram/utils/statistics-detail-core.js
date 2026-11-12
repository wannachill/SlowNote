const DAY = 86400000
const RANGE_KEYS = ['day', 'week', 'month', 'all']
const MAX_SERIES = 3
const TYPE_CARD_TAGS = {
  growth: ['growth'], feeding: ['feeding'], solid: ['solid'],
  excretion: ['excretion'], diary: ['diary'], custom: ['custom']
}
// Missing days remain gaps: no record is not evidence of a zero-valued event.
const TYPES = [
  { key: 'growth', name: '成长', kind: 'line', gap: 'skip', multi: false, metrics: [
    { key: 'weight', name: '体重', unit: 'kg' },
    { key: 'height', name: '身高', unit: 'cm' },
    { key: 'head', name: '头围', unit: 'cm' }
  ] },
  { key: 'feeding', name: '喂养', kind: 'line', gap: 'skip', multi: false, metrics: [
    { key: 'ml', name: '奶量', unit: 'ml' },
    { key: 'n', name: '次数', unit: '次' },
    { key: 'min', name: '亲喂', unit: 'min' }
  ] },
  { key: 'solid', name: '辅食', kind: 'line', gap: 'skip', multi: false, metrics: [
    { key: 'n', name: '次数', unit: '次' }
  ] },
  { key: 'excretion', name: '便便', kind: 'line', gap: 'skip', multi: false, metrics: [
    { key: 'stool', name: '大便', unit: '次' },
    { key: 'urine', name: '小便', unit: '次' }
  ] },
  { key: 'diary', name: '日记', kind: 'line', gap: 'skip', multi: false, metrics: [
    { key: 'n', name: '篇数', unit: '篇' }
  ] },
  { key: 'custom', name: '自定义', kind: 'line', gap: 'skip', multi: false, metrics: [] }
]
const EMPTY = {
  growth: ['还没有成长数据', '记下第一次身高或体重，这里就能看到变化。'],
  feeding: ['这个范围还没有喂养记录', '记下第一次喂奶，曲线就长出来了。'],
  solid: ['这个范围还没有辅食记录', '记下第一口辅食，这里就能看到次数。'],
  excretion: ['这个范围还没有便便记录', '记下第一次，这里就能看到规律。'],
  diary: ['这个范围还没有日记记录', '记下今天的小事，这里就能看到连续记录。'],
  custom: ['这个范围还没有自定义记录', '换一个自定义项，或者先记一笔。'],
  fallback: ['这个范围还没有记录', '换一个日期范围，或者先记一笔。']
}

function dayKey(offset = 0) {
  const date = new Date(Date.now() + offset * DAY)
  const pad = number => String(number).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
function dayLabel(day) {
  if (!isDay(day)) return ''
  return Number(day.slice(5, 7)) + '月' + Number(day.slice(8, 10)) + '日'
}
function domainOf(dates) {
  const start = dates && isDay(dates.start) ? dates.start : ''
  let end = dates && isDay(dates.end) && dates.end < '9000-01-01' ? dates.end : ''
  if (!end) end = dayKey(1)
  if (!start || start >= end) return { start: start || end, end }
  return { start, end }
}
function metricPoints(series, type) {
  const map = Object.create(null)
  if (type.key === 'custom') {
    for (const group of series.custom || []) {
      map[group.label] = (group.points || []).map(point => ({ d: point.d, y: Number(point.value) }))
        .filter(point => isDay(point.d) && Number.isFinite(point.y) && point.y >= 0)
        .sort((a, b) => a.d.localeCompare(b.d))
    }
    return map
  }
  const rows = series[type.key] || []
  for (const metric of type.metrics) {
    map[metric.key] = rows.map(row => ({ d: row.d, y: Number(row[metric.key]) }))
      .filter(point => isDay(point.d) && Number.isFinite(point.y) && point.y > 0)
      .sort((a, b) => a.d.localeCompare(b.d))
  }
  return map
}
function paneCountOf(kind, series) {
  if (kind !== 'bar') return series.length
  const units = []
  for (const item of series) {
    const unit = item.unit || ''
    if (!units.includes(unit)) units.push(unit)
  }
  return Math.max(1, units.length)
}
function cardsForType(cards, typeKey) {
  const tags = TYPE_CARD_TAGS[typeKey] || []
  return (cards || []).filter(card => tags.includes(card.tag || card.key))
}
module.exports = { DAY, RANGE_KEYS, MAX_SERIES, TYPES, EMPTY, dayKey, isDay, dayLabel, domainOf, metricPoints, paneCountOf, cardsForType }
