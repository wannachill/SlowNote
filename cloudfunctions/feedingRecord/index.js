const { endpoint, access, createOnce, requestId, hash, validDate, key, fail, number, text } = require('./lib/runtime')
const { records, range } = require('./lib/aggregation')
exports.main = endpoint(async ({event, db, openid}) => {
  const context=await access(db,openid)
  const action=event.action||'add'
  const babyId=typeof event.baby_id==='string'&&event.baby_id.length<=64?event.baby_id:''
  if(action==='listToday'||action==='listDate'){
    const day=event.recordDate||key(event.startOfDay||new Date())
    const rows=(await records(db,'feeding_records',context.scope,range('day',day),babyId)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,50)
    return {code:0,records:rows.map(r=>({id:r._id,type:r.type,payload:r.payload,created_at:r.created_at,record_date:r.record_date}))}
  }
  if(action==='delete'){
    if(typeof event.id!=='string'||!event.id)fail(400,'INVALID_ID')
    const found=(await db.collection('feeding_records').where({...context.scope,_id:event.id}).limit(1).get()).data[0]
    if(!found)fail(404,'NOT_FOUND')
    await db.collection('feeding_records').doc(found._id).remove()
    return {code:0}
  }
  const validatePayload=(type,p)=>{
  if(!p||!['feed','solid','excretion'].includes(type))fail(400,'INVALID_CATEGORY')
  let payload
  if(type==='feed'){
    if(!['breast','bottle','formula','mixed'].includes(p.mode))fail(400,'INVALID_MODE')
    payload=p.mode==='breast'?{mode:p.mode,durationMin:number(p.durationMin,1,600)}:{mode:p.mode,amountMl:number(p.amountMl,1,2000)}
  }else if(type==='solid')payload={name:text(p.name,60,true),note:text(p.note||'',300)}
  else {
    const kind=p.kind==='urine'?'urine':'stool'
    payload={kind,count:number(p.count,0,100,true),shape:text(p.shape||'',12)}
    if(!payload.count)fail(400,'EMPTY_CONTENT')
  }
  return payload
  }
  if(action==='update'){
    if(typeof event.id!=='string'||!event.id)fail(400,'INVALID_ID')
    const found=(await db.collection('feeding_records').where({...context.scope,_id:event.id}).limit(1).get()).data[0]
    if(!found)fail(404,'NOT_FOUND')
    if(event.type!==found.type)fail(400,'INVALID_CATEGORY')
    const payload=validatePayload(event.type,event.payload)
    const date=event.recordDate
    if(!validDate(date)||date>key())fail(400,'INVALID_DATE')
    await db.collection('feeding_records').doc(found._id).update({data:{payload,record_date:date}})
    return {code:0,data:{id:found._id}}
  }
  if(action!=='add')fail(400,'UNKNOWN_ACTION')
  const {type}=event,p=event.payload
  const payload=validatePayload(type,p)
  const date=event.recordDate||key();if(!validDate(date)||date>key())fail(400,'INVALID_DATE')
  const clientId=requestId(event), result=await createOnce(db,'feeding_records',hash(openid+':'+clientId),{openid,family_id:context.familyId,type,payload,baby_id:babyId,record_date:date,client_request_id:clientId,created_at:db.serverDate()})
  return {code:0,duplicate:result.duplicate,data:{id:result.id}}
})
