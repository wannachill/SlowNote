const formatNumber = require('./format-number')

function metricValue(totals, typeKey, metricKey) {
  if (!totals) return null
  if (typeKey === 'growth') {
    const metric = totals.growth && totals.growth[metricKey]
    return metric ? metric.latest : null
  }
  if (typeKey === 'feeding') {
    const feeding = totals.feeding || {}
    return metricKey === 'ml' ? feeding.amountMl : metricKey === 'n' ? feeding.count : null
  }
  if (typeKey === 'solid' && metricKey === 'n') return (totals.solid || {}).count
  if (typeKey === 'excretion') return (totals.excretion || {})[metricKey]
  if (typeKey === 'diary' && metricKey === 'n') return (totals.diary || {}).count
  return null
}

function metricPeriodValues(typeKey, metricKey, totals, prevTotals) {
  if (!prevTotals) return null
  const currentValue = metricValue(totals, typeKey, metricKey)
  const previousValue = metricValue(prevTotals, typeKey, metricKey)
  if (currentValue == null || previousValue == null) return null
  const current = Number(currentValue)
  const previous = Number(previousValue)
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  return { current, previous }
}

function currentPeriodValue(typeKey, metricKey, totals) {
  return metricValue(totals, typeKey, metricKey)
}

function periodDelta(current, previous, unit = '', digits = 2) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return '暂无对比'
  const precision = Math.max(0, Math.min(4, digits))
  const difference = Number((current - previous).toFixed(precision))
  const sign = difference > 0 ? '+' : difference < 0 ? '−' : '±'
  return sign + formatNumber(Math.abs(difference), precision) + (unit ? ' ' + unit : '')
}

function insightHasData(totals = {}) {
  const feeding = totals.feeding || {}, solid = totals.solid || {}, excretion = totals.excretion || {}
  const growth = totals.growth || {}, diary = totals.diary || {}, custom = totals.custom || {}
  return [feeding.count, feeding.amountMl, solid.count, excretion.stool, excretion.urine, growth.count, diary.count, custom.count]
    .some(value => (finite(value) || 0) > 0)
}

