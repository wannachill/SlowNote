const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const HEATMAP_TYPES = ['feeding', 'solid', 'excretion', 'diary']

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function shiftDay(day, offset) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10)
}

function weekday(day) {
  return new Date(`${day}T00:00:00Z`).getUTCDay()
}

function valueOf(type, point) {
  const numeric = value => {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : 0
  }
  // Combine stool and urine: both are daily elimination events, and neither is a health score.
  if (type === 'excretion') return numeric(point.stool) + numeric(point.urine)
  return numeric(point.n)
}

function emptyResult() {
  return { weekdays: WEEKDAYS.slice(), cells: [] }
}

function buildHeatmap(points, type, dates, range, today) {
  if (!HEATMAP_TYPES.includes(type)) return emptyResult()
  let start, end
  if (range === 'all') {
    if (!isDate(today)) return emptyResult()
    start = shiftDay(today, -34)
    if (dates && isDate(dates.start) && dates.start > start && dates.start <= today) start = dates.start
    end = today
  } else {
    if (!dates || !isDate(dates.start) || !isDate(dates.end)) return emptyResult()
    start = dates.start
    end = shiftDay(dates.end, -1)
  }
  if (start > end) return emptyResult()

  const days = []
  for (let day = start; day <= end; day = shiftDay(day, 1)) days.push(day)
  const values = new Map()
  for (const point of points || []) {
    if (!point || !isDate(point.d) || point.d < start || point.d > end) continue
    values.set(point.d, (values.get(point.d) || 0) + valueOf(type, point))
  }
  const max = days.reduce((largest, day) => Math.max(largest, values.get(day) || 0), 0)
  const cells = []
  const addBlank = key => cells.push({ key, date: '', day: '', value: 0, level: 0, outside: true, ariaLabel: '' })
  for (let index = 0; index < weekday(start); index++) addBlank(`leading-${index}`)
  for (const day of days) {
    const value = values.get(day) || 0
    const level = value > 0 && max > 0 ? Math.min(4, Math.max(1, Math.ceil(value / max * 4))) : 0
    cells.push({ key: day, date: day, day: Number(day.slice(8, 10)), value, level, outside: false, ariaLabel: `${day}，${value > 0 ? `${value}次记录` : '无记录'}` })
  }
  const trailing = (7 - cells.length % 7) % 7
  for (let index = 0; index < trailing; index++) addBlank(`trailing-${index}`)
  return { weekdays: WEEKDAYS.slice(), cells }
}

module.exports = { HEATMAP_TYPES, buildHeatmap }
