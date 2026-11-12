const DAY = 86400000
const CHINA_OFFSET = 8 * 3600000
const dateText = value => value.toISOString().slice(0, 10)
// 报告数据范围：auto 跟随频率（每天=今天、每周=近 7 天、每月=上月），其余为显式回溯天数。
// 范围与频率相互独立：频率决定「多久出一份」，范围决定「这份看多久」，允许滚动重叠。
const REPORT_RANGES = ['auto', 'today', '3d', '7d', '30d']
const RANGE_DAYS = { today: 1, '3d': 3, '7d': 7, '30d': 30 }
const RANGE_PERIODS = { 1: '今天', 3: '最近 3 天', 7: '最近一周', 30: '最近 30 天' }

function normalizeRange(range) {
  return REPORT_RANGES.includes(range) ? range : 'auto'
}
// Monthly keeps its own full-previous-month window; explicit ranges only apply to daily/weekly.
function windowDays(frequency, range) {
  const days = RANGE_DAYS[normalizeRange(range)]
  return days || (frequency === 'weekly' ? 7 : 1)
}

function nextRun(task, now = new Date()) {
  now = new Date(now)
  const china = new Date(now.getTime() + CHINA_OFFSET), [hour, minute] = task.time.split(':').map(Number)
  if (task.frequency === 'monthly') {
    let due = Date.UTC(china.getUTCFullYear(), china.getUTCMonth() + 1, 1, hour - 8, minute)
    if (due <= +now) due = Date.UTC(china.getUTCFullYear(), china.getUTCMonth() + 2, 1, hour - 8, minute)
    return new Date(due)
  }
  let due = Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate(), hour - 8, minute)
  if (task.frequency === 'weekly') {
    const days = (task.weekday - china.getUTCDay() + 7) % 7
    due += days * 86400000
    if (due <= +now) due += 7 * 86400000
  } else if (due <= +now) due += DAY
  return new Date(due)
}

function reportWindow(frequency, now = new Date(), range = 'auto') {
  const anchor = new Date(new Date(now).getTime() + CHINA_OFFSET)
  if (frequency === 'monthly') {
    const thisMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
    const previousMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1))
    return {
      start: dateText(previousMonth), end: dateText(thisMonth),
      days: Math.round((+thisMonth - +previousMonth) / DAY), period: '上个月'
    }
  }
  const days = windowDays(frequency, range)
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + 1))
  const start = new Date(+end - days * DAY)
  return { start: dateText(start), end: dateText(end), days, period: RANGE_PERIODS[days] || `最近 ${days} 天` }
}

module.exports = { nextRun, reportWindow, REPORT_RANGES, normalizeRange, windowDays }
