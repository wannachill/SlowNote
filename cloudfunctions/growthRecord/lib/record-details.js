const { key, validDate } = require('./runtime')

const CATEGORY_KEYS = ['feeding', 'excretion', 'solid', 'growth', 'diary', 'milestone', 'custom']
const CATEGORY_NAMES = { feeding: '喂养', excretion: '便便', solid: '辅食', growth: '成长', diary: '成长日记', milestone: '里程碑', custom: '自定义记录' }
const FEED_MODES = { breast: '亲喂', bottle: '奶瓶', formula: '配方奶', mixed: '混合喂养' }
const DETAILS_LIMIT = 1800
const MESSAGE_LIMIT = DETAILS_LIMIT + 200
const CONTEXT_LIMIT = MESSAGE_LIMIT * 4
const MAX_RECORDS_PER_CATEGORY = 20
const DIARY_TEXT_LIMIT = 120
const NOTE_TEXT_LIMIT = 60

function normalizeCategories(categories) {
  if (!Array.isArray(categories)) return []
  const selected = new Set(categories)
  return CATEGORY_KEYS.filter(category => selected.has(category))
}

function clipText(value, limit) {
  return Array.from(String(value || '')).slice(0, Math.max(0, Number(limit) || 0)).join('')
}

function clean(value, limit) {
  return clipText(typeof value === 'string' ? value.replace(/[\r\n\t\u0000-\u001f]+/g, ' ').trim() : '', limit)
}

function numberText(value) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return String(Number(number.toFixed(2)))
}

function dateOf(record) {
  if (validDate(record && record.record_date)) return record.record_date
  return key(record && record.created_at)
}

function excretionCount(payload) {
  const count = Number(payload && payload.count)
  return Number.isFinite(count) && count > 0 ? count : 1
}

function selectedRows(data, category) {
  if (category === 'feeding') return (data.feeding || []).filter(record => record.type === 'feed')
  if (category === 'solid' || category === 'excretion') return (data.feeding || []).filter(record => record.type === category)
  if (category === 'custom') return (data.custom || []).filter(record => record.category === 'custom')
  return data[category] || []
}

function countOverview(data, categories, label) {
  const parts = []
  for (const category of categories) {
    const rows = selectedRows(data, category)
    if (category === 'feeding') parts.push(`喂养 ${rows.length} 次`)
    else if (category === 'solid') parts.push(`辅食 ${rows.length} 次`)
    else if (category === 'excretion') {
      let stool = 0, urine = 0
      for (const record of rows) {
        const payload = record.payload || {}
        if (payload.kind === 'urine') urine += excretionCount(payload)
        else stool += excretionCount(payload)
      }
      parts.push(`大便 ${stool} 次、排尿 ${urine} 次`)
    } else if (category === 'diary') parts.push(`成长日记 ${rows.length} 篇`)
    else if (category === 'milestone') parts.push(`里程碑 ${rows.length} 个`)
    else if (category === 'custom') parts.push(`自定义记录 ${rows.length} 条`)
    else parts.push(`成长 ${rows.length} 条`)
  }
  return `${label}记录概览：${parts.join('；')}`
}

function rangeLabel(value) {
  const match = /^(\d+)d$/.exec(String(value || ''))
  if (match) return `近${match[1]}天`
  return ({ day: '今天', yesterday: '昨天', week: '本周', lastWeek: '上周', month: '本月', lastMonth: '上个月', all: '全部时间' })[value] || '所选范围'
}

