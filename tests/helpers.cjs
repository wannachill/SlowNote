const fs = require('fs'), path = require('path'), vm = require('vm')
const NOW = new Date('2026-10-21T12:00:00Z')
class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])) } static now() { return +NOW } }
const copy = value => structuredClone(value)
function memoryDb(seed = {}) {
  const tables = new Map(Object.entries(seed).map(([k,v]) => [k, copy(v)]))
  const rows = name => { if (!tables.has(name)) tables.set(name, []); return tables.get(name) }
  const comparable = v => v instanceof Date ? +v : v
  const compare = fn => { const op = value => fn(comparable(value)); op.and = other => compare(value => op(value) && other(value)); return op }
  const matches = (row, cond) => Object.entries(cond || {}).every(([k,v]) => k === '$and' ? v.every(c => matches(row,c)) : k === '$or' ? v.some(c => matches(row,c)) : typeof v === 'function' ? v(row[k]) : comparable(row[k]) === comparable(v))
  const command = {
    and: conditions => ({ $and: conditions }), or: conditions => ({ $or: conditions }),
    gt: v => compare(x => x > comparable(v)), gte: v => compare(x => x >= comparable(v)),
    lt: v => compare(x => x < comparable(v)), lte: v => compare(x => x <= comparable(v)),
    neq: v => compare(x => x !== comparable(v)), exists: v => compare(x => (x !== undefined) === v)
  }
  const db = {
    command, serverDate: () => new Date(NOW), rows,
    collection(name) {
      let condition = {}, limit = 20, sort = [], skip = 0
      const found = () => {
        let result = rows(name).filter(r => matches(r,condition))
        if (sort.length) result = result.slice().sort((a,b) => {
          for (const [key, direction] of sort) {
            const order = (comparable(a[key]) > comparable(b[key]) ? 1 : comparable(a[key]) < comparable(b[key]) ? -1 : 0) * (direction === 'desc' ? -1 : 1)
            if (order) return order
          }
          return 0
        })
        return result
      }
      const query = {
        where(value) { condition = value; return this }, limit(value) { limit = value; return this },
        orderBy(...value) { sort.push(value); return this }, skip(value) { skip = value; return this }, field() { return this },
        async get() { return { data: copy(found().slice(skip,skip + limit)) } },
        async count() { return { total: found().length } },
        async add({data}) {
          const id = data._id || 'auto-' + rows(name).length
          if (rows(name).some(r => r._id === id)) throw new Error('duplicate key')
          rows(name).push(copy({ ...data, _id: id })); return { _id: id }
        },
        async update({data}) { const targets = found(); targets.forEach(r => Object.assign(r,copy(data))); return { stats: { updated: targets.length } } },
        async remove() { const targets = found(); tables.set(name,rows(name).filter(r => !targets.includes(r))); return { stats: { removed: targets.length } } },
        doc(id) {
          return {
            async get() { const row=rows(name).find(r=>r._id===id);if(!row)throw Object.assign(new Error('document not found'),{errCode:-502005});return { data: copy(row) } },
            async set({data}) { const i=rows(name).findIndex(r=>r._id===id),row=copy({...data,_id:id});if(i<0)rows(name).push(row);else rows(name)[i]=row;return {_id:id} },
            async update({data}) { const row=rows(name).find(r=>r._id===id);if(!row)throw Error('not found');Object.assign(row,copy(data));return {stats:{updated:1}} },
            async remove() { tables.set(name,rows(name).filter(r=>r._id!==id));return {stats:{removed:1}} }
          }
        }
      }
      return query
    },
    runTransaction(handler) {
      const result = (db._queue || Promise.resolve()).catch(()=>{}).then(async()=>{
        const snapshot=copy([...tables]);try{return await handler(db)}catch(error){tables.clear();snapshot.forEach(([k,v])=>tables.set(k,v));throw error}
      })
      db._queue=result;return result
    }
  }
  return db
}
function seed() {
  return { users: [{_id:'user-a',openid:'user-a'},{_id:'user-b',openid:'user-b'}], family_members: [], babies: [] }
}
function load(file, globals = {}, substitutions = {}) {
  const cache = new Map()
  function read(filename) {
    filename=path.resolve(filename)
    if(cache.has(filename))return cache.get(filename).exports
    const module={exports:{}};cache.set(filename,module)
    const localRequire=name=>{
      if(Object.prototype.hasOwnProperty.call(substitutions,name))return substitutions[name]
      if(name.startsWith('.')){let resolved=path.resolve(path.dirname(filename),name);if(!path.extname(resolved))resolved+='.js';return read(resolved)}
      return require(name)
    }
    const context={module,exports:module.exports,require:localRequire,Date:ClockDate,URL,Buffer,setTimeout,clearTimeout,console,process:{env:{}},...globals}
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename})
    return module.exports
  }
  return read(file)
}
function service(name, db, options = {}) {
  const state={openid:options.openid === undefined?'user-a':options.openid,pushes:[]}
  const cloud={DYNAMIC_CURRENT_ENV:'test',init(){},database:()=>db,getWXContext:()=>({OPENID:state.openid}),openapi:{subscribeMessage:{async send(data){state.pushes.push(data);if(options.pushError)throw Error('not subscribed');return {errCode:0}}}}}
  const api=load('cloudfunctions/'+name+'/index.js',{process:{env:options.env||{}}},{'wx-server-sdk':cloud,...options.substitutions})
  return {...api,state}
}
function front(name, options = {}) {
  const storage={}, calls=[], state={ definition:null, app:null, pages:[] }
  const wx={
    getStorageSync:k=>storage[k],setStorageSync:(k,v)=>{storage[k]=v},removeStorageSync:k=>{delete storage[k]},
    getAppBaseInfo:()=>({theme:options.system||'light'}),getSystemInfoSync:()=>({pixelRatio:1,theme:options.system||'light'}),
    setNavigationBarColor(){},setBackgroundColor(){},onThemeChange(){},
    createSelectorQuery:()=>({in(){return this},select(){return this},fields(){return this},exec(cb){cb([])}}),
    navigateTo:arg=>calls.push({type:'navigateTo',...arg}),switchTab:arg=>calls.push({type:'switchTab',...arg}),
    showToast:arg=>calls.push({type:'toast',...arg}),showModal:arg=>arg.success({confirm:true}),stopPullDownRefresh(){},vibrateShort(){},
    cloud:{init(){},callFunction:options.callFunction|| (async()=>({result:{code:0}}))}
  }
  Object.assign(storage,options.storage||{})
  const app=options.app||{palette:null,globalData:{loggedIn:true,initialized:true,baby:{nickname:'小满',birthday:'2026-09-10'}},async init(){}}
  state.app=app
  load('miniprogram/pages/'+name+'/index.js',{wx,Page:def=>{state.definition=def},getApp:()=>app,getCurrentPages:()=>state.pages})
  const page={...state.definition,data:copy(state.definition.data),route:'pages/'+name+'/index',setData(data,done){for(const [key,value]of Object.entries(data)){const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let target=this.data;for(let i=0;i<parts.length-1;i++)target=target[parts[i]];target[parts[parts.length-1]]=value}if(done)done()},getTabBar:()=>({refresh(){},setData(){}})}
  state.pages=[page]
  return {page,app,wx,storage,calls}
}
module.exports={NOW,ClockDate,memoryDb,seed,load,service,front}