function insightSections(totals = {}, prevTotals = null, range = 'week') {
  if (!insightHasData(totals)) return []
  const previousPeriod = range === 'month' ? '上月' : range === 'week' ? '上周' : ''
  const currentFeeding = totals.feeding || {}, currentSolid = totals.solid || {}
  const currentExcretion = totals.excretion || {}, currentGrowth = totals.growth || {}
  const currentDiary = totals.diary || {}, currentCustom = totals.custom || {}
  const oldFeeding = prevTotals && prevTotals.feeding || {}, oldSolid = prevTotals && prevTotals.solid || {}
  const oldExcretion = prevTotals && prevTotals.excretion || {}, oldGrowth = prevTotals && prevTotals.growth || {}
  const oldDiary = prevTotals && prevTotals.diary || {}, oldCustom = prevTotals && prevTotals.custom || {}
  const sections = []
  const linesFor = (current, previous, metrics) => {
    const lines = []
    for (const metric of metrics) {
      const value = finite(metric.current)
      const old = finite(metric.previous)
      const hasCurrent = value != null && (value > 0 || (old || 0) > 0)
      const hasCompare = previousPeriod && (value != null || old != null) && !((value || 0) === 0 && (old || 0) === 0)
      if (!hasCurrent && !hasCompare) continue
      const currentText = hasCurrent ? `${metric.label}：${formatNumber(value, metric.digits)}${metric.unit}` : `${metric.label}：暂无本期数据`
      const deltaText = hasCompare
        ? `较${previousPeriod} ${old == null || value == null ? '暂无对比' : (value === old ? '持平' : periodDelta(value, old, metric.unit, metric.digits))}`
        : ''
      lines.push(deltaText ? `${currentText} · ${deltaText}` : currentText)
    }
    return lines
  }
  const feedCount = finite(currentFeeding.count) || 0, oldFeedCount = finite(oldFeeding.count) || 0
  const milk = finite(currentFeeding.amountMl) || 0, oldMilk = finite(oldFeeding.amountMl) || 0
  const feedingLines = linesFor(currentFeeding, oldFeeding, [
    { label: '喂养次数', current: currentFeeding.count, previous: oldFeeding.count, unit: '次', digits: 0 },
    { label: '奶量', current: currentFeeding.amountMl, previous: oldFeeding.amountMl, unit: 'ml', digits: precisionOf([currentFeeding.amountMl, oldFeeding.amountMl]) }
  ])
  if (feedCount > 0 || oldFeedCount > 0 || milk > 0 || oldMilk > 0) sections.push({ title: '喂养', lines: feedingLines })

  const growthMetrics = ['weight', 'height', 'head'].map(key => {
    const current = currentGrowth[key] || {}, previous = oldGrowth[key] || {}
    const unit = key === 'weight' ? 'kg' : 'cm'
    const label = key === 'weight' ? '体重' : key === 'height' ? '身高' : '头围'
    return { key, label, current: current.latest, previous: previous.latest, unit, digits: 1 }
  })
  const growthLines = []
  for (const metric of growthMetrics) {
    const value = finite(metric.current), old = finite(metric.previous)
    const hasCompare = previousPeriod && (value != null || old != null)
    if (value == null && !hasCompare) continue
    const currentText = value == null ? `${metric.label}：暂无本期数据` : `${metric.label}：${formatNumber(value, metric.digits)} ${metric.unit}`
    const deltaText = hasCompare ? `较${previousPeriod} ${value == null || old == null ? '暂无对比' : value === old ? '持平' : periodDelta(value, old, metric.unit, metric.digits)}` : ''
    growthLines.push(deltaText ? `${currentText} · ${deltaText}` : currentText)
  }
  if ((finite(currentGrowth.count) || 0) > 0 || (finite(oldGrowth.count) || 0) > 0 || growthLines.length) {
    sections.push({ title: '成长', lines: growthLines.length ? growthLines : ['本周期暂无测量值'] })
  }

  const elimination = (currentExcretion.stool || 0) + (currentExcretion.urine || 0)
  const oldElimination = (oldExcretion.stool || 0) + (oldExcretion.urine || 0)
  const eliminationLines = linesFor(currentExcretion, oldExcretion, [
    { label: '便便记录', current: elimination, previous: oldElimination, unit: '次', digits: 0 }
  ])
  if (elimination > 0 || oldElimination > 0) sections.push({ title: '便便', lines: eliminationLines })

  const otherLines = []
  const otherMetrics = [
    ['辅食', currentSolid.count, oldSolid.count, '次'],
    ['日记', currentDiary.count, oldDiary.count, '篇'],
    ['自定义', currentCustom.count, oldCustom.count, '次']
  ]
  for (const [label, currentRaw, previousRaw, unit] of otherMetrics) {
    const current = finite(currentRaw), previous = finite(previousRaw)
    const hasCompare = previousPeriod && (current != null || previous != null) && !((current || 0) === 0 && (previous || 0) === 0)
    if (!(current != null && (current > 0 || (previous || 0) > 0)) && !hasCompare) continue
    const currentText = current != null && (current > 0 || (previous || 0) > 0) ? `${label}：${formatNumber(current, 0)} ${unit}` : `${label}：暂无本期数据`
    const deltaText = hasCompare ? `较${previousPeriod} ${current == null || previous == null ? '暂无对比' : current === previous ? '持平' : periodDelta(current, previous, unit, 0)}` : ''
    otherLines.push(deltaText ? `${currentText} · ${deltaText}` : currentText)
  }
  if (otherLines.length) sections.push({ title: '其他', lines: otherLines })

  const reminders = []
  if ((finite(currentGrowth.count) || 0) === 0) reminders.push('这个周期还没有成长记录')
  if (elimination === 0) reminders.push('这个周期还没有便便记录')
  if (reminders.length) sections.push({ title: '提醒', lines: reminders })
  return sections
}

