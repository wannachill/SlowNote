// Private to babyProfile: receipts freeze the deletion scope and IDs before any removal.
const { access, all, hash, fail, mutateOnce, readDoc } = require('./lib/runtime')
const RECORDS = ['feeding_records', 'growth_records', 'diary_records', 'custom_records', 'milestone_records', 'milestone_defs']
const belongs = (row, condition) => Object.entries(condition).every(([field, value]) => row[field] === value)
const ownedFile = (file, directory, openid) => typeof file === 'string' && file.startsWith('cloud://') && file.includes(`/${directory}/${openid}/`)

async function deleteBaby({ db, cloud, openid, context, babyId, clientId }) {
  const event = { clientRequestId: clientId }
  const plan = await mutateOnce(db, openid, event, 'baby-del-plan', async tx => {
    const baby = await readDoc(tx, 'babies', babyId)
    if (!baby || !belongs(baby, context.scope)) fail(404, 'BABY_NOT_FOUND')
    return { code: 0, babyId, ownerKey: context.ownerKey, scope: context.scope }
  })
  if (plan.babyId !== babyId || plan.ownerKey !== context.ownerKey) fail(409, 'DELETE_SCOPE_CHANGED')
  const base = hash(`${clientId}:${babyId}`)
  const once = (suffix, operation, handler) => mutateOnce(db, openid, { clientRequestId: `${base}_${suffix}` }, operation, handler)
  const assertScope = async tx => {
    if ((await access(tx, openid)).ownerKey !== plan.ownerKey) fail(409, 'DELETE_SCOPE_CHANGED')
  }
  const snapshots = {}, conditions = {}
  async function snapshot(collection, condition, read = () => all(db, collection, condition)) {
    conditions[collection] = condition
    snapshots[collection] = await once(collection, 'baby-del-snapshot', async () => {
      const rows = await read()
      return { code: 0, ids: rows.map(row => row._id) }
    })
  }
  // A failed/over-limit snapshot leaves the profile intact. No retry can widen a completed snapshot.
  for (const collection of RECORDS) await snapshot(collection, { ...plan.scope, baby_id: babyId })
  await snapshot('ai_sessions', { openid, babyId })
  await snapshot('ai_tasks', { openid, baby_id: babyId })
  const taskIds = new Set(snapshots.ai_tasks.ids)
  for (const collection of ['ai_runs', 'ai_notifications']) {
    // Task IDs are frozen too; aggregate-all tasks and other users' histories are never touched.
    await snapshot(collection, { openid }, async () => {
      const rows = []
      for (const task_id of taskIds) {
        rows.push(...await all(db, collection, { openid, task_id }))
        if (rows.length > 10000) fail(413, 'TOO_MANY_RECORDS')
      }
      return rows
    })
  }
  const result = await mutateOnce(db, openid, event, 'baby-del', async tx => {
    await assertScope(tx)
    const baby = await readDoc(tx, 'babies', babyId)
    if (!baby || !belongs(baby, plan.scope)) fail(409, 'DELETE_SCOPE_CHANGED')
    await tx.collection('babies').doc(babyId).remove()
    return { code: 0, avatar: baby.avatar || '' }
  })

  const cleaned = {}, pending = {}, diaryFiles = new Set()
  // Stop dedicated reports first. Keep the definition for audit, revoke an in-flight lease;
  // aiReport already checks enabled + lease_token before publishing a slow model response.
  for (const collection of ['ai_tasks', ...RECORDS, 'ai_sessions', 'ai_runs', 'ai_notifications']) {
    cleaned[collection] = 0
    const ids = snapshots[collection].ids
    for (let offset = 0; offset < ids.length; offset += 40) {
      try {
        const batch = await once(`${collection}_${offset / 40}`, 'baby-del-batch', async tx => {
          await assertScope(tx)
          let count = 0
          const files = []
          for (const id of ids.slice(offset, offset + 40)) {
            const row = await readDoc(tx, collection, id)
            if (!row) continue
            if (!belongs(row, conditions[collection]) || (['ai_runs', 'ai_notifications'].includes(collection) && !taskIds.has(row.task_id))) fail(409, 'DELETE_RECORD_CHANGED')
            if (collection === 'ai_tasks') {
              await tx.collection(collection).doc(id).update({ data: { enabled: false, lease_token: '', lease_until: new Date(0), last_status: 'baby_deleted' } })
            } else {
              if (collection === 'diary_records') files.push(...(Array.isArray(row.images) ? row.images : []).filter(file => ownedFile(file, 'diary', openid)))
              await tx.collection(collection).doc(id).remove()
            }
            count++
          }
          return { code: 0, count, files: [...new Set(files)] }
        })
        cleaned[collection] += batch.count
        batch.files.forEach(file => diaryFiles.add(file))
      } catch (error) {
        const code = Number.isInteger(error.code) && error.code >= 400 && error.code <= 599 ? error.code : 503
        const failure = pending[collection] || { code, message: code === 409 ? error.message : 'CLEANUP_RETRY_REQUIRED', batches: 0 }
        failure.batches++
        pending[collection] = failure
      }
    }
  }
  await cleanupFiles({ db, cloud, openid, once, avatar: result.avatar, diaryFiles })
  return { code: 0, babyDeleted: true, duplicate: !!result.duplicate, cleaned, pending }
}

async function cleanupFiles({ db, cloud, openid, once, avatar, diaryFiles }) {
  try {
    const candidates = new Set(diaryFiles)
    if (ownedFile(avatar, 'avatars', openid)) candidates.add(avatar)
    if (!candidates.size) return
    // Inspect surviving references, including other babies/family members. Uncertain or
    // over-limit reference scans fail closed: keep files rather than break another record.
    const [diaries, babies, sessions] = await Promise.all([all(db, 'diary_records', {}), all(db, 'babies', {}), all(db, 'ai_sessions', {})])
    for (const row of diaries) for (const file of (Array.isArray(row.images) ? row.images : [])) candidates.delete(file)
    for (const baby of babies) candidates.delete(baby.avatar)
    for (const session of sessions) for (const message of (Array.isArray(session.messages) ? session.messages : [])) {
      for (const file of (Array.isArray(message.images) ? message.images : [])) candidates.delete(file)
    }
    const files = []
    for (const file of candidates) {
      const claim = await once(`file_${hash(file)}`, 'baby-del-files', async () => ({ code: 0 }))
      if (!claim.duplicate) files.push(file)
    }
    for (let offset = 0; offset < files.length; offset += 50) {
      const fileList = files.slice(offset, offset + 50)
      try {
        const response = await cloud.deleteFile({ fileList })
        if (!response || !Array.isArray(response.fileList) || response.fileList.some(file => Number(file.status) !== 0)) throw Error('FILE_DELETE_FAILED')
      } catch (_) { console.error('[babyProfile] file cleanup incomplete; storage lifecycle/manual follow-up required') }
    }
  } catch (_) { console.error('[babyProfile] file ownership/reference scan failed; files retained') }
}

module.exports = { deleteBaby }
