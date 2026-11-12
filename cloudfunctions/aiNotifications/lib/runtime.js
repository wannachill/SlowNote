// Shared source. Run node scripts/sync-cloud-runtime.js before deploying individual functions.
const crypto = require('crypto')
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32)
function fail(code, message) { throw Object.assign(new Error(message), { code }) }
const key = (date = new Date()) => new Date(new Date(date).getTime() + 8 * 3600000).toISOString().slice(0, 10)
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
function requestId(event) {
  const id = event.clientRequestId || event.client_request_id
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) fail(400, 'INVALID_REQUEST_ID')
  return id
}
function text(value, max = 100, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, 'INVALID_TEXT')
  return value.trim()
}
function number(value, min, max, optional = false) {
  if (optional && (value === '' || value == null)) return null
  if (!['number', 'string'].includes(typeof value) || value === '' || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) fail(400, 'INVALID_NUMBER')
  return Number(value)
}
async function identity(cloud, db) {
  const openid = cloud.getWXContext().OPENID
  if (!openid) fail(401, 'UNAUTHORIZED')
  if (!(await db.collection('users').where({ openid }).count()).total) fail(401, 'USER_NOT_FOUND')
  return openid
}
async function access(db, openid) {
  const membership = await db.collection('family_members').where({ openid }).limit(1).get()
  const familyId = membership.data.length ? membership.data[0].familyId : ''
  return { openid, familyId, scope: familyId ? { family_id: familyId } : { openid }, ownerKey: familyId ? `family:${familyId}` : `user:${openid}` }
}
async function all(db, collection, condition, max = 10000) {
  const result = []; let cursor = ''
  while (true) {
    const cond = cursor ? db.command.and([condition, { _id: db.command.gt(cursor) }]) : condition
    const page = (await db.collection(collection).where(cond).orderBy('_id', 'asc').limit(100).get()).data
    result.push(...page)
    if (result.length > max) fail(413, 'TOO_MANY_RECORDS')
    if (page.length < 100) return result
    cursor = page[page.length - 1]._id
  }
}
async function createOnce(db, collection, id, data) {
  const existingQuery = db.collection(collection).where({ _id: id }).limit(1).get()
  const legacyQuery = data.openid && data.client_request_id
    ? db.collection(collection).where({ openid: data.openid, client_request_id: data.client_request_id }).limit(1).get()
    : Promise.resolve({ data: [] })
  const [existingResult, legacyResult] = await Promise.all([existingQuery, legacyQuery])
  const existing = existingResult.data[0]
  if (existing) return { id, duplicate: true, record: existing }
  const legacy = legacyResult.data[0]
  if (legacy) return { id: legacy._id, duplicate: true, record: legacy }
  try {
    await db.collection(collection).add({ data: { ...data, _id: id } })
    return { id, duplicate: false, record: { ...data, _id: id } }
  } catch (error) {
    const raced = (await db.collection(collection).where({ _id: id }).limit(1).get()).data[0]
    if (raced) return { id, duplicate: true, record: raced }
    throw error
  }
}
function endpoint(handler) {
  const cloud = require('wx-server-sdk')
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
  const db = cloud.database()
  return async (event = {}) => {
    try { const openid = await identity(cloud, db); return await handler({ event, cloud, db, openid }) }
    catch (error) {
      const expected = Number.isInteger(error.code) && error.code >= 400 && error.code <= 599
      return { code: expected ? error.code : 503, message: expected ? error.message : 'SERVICE_UNAVAILABLE' }
    }
  }
}
async function readDoc(store, collection, id) {
  try { return (await store.collection(collection).doc(id).get()).data || null }
  catch (error) { if (error.errCode === -502005 || /not exist|not found/i.test(error.errMsg || error.message || '')) return null; throw error }
}
async function mutateOnce(db, openid, event, operation, handler) {
  const clientId = requestId(event), id = hash(`${openid}:${operation}:${clientId}`)
  return db.runTransaction(async transaction => {
    const existing = await readDoc(transaction, 'mutation_receipts', id)
    if (existing) return { ...existing.result, duplicate: true }
    const result = await handler(transaction)
    await transaction.collection('mutation_receipts').doc(id).set({ data: { openid, operation, client_request_id: clientId, result, created_at: db.serverDate() } })
    return result
  })
}
module.exports = { hash, fail, key, validDate, requestId, text, number, identity, access, all, createOnce, endpoint, readDoc, mutateOnce }