function detailLine(category, record, options = {}) {
  const date = dateOf(record)
  const payload = record.payload || {}
  let detail = ''
  if (category === 'feeding') {
    const mode = FEED_MODES[payload.mode]
    const amount = numberText(payload.amountMl)
    const duration = numberText(payload.durationMin)
    detail = `喂养${mode ? `（${mode}）` : ''}${amount ? `，奶量 ${amount} ml` : ''}${duration ? `，时长 ${duration} 分钟` : ''}`
  } else if (category === 'solid') {
    const name = clean(payload.name, 60)
    const note = clean(payload.note, NOTE_TEXT_LIMIT)
    detail = `辅食${name ? `：${name}` : '记录'}${note ? `；备注：${note}` : ''}`
  } else if (category === 'excretion') {
    const kind = payload.kind === 'urine' ? '排尿' : '大便'
    const count = excretionCount(payload)
    const shape = clean(payload.shape, 12)
    detail = `${kind} ${count} 次${shape ? `，形态 ${shape}` : ''}`
  } else if (category === 'growth') {
    const values = [['weight', '体重', 'kg'], ['height', '身高', 'cm'], ['head', '头围', 'cm']]
      .map(([field, name, unit]) => {
        const value = numberText(record[field])
        return value ? `${name} ${value} ${unit}` : ''
      }).filter(Boolean)
    detail = values.length ? values.join('，') : '成长记录'
  } else if (category === 'diary') {
    const content = clean(record.content, DIARY_TEXT_LIMIT)
    detail = content ? `日记：${content}${Array.from(record.content || '').length > DIARY_TEXT_LIMIT ? '…' : ''}` : '日记记录'
  } else if (category === 'milestone') {
    const babyId = record.baby_id || options.babyId || ''
    const definition = options.milestones && options.milestones.get(`${babyId}\u0000${record.milestone_key || ''}`)
    const keyName = clean(record.milestone_key, 80) || '未命名事项'
    const definitionName = definition && clean(definition.name, 60)
    const name = definitionName || keyName
    const domain = clean((definition && definition.domain) || record.domain, 24)
    detail = `里程碑${domain ? `（${domain}）` : ''}：${name}`
  } else if (category === 'custom') {
    const label = clean(record.label, 24) || '自定义记录'
    const value = numberText(record.value)
    const unit = clean(record.unit, 8)
    const note = clean(record.note, NOTE_TEXT_LIMIT)
    detail = `${label}${value ? `：${value}${unit ? ` ${unit}` : ''}` : ''}${note ? `；备注：${note}` : ''}`
  }
  return `${date}｜${CATEGORY_NAMES[category]}｜${detail}`
}

async function milestoneDefinitions(records, options) {
  const result = new Map()
  if (!options.db || !options.scope) return result
  const pairs = new Map()
  for (const record of records) {
    const keyValue = typeof record.milestone_key === 'string' ? record.milestone_key : ''
    const babyId = record.baby_id || options.babyId || ''
    if (keyValue) pairs.set(`${babyId}\u0000${keyValue}`, { babyId, keyValue })
  }
  await Promise.all([...pairs.values()].map(async pair => {
    const condition = { ...options.scope, ...(pair.babyId ? { baby_id: pair.babyId } : {}), key: pair.keyValue }
    try {
      const definition = (await options.db.collection('milestone_defs').where(condition).limit(1).get()).data[0]
      if (definition) result.set(`${pair.babyId}\u0000${pair.keyValue}`, {
        name: typeof definition.name === 'string' ? definition.name : '',
        domain: typeof definition.domain === 'string' ? definition.domain : ''
      })
    } catch (error) { /* Missing definitions fall back to the stored key. */ }
  }))
  return result
}

async function buildDetails(data = {}, categories, options = {}) {
  const selected = categories === undefined ? CATEGORY_KEYS : normalizeCategories(categories)
  if (!selected.length) return ''
  const buckets = selected.map(category => ({ category, rows: selectedRows(data, category) }))
  const allRecords = buckets.flatMap(({ category, rows }) => rows.map(record => ({ category, record })))
  const total = allRecords.length
  const overview = countOverview(data, selected, options.period || rangeLabel(options.range))
  if (!total) return `${overview}\n该类别暂无记录。`

  const candidates = []
  for (const { category, rows } of buckets) {
    const sorted = rows.slice().sort((a, b) => dateOf(b).localeCompare(dateOf(a)))
    for (const record of sorted.slice(0, MAX_RECORDS_PER_CATEGORY)) candidates.push({ category, record, date: dateOf(record) })
  }
  candidates.sort((a, b) => b.date.localeCompare(a.date))
  const defs = await milestoneDefinitions(candidates.filter(item => item.category === 'milestone').map(item => item.record), options)
  const lines = candidates.map(item => detailLine(item.category, item.record, { milestones: defs, babyId: options.babyId }))
  const limit = Math.min(DETAILS_LIMIT, Number.isFinite(Number(options.limit)) ? Math.max(0, Number(options.limit)) : DETAILS_LIMIT)

  for (let shown = lines.length; shown >= 0; shown--) {
    const omitted = total - shown
    const content = [overview, ...lines.slice(0, shown)]
    if (omitted) content.push(`另有 ${omitted} 条未展开`)
    const text = content.join('\n')
    if (Array.from(text).length <= limit) return text
  }
  return clipText(`${overview}\n另有 ${total} 条未展开`, limit)
}

module.exports = {
  CATEGORY_KEYS, DETAILS_LIMIT, MESSAGE_LIMIT, CONTEXT_LIMIT, MAX_RECORDS_PER_CATEGORY,
  DIARY_TEXT_LIMIT, NOTE_TEXT_LIMIT, normalizeCategories, clipText, buildDetails
}
