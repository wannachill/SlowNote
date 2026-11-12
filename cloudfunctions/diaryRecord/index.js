const { endpoint, access, createOnce, requestId, hash, validDate, key, fail, text } = require('./lib/runtime')
exports.main=endpoint(async({event,db,openid})=>{
  const context=await access(db,openid)
  const action=event.action||'add'
  const babyId=typeof event.baby_id==='string'&&event.baby_id.length<=64?event.baby_id:''
  if(action==='list')return {code:0,records:(await db.collection('diary_records').where({...context.scope,...(babyId?{baby_id:babyId}:{})}).orderBy('created_at','desc').limit(200).get()).data}
  if(action==='delete'||action==='update'){
    if(typeof event.id!=='string'||!event.id)fail(400,'INVALID_ID')
    const found=(await db.collection('diary_records').where({...context.scope,_id:event.id}).limit(1).get()).data[0]
    if(!found)fail(404,'NOT_FOUND')
    if(action==='delete'){
      await db.collection('diary_records').doc(found._id).remove()
      return {code:0}
    }
    const content=text(event.content||'',500),images=event.images||[]
    if(!Array.isArray(images)||images.length>9||images.some(i=>typeof i!=='string'||!i.startsWith('cloud://')||!i.includes('/diary/'+openid+'/')||i.length>500))fail(400,'INVALID_IMAGES')
    if(!content&&!images.length)fail(400,'EMPTY_CONTENT')
    const date=event.recordDate
    if(!validDate(date)||date>key())fail(400,'INVALID_DATE')
    await db.collection('diary_records').doc(found._id).update({data:{content,images,record_date:date}})
    return {code:0,data:{id:found._id}}
  }
  if(action!=='add')fail(400,'UNKNOWN_ACTION')
  const content=text(event.content||'',500),images=event.images||[]
  if(!Array.isArray(images)||images.length>9||images.some(i=>typeof i!=='string'||!i.startsWith('cloud://')||!i.includes('/diary/'+openid+'/')||i.length>500))fail(400,'INVALID_IMAGES')
  if(!content&&!images.length)fail(400,'EMPTY_CONTENT')
  const date=event.recordDate||key();if(!validDate(date)||date>key())fail(400,'INVALID_DATE')
  const clientId=requestId(event),result=await createOnce(db,'diary_records',hash(openid+':'+clientId),{openid,family_id:context.familyId,content,images,baby_id:babyId,record_date:date,client_request_id:clientId,created_at:db.serverDate()})
  return {code:0,duplicate:result.duplicate,data:{id:result.id}}
})
