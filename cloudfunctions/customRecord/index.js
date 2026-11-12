const { endpoint, access, hash, requestId, text, number, validDate, key, fail, createOnce } = require('./lib/runtime')
exports.main = endpoint(async ({ event, db, openid }) => {
  const context = await access(db, openid)
  const babyId = typeof event.baby_id === 'string' && event.baby_id.length <= 64 ? event.baby_id : ''
  if (event.action === 'list') {
    const date = event.recordDate || key()
    if (!validDate(date)) fail(400, 'INVALID_DATE')
    const records = (await db.collection('custom_records').where({ ...context.scope, record_date: date, ...(babyId ? { baby_id: babyId } : {}) }).orderBy('created_at', 'desc').limit(50).get()).data
    return { code: 0, records }
  }
  if (event.action === 'delete' || event.action === 'update') {
    if (typeof event.id !== 'string' || !event.id) fail(400, 'INVALID_ID')
    const found = (await db.collection('custom_records').where({ ...context.scope, _id: event.id }).limit(1).get()).data[0]
    if (!found) fail(404, 'NOT_FOUND')
    if (event.action === 'delete') {
      await db.collection('custom_records').doc(found._id).remove()
      return { code: 0 }
    }
    if (event.category !== 'custom') fail(400, 'INVALID_CATEGORY')
    const recordDate = event.recordDate
    if (!validDate(recordDate) || recordDate > key()) fail(400, 'INVALID_DATE')
    const label = text(event.label, 24, true)
    const value = number(event.value, 0, 999999, true)
    await db.collection('custom_records').doc(found._id).update({ data: {
      category: event.category, label, value,
      unit: text(event.unit || '', 8), note: text(event.note || '', 300), record_date: recordDate
    } })
    return { code: 0, data: { id: found._id } }
  }
  if (event.action && event.action !== 'add') fail(400, 'UNKNOWN_ACTION')
  if (event.category !== 'custom') fail(400, 'INVALID_CATEGORY')
  const recordDate = event.recordDate || key()
  if (!validDate(recordDate) || recordDate > key()) fail(400, 'INVALID_DATE')
  const label = text(event.label, 24, true)
  const value = number(event.value, 0, 999999, true)
  const clientId = requestId(event)
  const result = await createOnce(db, 'custom_records', hash(`${openid}:${clientId}`), {
    openid, family_id: context.familyId, category: event.category, label, value,
    unit: text(event.unit || '', 8), note: text(event.note || '', 300), baby_id: babyId, record_date: recordDate,
    client_request_id: clientId, created_at: db.serverDate()
  })
  return { code: 0, duplicate: result.duplicate, data: { id: result.id } }
})
