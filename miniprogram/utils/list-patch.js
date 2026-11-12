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

module.exports = { setListItemFields, setListFields }