function moduleSummaryOf(typeKey, totals = {}, prevTotals = null, range = 'week') {
  const previousPeriod = range === 'month' ? '上月' : range === 'week' ? '上周' : ''
  const appendDelta = (label, current, previous, unit, digits) => {
    if (!previousPeriod || current == null || previous == null || !(current > 0 || previous > 0)) return ''
    const delta = current === previous ? '持平' : periodDelta(current, previous, unit, digits)
    return `${label}较${previousPeriod} ${delta}`
  }
  if (typeKey === 'growth') {
    const current = totals.growth || {}, previous = prevTotals && prevTotals.growth || {}
    const metric = ['weight', 'height', 'head'].find(key => finite((current[key] || {}).latest) != null)
    if (!metric) return '暂无记录'
    const label = metric === 'weight' ? '体重' : metric === 'height' ? '身高' : '头围'
    const unit = metric === 'weight' ? 'kg' : 'cm'
    const value = finite(current[metric].latest), old = finite((previous[metric] || {}).latest)
    const delta = appendDelta(label, value, old, unit, 1)
    return `${label} ${formatNumber(value, 1)}${unit}${delta ? ` · ${delta}` : ''}`
  }
  if (typeKey === 'feeding') {
    const current = totals.feeding || {}, previous = prevTotals && prevTotals.feeding || {}
    const count = finite(current.count) || 0, milk = finite(current.amountMl) || 0
    if (count <= 0 && milk <= 0) return '暂无记录'
    const lines = []
    if (count > 0) lines.push(`${formatNumber(count, 0)} 次`)
    if (milk > 0) lines.push(`奶量 ${formatNumber(milk, precisionOf([milk]))}ml`)
    const delta = appendDelta('喂养次数', finite(current.count), finite(previous.count), '次', 0)
    if (delta) lines.push(delta)
    return lines.join(' · ')
  }
  if (typeKey === 'solid') {
    const count = finite((totals.solid || {}).count) || 0
    if (count <= 0) return '暂无记录'
    const previous = finite((prevTotals && prevTotals.solid || {}).count)
    const delta = appendDelta('辅食', count, previous, '次', 0)
    return `${formatNumber(count, 0)} 次${delta ? ` · ${delta}` : ''}`
  }
  if (typeKey === 'excretion') {
    const current = totals.excretion || {}, previous = prevTotals && prevTotals.excretion || {}
    const count = (finite(current.stool) || 0) + (finite(current.urine) || 0)
    if (count <= 0) return '暂无记录'
    const old = (finite(previous.stool) || 0) + (finite(previous.urine) || 0)
    const delta = appendDelta('便便记录', count, prevTotals ? old : null, '次', 0)
    return `${formatNumber(count, 0)} 次记录${delta ? ` · ${delta}` : ''}`
  }
  const key = typeKey === 'diary' ? 'diary' : typeKey === 'custom' ? 'custom' : ''
  if (!key) return '暂无记录'
  const count = finite((totals[key] || {}).count) || 0
  if (count <= 0) return '暂无记录'
  const unit = key === 'diary' ? '篇' : '条'
  const old = finite((prevTotals && prevTotals[key] || {}).count)
  const delta = appendDelta(key === 'diary' ? '日记' : '自定义', count, old, unit, 0)
  return `${formatNumber(count, 0)} ${unit}${delta ? ` · ${delta}` : ''}`
}

function deltaInfo(current, previous, unit, digits) {
  if (current == null || previous == null) return null
  const currentNumber = Number(current), previousNumber = Number(previous)
  if (!Number.isFinite(currentNumber) || !Number.isFinite(previousNumber)) return null
  if (currentNumber === previousNumber) return { dir: 'flat', arrow: '', text: '持平' }
  const precision = Math.max(0, Math.min(4, digits))
  const difference = Number((currentNumber - previousNumber).toFixed(precision))
  const dir = difference > 0 ? 'up' : 'down'
  const arrow = dir === 'up' ? '↑' : '↓'
  const text = formatNumber(Math.abs(difference), precision) + (unit ? ' ' + unit : '')
  return { dir, arrow, text }
}

