// 记录时间：日期仍为 YYYY-MM-DD，独立字段 record_time 存 HH:mm（北京时间）。
// 微信原生 picker 的 time 模式只到分钟，用 multiSelector 两列实现时:分。
const pad = (n) => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i))
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i))
const TIME_COLUMNS = [HOURS, MINUTES]

// 新写入只接受 HH:mm；读取/回填兼容旧 HH:mm:ss，统一截断到分钟。
function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}
function minuteOf(value) {
  if (typeof value !== 'string') return ''
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value) ? value.slice(0, 5) : ''
}
// 北京时间当前时刻；传 created_at 可换算旧记录的时间。
function timeKey(value) {
  if (value === undefined || value === null || value === '') return ''
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Date(ms + 8 * 3600000).toISOString().slice(11, 16)
}
function nowTime() { return timeKey(new Date()) || '00:00' }
function timeToIndexes(value) {
  const parts = (minuteOf(value) || nowTime()).split(':').map(Number)
  return [parts[0], parts[1]]
}
function indexesToTime(indexes) {
  const parts = Array.isArray(indexes) ? indexes : []
  return TIME_COLUMNS.map((column, i) => {
    const index = Number(parts[i])
    return column[Number.isInteger(index) && index >= 0 && index < column.length ? index : 0]
  }).join(':')
}
// 列表展示：优先用户指定时刻（含旧带秒值截断）；旧数据回退到 created_at 的北京时间。
function displayTime(recordTime, createdAt) {
  return minuteOf(recordTime) || timeKey(createdAt)
}
function recordTimeData(value) {
  const time = minuteOf(value) || nowTime()
  return { recordTime: time, timeIndexes: timeToIndexes(time) }
}
// 页面包装器：注入默认值、选择器事件与回填方法，避免六个记录页重复实现。
function withRecordTime(definition) {
  const onLoad = definition.onLoad
  return {
    ...definition,
    data: { ...definition.data, ...recordTimeData(), timeColumns: TIME_COLUMNS },
    onLoad(options) {
      const time = minuteOf(options && options.time) || nowTime()
      this.setData(recordTimeData(time))
      return onLoad ? onLoad.call(this, options) : undefined
    },
    onRecordTime(e) {
      if (this.data.submitting || this.data.closing) return
      const indexes = e.detail.value
      this.setData({ recordTime: indexesToTime(indexes), timeIndexes: indexes })
      this._timeTouched = true
      // 改时刻后必须换幂等键，否则同一 clientRequestId 会被云端判重复而忽略新值。
      this._requestId = ''
      this._id = ''
    },
    resetRecordTime() { this._timeTouched = false; this.setData(recordTimeData()) },
    fillRecordTime(value) { this._timeTouched = false; this.setData(recordTimeData(value)) }
  }
}
module.exports = {
  TIME_COLUMNS, validTime, minuteOf, timeKey, nowTime, timeToIndexes, indexesToTime,
  displayTime, recordTimeData, withRecordTime
}
