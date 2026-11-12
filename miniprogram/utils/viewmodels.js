const { CATEGORIES } = require('./categories')
const formatNumber = require('./format-number')
const display = (value, digits = 2) => formatNumber(value, digits)
function dailyCards(summary, times = {}) {
  if (!summary) return []
  const cards = []
  for (const [key, value] of Object.entries(summary.feeding.byCategory)) {
    const modes = { breast: '亲喂', bottle: '瓶喂', formula: '配方奶', mixed: '混合喂养' }
    const category = CATEGORIES.find(c => c.key === key) || { key, name: modes[key] || '喂养', icon: 'feeding', url: '/pages/feeding/index?panel=feed&mode=' + (modes[key] ? key : 'mixed') }
    const excretionTotal = (value.stoolCount || 0) + (value.urineCount || 0)
    const detail = key === 'excretion'
      ? `大便 ${value.stoolCount || 0}次 · 小便 ${value.urineCount || 0}次`
      : value.amountMl ? `奶量 ${display(value.amountMl, 2)} ml` : value.durationMin ? `亲喂 ${display(value.durationMin, 2)} 分钟` : '已记下这次照顾'
    const items = key === 'excretion'
      ? [{ label: '大便', value: (value.stoolCount || 0) + '次' }, { label: '小便', value: (value.urineCount || 0) + '次' }]
      : key === 'solid'
        ? [{ label: '次数', value: value.count + '次' }]
        : [{ label: '次数', value: value.count + '次' }, { label: '奶量', value: value.amountMl ? display(value.amountMl, 2) + ' ml' : '—' }, { label: '时长', value: value.durationMin ? display(value.durationMin, 2) + ' 分' : '—' }]
    const tag = key === 'solid' ? 'solid' : key === 'excretion' ? 'excretion' : 'feeding'
    cards.push({ ...category, tag, value: key === 'excretion' ? excretionTotal : value.count, unit: '次', detail, items })
  }
  if (summary.growth.count) cards.push({ ...CATEGORIES.find(c => c.key === 'growth'), tag: 'growth', value: display(summary.growth.weight.latest, 2), unit: 'kg', detail: `身高 ${display(summary.growth.height.latest, 1)} cm`, items: [
    { label: '体重', value: display(summary.growth.weight.latest, 2) + ' kg' },
    { label: '身高', value: display(summary.growth.height.latest, 1) + ' cm' },
    ...((summary.growth.head || {}).latest == null ? [] : [{ label: '头围', value: display(summary.growth.head.latest, 1) + ' cm' }])
  ] })
  if (summary.diary.count) cards.push({ ...CATEGORIES.find(c => c.key === 'diary'), tag: 'diary', value: summary.diary.count, unit: '篇', detail: '留住今天的小事', items: [{ label: '篇数', value: summary.diary.count + '篇' }] })
  if (summary.custom.count) cards.push({ ...CATEGORIES.find(c => c.key === 'custom'), tag: 'custom', value: summary.custom.count, unit: '次', detail: summary.custom.entries.map(e => `${e.label}${e.value == null ? '' : ' ' + display(e.value, e.unit === '次' ? 0 : 2) + (e.unit || '')}`).join('，'), items: summary.custom.entries.map(e => ({ label: e.label, value: e.value == null ? '已记' : display(e.value, e.unit === '次' ? 0 : 2) + (e.unit || '') })) })
  cards.sort((a, b) => {
    const aTime = (times || {})[a.key] || ''
    const bTime = (times || {})[b.key] || ''
    if (!aTime) return bTime ? 1 : 0
    if (!bTime) return -1
    return aTime < bTime ? 1 : aTime > bTime ? -1 : 0
  })
  return cards.map(card => ({ ...card, time: (times || {})[card.key] || '', items: card.items.map((item, key) => ({ ...item, key })) }))
}
function dailySummary(summary) {
  if (!summary) return []
  const categories = summary.feeding.byCategory || {}
  const excretion = categories.excretion || {}
  const values = [
    { key: 'feeding', label: '喂养', count: summary.feeding.count || 0 },
    { key: 'solid', label: '辅食', count: (categories.solid || {}).count || 0 },
    { key: 'excretion', label: '便便', count: (excretion.stoolCount || 0) + (excretion.urineCount || 0) },
    { key: 'growth', label: '成长', count: (summary.growth || {}).count || 0 },
    { key: 'diary', label: '日记', count: (summary.diary || {}).count || 0 },
    { key: 'custom', label: '自定义', count: (summary.custom || {}).count || 0 },
  ]
  const units = { growth: '笔', diary: '篇', custom: '次' }
  return values.filter(item => item.count > 0).map(item => ({ ...item, value: item.count + (units[item.key] || '次') }))
}
module.exports = { dailyCards, dailySummary }
