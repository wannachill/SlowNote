const DEFAULT_DURATION = 700
const DAY = 86400000
// 日号轴使用整数天步长；长区间改用月份刻度。
const STEP_DAYS = [1, 2, 3, 7, 14, 30, 90, 180, 365]
const LONG_SPAN = 120

function stopMotion(page) {
  if (page._chartCanvas && page._chartCanvas.cancelAnimationFrame && page._chartRaf !== null && page._chartRaf !== undefined) {
    page._chartCanvas.cancelAnimationFrame(page._chartRaf)
    page._chartPainted = false
  }
  page._chartRaf = null
  if (page._chartTimer !== null && page._chartTimer !== undefined) { clearTimeout(page._chartTimer); page._chartTimer = null }
}

function cancel(page) {
  page._chartVersion = (page._chartVersion || 0) + 1
  page._chartToken = (page._chartToken || 0) + 1
  stopMotion(page)
  if (page._chartContext && page._chartSize) {
    page._chartContext.clearRect(0, 0, page._chartSize.width, page._chartSize.height)
  }
  page._chartPainted = false
  page._chartSignature = ''
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }

// Keep every tick on an axis at the same precision.
function axisDigits(min, max) {
  const span = Math.abs(max - min)
  if (span >= 5) return 0
  if (span >= 1) return 1
  if (span > 0) return 2
  return Math.abs(max) >= 10 ? 1 : 2
}

