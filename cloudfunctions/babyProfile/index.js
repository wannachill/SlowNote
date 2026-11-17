const { endpoint, access, hash, requestId, text, validDate, key, fail, mutateOnce } = require('./lib/runtime')
const { deleteBaby } = require('./cleanup')
exports.main = endpoint(async ({ event, db, cloud, openid }) => {
  const context = await access(db, openid)
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  const listBabies = async (store) => {
    const rows = (await store.collection('babies').where(context.scope).orderBy('updated_at', 'desc').limit(50).get()).data
    return rows.map(b => ({ baby_id: b._id, nickname: b.nickname, birthday: b.birthday || '', gender: b.gender, avatar: b.avatar || '' }))
  }
  if (event.action === 'get') {
    const babies = await listBabies(db)
    return { code: 0, babies, theme_pref: user.theme_pref || null }
  }
  const clientId = requestId(event)
  if (event.action === 'theme') {
    const pref = event.theme_pref
    const THEME_COLORS = ['blue', 'pink', 'orange', 'mint', 'purple', 'dark']
    let color
    if (pref && typeof pref === 'object' && THEME_COLORS.includes(pref.color)) color = pref.color
    else if (pref && typeof pref === 'object' && ['light', 'dark'].includes(pref.mode)) color = pref.mode === 'dark' ? 'dark' : 'blue'
    else fail(400, 'INVALID_THEME')
    return mutateOnce(db, openid, event, 'theme', async tx => {
      await tx.collection('users').doc(user._id).update({ data: { theme_pref: { color }, theme_request_id: clientId, updated_at: db.serverDate() } })
      return { code: 0 }
    })
  }
  if (event.action === 'delete') {
    const babyId = text(event.babyId || '', 64, true)
    return deleteBaby({ db, cloud, openid, context, babyId, clientId })
  }
  if (event.action !== 'save') fail(400, 'UNKNOWN_ACTION')
  const nickname = text(event.nickname, 24, true), birthday = event.birthday || '', gender = event.gender, avatar = event.avatar || ''
  const defaultAvatar = ['', 'boy', 'girl'].includes(avatar)
  const ownedAvatar = typeof avatar === 'string' && avatar.startsWith('cloud://') && avatar.includes(`/avatars/${openid}/`)
  if ((birthday && (!validDate(birthday) || birthday > key() || birthday < '1900-01-01')) || !['unknown', 'male', 'female'].includes(gender) || (!defaultAvatar && !ownedAvatar)) fail(400, 'INVALID_BABY')
  const babyId = event.babyId || ''
  if (typeof babyId !== 'string' || babyId.length > 64) fail(400, 'INVALID_BABY_ID')
  return mutateOnce(db, openid, event, 'baby', async tx => {
    if (babyId) {
      const found = await tx.collection('babies').where({ _id: babyId, ...context.scope }).limit(1).get()
      if (!found.data.length) fail(404, 'BABY_NOT_FOUND')
      await tx.collection('babies').doc(babyId).update({ data: { nickname, birthday, gender, avatar, client_request_id: clientId, updated_at: db.serverDate() } })
      return { code: 0, baby: { baby_id: babyId, nickname, birthday, gender, avatar } }
    }
    const id = hash(openid + ':' + clientId)
    await tx.collection('babies').doc(id).set({ data: { nickname, birthday, gender, avatar, family_id: context.familyId, openid, client_request_id: clientId, updated_at: db.serverDate() } })
    return { code: 0, baby: { baby_id: id, nickname, birthday, gender, avatar } }
  })
})
