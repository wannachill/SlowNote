const pad = (n) => String(n).padStart(2, '0')
const dateKey = (value) => {
  if (value === undefined) return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const d = value instanceof Date ? value : new Date(value)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function parseDate(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return null
  const [y, m, d] = key.split('-').map(Number)
  const value = new Date(y, m - 1, d, 12)
  return dateKey(value) === key ? value : null
}
function addDays(key, days) {
  const d = parseDate(key)
  if (!d) return dateKey()
  d.setDate(d.getDate() + days)
  return dateKey(d)
}
function week(key) {
  const d = parseDate(key) || new Date(), start = addDays(dateKey(d), -d.getDay())
  return Array.from({ length: 7 }, (_, i) => {
    const value = addDays(start, i)
    return { date: value, day: Number(value.slice(-2)), today: value === dateKey(), label: ['日', '一', '二', '三', '四', '五', '六'][i] }
  })
}
function ageMonths(birthday, today = dateKey()) {
  const birth = parseDate(birthday), now = parseDate(today)
  if (!birth || !now || birth > now) return null
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth()
  const anniversary = (m) => new Date(birth.getFullYear(), birth.getMonth() + m, Math.min(birth.getDate(), new Date(birth.getFullYear(), birth.getMonth() + m + 1, 0).getDate()), 12)
  if (anniversary(months) > now) months--
  return months
}
function ageText(birthday, today = dateKey()) {
  const birth = parseDate(birthday), now = parseDate(today), months = ageMonths(birthday, today)
  if (!birth || !now || months == null) return '一迈一记，记录每一步成长'
  const anniversary = (m) => new Date(birth.getFullYear(), birth.getMonth() + m, Math.min(birth.getDate(), new Date(birth.getFullYear(), birth.getMonth() + m + 1, 0).getDate()), 12)
  const days = Math.round((now - anniversary(months)) / 86400000)
  return `${months ? `${months}个月` : ''}${days || !months ? `${days}天` : ''}`
}
function ageMonth(birthday, today = dateKey()) {
  const months = ageMonths(birthday, today)
  return months == null || months > 36 ? null : months
}
function monthDays(key) {
  const d = parseDate(key) || parseDate(dateKey())
  const first = dateKey(new Date(d.getFullYear(), d.getMonth(), 1, 12))
  const start = addDays(first, -parseDate(first).getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i)
    return { date, day: Number(date.slice(-2)), today: date === dateKey(), muted: date.slice(0, 7) !== key.slice(0, 7) }
  })
}
function shiftMonth(key, amount) {
  const d = parseDate(key), target = new Date(d.getFullYear(), d.getMonth() + amount + 1, 0, 12)
  target.setDate(Math.min(d.getDate(), target.getDate()))
  return dateKey(target)
}
module.exports = { dateKey, parseDate, addDays, week, monthDays, shiftMonth, ageText, ageMonths, ageMonth }
