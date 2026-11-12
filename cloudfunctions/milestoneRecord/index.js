// 云函数：milestoneRecord —— 宝宝个性化成长里程碑
const { endpoint, access, all, createOnce, mutateOnce, requestId, hash, validDate, key: todayKey, fail, text } = require('./lib/runtime')

const MILESTONES = [
  ['lift_head', 1, '大运动', '俯卧时能抬起头'], ['follow_eye', 1, '精细动作', '眼睛能追视移动的物体'],
  ['grip', 2, '精细动作', '能握紧小拳头'], ['smile', 2, '社交', '会回应性地微笑'],
  ['head_steady', 3, '大运动', '俯卧时能用前臂撑起胸部、抬头约90°'], ['coo', 3, '语言', '会发出“哦哦、啊啊”等元音声'],
  ['roll', 4, '大运动', '能自己翻身（俯卧翻到仰卧）'], ['babble', 4, '语言', '会发出咿呀学语声'],
  ['grab', 5, '精细动作', '能伸手抓握玩具'], ['recognize', 5, '社交', '能认出亲近的人'],
  ['sit', 6, '大运动', '能独坐片刻'], ['roll_both', 7, '大运动', '能在仰卧与俯卧间自如翻身'],
  ['stranger', 7, '社交', '开始认生、对陌生人表现出警惕'], ['crawl', 8, '大运动', '能匍匐或手脚爬行'],
  ['call_parents', 8, '语言', '会无意识地叫爸爸妈妈'], ['stranger_anxiety', 8, '社交', '见到陌生人会害羞或怕生'],
  ['pull_stand', 9, '大运动', '能扶着家具尝试站立'], ['pincer_early', 9, '精细动作', '开始用拇指和食指捏取小物'],
  ['stand', 10, '大运动', '能扶着站立'], ['pincer', 10, '精细动作', '能用拇指和食指捏取小物'],
  ['wave', 10, '社交', '会挥手再见'], ['cruise', 11, '大运动', '能扶着家具侧移学步'],
  ['respond_sound', 11, '社交', '会对熟悉的人或物用声音或动作回应'], ['first_words', 12, '语言', '会说简单词汇（如妈妈、拜拜）'],
  ['walk', 13, '大运动', '能独立行走'], ['point', 14, '社交', '会用手指指出想要的东西'],
  ['stack', 15, '精细动作', '能叠起两块积木'], ['more_words', 16, '语言', '词汇量明显增多'],
  ['run_early', 17, '大运动', '能摇摇晃晃地小步跑'], ['feed_self', 17, '精细动作', '能自己拿食物送入口中'],
  ['say_more', 18, '语言', '能说约10个以上单词、指认身体部位'], ['stairs', 18, '大运动', '能扶栏上下楼梯'],
  ['tower3', 19, '精细动作', '能把积木搭高3-4块'], ['kick', 19, '大运动', '能抬脚踢球'],
  ['run', 20, '大运动', '能小跑'], ['imitate', 20, '社交', '喜欢模仿大人的动作'],
  ['say_50', 21, '语言', '能说约50个词、乐于学新词'], ['squat', 21, '大运动', '能蹲下再站起'],
  ['undress', 22, '精细动作', '能自己脱简单衣物'], ['short_sentence', 22, '语言', '会说两三个词组成的短句'],
  ['stairs_alone', 23, '大运动', '能独立上下楼梯（仍需扶）'], ['color_early', 23, '语言', '开始辨认常见颜色'],
  ['jump2', 24, '大运动', '能双脚并拢跳起'], ['self_feed2', 24, '精细动作', '能较稳地自己用勺吃饭'],
  ['sentence_3', 24, '语言', '能说3个词以上的短句、听懂简单指令'], ['copy_draw', 25, '精细动作', '能模仿画直线或画圈'],
  ['sing', 25, '语言', '能跟着唱简单儿歌片段'], ['jump', 26, '大运动', '能双脚跳起'],
  ['ride_trike', 27, '大运动', '能骑带辅助轮的三轮车（脚蹬）'], ['shape', 27, '语言', '能认出常见形状（圆、方、三角）'],
  ['eat_self', 28, '精细动作', '能自己用勺子吃饭'], ['one_foot', 29, '大运动', '能单脚站立约2秒'],
  ['sentence_4', 29, '语言', '能说4个词以上的句子'], ['simple_q', 30, '语言', '会问简单的问题'],
  ['play_together', 30, '社交', '能和小朋友一起玩耍'], ['tip_toe', 31, '大运动', '能踮脚走路'],
  ['count3', 31, '语言', '能数到3、认出1-2种颜色'], ['draw_line', 32, '精细动作', '能画出竖线或模仿画横竖线'],
  ['name_age', 32, '语言', '能说出自己的名字和年龄'], ['ride_steady', 33, '大运动', '骑三轮更稳、能转弯'],
  ['color_more', 33, '语言', '能辨认多种颜色'], ['one_foot_long', 34, '大运动', '能单脚站立几秒'],
  ['story', 34, '语言', '能复述简短故事片段'], ['hop', 35, '大运动', '能单脚跳'],
  ['sentence_5', 35, '语言', '能说5个词左右的句子表达需求'], ['ride_confident', 36, '大运动', '能熟练骑三轮、跑跳更协调'],
  ['count10', 36, '语言', '能数到10、说完整短句'], ['toilet', 36, '其他', '能基本自己如厕（白天）']
].map(([key, month, domain, name], sort_order) => ({ key, month, domain, name, sort_order, source: 'builtin' }))
const MONTHS = Array.from({ length: 36 }, (_, index) => index + 1)
const DOMAINS = ['大运动', '精细动作', '语言', '社交', '其他']

