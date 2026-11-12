const { endpoint, access, validDate, fail, key, requestId, mutateOnce, readDoc } = require('./lib/runtime')
const { records, range, recordDate } = require('./lib/aggregation')
const spec = {
  breast: 'feeding_records', bottle: 'feeding_records', formula: 'feeding_records', mixed: 'feeding_records',
  solid: 'feeding_records', excretion: 'feeding_records', growth: 'growth_records',
  diary: 'diary_records', outdoor: 'custom_records', custom: 'custom_records', milestone: 'milestone_records'
}
function matches(record, category) {
  if (['breast', 'bottle', 'formula', 'mixed'].includes(category)) {
    const mode = (record.payload || {}).mode
    return record.type === 'feed' && (category === 'mixed' ? !['breast', 'bottle', 'formula'].includes(mode) : mode === category)
  }
  if (category === 'solid' || category === 'excretion') return record.type === category
  if (category === 'outdoor' || category === 'custom') return record.category === category
  return true
}
exports.main = endpoint(async ({ event, db, openid }) => {
  if (event.action !== 'deleteDay' || !spec[event.category]) fail(400, 'INVALID_ACTION')
  const date = event.recordDate, babyId = event.baby_id || ''
  if (!validDate(date) || date > key() || typeof babyId !== 'string' || babyId.length > 64) fail(400, 'INVALID_DATE_OR_BABY')
  requestId(event)
  const context = await access(db, openid), collection = spec[event.category]
  const identity = [context.ownerKey, babyId, date, event.category].join('|')
  // Freeze the first attempt's IDs: a retry must never delete records added afterwards.
  const snapshot = await mutateOnce(db, openid, event, 'homeCards:snapshot', async () => {
    const rows = (await records(db, collection, context.scope, range('day', date), babyId)).filter(row => matches(row, event.category))
    return { code: 0, identity, ids: rows.map(row => row._id), count: rows.length }
  })
  if (snapshot.identity !== identity) fail(409, 'DELETE_SCOPE_CHANGED')
  let deleted = 0, base = 0
  for (let offset = 0; offset < snapshot.ids.length; offset += 40) {
    const result = await mutateOnce(db, openid, { ...event, clientRequestId: event.clientRequestId + '_b' + base++ }, 'homeCards:batch', async transaction => {
      const current = await access(db, openid)
      if (current.ownerKey !== context.ownerKey) fail(409, 'DELETE_SCOPE_CHANGED')
      let count = 0
      for (const id of snapshot.ids.slice(offset, offset + 40)) {
        const row = await readDoc(transaction, collection, id)
        if (!row) continue
        if (!Object.entries(context.scope).every(([field, value]) => row[field] === value) || (babyId && row.baby_id !== babyId) || recordDate(row) !== date || !matches(row, event.category)) fail(409, 'RECORD_CHANGED')
        await transaction.collection(collection).doc(id).remove()
        count++
      }
      return { code: 0, deleted: count }
    })
    deleted += result.deleted
  }
  return { code: 0, deleted, matched: snapshot.count }
})
