const { key, validDate, fail, all } = require('./runtime')
const { CATEGORY_KEYS, normalizeCategories } = require('./record-details')
function range(kind, anchor = key()) {
  if (!validDate(anchor)) fail(400, 'INVALID_DATE')
  const day = new Date(`${anchor}T00:00:00Z`)
  let start = anchor, end
  if (kind === 'all') return { start: '', end: '9999-12-31' }
  if (kind === 'week') { day.setUTCDate(day.getUTCDate() - day.getUTCDay()); start = day.toISOString().slice(0, 10); day.setUTCDate(day.getUTCDate() + 7) }
  else if (kind === 'lastWeek') { day.setUTCDate(day.getUTCDate() - day.getUTCDay() - 7); start = day.toISOString().slice(0, 10); day.setUTCDate(day.getUTCDate() + 7) }
  else if (kind === 'month') { day.setUTCDate(1); start = day.toISOString().slice(0, 10); day.setUTCMonth(day.getUTCMonth() + 1) }
  else if (kind === 'lastMonth') { day.setUTCDate(1); day.setUTCMonth(day.getUTCMonth() - 1); start = day.toISOString().slice(0, 10); day.setUTCMonth(day.getUTCMonth() + 1) }
  else if (typeof kind === 'string' && /^([1-9]|[1-8]\d|90)d$/.test(kind)) {
    const days = Number(kind.slice(0, -1))
    day.setUTCDate(day.getUTCDate() + 1)
    end = day.toISOString().slice(0, 10)
    day.setUTCDate(day.getUTCDate() - days)
    start = day.toISOString().slice(0, 10)
    return { start, end }
  }
  else if (kind === 'day') day.setUTCDate(day.getUTCDate() + 1)
  else if (kind === 'yesterday') { day.setUTCDate(day.getUTCDate() - 1); start = day.toISOString().slice(0, 10); day.setUTCDate(day.getUTCDate() + 1) }
  else fail(400, 'INVALID_RANGE')
  end = day.toISOString().slice(0, 10)
  return { start, end }
}
const recordDate = (record) => validDate(record.record_date) ? record.record_date : key(record.created_at)
function excretionCount(payload) {
  const count = Number(payload && payload.count)
  return Number.isFinite(count) && count > 0 ? count : 1
}
async function records(db, name, scope, dates, babyId = '') {
  scope = babyId ? { ...scope, baby_id: babyId } : scope
  let condition = scope
  if (dates.start) {
    const _ = db.command
    condition = _.and([scope, _.or([
      { record_date: _.gte(dates.start).and(_.lt(dates.end)) },
      { record_date: _.exists(false), created_at: _.gte(new Date(`${dates.start}T00:00:00+08:00`)).and(_.lt(new Date(`${dates.end}T00:00:00+08:00`))) }
    ])])
  }
  return all(db, name, condition)
}
function summarize(data) {
  const feeds = data.feeding || [], growth = (data.growth || []).slice().sort((a, b) => recordDate(a).localeCompare(recordDate(b)) || new Date(a.created_at) - new Date(b.created_at))
  const byCategory = {}
  for (const record of feeds) {
    const p = record.payload || {}, category = record.type === 'feed' ? (['breast', 'bottle', 'formula', 'mixed'].includes(p.mode) ? p.mode : 'mixed') : record.type
    const item = byCategory[category] || { count: 0, amountMl: 0, durationMin: 0 }
    item.count++; item.amountMl += Number(p.amountMl) || 0; item.durationMin += Number(p.durationMin) || 0
    if (record.type === 'excretion') {
      const kind = p.kind === 'urine' ? 'urine' : 'stool'
      item[kind + 'Count'] = (item[kind + 'Count'] || 0) + excretionCount(p)
    }
    byCategory[category] = item
  }
  const measure = field => {
    const values = growth.map(r => Number(r[field])).filter(v => Number.isFinite(v) && v > 0)
    return { latest: values.length ? values[values.length - 1] : null, gain: values.length > 1 ? Math.round((values[values.length - 1] - values[0]) * 100) / 100 : null }
  }
  const extra = data.custom || []
  return {
    feeding: { count: feeds.filter(r => r.type === 'feed').length, amountMl: feeds.filter(r => r.type === 'feed').reduce((n, r) => n + (Number((r.payload || {}).amountMl) || 0), 0), byCategory },
    growth: { count: growth.length, height: measure('height'), weight: measure('weight'), head: measure('head'), trend: growth.map(r => ({ date: recordDate(r), weight: r.weight, height: r.height })) },
    diary: { count: (data.diary || []).length }, milestone: { count: (data.milestone || []).length },
    custom: { count: extra.filter(r => r.category === 'custom').length, entries: extra.filter(r => r.category === 'custom').map(r => ({ label: r.label, value: r.value, unit: r.unit })) }
  }
}
async function aggregate(db, context, dates, babyId = '', categories) {
  const filterToCategories = categories !== undefined
  const selected = filterToCategories ? normalizeCategories(categories) : CATEGORY_KEYS
  const data = { feeding: [], growth: [], diary: [], milestone: [], custom: [] }
  const spec = []
  if (selected.some(category => ['feeding', 'solid', 'excretion'].includes(category))) spec.push(['feeding', 'feeding_records'])
  if (selected.includes('growth')) spec.push(['growth', 'growth_records'])
  if (selected.includes('diary')) spec.push(['diary', 'diary_records'])
  if (selected.includes('milestone')) spec.push(['milestone', 'milestone_records'])
  if (selected.includes('custom')) spec.push(['custom', 'custom_records'])
  await Promise.all(spec.map(async ([type, collection]) => { data[type] = await records(db, collection, context.scope, dates, babyId) }))
  if (filterToCategories && selected.length && data.feeding.length) {
    const allowed = new Set(selected.flatMap(category => category === 'feeding' ? ['feed'] : category === 'solid' || category === 'excretion' ? [category] : []))
    data.feeding = data.feeding.filter(record => allowed.has(record.type))
  }
  if (filterToCategories) {
    if (!selected.includes('custom')) data.custom = []
    else data.custom = data.custom.filter(record => record.category === 'custom')
  }
  return { data, summary: summarize(data) }
}
function series(data) {
  const dateSort = (a, b) => a.d.localeCompare(b.d)
  const positive = value => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null }
  const timestamp = value => { const time = new Date(value || 0).getTime(); return Number.isFinite(time) ? time : 0 }
  const daily = (rows, predicate, create, add) => {
    const groups = new Map()
    for (const record of rows || []) {
      if (!predicate(record)) continue
      const d = recordDate(record)
      if (!groups.has(d)) groups.set(d, create(d))
      add(groups.get(d), record)
    }
    return [...groups.values()].sort(dateSort)
  }
  const result = { growth: [], feeding: [], solid: [], excretion: [], diary: [], custom: [] }

  const growthByDay = new Map()
  for (const record of (data.growth || []).slice().sort((a, b) => recordDate(a).localeCompare(recordDate(b)) || timestamp(a.created_at) - timestamp(b.created_at))) {
    const d = recordDate(record)
    const point = growthByDay.get(d) || { d }
    for (const field of ['weight', 'height', 'head']) {
      const value = positive(record[field])
      if (value !== null) point[field] = value
    }
    growthByDay.set(d, point)
  }
  result.growth = [...growthByDay.values()].sort((a, b) => a.d.localeCompare(b.d))

  result.feeding = daily(data.feeding, record => record.type === 'feed', d => ({ d, n: 0, ml: 0, min: 0 }), (row, record) => {
    const payload = record.payload || {}
    row.n++
    row.ml += positive(payload.amountMl) || 0
    row.min += positive(payload.durationMin) || 0
  }).map(row => {
    const point = { d: row.d, n: row.n }
    if (row.ml > 0) point.ml = row.ml
    if (row.min > 0) point.min = row.min
    return point
  })
  result.solid = daily(data.feeding, record => record.type === 'solid', d => ({ d, n: 0 }), row => { row.n++ })
  result.excretion = daily(data.feeding, record => record.type === 'excretion', d => ({ d, stool: 0, urine: 0 }), (row, record) => {
    const payload = record.payload || {}
    const kind = payload.kind === 'urine' ? 'urine' : 'stool'
    row[kind] += excretionCount(payload)
  }).map(row => {
    const point = { d: row.d }
    if (row.stool > 0) point.stool = row.stool
    if (row.urine > 0) point.urine = row.urine
    return point
  })
  result.diary = daily(data.diary, () => true, d => ({ d, n: 0 }), row => { row.n++ })

  const customGroups = new Map()
  for (const record of data.custom || []) {
    if (record.category !== 'custom') continue
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    if (!label) continue
    const group = customGroups.get(label) || { label, unit: '', count: 0, points: [] }
    group.count++
    if (!group.unit && typeof record.unit === 'string' && record.unit.trim()) group.unit = record.unit.trim()
    const value = record.value == null || record.value === '' ? null : Number(record.value)
    if (Number.isFinite(value) && value >= 0) group.points.push({ d: recordDate(record), value, createdAt: timestamp(record.created_at) })
    customGroups.set(label, group)
  }
  result.custom = [...customGroups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 6).map(group => ({
    label: group.label,
    unit: group.unit,
    points: group.points.sort((a, b) => a.d.localeCompare(b.d) || a.createdAt - b.createdAt).map(({ d, value }) => ({ d, value }))
  }))
  return result
}
// Numeric aggregates remain available as overview; record prose is rendered separately by record-details.js.
// feeding / excretion / solid 同源于 feeding_records，但按所选数据类型分别切片，未选中的不会被带进提示词。
const FEED_MODES = ['breast', 'bottle', 'formula', 'mixed']
function aiSummary(summary, categories) {
  const result = {}, byCategory = summary.feeding.byCategory || {}
  for (const category of categories) {
    if (category === 'growth') result.growth = { count: summary.growth.count, height: summary.growth.height, weight: summary.growth.weight, head: summary.growth.head }
    else if (category === 'custom') result.custom = { count: summary.custom.count }
    else if (category === 'feeding') {
      const modes = {}
      for (const mode of FEED_MODES) if (byCategory[mode]) modes[mode] = byCategory[mode]
      result.feeding = { count: summary.feeding.count, amountMl: summary.feeding.amountMl, byCategory: modes }
    } else if (category === 'excretion') {
      const item = byCategory.excretion || {}
      result.excretion = { count: item.count || 0, urine: item.urineCount || 0, stool: item.stoolCount || 0 }
    } else if (category === 'solid') result.solid = { count: (byCategory.solid || {}).count || 0 }
    else result[category] = summary[category]
  }
  return result
}
module.exports = { range, recordDate, records, aggregate, summarize, aiSummary, series }