function moduleCardOf(typeKey, totals = {}, prevTotals = null, range = 'week') {
  const hasPrev = !!prevTotals && range !== 'all' && range !== 'day'
  if (typeKey === 'growth') {
    const current = totals.growth || {}, previous = (prevTotals && prevTotals.growth) || {}
    const metrics = [
      { key: 'weight', label: '体重', unit: 'kg' },
      { key: 'height', label: '身高', unit: 'cm' },
      { key: 'head', label: '头围', unit: 'cm' }
    ].map(metric => {
      const value = finite((current[metric.key] || {}).latest)
      const prior = finite((previous[metric.key] || {}).latest)
      const delta = hasPrev ? deltaInfo(value, prior, '', 1) : null
      return {
        label: metric.label,
        value: value == null ? '' : formatNumber(value, 1),
        unit: metric.unit,
        deltaText: delta ? delta.text : '',
        deltaArrow: delta ? delta.arrow : '',
        deltaDir: delta ? delta.dir : '',
        hasData: value != null
      }
    })
    return { key: typeKey, multi: true, metrics, empty: !metrics.some(metric => metric.hasData) }
  }
  if (typeKey === 'feeding') {
    const current = totals.feeding || {}, previous = (prevTotals && prevTotals.feeding) || {}
    const count = finite(current.count) || 0, milk = finite(current.amountMl) || 0
    const countDelta = hasPrev ? deltaInfo(finite(current.count), finite(previous.count), '', 0) : null
    const milkDelta = hasPrev && (milk > 0 || (finite(previous.amountMl) || 0) > 0)
      ? deltaInfo(finite(current.amountMl), finite(previous.amountMl), '', precisionOf([current.amountMl, previous.amountMl]))
      : null
    const metrics = [
      {
        label: '次数', value: count > 0 ? formatNumber(count, 0) : '', unit: '次', hasData: count > 0,
        deltaText: countDelta ? countDelta.text : '', deltaArrow: countDelta ? countDelta.arrow : '', deltaDir: countDelta ? countDelta.dir : ''
      },
      {
        label: '奶量', value: milk > 0 ? formatNumber(milk, precisionOf([milk])) : '', unit: 'ml', hasData: milk > 0,
        deltaText: milkDelta ? milkDelta.text : '', deltaArrow: milkDelta ? milkDelta.arrow : '', deltaDir: milkDelta ? milkDelta.dir : ''
      }
    ]
    return { key: typeKey, multi: true, metrics, empty: !(count > 0 || milk > 0) }
  }

  const card = { key: typeKey, primary: '', unit: '', deltaText: '', deltaArrow: '', deltaDir: '', empty: true }
  const applyDelta = (current, previous, unit, digits) => {
    if (!hasPrev) return
    const delta = deltaInfo(current, previous, unit, digits)
    if (!delta) return
    card.deltaText = delta.text
    card.deltaArrow = delta.arrow
    card.deltaDir = delta.dir
  }
  if (typeKey === 'solid') {
    const count = finite((totals.solid || {}).count) || 0
    if (count > 0) {
      card.primary = formatNumber(count, 0)
      card.unit = '次'
      applyDelta(count, finite((prevTotals && prevTotals.solid || {}).count), '次', 0)
    }
  } else if (typeKey === 'excretion') {
    const current = totals.excretion || {}, previous = (prevTotals && prevTotals.excretion) || {}
    const count = (finite(current.stool) || 0) + (finite(current.urine) || 0)
    if (count > 0) {
      card.primary = formatNumber(count, 0)
      card.unit = '次'
      applyDelta(count, (finite(previous.stool) || 0) + (finite(previous.urine) || 0), '次', 0)
    }
  } else {
    const key = typeKey === 'diary' ? 'diary' : typeKey === 'custom' ? 'custom' : ''
    if (key) {
      const count = finite((totals[key] || {}).count) || 0
      if (count > 0) {
        const unit = key === 'diary' ? '篇' : '条'
        card.primary = formatNumber(count, 0)
        card.unit = unit
        applyDelta(count, finite((prevTotals && prevTotals[key] || {}).count), unit, 0)
      }
    }
  }
  card.empty = !card.primary
  return card
}

