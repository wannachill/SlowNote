// 记录时间：日期仍为 YYYY-MM-DD，独立字段 record_time 存 HH:mm:ss（北京时间）。
// 微信原生 picker 的 time 模式只到分钟，用 multiSelector 三列实现时:分:秒。
const pad = (n) => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i))
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i))
const SECONDS = Array.from({ length: 60 }, (_, i) => pad(i))
const TIME_COLUMNS = [HOURS, MINUTES, SECONDS]

function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)
}
// 北京时间当前时刻；传 created_at 可换算旧记录的时间。
function timeKey(value) {
  if (value === undefined || value === null || value === '') return ''
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Date(ms + 8 * 3600000).toISOString().slice(11, 19)
}
function nowTime() { return timeKey(new Date()) || '00:00:00' }
function timeToIndexes(value) {
  const parts = validTime(value) ? value.split(':').map(Number) : nowTime().split(':').map(Number)
  return [parts[0], parts[1], parts[2]]
}
function indexesToTime(indexes) {
  const parts = Array.isArray(indexes) ? indexes : []
  return TIME_COLUMNS.map((column, i) => {
    const index = Number(parts[i])
    return column[Number.isInteger(index) && index >= 0 && index < column.length ? index : 0]
  }).join(':')
}
// 列表展示：优先用户指定时刻；旧数据回退到 created_at 的北京时间。
function displayTime(recordTime, createdAt) {
  return validTime(recordTime) ? recordTime : timeKey(createdAt)
}
function recordTimeData(value) {
  const time = validTime(value) ? value : nowTime()
  return { recordTime: time, timeIndexes: timeToIndexes(time) }
}
// 页面包装器：注入默认值、选择器事件与回填方法，避免六个记录页重复实现。
function withRecordTime(definition) {
  const onLoad = definition.onLoad
  return {
    ...definition,
    data: { ...definition.data, ...recordTimeData(), timeColumns: TIME_COLUMNS },
    onLoad(options) {
      const time = validTime(options && options.time) ? options.time : nowTime()
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
  TIME_COLUMNS, validTime, timeKey, nowTime, timeToIndexes, indexesToTime,
  displayTime, recordTimeData, withRecordTime
}
