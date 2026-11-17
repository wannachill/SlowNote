function setListItemFields(page, listKey, index, fields) {
  const item = (page.data[listKey] || [])[index]
  if (!item) return
  const patch = {}
  Object.keys(fields).forEach(field => {
    if (item[field] !== fields[field]) patch[`${listKey}[${index}].${field}`] = fields[field]
  })
  if (Object.keys(patch).length) page.setData(patch)
}

function setListFields(page, listKey, getFields) {
  const patch = {}
  ;(page.data[listKey] || []).forEach((item, index) => {
    const fields = getFields(item, index)
    if (!fields) return
    Object.keys(fields).forEach(field => {
      if (item[field] !== fields[field]) patch[`${listKey}[${index}].${field}`] = fields[field]
    })
  })
  if (Object.keys(patch).length) page.setData(patch)
}

// Structural deletion needs one array patch. Rollback restores only that row, not
// an old whole-list snapshot, so concurrent edits to other rows survive.
function removeListItem(page, listKey, field, id) {
  const list = page.data[listKey] || [], index = list.findIndex(item => item[field] === id)
  if (index < 0) return null
  const removed = { ...list[index], swipeX: 0 }
  const scope = () => {
    const g = getApp().globalData
    return JSON.stringify([g.openid, g.activeBabyId, page.data.startDate, page.data.endDate])
  }
  const identity = scope()
  const key = removalKey(listKey, id)
  const removedIds = page._removedListIds || (page._removedListIds = new Set())
  removedIds.add(key)
  page.setData({ [listKey]: list.filter(item => item[field] !== id) })
  return () => {
    removedIds.delete(key)
    if (scope() !== identity || (page.data[listKey] || []).some(item => item[field] === id)) return false
    const current = (page.data[listKey] || []).slice()
    current.splice(Math.min(index, current.length), 0, removed)
    page.setData({ [listKey]: current })
    return true
  }
}

function removalKey(listKey, id) {
  const g = getApp().globalData
  return JSON.stringify([g.openid, g.activeBabyId, listKey, id])
}
function filterRemoved(page, listKey, field, items) {
  return (items || []).filter(item => !page._removedListIds || !page._removedListIds.has(removalKey(listKey, item[field])))
}

module.exports = { setListItemFields, setListFields, removeListItem, filterRemoved }