function finite(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function precisionOf(values) {
  return Math.min(2, values.reduce((digits, value) => {
    const number = finite(value)
    if (number == null) return digits
    const text = String(number)
    if (/[eE]/.test(text)) return Math.max(digits, 2)
    return Math.max(digits, (text.split('.')[1] || '').length)
  }, 0))
}

function insightText(totals = {}, prevTotals = null, range = 'week') {
  const period = range === 'month' ? '本月' : range === 'all' ? '所选范围' : '本周'
  const previousPeriod = range === 'month' ? '上月' : range === 'week' ? '上周' : ''
  const feeding = totals.feeding || {}, solid = totals.solid || {}, excretion = totals.excretion || {}
  const growth = totals.growth || {}, diary = totals.diary || {}, custom = totals.custom || {}
  const feedCount = finite(feeding.count) || 0
  const milk = finite(feeding.amountMl) || 0
  const solidCount = finite(solid.count) || 0
  const stool = finite(excretion.stool) || 0
  const urine = finite(excretion.urine) || 0
  const excretionCount = stool + urine
  const growthCount = finite(growth.count) || 0
  const diaryCount = finite(diary.count) || 0
  const customCount = finite(custom.count) || 0
  const facts = []

  if (feedCount > 0) facts.push(`喂养${formatNumber(feedCount, 0)}次`)
  if (milk > 0) facts.push(`奶量共${formatNumber(milk, precisionOf([milk]))}ml`)
  if (solidCount > 0) facts.push(`辅食${formatNumber(solidCount, 0)}次`)
  if (excretionCount > 0) facts.push(`便便记录${formatNumber(excretionCount, 0)}次`)
  for (const key of ['weight', 'height', 'head']) {
    const item = growth[key] || {}
    if (Number.isFinite(item.latest)) {
      const unit = key === 'weight' ? 'kg' : 'cm'
      facts.push(`${key === 'weight' ? '体重' : key === 'height' ? '身高' : '头围'}${formatNumber(item.latest, 1)}${unit}`)
    }
  }
  if (diaryCount > 0) facts.push(`日记${formatNumber(diaryCount, 0)}篇`)
  if (customCount > 0) facts.push(`自定义记录${formatNumber(customCount, 0)}次`)

  const changes = []
  const addChange = (label, current, previous, unit, digits) => {
    if (!previousPeriod || !Number.isFinite(current) || !Number.isFinite(previous) || (current === 0 && previous === 0)) return
    const difference = Number((current - previous).toFixed(digits))
    const text = difference === 0 ? '持平' : periodDelta(current, previous, unit, digits)
    changes.push(`${label}较${previousPeriod}${text}`)
  }
  if (prevTotals) {
    const previousFeeding = prevTotals.feeding || {}, previousSolid = prevTotals.solid || {}
    const previousExcretion = prevTotals.excretion || {}, previousGrowth = prevTotals.growth || {}
    const previousDiary = prevTotals.diary || {}, previousCustom = prevTotals.custom || {}
    addChange('喂养次数', finite(feeding.count), finite(previousFeeding.count), '次', 0)
    addChange('奶量', finite(feeding.amountMl), finite(previousFeeding.amountMl), 'ml', precisionOf([feeding.amountMl, previousFeeding.amountMl]))
    addChange('辅食次数', finite(solid.count), finite(previousSolid.count), '次', 0)
    addChange('便便记录', excretionCount, (finite(previousExcretion.stool) || 0) + (finite(previousExcretion.urine) || 0), '次', 0)
    for (const key of ['weight', 'height', 'head']) {
      const unit = key === 'weight' ? 'kg' : 'cm'
      addChange(key === 'weight' ? '体重' : key === 'height' ? '身高' : '头围', finite((growth[key] || {}).latest), finite((previousGrowth[key] || {}).latest), unit, 1)
    }
    addChange('日记篇数', finite(diary.count), finite(previousDiary.count), '篇', 0)
    addChange('自定义记录', finite(custom.count), finite(previousCustom.count), '次', 0)
  }

  let result = facts.length ? `${period}：${facts.join('，')}` : `${period}暂无记录`
  if (changes.length) result += `；${changes.join('，')}`
  result += '。'
  const notices = []
  if (growthCount === 0) notices.push('这个周期还没有成长记录')
  if (excretionCount === 0) notices.push('这个周期还没有便便记录')
  if (notices.length) result += notices.join('；') + '。'
  return result
}

module.exports = { currentPeriodValue, metricPeriodValues, periodDelta, insightHasData, insightSections, insightText, moduleSummaryOf, moduleCardOf }