function axisValue(value, digits) {
  const factor = Math.pow(10, digits)
  const rounded = Math.round(value * factor) / factor
  const text = digits > 0 ? rounded.toFixed(digits) : String(rounded)
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function durationMs(value) {
  const match = String(value || '').trim().match(/^([\d.]+)\s*(ms|s)?$/i)
  if (!match) return DEFAULT_DURATION
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return DEFAULT_DURATION
  return match[2] && match[2].toLowerCase() === 's' ? amount * 1000 : amount
}

function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function dayTime(value) { const time = new Date(value + 'T00:00:00Z').getTime(); return Number.isFinite(time) ? time : null }
function shortDay(value) { return validDay(value) ? value.slice(5) : '' }
function tickLabel(value) {
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function pointLabel(value) {
  const digits = Number.isInteger(value) ? 0 : Math.abs(value) < 10 ? 2 : 1
  return axisValue(value, digits)
}
function visiblePlotBounds(geometry) {
  const { plot, width } = geometry
  const offset = Number(geometry.viewOffset) || 0
  const viewWidth = Number(geometry.viewWidth) || Number(geometry.bitmapWidth) || width
  return {
    left: Math.max(plot.x, offset),
    right: Math.min(plot.x + plot.w, offset + viewWidth)
  }
}

function pointLabelBounds(ctx, text, x, geometry, fontSize) {
  const previousFont = ctx.font
  if (fontSize && geometry.axisFontFamily) ctx.font = fontSize + 'px ' + geometry.axisFontFamily
  const width = ctx.measureText ? ctx.measureText(text).width : text.length * (fontSize || 10) * 0.55
  ctx.font = previousFont
  const bounds = visiblePlotBounds(geometry)
  const available = Math.max(0, bounds.right - bounds.left)
  const half = width / 2
  if (x - half < bounds.left) return { left: bounds.left + 2, right: bounds.left + 2 + width, align: 'left', x: bounds.left + 2, width }
  if (x + half > bounds.right) return { left: bounds.right - 2 - width, right: bounds.right - 2, align: 'right', x: bounds.right - 2, width }
  if (width > available) return { left: bounds.left, right: bounds.right, align: 'left', x: bounds.left, width }
  return { left: x - half, right: x + half, align: 'center', x, width }
}

function drawPointLabel(ctx, text, x, y, geometry, options = {}) {
  const previousAlign = ctx.textAlign, previousBaseline = ctx.textBaseline
  const previousFont = ctx.font, previousFill = ctx.fillStyle
  const fontSize = options.fontSize || geometry.axisFontSize || Math.max(9, Math.round(geometry.width * 0.026))
  const family = geometry.axisFontFamily || 'sans-serif'
  ctx.font = fontSize + 'px ' + family
  const visible = visiblePlotBounds(geometry)
  if (x < visible.left || x > visible.right) {
    ctx.font = previousFont
    return null
  }
  const bounds = pointLabelBounds(ctx, text, x, geometry, fontSize)
  ctx.textAlign = bounds.align
  ctx.textBaseline = 'bottom'
  if (options.background && typeof ctx.fillRect === 'function') {
    ctx.fillStyle = geometry.palette.surface || (geometry.palette.dark ? '#1d2a37' : '#ffffff')
    ctx.fillRect(bounds.left - 2, y - fontSize - 1, bounds.width + 4, fontSize + 3)
    ctx.fillStyle = previousFill
  }
  ctx.fillText(text, bounds.x, y)
  ctx.textAlign = previousAlign
  ctx.textBaseline = previousBaseline
  ctx.font = previousFont
  ctx.fillStyle = previousFill
  return { left: bounds.left - 2, right: bounds.right + 2, top: y - fontSize - 1, bottom: y + 1 }
}

function segmentIntersectsRect(start, end, rect) {
  const left = rect.left - 2, right = rect.right + 2
  const top = rect.top - 2, bottom = rect.bottom + 2
  const dx = end.x - start.x, dy = end.y - start.y
  let first = 0, last = 1
  const clip = (p, q) => {
    if (p === 0) return q >= 0
    const ratio = q / p
    if (p < 0) {
      if (ratio > last) return false
      if (ratio > first) first = ratio
    } else {
      if (ratio < first) return false
      if (ratio < last) last = ratio
    }
    return true
  }
  return clip(-dx, start.x - left) && clip(dx, right - start.x) &&
    clip(-dy, start.y - top) && clip(dy, bottom - start.y) && first <= last
}

function linePointLabelPlacement(ctx, text, point, pointIndex, points, radius, pane, geometry, fontSize, placed) {
  const sizes = [fontSize, Math.max(8, Math.round(fontSize * 0.84)), Math.max(7, Math.round(fontSize * 0.72))]
  const candidateFor = (size, y) => {
    const label = pointLabelBounds(ctx, text, point.x, geometry, size)
    const rect = { left: label.left - 2, right: label.right + 2, top: y - size - 1, bottom: y + 1 }
    return { y, fontSize: size, background: false, rect }
  }
  const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  const available = candidate => {
    if (candidate.rect.top < pane.y || candidate.rect.bottom > pane.y + pane.h) return false
    if (placed.some(rect => intersects(candidate.rect, rect))) return false
    const left = candidate.rect.left - radius - 2, right = candidate.rect.right + radius + 2
    let first = pointIndex, last = pointIndex
    while (first > 0 && points[first - 1].x >= left) first--
    while (last < points.length - 1 && points[last + 1].x <= right) last++
    let hitsPoint = false
    for (let index = first; index <= last; index++) {
      const other = points[index]
      const nearestX = clamp(other.x, candidate.rect.left, candidate.rect.right)
      const nearestY = clamp(other.y, candidate.rect.top, candidate.rect.bottom)
      if (Math.pow(nearestX - other.x, 2) + Math.pow(nearestY - other.y, 2) <= Math.pow(radius + 2, 2)) { hitsPoint = true; break }
    }
    if (hitsPoint) return false
    for (let index = Math.max(1, first); index <= Math.min(points.length - 1, last + 1); index++) {
      if (segmentIntersectsRect(points[index - 1], points[index], candidate.rect)) return false
    }
    return true
  }

  for (const size of sizes) {
    const above = point.y - radius - 5
    const below = point.y + radius + size + 5
    const step = size + 3
    const candidates = [above, below]
    for (let row = 1; row <= 8; row++) candidates.push(above - step * row, below + step * row)
    for (const y of candidates) {
      const candidate = candidateFor(size, y)
      if (available(candidate)) return candidate
    }
  }

  // Dense series can leave no collision-free position. Keep the value visible
  // with an opaque label close to its point instead of silently dropping it.
  const size = sizes[sizes.length - 1]
  const above = point.y - radius - 4
  const low = pane.y + size + 1, high = pane.y + pane.h - 1
  for (let row = 0; row <= 12; row++) {
    const y = clamp(above - row * (size + 2), low, high)
    const candidate = candidateFor(size, y)
    if (!placed.some(rect => intersects(candidate.rect, rect))) {
      candidate.background = true
      return candidate
    }
  }
  const candidate = candidateFor(size, clamp(above, low, high))
  candidate.background = true
  return candidate
}

function pointLabelIndexes(points) {
  return new Set(points.map((point, index) => point.registered !== false ? index : -1).filter(index => index >= 0))
}

function linePointLabelPlacements(ctx, item, geometry, radius, fontSize, seriesIndex) {
  const offset = Number(geometry.viewOffset) || 0
  const width = Number(geometry.viewWidth) || Number(geometry.bitmapWidth) || geometry.width
  const viewportKey = [offset, width].join(':')
  let cache = geometry._pointLabelPlacementCache
  if (!cache || cache.viewportKey !== viewportKey) {
    cache = geometry._pointLabelPlacementCache = { viewportKey, series: Object.create(null) }
  }
  const key = [seriesIndex, fontSize, radius].join(':')
  if (cache.series[key]) return cache.series[key]
  const labels = pointLabelIndexes(item.points)
  const placed = [], placements = []
  const visible = visiblePlotBounds(geometry)
  for (let index = 0; index < item.points.length; index++) {
    if (!labels.has(index)) continue
    const point = item.points[index]
    if (point.x < visible.left || point.x > visible.right) continue
    const placement = linePointLabelPlacement(ctx, pointLabel(point.v), point, index, item.points, radius, item.pane, geometry, fontSize, placed)
    placed.push(placement.rect)
    placements[index] = placement
  }
  cache.series[key] = placements
  return placements
}

function niceAxisStep(value, integer) {
  if (integer) return Math.max(1, Math.ceil(value))
  const power = Math.pow(10, Math.floor(Math.log10(value || 1)))
  const fraction = value / power
  const multiplier = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return multiplier * power
}

function axisScale(min, max, zeroBased, integer) {
  if (min === max) {
    const padding = integer ? 1 : Math.abs(max) * 0.1 || 1
    min -= padding
    max += padding
  }
  const step = niceAxisStep((max - min) / 4, integer)
  const lower = zeroBased ? 0 : Math.floor(min / step) * step
  let upper = Math.ceil((max + step * 1e-10) / step) * step
  if (upper <= max) upper += step
  if (upper - lower < step * 3) upper = lower + step * 3
  const digits = integer ? 0 : Math.min(3, (String(Number(step.toPrecision(8))).split('.')[1] || '').length)
  const ticks = []
  for (let value = lower, index = 0; value <= upper + step * 1e-8 && index < 8; value += step, index++) {
    ticks.push({ value: Number(value.toPrecision(10)) })
  }
  return { min: lower, max: upper, ticks, digits }
}

function axisDates(geometry) {
  const { start, end, dates } = geometry
  const days = Math.round((end - start) / DAY)
  if (!(days >= 1) || days > 4000) return dates
  const list = []
  for (let index = 0; index < days; index++) list.push(new Date(start + index * DAY).toISOString().slice(0, 10))
  return list
}

function monthLabel(key, withYear) {
  return (withYear ? key.slice(2, 4) + '年' : '') + Number(key.slice(5, 7)) + '月'
}

function axisTicks(ctx, geometry) {
  const { plot, width, start, end } = geometry
  const dates = axisDates(geometry)
  if (!dates || !dates.length) return { ticks: [], band: [] }
  const days = dates.length
  const span = Math.max(end - start, 1)
  const rawX = index => plot.x + (dayTime(dates[index]) - start) / span * plot.w
  const size = geometry.axisFontSize || Math.max(9, Math.round(width * 0.026))
  const family = geometry.axisFontFamily || 'sans-serif'
  const tickFont = size + 'px ' + family
  const bandFont = Math.max(9, size - 2) + 'px ' + family
  const place = (x, text, font) => {
    ctx.font = font
    const half = ctx.measureText(text).width / 2
    ctx.font = tickFont
    return { text, x: Math.round(clamp(x, half + 8, width - half - 8)) }
  }

  if (days === 1) {
    const only = dates[0]
    return { ticks: [place(rawX(0), Number(only.slice(5, 7)) + '/' + Number(only.slice(8, 10)), tickFont)], band: [] }
  }

  const groups = []
  dates.forEach((day, index) => {
    const key = day.slice(0, 7)
    const last = groups[groups.length - 1]
    if (!last || last.key !== key) groups.push({ key, from: index, to: index })
    else last.to = index
  })
  const spansYears = dates[0].slice(0, 4) !== dates[days - 1].slice(0, 4)

  if (days > LONG_SPAN) {
    ctx.font = tickFont
    const need = ctx.measureText(monthLabel(groups[0].key, true)).width + 12
    const average = plot.w / groups.length
    let every = 1
    while (every < groups.length && average * every < need) every++
    const xOf = index => index ? rawX(groups[index].from) : plot.x
    const picked = []
    for (let index = 0; index < groups.length; index += every) picked.push(index)
    const tail = groups.length - 1
    while (picked.length > 1 && xOf(tail) - xOf(picked[picked.length - 1]) < need) picked.pop()
    if (picked[picked.length - 1] !== tail) picked.push(tail)
    return { ticks: picked.map(index => place(xOf(index), monthLabel(groups[index].key, spansYears), tickFont)), band: [] }
  }

  const slot = plot.w / days
  ctx.font = tickFont
  const need = ctx.measureText('28').width + 16
  let step = STEP_DAYS[STEP_DAYS.length - 1]
  for (const value of STEP_DAYS) { if (value * slot >= need) { step = value; break } }
  const last = days - 1
  const picked = []
  for (let index = 0; index < days; index += step) picked.push(index)
  while (picked.length > 1 && (last - picked[picked.length - 1]) * slot < need) picked.pop()
  if (picked[picked.length - 1] !== last) picked.push(last)
  const ticks = picked.map(index => place(rawX(index), String(Number(dates[index].slice(8, 10))), tickFont))
  if (days <= 31) return { ticks, band: [] }

  const margins = []
  let prevYear = ''
  for (const group of groups) {
    const year = group.key.slice(0, 4)
    const text = monthLabel(group.key, spansYears && prevYear !== year)
    prevYear = year
    ctx.font = bandFont
    const marginWidth = ctx.measureText(text).width
    ctx.font = tickFont
    margins.push({ text, x: (rawX(group.from) + rawX(group.to)) / 2, width: marginWidth })
  }
  const band = []
  for (const item of margins) {
    const prev = band[band.length - 1]
    if (prev && item.x - prev.x < prev.width / 2 + item.width / 2 + 10) continue
    band.push(item)
  }
  const tailBand = margins[margins.length - 1]
  while (band.length > 1 && band[band.length - 1] !== tailBand && tailBand.x - band[band.length - 1].x < band[band.length - 1].width / 2 + tailBand.width / 2 + 10) band.pop()
  if (band[band.length - 1] !== tailBand) band.push(tailBand)
  return { ticks, band: band.map(item => place(item.x, item.text, bandFont)) }
}

function readSeries(spec) {
  if (!spec || !Array.isArray(spec.series)) return null
  const kind = spec.kind === 'bar' ? 'bar' : 'line'
  const list = []
  for (const item of spec.series) {
    if (!item || !Array.isArray(item.points)) continue
    const points = item.points
      .map(point => ({ d: point.x, y: Number(point.y), registered: true }))
      .filter(point => validDay(point.d) && Number.isFinite(point.y) && point.y >= 0)
      .sort((a, b) => a.d.localeCompare(b.d))
    if (!points.length) continue
    list.push({ name: item.name || '', unit: item.unit || '', points })
  }
  if (!list.length) return null
  const pointDates = [...new Set(list.flatMap(item => item.points.map(point => point.d)))].sort()
  let dates = pointDates
  if (spec.gap === 'zero' && pointDates.length) {
    const requestedStart = spec.dates && validDay(spec.dates.start) ? spec.dates.start : pointDates[0]
    const requestedEnd = spec.dates && validDay(spec.dates.end) ? spec.dates.end : new Date(dayTime(pointDates[pointDates.length - 1]) + DAY).toISOString().slice(0, 10)
    const first = dayTime(requestedStart), end = dayTime(requestedEnd)
    if (first !== null && end !== null && end > first) {
      dates = []
      for (let time = first; time < end; time += DAY) dates.push(new Date(time).toISOString().slice(0, 10))
    }
  }
  if (spec.gap === 'zero') {
    list.forEach(item => {
      const values = new Map(item.points.map(point => [point.d, point.y]))
      item.points = dates.map(d => ({ d, y: values.get(d) || 0, registered: values.has(d) }))
    })
  }
  return { kind, zeroBased: !!spec.zeroBased, gap: spec.gap === 'zero' ? 'zero' : 'skip', series: list, dates: spec.dates || null, selectedDate: validDay(spec.selectedDate) ? spec.selectedDate : '' }
}

function layout(model, width, height, palette, axisLabelWidth, fontSize) {
  const padL = Math.max(width * 0.05, 12), padR = 12
  const padT = Math.max(height * 0.05, 12)
  // 底部只留一行刻度 + 一行月份带，分带后才不会挤掉横轴。
  const padB = Math.max(height * 0.12, 26) + (fontSize > 0 ? fontSize + 2 : 14)
  const plot = { x: padL, y: padT, w: Math.max(width - padL - padR, 1), h: Math.max(height - padT - padB, 1) }
  const times = []
  for (const item of model.series) for (const point of item.points) times.push(dayTime(point.d))
  const minTime = Math.min(...times), maxTime = Math.max(...times)
  let start = model.dates && validDay(model.dates.start) ? dayTime(model.dates.start) : null
  let end = model.dates && validDay(model.dates.end) ? dayTime(model.dates.end) : null
  if (start === null || !(start <= minTime)) start = minTime
  if (end === null || !(end >= maxTime)) end = maxTime + DAY
  let span = end - start
  if (!(span > 0)) { start = minTime - DAY / 2; end = maxTime + DAY / 2; span = end - start || DAY }
  // 折线按指标独立使用真实刻度；柱状图按单位共用绝对刻度。
  const groups = []
  for (const item of model.series) {
    const key = model.kind === 'bar' ? 'unit:' + (item.unit || '') : 'series:' + item.name
    let group = groups.find(entry => entry.key === key)
    if (!group) { group = { key, items: [] }; groups.push(group) }
    group.items.push(item)
  }
  const count = groups.length
  const gap = count > 1 ? Math.max(6, Math.round(plot.h * 0.06)) : 0
  const paneH = Math.max((plot.h - gap * (count - 1)) / count, 1)
  const colors = [palette.accent, palette.secondary, palette.accentInk]
  const panes = []
  groups.forEach((group, groupIndex) => {
    const values = group.items.reduce((list, item) => list.concat(item.points.map(point => point.y)), [])
    const rawMax = Math.max(...values), rawMin = model.zeroBased ? 0 : Math.min(...values)
    const unit = group.items[0].unit || ''
    const integer = ['次', '条', '项', '篇', '个', '餐'].includes(unit)
    const scale = axisScale(rawMin, rawMax, model.zeroBased, integer)
    const pane = { x: plot.x, y: plot.y + groupIndex * (paneH + gap), w: plot.w, h: paneH, ...scale, unit, flat: false }
    panes.push(pane)
    group.pane = pane
  })
  const series = model.series.map((item, index) => {
    const key = model.kind === 'bar' ? 'unit:' + (item.unit || '') : 'series:' + item.name
    const pane = groups.find(group => group.key === key).pane
    const toY = value => pane.flat ? pane.y + pane.h / 2 : pane.y + pane.h - (value - pane.min) / (pane.max - pane.min) * pane.h
    return {
      color: colors[index] || palette.accent, name: item.name, unit: item.unit, flat: pane.flat, min: pane.min, max: pane.max, pane,
      points: item.points.map(point => ({ x: plot.x + (dayTime(point.d) - start) / span * plot.w, y: toY(point.y), d: point.d, v: point.y, registered: point.registered !== false }))
    }
  })
  const dates = [...new Set(series.flatMap(item => item.points.map(point => point.d)))].sort()
  return { width, height, plot, panes, series, dates, start, end, kind: model.kind, palette, axisLabelWidth, selectedDate: model.selectedDate || '' }
}

function roundedRect(ctx, x, y, w, h, radius) {
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.closePath()
}

function drawAxis(ctx, geometry, alpha) {
  const { plot, palette } = geometry
  if (!geometry.panes.length) return
  const size = geometry.axisFontSize || Math.max(9, Math.round(geometry.width * 0.026))
  ctx.save()
  ctx.globalAlpha = alpha * 0.75
  ctx.fillStyle = palette.text
  ctx.font = size + 'px ' + (geometry.axisFontFamily || 'sans-serif')
  const axis = geometry._axis || (geometry._axis = axisTicks(ctx, geometry))
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  const offset = Math.round(geometry.height * 0.04)
  for (const tick of axis.ticks) ctx.fillText(tick.text, tick.x, plot.y + plot.h + offset)
  if (axis.band.length) {
    ctx.globalAlpha = alpha * 0.45
    ctx.font = Math.max(9, size - 2) + 'px ' + (geometry.axisFontFamily || 'sans-serif')
    const bandTop = plot.y + plot.h + offset + size + 2
    for (const item of axis.band) ctx.fillText(item.text, item.x, bandTop)
  }
  ctx.restore()
}

function axisLabels(geometry) {
  if (!geometry || !Array.isArray(geometry.panes)) return []
  const labels = []
  geometry.panes.forEach((pane, paneIndex) => {
    const ticks = pane.ticks || [{ value: pane.max }, { value: pane.min }]
    ticks.forEach((tick, index) => {
      const y = pane.y + pane.h - (tick.value - pane.min) / (pane.max - pane.min) * pane.h
      labels.push({ key: paneIndex + '-' + index, text: axisValue(tick.value, pane.digits || 0), y })
    })
  })
  return labels
}

function drawBars(ctx, geometry, grow) {
  const { plot, series, start, end, radius } = geometry
  const slot = plot.w / Math.max((end - start) / DAY, 1)
  const groups = []
  for (const item of series) {
    let group = groups.find(entry => entry.pane === item.pane)
    if (!group) { group = { pane: item.pane, items: [] }; groups.push(group) }
    group.items.push(item)
  }
  for (const group of groups) {
    const count = group.items.length
    const barWidth = Math.min(Math.max(2, slot * 0.5 / count), 24)
    const baseY = group.pane.y + group.pane.h
    for (let index = 0; index < group.items.length; index++) {
      const item = group.items[index]
      ctx.save()
      ctx.globalAlpha = grow
      ctx.fillStyle = item.color
      ctx.font = (geometry.axisFontSize || Math.max(9, Math.round(geometry.width * 0.026))) + 'px ' + (geometry.axisFontFamily || 'sans-serif')
      const labelIndexes = pointLabelIndexes(item.points)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      for (let pointIndex = 0; pointIndex < item.points.length; pointIndex++) {
        const point = item.points[pointIndex]
        const centerX = point.x + slot / 2
        const rawLeft = centerX + (index - (count - 1) / 2) * barWidth - barWidth / 2
        const left = Math.max(rawLeft, plot.x)
        const right = Math.min(rawLeft + barWidth, plot.x + plot.w)
        if (right <= left) continue
        const height = Math.max(baseY - point.y, 0) * grow
        if (height > 0) {
          roundedRect(ctx, left, baseY - height, right - left, height, radius)
          ctx.fill()
        }
        if (grow > 0.55 && labelIndexes.has(pointIndex)) drawPointLabel(ctx, pointLabel(point.v), centerX + (index - (count - 1) / 2) * barWidth, Math.max(group.pane.y + 10, baseY - height - 8), geometry)
      }
      ctx.restore()
    }
  }
}

function drawLines(ctx, geometry, grow) {
  const { plot, series } = geometry
  const clipX = plot.x + plot.w * grow
  for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
    const item = series[seriesIndex]
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, item.pane.y - 6, Math.max(clipX, 0), item.pane.h + 12)
    ctx.clip()
    if (item.points.length >= 2) {
      ctx.strokeStyle = item.color
      ctx.lineWidth = 2
      ctx.beginPath()
      item.points.forEach((point, index) => { if (index) ctx.lineTo(point.x, point.y); else ctx.moveTo(point.x, point.y) })
      ctx.stroke()
    }
    ctx.fillStyle = item.color
    const pointRadius = item.points.length <= 12 ? 3 : 2
    ctx.font = (geometry.axisFontSize || Math.max(9, Math.round(geometry.width * 0.026))) + 'px ' + (geometry.axisFontFamily || 'sans-serif')
    const labelIndexes = pointLabelIndexes(item.points)
    const labelPlacements = linePointLabelPlacements(ctx, item, geometry, pointRadius, geometry.axisFontSize || Math.max(9, Math.round(geometry.width * 0.026)), seriesIndex)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    for (let index = 0; index < item.points.length; index++) {
      const point = item.points[index]
      ctx.beginPath()
      ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2)
      ctx.fill()
      if (grow > 0.55 && labelIndexes.has(index)) {
        const text = pointLabel(point.v)
        const placement = labelPlacements[index]
        if (placement) drawPointLabel(ctx, text, point.x, placement.y, geometry, placement)
      }
    }
    ctx.restore()
  }
}

