const { endpoint, access, createOnce, requestId, hash, validDate, key, fail, number } = require('./lib/runtime')
exports.main=endpoint(async({event,db,openid})=>{
  const context=await access(db,openid)
  const action=event.action||'add'
  const babyId=typeof event.baby_id==='string'&&event.baby_id.length<=64?event.baby_id:''
  if(action==='list')return {code:0,records:(await db.collection('growth_records').where({...context.scope,...(babyId?{baby_id:babyId}:{})}).orderBy('record_date','desc').limit(60).get()).data}
  if(action==='listDate'){
    const recordDate=event.recordDate
    if(!validDate(recordDate))fail(400,'INVALID_DATE')
    const rows=(await db.collection('growth_records').where({...context.scope,...(babyId?{baby_id:babyId}:{}),record_date:recordDate}).limit(1).get()).data
    return {code:0,records:rows}
  }
  if(action==='delete'||action==='update'){
    if(typeof event.id!=='string'||!event.id)fail(400,'INVALID_ID')
    const found=(await db.collection('growth_records').where({...context.scope,_id:event.id}).limit(1).get()).data[0]
    if(!found)fail(404,'NOT_FOUND')
    if(action==='delete'){
      await db.collection('growth_records').doc(found._id).remove()
      return {code:0}
    }
    const recordDate=event.recordDate
    if(!validDate(recordDate)||recordDate>key())fail(400,'INVALID_DATE')
    const values={height:number(event.height,1,250,true),weight:number(event.weight,0.1,300,true),head:number(event.head,1,100,true)}
    if(Object.values(values).every(v=>v==null))fail(400,'EMPTY_CONTENT')
    await db.collection('growth_records').doc(found._id).update({data:{...values,record_date:recordDate}})
    return {code:0,data:{id:found._id}}
  }
  if(action!=='add')fail(400,'UNKNOWN_ACTION')
  const {recordDate}=event
  if(!validDate(recordDate)||recordDate>key())fail(400,'INVALID_DATE')
  const values={height:number(event.height,1,250,true),weight:number(event.weight,0.1,300,true),head:number(event.head,1,100,true)}
  if(Object.values(values).every(v=>v==null))fail(400,'EMPTY_CONTENT')
  const clientId=requestId(event), result=await createOnce(db,'growth_records',hash(openid+':'+clientId),{openid,family_id:context.familyId,...values,baby_id:babyId,record_date:recordDate,client_request_id:clientId,created_at:db.serverDate()})
  return {code:0,duplicate:result.duplicate,data:{id:result.id}}
})