function validMonth(value) { return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 36 }
function babyCondition(scope, babyId) { return { ...scope.scope, baby_id: babyId } }
function isMissingCollection(error) {
  return error && (error.errCode === -502005 || /collection.{0,30}(not exist|not found|不存在)/i.test(error.errMsg || error.message || ''))
}
function isExistingCollection(error) {
  return error && /already exists|duplicate|collection.{0,30}(exist|存在)/i.test(error.errMsg || error.message || '')
}
async function ensureDefsCollection(db) {
  try {
    await db.collection('milestone_defs').limit(1).get()
  } catch (error) {
    if (!isMissingCollection(error) || typeof db.createCollection !== 'function') throw error
    try { await db.createCollection('milestone_defs') }
    catch (createError) { if (!isExistingCollection(createError)) throw createError }
  }
}
async function requireBaby(db, scope, babyId) {
  if (typeof babyId !== 'string' || !babyId || babyId.length > 64) fail(400, 'INVALID_BABY_ID')
  const baby = (await db.collection('babies').where({ ...scope.scope, _id: babyId }).limit(1).get()).data[0]
  if (!baby) fail(404, 'BABY_NOT_FOUND')
  return babyCondition(scope, babyId)
}
function defId(ownerKey, babyId, milestoneKey) { return hash(`milestone-def:${ownerKey}:${babyId}:${milestoneKey}`) }
async function ensureBuiltins(db, scope, babyId) {
  const condition = babyCondition(scope, babyId)
  const existing = (await db.collection('milestone_defs').where(condition).get()).data
  const keys = new Set(existing.map(item => item.key))
  await Promise.all(MILESTONES.filter(item => !keys.has(item.key)).map(item => createOnce(db, 'milestone_defs', defId(scope.ownerKey, babyId, item.key), {
    ...item, ...condition, openid: scope.openid, family_id: scope.familyId, deleted: false,
    created_at: db.serverDate(), updated_at: db.serverDate()
  })))
  return condition
}
function definitionInput(event) {
  const name = text(event.name, 120, true)
  const domain = text(event.domain, 16, true)
  const month = Number(event.month)
  if (!DOMAINS.includes(domain)) fail(400, 'INVALID_DOMAIN')
  if (!validMonth(month)) fail(400, 'INVALID_MONTH')
  return { name, domain, month }
}
async function findDef(db, condition, milestoneKey) {
  if (typeof milestoneKey !== 'string' || !milestoneKey || milestoneKey.length > 80) fail(400, 'INVALID_KEY')
  const found = (await db.collection('milestone_defs').where({ ...condition, key: milestoneKey }).limit(1).get()).data[0]
  if (!found || found.deleted) fail(404, 'MILESTONE_NOT_FOUND')
  return found
}

