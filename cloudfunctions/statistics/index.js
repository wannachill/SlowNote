const { endpoint, access, validDate, fail } = require('./lib/runtime')
const { aggregate, range, recordDate, series } = require('./lib/aggregation')
const { buildDetails, DETAILS_LIMIT, normalizeCategories } = require('./lib/record-details')
// 显式 action 白名单：省略 action 的旧调用仍走默认区间聚合，其余未知值必须报错，
// 否则拼写错误会静默落到聚合分支，返回看似正常但语义不符的数据。
const ACTIONS = ['trend', 'calendar', 'daily', 'range']
function totals(summary) {
  const categories = summary.feeding.byCategory || {}
  const excretion = categories.excretion || {}
  return {
    feeding: { count: summary.feeding.count, amountMl: summary.feeding.amountMl },
    solid: { count: (categories.solid || {}).count || 0 },
    excretion: { stool: excretion.stoolCount || 0, urine: excretion.urineCount || 0 },
    growth: { count: summary.growth.count, weight: summary.growth.weight, height: summary.growth.height, head: summary.growth.head },
    diary: { count: summary.diary.count },
    custom: { count: summary.custom.count }
  }
}
exports.main = endpoint(async ({ event, db, openid }) => {
  if (event.action != null && event.action !== '' && !ACTIONS.includes(event.action)) fail(400, 'UNKNOWN_ACTION')
  const context = await access(db, openid)
  const babyId = typeof event.baby_id === 'string' && event.baby_id.length <= 64 ? event.baby_id : ''
  if (event.action === 'trend') {
    const kind = event.range || 'week'
    const dates = range(kind)
    const previousKind = kind === 'week' ? 'lastWeek' : kind === 'month' ? 'lastMonth' : ''
    const [current, previous] = await Promise.all([
      aggregate(db, context, dates, babyId),
      previousKind ? aggregate(db, context, range(previousKind), babyId) : Promise.resolve(null)
    ])
    const { data, summary } = current
    const chartSeries = series(data)
    if (kind === 'all') {
      const allDates = Object.values(chartSeries).flatMap(items => items.flatMap(item => item.points ? item.points.map(point => point.d) : item.d ? [item.d] : []))
      dates.start = allDates.length ? allDates.sort()[0] : ''
    }
    return { code: 0, range: kind, dates, series: chartSeries, totals: totals(summary), prevTotals: previous ? totals(previous.summary) : null }
  }
  if (event.action === 'calendar') {
    const { data } = await aggregate(db, context, range('month', event.date), babyId)
    return { code: 0, marks: [...new Set(Object.values(data).flat().map(recordDate))] }
  }
  if (event.action === 'daily') {
    if (!validDate(event.date) || !validDate(event.weekStart)) fail(400, 'INVALID_DATE')
    const weekEnd = new Date(`${event.weekStart}T00:00:00Z`); weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)
    const dates = { start: event.weekStart, end: weekEnd.toISOString().slice(0, 10) }
    if (event.date < dates.start || event.date >= dates.end) fail(400, 'DATE_OUTSIDE_WEEK')
    const { data } = await aggregate(db, context, dates, babyId), selected = {}, marks = new Set()
    for (const [category, rows] of Object.entries(data)) { rows.forEach(r => marks.add(recordDate(r))); selected[category] = rows.filter(r => recordDate(r) === event.date) }
    const times = {}
    const timeOf = rows => (rows || []).reduce((latest, record) => {
      const value = new Date(record.created_at || 0).getTime()
      return Number.isFinite(value) && value > latest ? value : latest
    }, 0)
    const formatTime = value => {
      const date = new Date(value + 8 * 3600 * 1000)
      return String(date.getUTCHours()).padStart(2, '0') + ':' + String(date.getUTCMinutes()).padStart(2, '0')
    }
    const putTime = (key, rows) => { const value = timeOf(rows); if (value) times[key] = formatTime(value) }
    const feedingTimes = {}
    for (const record of selected.feeding || []) {
      const payload = record.payload || {}
      const key = record.type === 'feed' ? (['breast', 'bottle', 'formula', 'mixed'].includes(payload.mode) ? payload.mode : 'mixed') : record.type
      const value = new Date(record.created_at || 0).getTime()
      if (Number.isFinite(value) && value > (feedingTimes[key] || 0)) feedingTimes[key] = value
    }
    for (const [key, value] of Object.entries(feedingTimes)) times[key] = formatTime(value)
    putTime('growth', selected.growth)
    putTime('diary', selected.diary)
    putTime('milestone', selected.milestone)
    putTime('custom', (selected.custom || []).filter(record => record.category === 'custom'))
    return { code: 0, date: event.date, marks: [...marks], summary: require('./lib/aggregation').summarize(selected), times }
  }
  // 'range' 为 AI 问答生成服务端明细；仅返回白名单渲染文本，不下发原始记录。
  const kind = event.range || 'week'
  const dates = range(kind)
  const categories = event.categories === undefined
    ? undefined
    : normalizeCategories(Array.isArray(event.categories) ? event.categories : [])
  const { data, summary } = await aggregate(db, context, dates, babyId, categories)
  const details = await buildDetails(data, categories, { db, scope: context.scope, babyId, range: kind })
  return { code: 0, range: kind, dates, summary, details, detailsLimit: DETAILS_LIMIT }
})
