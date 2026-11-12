const { endpoint, fail, mutateOnce, readDoc, validDate } = require('./lib/runtime')
exports.main = endpoint(async ({ event, db, openid }) => {
  if (!event.action || event.action === 'list') {
    const condition = { openid }
    if (event.startDate !== undefined || event.endDate !== undefined) {
      if (!validDate(event.startDate) || !validDate(event.endDate) || event.startDate > event.endDate) fail(400, 'INVALID_DATE_RANGE')
      const start = new Date(event.startDate + 'T00:00:00+08:00')
      const end = new Date(+new Date(event.endDate + 'T00:00:00+08:00') + 86400000)
      condition.created_at = db.command.gte(start).and(db.command.lt(end))
    }
    const offset = event.offset === undefined ? 0 : event.offset
    if (!Number.isSafeInteger(offset) || offset < 0) fail(400, 'INVALID_OFFSET')
    const total = (await db.collection('ai_notifications').where(condition).count()).total
    const items = (await db.collection('ai_notifications').where(condition).orderBy('created_at', 'desc').orderBy('_id', 'desc').skip(offset).limit(20).get()).data
    return { code: 0, total, hasMore: offset + items.length < total, items: items.map(item => ({ id: item._id, title: item.title, content: item.content, read: item.read, created_at: item.created_at, configured: item.configured, unavailable: item.unavailable, delivery: item.delivery })) }
  }
  if (event.action === 'remove') {
    if (typeof event.id !== 'string') fail(400, 'UNKNOWN_ACTION')
    return mutateOnce(db, openid, event, 'notification-remove', async tx => {
      const item = await readDoc(tx, 'ai_notifications', event.id)
      if (!item || item.openid !== openid) fail(404, 'NOTIFICATION_NOT_FOUND')
      await tx.collection('ai_notifications').doc(item._id).remove()
      return { code: 0 }
    })
  }
  if (event.action !== 'read' || typeof event.id !== 'string') fail(400, 'UNKNOWN_ACTION')
  return mutateOnce(db, openid, event, 'notification-read', async tx => {
    const item = await readDoc(tx, 'ai_notifications', event.id)
    if (!item || item.openid !== openid) fail(404, 'NOTIFICATION_NOT_FOUND')
    await tx.collection('ai_notifications').doc(item._id).update({ data: { read: true } })
    return { code: 0 }
  })
})