exports.main = endpoint(async ({ event, db, openid }) => {
  const action = event.action || 'list'
  const scope = await access(db, openid)
  const babyId = typeof event.baby_id === 'string' ? event.baby_id : ''
  const condition = await requireBaby(db, scope, babyId)
  if (['addDef', 'updateDef', 'removeDef', 'reorder'].includes(action)) await ensureDefsCollection(db)

  if (action === 'list') {
    await ensureDefsCollection(db)
    await ensureBuiltins(db, scope, babyId)
    const [defs, records] = await Promise.all([
      all(db, 'milestone_defs', condition), all(db, 'milestone_records', condition)
    ])
    const doneMap = new Map(records.map(record => [record.milestone_key, record]))
    const milestones = defs.filter(def => !def.deleted).sort((a, b) => a.month - b.month || (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name)).map(def => {
      const done = doneMap.get(def.key)
      return { key: def.key, source: def.source, name: def.name, domain: def.domain, month: Number(def.month), sort_order: def.sort_order || 0, done: !!done, recordDate: done ? done.record_date : '' }
    })
    return { code: 0, milestones, months: MONTHS }
  }

  if (action === 'check') {
    const milestoneKey = event.key, recordDate = event.recordDate
    if (!validDate(recordDate) || recordDate > todayKey()) fail(400, 'INVALID_DATE')
    const def = await findDef(db, condition, milestoneKey)
    const clientId = requestId(event)
    const existing = (await db.collection('milestone_records').where({ ...condition, milestone_key: milestoneKey }).limit(1).get()).data[0]
    if (existing) return { code: 0, duplicate: true }
    const result = await createOnce(db, 'milestone_records', hash(`${openid}:${clientId}`), {
      openid, family_id: scope.familyId, milestone_key: milestoneKey, domain: def.domain,
      baby_id: babyId, record_date: recordDate, client_request_id: clientId, created_at: db.serverDate()
    })
    return { code: 0, duplicate: result.duplicate, data: { id: result.id } }
  }

  if (action === 'uncheck') {
    const def = await findDef(db, condition, event.key)
    const records = await all(db, 'milestone_records', { ...condition, milestone_key: def.key })
    for (const record of records) await db.collection('milestone_records').doc(record._id).remove()
    return { code: 0 }
  }

  if (action === 'addDef') {
    const input = definitionInput(event), clientId = requestId(event)
    return mutateOnce(db, openid, event, 'milestone-def-add', async tx => {
      const defs = (await tx.collection('milestone_defs').where(condition).get()).data.filter(def => !def.deleted && Number(def.month) === input.month)
      const milestoneKey = `custom_${hash(`${openid}:${babyId}:${clientId}`).slice(0, 24)}`
      const result = await createOnce(tx, 'milestone_defs', defId(scope.ownerKey, babyId, milestoneKey), {
        ...input, ...condition, key: milestoneKey, source: 'custom', sort_order: defs.reduce((max, def) => Math.max(max, Number(def.sort_order) || 0), -1) + 1,
        deleted: false, openid, family_id: scope.familyId, created_at: db.serverDate(), updated_at: db.serverDate()
      })
      return { code: 0, key: milestoneKey, duplicate: result.duplicate }
    })
  }

  if (action === 'updateDef') {
    const input = definitionInput(event), clientId = requestId(event)
    return mutateOnce(db, openid, event, 'milestone-def-update', async tx => {
      const def = await findDef(tx, condition, event.key)
      const max = await tx.collection('milestone_defs').where(condition).get()
      const sortOrder = def.month === input.month ? def.sort_order : max.data.filter(item => !item.deleted && Number(item.month) === input.month).reduce((value, item) => Math.max(value, Number(item.sort_order) || 0), -1) + 1
      await tx.collection('milestone_defs').doc(def._id).update({ data: { ...input, sort_order: sortOrder, updated_at: db.serverDate() } })
      return { code: 0, key: def.key }
    })
  }

  if (action === 'removeDef') {
    const clientId = requestId(event)
    return mutateOnce(db, openid, event, 'milestone-def-remove', async tx => {
      const def = await findDef(tx, condition, event.key)
      await tx.collection('milestone_defs').doc(def._id).update({ data: { deleted: true, updated_at: db.serverDate() } })
      const records = await all(tx, 'milestone_records', { ...condition, milestone_key: def.key })
      for (const record of records) await tx.collection('milestone_records').doc(record._id).remove()
      return { code: 0, key: def.key }
    })
  }

  if (action === 'reorder') {
    requestId(event)
    const month = Number(event.month), keys = event.keys
    if (!validMonth(month) || !Array.isArray(keys) || keys.length > 200 || keys.some(key => typeof key !== 'string') || new Set(keys).size !== keys.length) fail(400, 'INVALID_ORDER')
    return mutateOnce(db, openid, event, 'milestone-def-reorder', async tx => {
      const defs = (await tx.collection('milestone_defs').where(condition).get()).data.filter(def => !def.deleted && Number(def.month) === month)
      const byKey = new Map(defs.map(def => [def.key, def]))
      if (keys.length !== defs.length || keys.some(key => !byKey.has(key))) fail(400, 'INVALID_ORDER')
      for (let index = 0; index < keys.length; index++) await tx.collection('milestone_defs').doc(byKey.get(keys[index])._id).update({ data: { sort_order: index, updated_at: db.serverDate() } })
      return { code: 0 }
    })
  }

  fail(400, 'UNKNOWN_ACTION')
})