function drawFrame(ctx, geometry, progress, selectedDate = geometry.selectedDate) {
  const { plot, panes, palette, kind, width, height } = geometry
  const value = clamp(progress, 0, 1)
  const bitmapWidth = Number(geometry.bitmapWidth) || width
  const logicalWidth = Number(geometry.logicalWidth) || width
  const viewWidth = clamp(Number(geometry.viewWidth) || bitmapWidth, 1, bitmapWidth)
  const offset = clamp(Number(geometry.viewOffset) || 0, 0, Math.max(0, logicalWidth - viewWidth))
  ctx.clearRect(0, 0, bitmapWidth, height)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, viewWidth, height)
  ctx.clip()
  if (offset > 0) ctx.translate(-offset, 0)
  const gridAlpha = clamp(value / 0.18, 0, 1)
  const grow = 1 - Math.pow(1 - clamp((value - 0.18) / 0.82, 0, 1), 3)
  ctx.save()
  ctx.globalAlpha = gridAlpha * 0.72
  ctx.strokeStyle = palette.grid
  ctx.lineWidth = 1
  if (ctx.setLineDash) ctx.setLineDash([4, 4])
  for (const pane of panes) {
    const ticks = pane.ticks || [{ value: pane.max }, { value: pane.min }]
    for (const tick of ticks) {
      const y = pane.y + pane.h - (tick.value - pane.min) / (pane.max - pane.min) * pane.h
      ctx.beginPath()
      ctx.moveTo(plot.x, y)
      ctx.lineTo(plot.x + plot.w, y)
      ctx.stroke()
    }
  }
  if (ctx.setLineDash) ctx.setLineDash([])
  ctx.restore()
  if (gridAlpha > 0) drawAxis(ctx, geometry, gridAlpha)
  if (kind === 'bar') drawBars(ctx, geometry, grow)
  else drawLines(ctx, geometry, grow)
  if (selectedDate && validDay(selectedDate) && dayTime(selectedDate) >= geometry.start && dayTime(selectedDate) < geometry.end) {
    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.fillStyle = palette.accentInk || palette.accent
    for (const item of geometry.series) {
      const point = item.points.find(value => value.d === selectedDate)
      if (!point) continue
      ctx.beginPath(); ctx.arc(point.x, point.y, 5, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }
  ctx.restore()
}

function dateAtX(page, x) {
  const geometry = page && page._chartGeometry
  if (!geometry || !Number.isFinite(Number(x))) return ''
  const ratio = clamp((Number(x) - geometry.plot.x) / Math.max(geometry.plot.w, 1), 0, 1)
  const span = Math.max(geometry.end - geometry.start, 1)
  const time = Math.min(geometry.start + ratio * span, geometry.end - 1)
  return new Date(time).toISOString().slice(0, 10)
}

function xAtDate(page, date) {
  const geometry = page && page._chartGeometry, time = dayTime(date)
  if (!geometry || time === null || time < geometry.start || time >= geometry.end) return null
  return geometry.plot.x + (time - geometry.start) / (geometry.end - geometry.start) * geometry.plot.w
}

function highlightDate(page, date) {
  if (!page || !validDay(date) || !page._chartContext || !page._chartGeometry) return
  page._chartGeometry.selectedDate = date
  drawFrame(page._chartContext, page._chartGeometry, page._chartProgress == null ? 1 : page._chartProgress, date)
}

// The canvas stays viewport-sized; redraw the matching logical content slice.
// Returns false when the viewport is unchanged and no animation needs settling.
function clipViewport(page, left, width) {
  const geometry = page && page._chartGeometry, ctx = page && page._chartContext
  const size = Number(width)
  if (!geometry || !ctx || !(size > 0)) return false
  const bitmapWidth = Number(geometry.bitmapWidth) || geometry.width
  const logicalWidth = Number(geometry.logicalWidth) || geometry.width
  const viewWidth = Math.min(size, bitmapWidth)
  const offset = clamp(Number(left) || 0, 0, Math.max(0, logicalWidth - viewWidth))
  const unchanged = geometry.viewOffset === offset && geometry.viewWidth === viewWidth
  const animating = page._chartRaf !== null && page._chartRaf !== undefined || Number(page._chartProgress) < 1
  if (unchanged && !animating) return false
  if (animating) {
    if (page._chartCanvas && page._chartCanvas.cancelAnimationFrame && page._chartRaf !== null && page._chartRaf !== undefined) {
      page._chartCanvas.cancelAnimationFrame(page._chartRaf)
    }
    page._chartRaf = null
    page._chartProgress = 1
  }
  geometry.viewOffset = offset
  geometry.viewWidth = viewWidth
  drawFrame(ctx, geometry, 1, geometry.selectedDate)
  return true
}

// Statistics trend chart: real time X axis, independent line panes and unit-grouped bar panes.
function seriesChart(page, selector, spec) {
  page._chartVersion = (page._chartVersion || 0) + 1
  const token = page._chartToken = (page._chartToken || 0) + 1
  page._chartMeasure = null
  stopMotion(page)
  const alive = () => token === page._chartToken && page._chartVisible !== false
  const model = readSeries(spec)
  if (!model) {
    if (page._chartContext && page._chartSize) page._chartContext.clearRect(0, 0, page._chartSize.width, page._chartSize.height)
    page._chartPainted = false
    page._chartSignature = ''
    return
  }

  let reducedMotion = false, duration = DEFAULT_DURATION, radius = 0, fontSize = 0, fontFamily = 'sans-serif'
  const retry = attempt => {
    if (!alive() || attempt >= 4) return
    page._chartTimer = setTimeout(() => {
      page._chartTimer = null
      if (!alive()) return
      if (typeof wx.nextTick === 'function') wx.nextTick(() => measure(attempt + 1))
      else measure(attempt + 1)
    }, 100)
  }
  const measure = attempt => {
    if (!alive()) return
    const query = wx.createSelectorQuery().in(page)
    let info = null
    query.select('.chart-motion-probe').fields({ computedStyle: ['display', 'transitionDuration', 'borderTopLeftRadius', 'fontSize', 'fontFamily'] }, result => {
      reducedMotion = !!result && result.display === 'none'
      if (result) {
        duration = durationMs(result.transitionDuration)
        const value = Number.parseFloat(result.borderTopLeftRadius)
        if (Number.isFinite(value)) radius = value
        const textSize = Number.parseFloat(result.fontSize)
        if (Number.isFinite(textSize)) fontSize = textSize
        if (typeof result.fontFamily === 'string' && result.fontFamily.trim()) fontFamily = result.fontFamily.trim()
      }
    })
    query.select(selector).fields({ node: true, size: true }, result => { info = result })
    query.exec(() => {
      if (!alive()) return
      if (!info || !info.node || !(info.width > 0) || !(info.height > 0)) return retry(attempt)
      if (!(fontSize > 0)) {
        const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        fontSize = Math.max(9, Math.round(28 * ((Number(windowInfo.windowWidth) || 375) / 750)))
      }
      const previous = page._chartMeasure
      page._chartMeasure = { width: info.width, height: info.height }
      if (!previous || Math.abs(previous.width - info.width) > 0.5 || Math.abs(previous.height - info.height) > 0.5) return retry(attempt)
      paint(info, model, reducedMotion, duration, radius, fontSize, fontFamily, alive, page, selector, token)
    })
  }
  measure(0)
}

function paint(info, model, reducedMotion, duration, radius, fontSize, fontFamily, alive, page, selector, token) {
  if (!alive()) return
  const canvas = info.node
  const bitmapWidth = info.width, height = info.height
  const logicalWidth = Math.max(bitmapWidth, Number(page._chartLogicalWidth) || 0)
  const palette = (getApp() || {}).palette || require('./theme').resolve()
  const signature = [selector, bitmapWidth, logicalWidth, height, radius, fontSize, fontFamily, palette.accent, palette.secondary, palette.accentInk, palette.grid, palette.text, JSON.stringify(model)].join('|')
  if (page._chartPainted && page._chartCanvas === canvas && page._chartSignature === signature) return
  page._chartSignature = signature
  page._chartPainted = true
  const dpr = wx.getSystemInfoSync().pixelRatio || 1
  canvas.width = Math.round(bitmapWidth * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  if (ctx.setTransform) ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)
  let axisLabelWidth = 36
  if (fontSize > 0 && ctx.measureText) {
    ctx.font = fontSize + 'px ' + fontFamily
    let widest = 0
    const groups = []
    for (const item of model.series) {
      const key = model.kind === 'bar' ? 'unit:' + (item.unit || '') : 'series:' + item.name
      let group = groups.find(entry => entry.key === key)
      if (!group) { group = { key, items: [] }; groups.push(group) }
      group.items.push(item)
    }
    for (const group of groups) {
      const values = group.items.flatMap(item => item.points.map(point => point.y))
      const unit = group.items[0].unit || ''
      const min = model.kind === 'bar' && model.zeroBased ? 0 : Math.min(...values)
      const max = Math.max(...values)
      const integer = ['次', '条', '项', '篇', '个', '餐'].includes(unit)
      const scale = axisScale(min, max, model.kind === 'bar' && model.zeroBased, integer)
      scale.ticks.forEach(tick => {
        widest = Math.max(widest, ctx.measureText(axisValue(tick.value, scale.digits)).width)
      })
    }
    axisLabelWidth = widest
  }
  page._chartCanvas = canvas
  page._chartContext = ctx
  page._chartSize = { width: bitmapWidth, height }
  if (fontSize > 0) ctx.font = fontSize + 'px ' + fontFamily
  const geometry = layout(model, logicalWidth, height, palette, axisLabelWidth, fontSize)
  geometry.bitmapWidth = bitmapWidth
  geometry.logicalWidth = logicalWidth
  geometry.axisFontSize = fontSize
  geometry.axisFontFamily = fontFamily
  geometry.radius = radius
  page._chartGeometry = geometry
  page._chartProgress = 1
  // Establish the viewport before the very first frame, otherwise the opening
  // animation would briefly paint the whole canvas past the card border.
  const viewportWidth = Number(page._chartViewportWidth || page._chartEstimatedViewport) || 0
  if (viewportWidth > 0) {
    const rawLeft = Number((page.data && page.data.chartScrollLeft) || 0)
    const viewWidth = Math.min(viewportWidth, bitmapWidth)
    geometry.viewWidth = viewWidth
    geometry.viewOffset = clamp(Number.isFinite(rawLeft) ? rawLeft : 0, 0, Math.max(0, logicalWidth - viewWidth))
  }
  if (typeof page.onChartGeometry === 'function') page.onChartGeometry(geometry)
  if (reducedMotion || typeof canvas.requestAnimationFrame !== 'function' || typeof canvas.cancelAnimationFrame !== 'function') {
    drawFrame(ctx, geometry, 1)
    return
  }
  const total = Math.max(duration, 200)
  let startTime = null
  const frame = timestamp => {
    if (token !== page._chartToken || page._chartVisible === false) return
    page._chartRaf = null
    if (startTime === null) startTime = timestamp
    const elapsed = clamp(timestamp - startTime, 0, total)
    page._chartProgress = elapsed / total
    drawFrame(ctx, geometry, page._chartProgress)
    if (elapsed < total) page._chartRaf = canvas.requestAnimationFrame(frame)
  }
  page._chartRaf = canvas.requestAnimationFrame(frame)
}

module.exports = { seriesChart, cancel, readSeries, layout, axisDigits, axisValue, axisLabels, drawAxis, drawFrame, dateAtX, xAtDate, highlightDate, clipViewport }

