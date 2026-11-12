const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path')
const {NOW,memoryDb,seed,load,service,front}=require('./helpers.cjs')
const {readSeries,layout,axisDigits,axisValue,axisLabels,drawAxis}=require('../miniprogram/utils/chart')
const request='request-123456'
test('date arithmetic, Sunday week, leap birthday and month end remain calendar-correct',()=>{
  const date=load('miniprogram/utils/date.js')
  assert.equal(date.week('2026-10-21')[0].date,'2026-10-18')
  assert.equal(date.week('2026-10-21')[3].today,true)
  assert.equal(date.parseDate('2026-02-31'),null)
  assert.equal(date.shiftMonth('2026-01-31',1),'2026-02-28')
  assert.equal(date.monthDays('2026-02-28').length,42)
  assert.equal(date.ageText('2026-01-31','2026-02-28'),'1个月')
})
test('theme is color-only: blue/pink/orange are light, dark is a dark theme, no separate light/dark switch',()=>{
  const storage={},wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v,getAppBaseInfo:()=>({theme:'dark'})}
  const theme=load('miniprogram/utils/theme.js',{wx})
  const themeTemplate=fs.readFileSync(path.join(__dirname,'../miniprogram/templates/theme-settings.wxml'),'utf8')
  // 不再有独立的浅色/深色模式开关
  assert.doesNotMatch(themeTemplate,/浅色|显示模式|跟随系统|<switch|<picker/)
  // 深色作为可选主题色之一（在 COLORS 中以 dark 标记存在，经数据绑定渲染）
  assert.ok(theme.COLORS.some(c => c.id === 'dark' && c.dark), '深色应作为带 dark 标记的主题色')
  assert.equal(theme.COLORS.length, 6, '应有 6 个主题色：蓝/粉/橙/薄荷绿/紫色/深')
  // 薄荷绿、紫色为新增的浅色主题色
  assert.ok(theme.COLORS.some(c => c.id === 'mint' && !c.dark), '薄荷绿应作为浅色主题色')
  assert.ok(theme.COLORS.some(c => c.id === 'purple' && !c.dark), '紫色应作为浅色主题色')
  // 颜色解析：蓝/粉/橙/薄荷绿/紫色为浅色；深色为暗色基调
  assert.equal(theme.resolve({color:'blue'}).dark,false)
  assert.equal(theme.resolve({color:'pink'}).dark,false)
  assert.equal(theme.resolve({color:'orange'}).dark,false)
  assert.equal(theme.resolve({color:'mint'}).dark,false)
  assert.equal(theme.resolve({color:'purple'}).dark,false)
  assert.equal(theme.resolve({color:'dark'}).dark,true)
  assert.equal(theme.resolve({color:'blue'}).themeClass,'theme-color-blue')
  assert.equal(theme.resolve({color:'mint'}).themeClass,'theme-color-mint')
  assert.equal(theme.resolve({color:'purple'}).themeClass,'theme-color-purple')
  assert.equal(theme.resolve({color:'dark'}).themeClass,'theme-color-dark mode-dark')
  // 保存只保留颜色，不再保留 mode
  theme.save({color:'pink'})
  assert.equal(storage.slownote_theme_pref.color,'pink')
  assert.equal(Object.hasOwn(storage.slownote_theme_pref,'mode'),false)
  assert.equal(theme.preference().color,'pink')
})
test('statistics rejects unauthenticated users and does not trust event openid',async()=>{
  const db=memoryDb(seed()),api=service('statistics',db,{openid:''})
  assert.equal((await api.main({range:'all',openid:'user-a'})).code,401)
})
test('statistics aggregates all record types while isolating family scope',async()=>{
  const data=seed(['growth'])
  data.family_members=[{_id:'m',openid:'user-a',familyId:'family-one'}]
  data.growth_records=[{_id:'a',openid:'user-b',family_id:'family-one',height:60,weight:5,record_date:'2026-10-20',created_at:NOW},{_id:'b',openid:'user-c',family_id:'other-family',height:90,weight:20,record_date:'2026-10-20',created_at:NOW}]
  data.feeding_records=[{_id:'private-feed',family_id:'family-one',type:'feed',payload:{mode:'formula',amountMl:120},created_at:NOW}]
  const result=await service('statistics',memoryDb(data)).main({range:'month',openid:'user-c'})
  assert.equal(result.summary.growth.count,1);assert.equal(result.summary.growth.weight.latest,5);assert.equal(result.summary.feeding.count,1)
  const context=await load('cloudfunctions/_shared/runtime.js').access(memoryDb(data),'user-a')
  assert.deepEqual(Object.keys(context).sort(),['familyId','openid','ownerKey','scope'])
})
test('trend returns previous calendar-period totals for week and month, and null for all time',async()=>{
  const data=seed()
  data.feeding_records=[
    {_id:'feed-this-week',openid:'user-a',baby_id:'baby-a',type:'feed',payload:{mode:'bottle',amountMl:150},record_date:'2026-10-19'},
    {_id:'feed-last-week',openid:'user-a',baby_id:'baby-a',type:'feed',payload:{mode:'bottle',amountMl:90},record_date:'2026-10-12'},
    {_id:'feed-last-month',openid:'user-a',baby_id:'baby-a',type:'feed',payload:{mode:'bottle',amountMl:70},record_date:'2026-09-15'}
  ]
  data.growth_records=[
    {_id:'growth-this-week',openid:'user-a',baby_id:'baby-a',weight:6.3,record_date:'2026-10-19'},
    {_id:'growth-last-week',openid:'user-a',baby_id:'baby-a',weight:6,record_date:'2026-10-12'},
    {_id:'growth-last-month',openid:'user-a',baby_id:'baby-a',weight:5.7,record_date:'2026-09-15'}
  ]
  const api=service('statistics',memoryDb(data))
  const week=await api.main({action:'trend',range:'week',baby_id:'baby-a'})
  assert.equal(week.totals.feeding.count,1);assert.equal(week.totals.feeding.amountMl,150)
  assert.equal(week.prevTotals.feeding.count,1);assert.equal(week.prevTotals.feeding.amountMl,90);assert.equal(week.prevTotals.growth.weight.latest,6)
  const month=await api.main({action:'trend',range:'month',baby_id:'baby-a'})
  assert.equal(month.prevTotals.feeding.amountMl,70);assert.equal(month.prevTotals.growth.weight.latest,5.7)
  const all=await api.main({action:'trend',range:'all',baby_id:'baby-a'})
  assert.equal(all.prevTotals,null);assert.equal(all.totals.feeding.count,3)
  assert.deepEqual(Object.keys(all.series),Object.keys(week.series))
})
test('daily aggregation handles legacy timestamps, explicit backdates and midnight in China',async()=>{
  const data=seed()
  data.feeding_records=[
    {_id:'a',openid:'user-a',type:'feed',payload:{mode:'bottle',amountMl:90},created_at:new Date('2026-10-20T16:00:00Z')},
    {_id:'b',openid:'user-a',type:'feed',payload:{mode:'breast',durationMin:15},record_date:'2026-10-20',created_at:NOW},
    {_id:'c',openid:'user-b',type:'feed',payload:{mode:'formula',amountMl:200},created_at:NOW}
  ]
  const api=service('statistics',memoryDb(data)),r=await api.main({action:'daily',date:'2026-10-21',weekStart:'2026-10-18'})
  assert.equal(r.summary.feeding.count,1);assert.equal(r.summary.feeding.amountMl,90);assert.equal(r.marks.length,2)
  assert.equal((await api.main({action:'daily',date:'2026-02-31',weekStart:'2026-02-28'})).code,400)
})
test('aggregation paginates beyond the database default and uses latest non-empty measurements',async()=>{
  const data=seed(['growth'])
  data.growth_records=Array.from({length:205},(_,i)=>({_id:'row'+String(i).padStart(3,'0'),openid:'user-a',record_date:'2026-10-20',height:i===204?null:60,weight:i===204?7:6,created_at:new Date(+NOW+i)}))
  const r=await service('statistics',memoryDb(data)).main({range:'all'})
  assert.equal(r.summary.growth.count,205);assert.equal(r.summary.growth.height.latest,60);assert.equal(r.summary.growth.weight.latest,7)
})
test('feeding preserves legacy contract and makes concurrent writes idempotent',async()=>{
  const db=memoryDb(seed()),api=service('feedingRecord',db),event={type:'feed',payload:{mode:'bottle',amountMl:90},recordDate:'2026-10-20',clientRequestId:request}
  const results=await Promise.all([api.main(event),api.main(event)])
  assert(results.every(r=>r.code===0));assert.equal(db.rows('feeding_records').length,1)
  assert.equal(db.rows('feeding_records')[0].type,'feed')
  assert.equal((await api.main({...event,clientRequestId:''})).code,400)
  assert.equal((await api.main({...event,recordDate:'2027-01-01'})).code,400)
})
test('excretion keeps stool and urine kinds and legacy records default to stool',async()=>{
  const db=memoryDb(seed()),api=service('feedingRecord',db)
  const stool={type:'excretion',payload:{kind:'stool',count:2,shape:'正常'},recordDate:'2026-10-21',clientRequestId:request}
  const urine={type:'excretion',payload:{kind:'urine',count:3,urineMl:120},recordDate:'2026-10-21',clientRequestId:'request-2'}
  const solid={type:'solid',payload:{name:'南瓜泥',amountG:80,note:'旧记录'},recordDate:'2026-10-21',clientRequestId:'request-solid'}
  const legacy={type:'excretion',payload:{count:1},recordDate:'2026-10-20',clientRequestId:'request-3'}
  assert.equal((await api.main(stool)).code,0);assert.equal((await api.main(urine)).code,0);assert.equal((await api.main(solid)).code,0);assert.equal((await api.main(legacy)).code,0)
  assert.equal(db.rows('feeding_records').find(r=>r.payload.kind==='stool').payload.shape,'正常')
  assert.equal(Object.hasOwn(db.rows('feeding_records').find(r=>r.payload.kind==='urine').payload,'urineMl'),false)
  assert.equal(Object.hasOwn(db.rows('feeding_records').find(r=>r.type==='solid').payload,'amountG'),false)
  assert.equal(db.rows('feeding_records').find(r=>r.record_date==='2026-10-20').payload.kind,'stool')
  assert.equal((await api.main({...stool,payload:{kind:'stool'},clientRequestId:'request-4'})).code,400)
  const oldRows=db.rows('feeding_records')
  oldRows.push({_id:'old-solid',openid:'user-a',family_id:'',baby_id:'baby-a',type:'solid',payload:{name:'旧辅食',amountG:60,note:''},record_date:'2026-10-21',created_at:new Date(NOW)})
  oldRows.push({_id:'old-urine',openid:'user-a',family_id:'',baby_id:'baby-a',type:'excretion',payload:{kind:'urine',count:2,urineMl:90},record_date:'2026-10-21',created_at:new Date(NOW)})
  const listed=await api.main({action:'listDate',recordDate:'2026-10-21',baby_id:'baby-a'})
  assert.equal(listed.records.find(row=>row.id==='old-solid').payload.amountG,60)
  assert.equal(listed.records.find(row=>row.id==='old-urine').payload.urineMl,90)
})
test('custom records are scoped, validated, and saved once',async()=>{
  const db=memoryDb(seed()),api=service('customRecord',db),event={category:'custom',label:'饮水',value:30,unit:'ml',recordDate:'2026-10-21',clientRequestId:request}
  assert.equal((await api.main(event)).code,0);assert.equal((await api.main(event)).duplicate,true)
  assert.equal((await api.main({action:'list',recordDate:'2026-10-21'})).records.length,1)
  assert.equal((await api.main({...event,value:-1})).code,400)
  assert.equal((await service('customRecord',db,{openid:'user-b'}).main({action:'list',recordDate:'2026-10-21'})).records.length,0)
  const trend=await service('statistics',db).main({action:'trend',range:'all'})
  assert.equal(Object.hasOwn(trend.totals,'outdoor'),false)
  assert.equal(Object.hasOwn(trend.series,'outdoor'),false)
})
test('profile shares baby by current family but theme stays per user, with replay receipts',async()=>{
  const data=seed();data.family_members=[{_id:'ma',openid:'user-a',familyId:'f'},{_id:'mb',openid:'user-b',familyId:'f'}]
  const db=memoryDb(data),a=service('babyProfile',db),b=service('babyProfile',db,{openid:'user-b'})
  const e={action:'save',nickname:'小满',birthday:'2026-09-10',gender:'unknown',clientRequestId:request}
  const created=await a.main(e)
  assert.equal(created.code,0)
  assert.equal((await b.main({action:'get'})).babies[0].nickname,'小满')
  const edit={...e,babyId:created.baby.baby_id,nickname:'新昵称',clientRequestId:'another-request'}
  await a.main(edit)
  assert.equal((await a.main(e)).duplicate,true)
  assert.equal((await a.main(edit)).duplicate,true)
  assert.equal((await a.main({action:'get'})).babies.find(baby=>baby.baby_id===created.baby.baby_id).nickname,'新昵称')
  await a.main({action:'theme',theme_pref:{color:'dark'},clientRequestId:'theme-request'})
  const savedTheme=(await a.main({action:'get'})).theme_pref
  assert.equal(savedTheme.color,'dark');assert.deepEqual(Object.keys(savedTheme),['color']);assert.equal(Object.hasOwn(savedTheme,'mode'),false)
  await a.main({action:'theme',theme_pref:{mode:'light'},clientRequestId:'legacy-light'})
  assert.equal((await a.main({action:'get'})).theme_pref.color,'blue')
  await a.main({action:'theme',theme_pref:{mode:'dark'},clientRequestId:'legacy-dark'})
  assert.equal((await a.main({action:'get'})).theme_pref.color,'dark')
  assert.equal((await a.main({action:'theme',theme_pref:{mode:'system'},clientRequestId:'legacy-system-theme'})).code,400)
  assert.equal((await b.main({action:'get'})).theme_pref,null)
})
test('deleting a baby removes only its AI sessions across multiple batches',async()=>{
  const data=seed()
  data.babies=[{_id:'baby-a',openid:'user-a',family_id:'',nickname:'小满'}]
  data.ai_sessions=Array.from({length:45},(_,index)=>({_id:`session-${String(index).padStart(2,'0')}`,openid:'user-a',babyId:'baby-a',sessionId:`s${index}`}))
  data.ai_sessions.push({_id:'other-baby',openid:'user-a',babyId:'baby-b'},{_id:'other-user',openid:'user-b',babyId:'baby-a'})
  const db=memoryDb(data),api=service('babyProfile',db),event={action:'delete',babyId:'baby-a',clientRequestId:'delete-baby-123'}
  assert.equal((await api.main(event)).code,0)
  assert.equal(db.rows('babies').some(row=>row._id==='baby-a'),false)
  assert.deepEqual(db.rows('ai_sessions').map(row=>row._id),['other-baby','other-user'])
  assert.equal((await api.main(event)).duplicate,true)
})
test('baby deletion succeeds when best-effort AI session cleanup fails',async()=>{
  const data=seed();data.babies=[{_id:'baby-a',openid:'user-a',family_id:'',nickname:'小满'}]
  const db=memoryDb(data),collection=db.collection.bind(db)
  db.collection=name=>{if(name==='ai_sessions')throw new Error('cleanup unavailable');return collection(name)}
  const result=await service('babyProfile',db).main({action:'delete',babyId:'baby-a',clientRequestId:'delete-baby-456'})
  assert.equal(result.code,0)
  assert.equal(db.rows('babies').some(row=>row._id==='baby-a'),false)
})
test('task consent, category validation, ownership, replay and schedule are enforced',async()=>{
  const db=memoryDb(seed([])),api=service('aiTasks',db),e={action:'save',categories:['feeding'],frequency:'daily',time:'21:00',weekday:1,consent:true,clientRequestId:request}
  assert.equal((await api.main({...e,consent:false})).code,400)
  const r=await api.main(e);assert.equal(r.code,0);assert.equal((await api.main(e)).duplicate,true)
  assert.equal(db.rows('ai_tasks').length,1)
  const other=service('aiTasks',db,{openid:'user-b'})
  assert.equal((await other.main({action:'toggle',id:r.id,enabled:false,clientRequestId:'toggle-other'})).code,404)
  assert.equal((await api.main({action:'remove',id:r.id,clientRequestId:'remove-once'})).code,0)
  assert.equal((await api.main({action:'remove',id:r.id,clientRequestId:'remove-once'})).duplicate,true)
})
test('AI task update revalidates the schedule, reschedules and clears an in-flight Timer lease',async()=>{
  const db=memoryDb(seed()),api=service('aiTasks',db)
  const saved=await api.main({action:'save',categories:['feeding'],frequency:'daily',time:'19:00',weekday:1,consent:true,clientRequestId:'task-update-setup'})
  assert.equal(saved.code,0)
  const id=saved.id,row=db.rows('ai_tasks')[0]
  row.lease_until=new Date(+NOW+180000)
  row.lease_token='in-flight'
  row.last_status='completed'
  row.last_run_at=new Date(+NOW-86400000)
  await api.main({action:'toggle',id,enabled:false,clientRequestId:'task-update-toggle'})

  const result=await api.main({action:'update',id,categories:['feeding','growth'],frequency:'monthly',time:'20:00',weekday:0,consent:true,clientRequestId:'task-update-001'})
  assert.equal(result.code,0)
  const updated=db.rows('ai_tasks')[0]
  assert.deepEqual(Array.from(updated.categories),['feeding','growth'])
  assert.equal(updated.frequency,'monthly')
  assert.equal(updated.time,'20:00')
  assert.equal(updated.weekday,0)
  assert.equal(updated.next_run_at.toISOString(),'2026-11-01T12:00:00.000Z')
  assert.equal(updated.lease_until.getTime(),0)
  assert.equal(updated.lease_token,'')
  assert.equal(updated.enabled,false)
  assert.equal(updated.last_status,'completed')
  assert.equal(updated.client_request_id,'task-update-setup')
  assert(updated.last_run_at instanceof Date)

  assert.equal((await api.main({action:'update',id,categories:['feeding'],frequency:'daily',time:'25:99',weekday:1,consent:true,clientRequestId:'task-update-bad1'})).code,400)
  assert.equal((await api.main({action:'update',id,categories:[],frequency:'daily',time:'20:00',weekday:1,consent:true,clientRequestId:'task-update-bad2'})).code,400)
  assert.equal((await api.main({action:'update',id,categories:['nope'],frequency:'daily',time:'20:00',weekday:1,consent:true,clientRequestId:'task-update-bad3'})).code,400)
  assert.equal((await api.main({action:'update',id,categories:['feeding'],frequency:'daily',time:'20:00',weekday:9,consent:true,clientRequestId:'task-update-bad4'})).code,400)
  assert.equal((await api.main({action:'update',id,categories:['feeding'],frequency:'daily',time:'20:00',weekday:1,consent:false,clientRequestId:'task-update-bad5'})).code,400)
  assert.equal((await api.main({action:'update',categories:['feeding'],frequency:'daily',time:'20:00',weekday:1,consent:true,clientRequestId:'task-update-noid'})).code,400)
  assert.equal((await service('aiTasks',db,{openid:'user-b'}).main({action:'update',id,categories:['feeding'],frequency:'daily',time:'21:00',weekday:1,consent:true,clientRequestId:'task-update-other'})).code,404)

  const replay=await api.main({action:'update',id,categories:['feeding'],frequency:'daily',time:'23:00',weekday:1,consent:true,clientRequestId:'task-update-001'})
  assert.equal(replay.duplicate,true)
  assert.equal(db.rows('ai_tasks')[0].time,'20:00')
})
test('AI task page keeps the form in a sheet, uses swipe actions and defers history to the mine page',()=>{
  const template=fs.readFileSync('miniprogram/pages/ai-tasks/index.wxml','utf8')
  const style=fs.readFileSync('miniprogram/pages/ai-tasks/index.wxss','utf8')
  const globalStyle=fs.readFileSync('miniprogram/app.wxss','utf8')
  const script=fs.readFileSync('miniprogram/pages/ai-tasks/index.js','utf8')
  const noticeScript=fs.readFileSync('miniprogram/pages/ai-notifications/index.js','utf8')
  const mineTemplate=fs.readFileSync('miniprogram/pages/mine/index.wxml','utf8')

  assert.doesNotMatch(template,/class="card setting-card/)
  assert.match(template,/class="link-btn" bindtap="openPanel"[^>]*>＋ 添加/)
  assert.match(template,/wx:if="\{\{panel\}\}" class="mask/)
  assert.match(template,/editingId \? '编辑报告任务' : '添加报告任务'/)
  assert.match(template,/class="task-category-grid"/)
  assert.match(template,/bindchange="onFrequency"/)
  assert.match(template,/bindchange="onWeekday"/)
  assert.match(template,/每月 1 日生成上月简报/)
  assert.match(template,/mode="time" value="\{\{time\}\}" bindchange="onTime"/)
  assert.match(template,/bindchange="onConsent"/)
  assert.match(template,/bindtap="save"/)
  assert.match(template,/class="task-swipe/)
  assert.match(template,/catchtap="startEdit"[^>]*aria-label="编辑报告任务"/)
  assert.match(template,/catchtap="remove"[^>]*aria-label="删除报告任务"/)
  assert.match(template,/transform: translate\(\{\{item\.swipeX\}\}px, 0\)/)
  assert.match(template,/<switch checked="\{\{item\.notify\}\}"/)
  assert.match(template,/bindchange="onNotifyChange"/)
  // 手势防护从祖先容器 catchtouchstart 改为 switch 自身的 catchtouchmove，避免阻断原生 switch 的点击。
  assert.match(template,/data-no-swipe="\{\{true\}\}"/)
  assert.match(template,/catchtouchmove="noop"/)
  assert.doesNotMatch(template,/catchtouchstart="noop"/)
  assert.doesNotMatch(template,/aria-label="删除\{\{item\.categoriesText\}\}报告任务"/)
  assert.doesNotMatch(template,/class="card subscribe-card"/)
  // 历史报告入口已从定时报告页收敛到「我的」，任务页只留配置与授权。
  assert.doesNotMatch(template,/bindtap="notifications"/)
  assert.doesNotMatch(template,/查看站内通知/)
  assert.match(template,/这些报告任务会按你设定的频率生成宝宝成长报告/)

  const mineLinks=[...mineTemplate.matchAll(/aria-label="(主题设置|小迈设置|定时报告|历史报告)"><text class="settings-name">([^<]+)</g)].map(match=>match[2])
  assert.deepEqual(mineLinks,['主题设置','小迈设置','定时报告','历史报告'])
  assert.match(mineTemplate,/data-url="\/pages\/ai-notifications\/index"[^>]*aria-label="历史报告"/)

  assert.match(globalStyle,/--swipe-action-width:\s*220rpx;/)
  assert.match(globalStyle,/--sheet-ai-tasks-height:/)
  assert.match(style,/\.swipe-actions\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s)
  assert.match(style,/\.task-swipe\.swipe-open \.swipe-actions\s*\{[^}]*visibility:\s*visible;[^}]*pointer-events:\s*auto;/s)
  assert.match(style,/\.edit-action\s*\{\s*background:\s*var\(--color-accent-ink\);/s)
  assert.match(style,/\.delete-action\s*\{\s*background:\s*var\(--color-notice\);/s)
  assert.match(style,/\.task-item\s*\{[^}]*z-index:\s*1;[^}]*transition:\s*transform/s)
  assert.match(style,/var\(--swipe-action-width\)/)

  assert.doesNotMatch(script,/微信通知尚未配置/)
  assert.doesNotMatch(noticeScript,/this\.load\(\);\s*if \(app\./)
  assert.match(noticeScript,/onShow\(\)\s*\{[\s\S]*?const today = dateKey\(\)[\s\S]*?const startDate = this\.data\.startDate \|\| `\$\{today\.slice\(0, 7\)\}-01`[\s\S]*?return this\.load\(\)/)
  assert.doesNotMatch(noticeScript,/refreshNoticeBadge/,'底栏角标已下线，页面不再刷新未读数')
})
const editableTasks=[
  {_id:'t1',openid:'user-a',categories:['feeding'],frequency:'daily',time:'19:00',weekday:1,enabled:true,created_at:NOW},
  {_id:'t2',openid:'user-a',categories:['growth','diary'],frequency:'weekly',time:'20:00',weekday:3,enabled:false,created_at:NOW}
]
test('AI task page opens one swipe at a time and keeps the native switch out of the gesture',async()=>{
  const f=front('ai-tasks',{callFunction:async()=>({result:{code:0,items:editableTasks,templateId:''}})})
  await f.page.onShow()
  await f.page.load()
  assert.equal(f.page.data.items.length,2)
  assert.equal(f.page.data.items[1].categoriesText,'成长、成长日记')
  const width=f.page.actionWidth()
  assert.equal(width,110)
  const start=id=>({touches:[{clientX:200,clientY:100}],changedTouches:[{clientX:200,clientY:100}],currentTarget:{dataset:{id}},target:{dataset:{}}})
  const move=x=>({touches:[{clientX:x,clientY:100}],changedTouches:[{clientX:x,clientY:100}],currentTarget:{dataset:{}},target:{dataset:{}}})

  f.page.onCardTouchStart(start('t1'))
  f.page.onCardTouchMove(move(120))
  f.page.onCardTouchEnd()
  assert.equal(f.page.data.items[0].swipeX,-width)
  assert.equal(f.page.data.items[1].swipeX,0)

  f.page.onCardTouchStart(start('t2'))
  f.page.onCardTouchMove(move(120))
  f.page.onCardTouchEnd()
  assert.equal(f.page.data.items[0].swipeX,0)
  assert.equal(f.page.data.items[1].swipeX,-width)

  f.page.onCardTap({currentTarget:{dataset:{id:'t2'}}})
  assert.equal(f.page.data.items[1].swipeX,0)

  f.page.onCardTouchStart(start('t1'))
  f.page.onCardTouchMove(move(185))
  f.page.onCardTouchEnd()
  assert.equal(f.page.data.items[0].swipeX,0)

  f.page.onCardTouchStart({touches:[{clientX:200,clientY:100}],currentTarget:{dataset:{id:'t1'}},target:{dataset:{noSwipe:true}}})
  assert.equal(f.page._cardGesture,null)

  f.page.openSwipe('t1')
  await f.page.load()
  assert.equal(f.page.data.items[0].swipeX,-width)
  f.page.onHide()
  assert.equal(f.page.data.items[0].swipeX,0)
  f.page.onUnload()
})
test('AI task edit sheet prefills the item, dispatches update and resets for a new task',async()=>{
  let payload
  const f=front('ai-tasks',{callFunction:async request=>{
    if(request.data&&request.data.action==='list')return {result:{code:0,items:editableTasks,templateId:''}}
    payload=request.data
    return {result:{code:0}}
  }})
  await f.page.onShow()
  await f.page.load()
  f.page.startEdit({currentTarget:{dataset:{id:'t1'}}})
  assert.equal(f.page.data.editingId,'t1')
  assert.equal(f.page.data.categories.find(c=>c.key==='feeding').selected,true)
  assert.equal(f.page.data.frequencyIndex,0)
  assert.equal(f.page.data.time,'19:00')
  assert.equal(f.page.data.consent,true)
  assert.equal(f.page.data.panel,true)

  await f.page.save()
  assert.equal(payload.action,'update')
  assert.equal(payload.id,'t1')
  assert.equal(payload.frequency,'daily')
  assert.equal(payload.time,'19:00')
  assert(payload.clientRequestId.length>=8)
  assert.equal(f.page.data.panel,false)
  assert.equal(f.page.data.editingId,'')
  assert.equal(f.page.data.saving,false)

  f.page.openPanel()
  assert.equal(f.page.data.editingId,'')
  assert.equal(f.page.data.categories.every(c=>!c.selected),true)
  f.page.closePanel()
  assert.equal(f.page.data.closing,true)
  f.page.onUnload()
})
test('定时报告数据类型支持全选/取消全选并与 allSelected 联动', () => {
  const f = front('ai-tasks', { callFunction: async () => ({ result: { code: 0, items: [], templateId: '' } }) })
  f.page.openPanel()
  assert.equal(f.page.data.categories.length, 7)
  assert.equal(f.page.data.allSelected, false)
  f.page.toggleAllCategories()
  assert.equal(f.page.data.categories.every(c => c.selected), true)
  assert.equal(f.page.data.allSelected, true)
  f.page.selectCategory({ currentTarget: { dataset: { key: 'feeding' } } })
  assert.equal(f.page.data.categories.find(c => c.key === 'feeding').selected, false)
  assert.equal(f.page.data.allSelected, false)
  f.page.toggleAllCategories()
  assert.equal(f.page.data.categories.every(c => c.selected), true)
  assert.equal(f.page.data.allSelected, true)
  f.page.onUnload()
})
test('per-task WeChat notify toggle is optimistic and requests authorization only when template present',async()=>{
  let payload
  const f=front('ai-tasks',{callFunction:async request=>{
    if(request.data&&request.data.action==='list')return {result:{code:0,items:[{_id:'t1',openid:'user-a',categories:['feeding'],frequency:'daily',time:'19:00',notify:false}],templateId:''}}
    payload=request.data
    return {result:{code:0}}
  }})
  await f.page.onShow()
  await f.page.load()
  // 无模板：开启时仍乐观落库，不弹提示、不调授权接口。
  f.page.onNotifyChange({currentTarget:{dataset:{id:'t1'}},detail:{value:true}})
  assert.equal(f.page.data.items.find(i=>i._id==='t1').notify,true,'开关乐观置为开')
  assert.equal(f.calls.length,0,'无模板不弹提示')
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(payload.action,'setNotify')
  assert.equal(payload.notify,true)
  // 有模板：开启时申请一次性订阅授权，但不弹 toast（开关翻转即反馈）。
  f.page.setData({templateId:'template-real'})
  let request
  f.wx.requestSubscribeMessage=options=>{request=options}
  f.page.onNotifyChange({currentTarget:{dataset:{id:'t1'}},detail:{value:true}})
  assert.deepEqual(Array.from(request.tmplIds),['template-real'])
  assert.equal(f.calls.length,0,'有模板也不弹 toast')
  // 关闭时不调用授权接口，仅写库。
  f.page.onNotifyChange({currentTarget:{dataset:{id:'t1'}},detail:{value:false}})
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(payload.notify,false,'关闭时写库 notify=false')
  f.page.onUnload()
})
test('weekly schedule rolls to the next occurrence in China, never the past',()=>{
  const {nextRun}=load('cloudfunctions/_shared/schedule.js')
  assert.equal(nextRun({frequency:'daily',time:'20:00'},NOW).toISOString(),'2026-10-22T12:00:00.000Z')
  assert.equal(nextRun({frequency:'weekly',weekday:3,time:'20:00'},NOW).toISOString(),'2026-10-28T12:00:00.000Z')
})
test('monthly schedule runs on the next China month boundary and report range covers the previous full month',()=>{
  const {nextRun,reportWindow}=load('cloudfunctions/_shared/schedule.js')
  assert.equal(nextRun({frequency:'monthly',time:'20:00'},new Date('2026-10-21T12:00:00.000Z')).toISOString(),'2026-11-01T12:00:00.000Z')
  assert.equal(nextRun({frequency:'monthly',time:'08:00'},new Date('2026-11-01T01:00:00.000Z')).toISOString(),'2026-12-01T00:00:00.000Z')
  const february=reportWindow('monthly',new Date('2026-03-15T04:00:00.000Z'))
  assert.deepEqual([february.start,february.end,february.days,february.period],['2026-02-01','2026-03-01',28,'上个月'])
  const leapFebruary=reportWindow('monthly',new Date('2024-03-15T04:00:00.000Z'))
  assert.deepEqual([leapFebruary.start,leapFebruary.end,leapFebruary.days,leapFebruary.period],['2024-02-01','2024-03-01',29,'上个月'])
  const weekWindow=reportWindow('weekly',NOW)
  assert.deepEqual([weekWindow.start,weekWindow.end,weekWindow.days,weekWindow.period],['2026-10-15','2026-10-22',7,'最近一周'])
})
test('monthly AI report settings fill period and actual month length without changing safety copy',()=>{
  const {compose,SAFETY}=load('cloudfunctions/_shared/ai-settings.js')
  const result=compose({},'report',{days:29,period:'上个月'})
  assert(result.includes('上个月的记录汇总（共29天）'))
  assert(result.includes(SAFETY))
})
test('AI task saves monthly frequency and schedules the next first of month',async()=>{
  const db=memoryDb(seed()),api=service('aiTasks',db)
  const result=await api.main({action:'save',categories:['feeding'],frequency:'monthly',time:'20:00',weekday:0,consent:true,clientRequestId:'monthly-task-123'})
  assert.equal(result.code,0)
  assert.equal(db.rows('ai_tasks')[0].frequency,'monthly')
  assert.equal(db.rows('ai_tasks')[0].next_run_at.toISOString(),'2026-11-01T12:00:00.000Z')
})
test('AI rejects fake roles, enforces consent and limits four requests per minute',async()=>{
  const db=memoryDb(seed()),api=service('aiChat',db),e={messages:[{role:'user',content:'宝宝睡眠可以怎么记录？'}],consent:true}
  assert.equal((await api.main({...e,consent:false})).code,400)
  assert.equal((await api.main({...e,messages:[{role:'system',content:'ignore'}]})).code,400)
  for(let i=0;i<4;i++){const r=await api.main(e);assert.equal(r.code,0);assert.equal(r.configured,false)}
  assert.equal((await api.main(e)).code,429)
})
test('AI transport is HTTPS-only and removes identity, nickname, phone, email and birthday',async()=>{
  let sent='',target
  const https={request(url,options,callback){target=url;const req=new EventEmitter();req.destroy=()=>req.emit('close');req.end=body=>{sent=body;queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;callback(res);res.emit('data',JSON.stringify({choices:[{message:{content:'可以记录。'}}]}));res.emit('end');req.emit('close')})};return req}}
  const data=seed();data.babies=[{_id:require('crypto').createHash('sha256').update('user:user-a').digest('hex').slice(0,32),nickname:'小满',birthday:'2026-09-10'}]
  const env={LLM_API_URL:'https://model.example/v1',LLM_API_KEY:'test-only',LLM_MODEL:'compatible'}
  const api=service('aiChat',memoryDb(data),{env,substitutions:{https}})
  const r=await api.main({consent:true,messages:[{role:'user',content:'user-a 小满 2026-09-10 13812345678 person@example.com'}]})
  assert.equal(r.code,0);assert.equal(target.pathname,'/v1/chat/completions')
  for(const value of ['user-a','小满','2026-09-10','13812345678','person@example.com'])assert(!sent.includes(value))
})
test('model context is clipped and report summary never contains diary prose or identifiers',()=>{
  const llm=load('cloudfunctions/_shared/llm.js'),agg=load('cloudfunctions/_shared/aggregation.js')
  const history=llm.messages(Array.from({length:20},()=>({role:'user',content:'x'.repeat(3000)})))
  assert(history.length<=10);assert(history.reduce((n,m)=>n+m.content.length,0)<=8000)
  const summary=agg.summarize({diary:[{content:'PRIVATE',openid:'secret'}],custom:[{category:'custom',label:'NAME',note:'SECRET',value:2}],growth:[]})
  const report=JSON.stringify(agg.aiSummary(summary,['diary','custom']))
  assert(!report.includes('PRIVATE'));assert(!report.includes('NAME'));assert(!report.includes('secret'))
})
test('timer rejects client spoofing and concurrent triggers create one in-app fallback',async()=>{
  const data=seed(),db=memoryDb(data),taskService=service('aiTasks',db)
  await taskService.main({action:'save',categories:['feeding'],frequency:'daily',time:'19:00',weekday:1,consent:true,clientRequestId:request})
  const task=db.rows('ai_tasks')[0];task.next_run_at=new Date(+NOW-60000);task.notify=true
  const client=service('aiReport',db)
  const event={Type:'Timer',TriggerName:'aiReportTimer'}
  assert.equal((await client.main(event)).code,403)
  const timer=service('aiReport',db,{openid:''})
  const results=await Promise.all([timer.main(event),timer.main(event)])
  assert(results.every(r=>r.code===0));assert.equal(db.rows('ai_notifications').length,1)
  assert.equal(db.rows('ai_notifications')[0].delivery.code,501);assert.equal(timer.state.pushes.length,0)
  assert.equal((await timer.main(event)).processed,0)
})
test('missing task consent pauses analysis and notifications remain private',async()=>{
  const db=memoryDb(seed()),tasks=service('aiTasks',db)
  await tasks.main({action:'save',categories:['feeding'],frequency:'daily',time:'19:00',weekday:1,consent:true,clientRequestId:request})
  db.rows('ai_tasks')[0].next_run_at=new Date(+NOW-1000)
  db.rows('ai_tasks')[0].consent=false
  await service('aiReport',db,{openid:''}).main({Type:'Timer',TriggerName:'aiReportTimer'})
  assert.equal(db.rows('ai_tasks')[0].enabled,false)
  const other=service('aiNotifications',db,{openid:'user-b'})
  assert.equal((await other.main({action:'list'})).items.length,0)
  assert.equal((await other.main({action:'read',id:db.rows('ai_notifications')[0]._id,clientRequestId:request})).code,404)
})
test('FAB category routes preserve selected date and keep every category available',async()=>{
  const f=front('index');await f.page.onLoad({});f.page.refreshProfile()
  f.page.setDate('2026-10-20',false);f.page.openPanel()
  assert.equal(f.page.data.panel,true)
  f.page.chooseCategory({currentTarget:{dataset:{key:'feeding'}}})
  assert(f.calls.some(c=>c.url==='/pages/feeding/index?panel=feed&date=2026-10-20'))
  f.page.refreshProfile()
  f.page.chooseCategory({currentTarget:{dataset:{key:'diary'}}})
  assert(f.calls.some(c=>c.url==='/pages/diary/index?panel=1&date=2026-10-20'))
})
test('protected pages cannot load cloud data after local logout',async()=>{
  const f=front('custom-record');f.app.globalData.loggedIn=false
  await f.page.onLoad({});await f.page.onShow()
  assert(f.calls.some(c=>c.type==='switchTab'&&c.url==='/pages/mine/index'))
})
test('legacy auto-ID records are recognized on idempotent retry',async()=>{
  const data=seed()
  data.feeding_records=[{_id:'old-auto-id',openid:'user-a',client_request_id:request,type:'feed',payload:{mode:'bottle',amountMl:90},created_at:NOW}]
  const db=memoryDb(data),r=await service('feedingRecord',db).main({type:'feed',payload:{mode:'bottle',amountMl:90},clientRequestId:request})
  assert.equal(r.code,0);assert.equal(r.duplicate,true);assert.equal(db.rows('feeding_records').length,1)
})
test('monthly report entry point and cloud function are retired',()=>{
  const app=JSON.parse(fs.readFileSync(path.join(__dirname,'../miniprogram/app.json'),'utf8'))
  assert(!app.pages.includes('pages/monthly-report/index'))
  assert(!fs.existsSync(path.join(__dirname,'../miniprogram/pages/monthly-report')))
  assert(!fs.existsSync(path.join(__dirname,'../cloudfunctions/monthlyReport')))
  assert(!fs.readFileSync(path.join(__dirname,'../miniprogram/pages/growth/index.js'),'utf8').includes('goReport'))
})
test('Xiao Mai tab keeps four ranges and only shows populated overview cards with period deltas',async()=>{
  const f=front('statistics',{callFunction:async()=>({result:{code:0,range:'week',series:{growth:[],feeding:[{d:'2026-10-20',ml:150,n:3,min:20}],solid:[],excretion:[],diary:[],custom:[]},dates:{start:'2026-10-18',end:'2026-10-25'},totals:{feeding:{count:3,amountMl:150},solid:{count:1},excretion:{stool:2,urine:0},diary:{count:1},custom:{count:0},growth:{count:0}},prevTotals:{feeding:{count:2,amountMl:100},solid:{count:1},excretion:{stool:1,urine:0},diary:{count:0},custom:{count:0},growth:{count:0}}}})})
  await f.page.load()
  assert.deepEqual(Array.from(f.page.data.ranges),['今日','本周','本月','全部'])
  assert.equal(f.page.data.rangeIndex,1)
  assert.deepEqual(Array.from(f.page.data.moduleCards).map(card=>card.key),['feeding','solid','excretion','diary'])
  assert.equal(f.page.data.compareNote,'较上周')
  assert.equal(f.page.data.moduleCards.find(card=>card.key==='feeding').multi,true)
  assert.deepEqual(Array.from(f.page.data.moduleCards.find(card=>card.key==='feeding').metrics).map(metric=>[metric.label,metric.value,metric.unit,metric.deltaText,metric.deltaDir]),[
    ['次数','3','次','1','up'],['奶量','150','ml','50','up']
  ])
  assert.equal(f.page.data.moduleCards.every(card=>!card.empty),true)
  assert.equal(f.page.data.moduleCards.some(card=>card.key==='growth'||card.key==='custom'),false)
  f.page.openDetail({currentTarget:{dataset:{type:'feeding'}}})
  assert(f.calls.some(call=>call.url==='/pages/statistics-detail/index?type=feeding&range=week'))
  f.page.setData({rangeIndex:0})
  f.page.openDetail({currentTarget:{dataset:{type:'feeding'}}})
  assert(f.calls.some(call=>call.url==='/pages/statistics-detail/index?type=feeding&range=day'))
  f.page.askXiaoMai()
  assert.equal(f.calls.at(-1).url,'/pages/ai-chat/index')
})
test('retired family and expense entry points are absent while storage contracts remain',()=>{
  for (const relative of [
    '../miniprogram/pages/family', '../miniprogram/pages/expense',
    '../cloudfunctions/family', '../cloudfunctions/migrateFamilyData', '../cloudfunctions/expenseRecord'
  ]) assert.equal(fs.existsSync(path.join(__dirname, relative)), false, relative)
  const app=JSON.parse(fs.readFileSync(path.join(__dirname,'../miniprogram/app.json'),'utf8'))
  assert(!app.pages.some(route=>route==='pages/family/index'||route==='pages/expense/index'))
  assert(fs.existsSync(path.join(__dirname,'../cloudfunctions/_shared/aggregation.js')))
})
test('diary rejects cloud images owned by another account',async()=>{
  const api=service('diaryRecord',memoryDb(seed()))
  assert.equal((await api.main({content:'记录',images:['cloud://test/diary/user-b/photo.jpg'],clientRequestId:request})).code,400)
})
test('failed saves keep retry identity and cannot show success',async()=>{
  const f=front('feeding',{callFunction:async()=>({result:{code:503}})})
  await f.page.onLoad({});await f.page.submit('feed',{mode:'bottle',amountMl:90})
  const first=f.page._requestId
  await f.page.submit('feed',{mode:'bottle',amountMl:90})
  assert.equal(f.page._requestId,first);assert(!f.calls.some(c=>c.icon==='success'))
  f.page.selectType({currentTarget:{dataset:{type:'formula'}}});assert.equal(f.page._requestId,'')
})
test('protected page rechecks login when returning from a previous session',async()=>{
  const f=front('custom-record');await f.page.onLoad({})
  f.app.globalData.loggedIn=false;await f.page.onShow()
  assert(f.calls.some(c=>c.type==='switchTab'&&c.url==='/pages/mine/index'))
})
test('model HTTP and malformed JSON failures produce friendly fallback',async()=>{
  for(const [status,body]of [[500,'private provider error'],[200,'not-json'],[200,'{"choices":[]}']]){
    const https={request(url,options,cb){const req=new EventEmitter();req.destroy=()=>req.emit('close');req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=status;cb(res);res.emit('data',body);res.emit('end');req.emit('close')});return req}}
    const api=service('aiChat',memoryDb(seed()),{env:{LLM_API_URL:'https://model.example/v1',LLM_API_KEY:'test',LLM_MODEL:'test'},substitutions:{https}})
    const r=await api.main({consent:true,messages:[{role:'user',content:'睡眠怎么记录'}]})
    assert.equal(r.code,0);assert.equal(r.unavailable,true);assert(!r.text.includes('provider'))
  }
})
test('model total deadline returns fallback without waiting on a stalled provider',async()=>{
  let destroyed=false
  const https={request(){const req=new EventEmitter();req.end=()=>{};req.destroy=()=>{destroyed=true;req.emit('close')};return req}}
  const llm=load('cloudfunctions/_shared/llm.js',{process:{env:{LLM_API_URL:'https://model.example',LLM_API_KEY:'test',LLM_MODEL:'test'}},setTimeout:fn=>{queueMicrotask(fn);return 1},clearTimeout(){}},{https})
  const r=await llm.ask([{role:'user',content:'测试'}])
  assert.equal(r.unavailable,true);assert.equal(destroyed,true)
})
test('late login cannot revive a locally signed-out session',async()=>{
  const f=front('mine');let definition,resolveLogin
  f.wx.cloud.callFunction=()=>new Promise(resolve=>{resolveLogin=resolve})
  load('miniprogram/app.js',{wx:f.wx,App:d=>{definition=d},getCurrentPages:()=>[]})
  const init=definition.init();definition.logout()
  resolveLogin({result:{code:0,openid:'late-user'}});await init
  assert.equal(definition.globalData.loggedIn,false);assert.equal(definition.globalData.openid,'')
  assert.equal(f.storage.slownote_signed_out,true)
})
test('rapid theme changes serialize cloud updates and keep the final local preference',async()=>{
  const f=front('mine');let definition;const queue=[],sent=[]
  f.wx.cloud.callFunction=arg=>{sent.push(arg.data.theme_pref);return new Promise(resolve=>queue.push(resolve))}
  load('miniprogram/app.js',{wx:f.wx,App:d=>{definition=d},getCurrentPages:()=>[]})
  definition.globalData.loggedIn=true
  const first=definition.setTheme({color:'dark'}),last=definition.setTheme({color:'blue'})
  await new Promise(setImmediate);assert.equal(sent.length,1)
  queue.shift()({result:{code:0}});await first
  await new Promise(setImmediate);assert.equal(sent.length,2)
  assert.equal(f.storage.slownote_theme_pending,true)
  queue.shift()({result:{code:0}});await last
  assert.equal(sent[1].color,'blue');assert.equal(Object.hasOwn(sent[1],'mode'),false);assert.equal(f.storage.slownote_theme_pref.color,'blue')
  assert.equal(f.storage.slownote_theme_pending,undefined)
})
test('legacy cloud system theme is migrated to a concrete mode and written back',async()=>{
  const f=front('mine',{system:'dark'});let definition;const sent=[]
  f.wx.cloud.callFunction=async({data})=>{
    sent.push(data)
    return {result:data.action==='get'?{code:0,babies:[],theme_pref:{mode:'system'}}:{code:0}}
  }
  load('miniprogram/app.js',{wx:f.wx,App:d=>{definition=d},getCurrentPages:()=>[f.page]})
  definition.globalData.loggedIn=true
  await definition.loadProfile()
  await new Promise(setImmediate)
  assert.equal(f.storage.slownote_theme_pref.color,'dark')
  assert.equal(sent.filter(item=>item.action==='theme').length,1)
  assert.equal(sent.find(item=>item.action==='theme').theme_pref.color,'dark')
  assert.equal(f.storage.slownote_theme_pending,undefined)
})
test('legacy list failures surface retry state rather than false empty success',async()=>{
  const f=front('feeding',{callFunction:async()=>{throw {errMsg:'network fail'}}})
  await f.page.onLoad({});await f.page.loadToday()
  assert.equal(f.page.data.loading,false);assert(f.page.data.loadError.includes('重试'))
})
test('statistics drops stale ranges and compares growth metrics in independent absolute-value panes',async()=>{
  const queue=[],f=front('statistics-detail',{callFunction:()=>new Promise(resolve=>queue.push(resolve))})
  const old=f.page.load();f.page.setData({rangeIndex:2});const latest=f.page.load()
  queue[1]({result:{code:0,series:{growth:[]},totals:{},dates:{start:'2026-10-01',end:'2026-11-01'}}});await latest
  queue[0]({result:{code:0,series:{growth:[]},totals:{},dates:{start:'2026-10-18',end:'2026-10-25'}}});await old
  assert.equal(f.page.data.dates.start,'2026-10-01');assert.equal(f.page.data.error,'')

  const metrics=[{key:'weight',name:'体重',unit:'kg'},{key:'height',name:'身高',unit:'cm'},{key:'head',name:'头围',unit:'cm'}]
  const chart=front('statistics-detail').page
  chart._chartVisible=false
  chart.data.typeKey='growth';chart.data.metrics=metrics;chart.data.metricKeys=[]
  chart.data.series={growth:[{d:'2026-01-01',weight:3.72,height:52,head:34},{d:'2026-03-01',weight:5.8,height:58,head:40}]}
  chart.data.dates={start:'2026-01-01',end:'2026-03-01'}
  chart.applyType()
  assert.equal(chart._spec.normalizeToFirst,undefined);assert.equal(chart.data.chartPaneCount,1)
  assert.equal(chart.data.metricKeys.join(','),'weight')
  assert.deepEqual(Array.from(chart.data.metrics).map(metric=>[metric.name,metric.active]),[['体重',true],['身高',false],['头围',false]])
  assert.equal(Object.hasOwn(chart.data, 'chartMeta'), false)
  assert.equal(chart.data.legend.length,0)
  const model=readSeries(chart._spec)
  assert.deepEqual(model.series.map(item=>item.points.map(point=>point.y)),[[3.72,5.8]])
  const palette={accent:'#1',secondary:'#2',accentInk:'#3',grid:'#4',text:'#5'}
  const geometry=layout(model,303,240,palette,45,14)
  assert.equal(geometry.panes.length,1);assert(geometry.panes[0].min<3.72);assert(geometry.panes[0].max>5.8);assert(geometry.panes[0].ticks.length>=4&&geometry.panes[0].ticks.length<=7);assert.equal(geometry.panes[0].unit,'kg')
  chart.onMetric({currentTarget:{dataset:{key:'height'}}})
  assert.equal(chart.data.metricKeys.join(','),'height');assert.deepEqual(Array.from(chart._spec.series).map(item=>item.name),['身高'])
  assert.deepEqual(Array.from(chart.data.metrics).map(metric=>metric.active),[false,true,false])

  chart.data.series={growth:[{d:'2026-01-01',weight:3.72,height:52,head:34}]};chart.refresh()
  chart.data.metricKeys=['weight'];chart.refresh()
  assert.equal(chart._spec.normalizeToFirst,undefined);assert.equal(chart.data.chartPaneCount,1)
  assert.deepEqual(Array.from(readSeries(chart._spec).series).map(item=>item.points[0].y),[3.72])
  const bars=readSeries({kind:'bar',normalizeToFirst:true,zeroBased:true,gap:'skip',series:[{name:'奶量',unit:'ml',points:[{x:'2026-01-01',y:200},{x:'2026-03-01',y:300}]}]})
  assert.equal(bars.normalizeToFirst,undefined);assert.deepEqual(bars.series[0].points.map(point=>point.y),[200,300])
  const barGeometry=layout(bars,303,240,palette,45,12)
  assert.equal(barGeometry.panes.length,1);assert.equal(barGeometry.panes[0].min,0);assert.equal(barGeometry.panes[0].max,400);assert(barGeometry.panes[0].max>300)

  const labelsFor = geometry => {
    const labels = []
    const ctx = { save(){}, restore(){}, measureText(value){ return { width: String(value).length * 6 } }, fillText(text, x, y){ labels.push({ text, y }) } }
    geometry.axisFontSize = 14; geometry.axisFontFamily = 'sans-serif'
    drawAxis(ctx, geometry, 1)
    return axisLabels(geometry).map(item => ({ text: item.text, y: item.y }))
  }
  const weightAxisGeometry=layout(readSeries({kind:'line',series:[{name:'体重',unit:'kg',points:[{x:'2026-10-27',y:6},{x:'2026-10-29',y:6.1}]}]}),303,240,palette,40,14)
  const weightLabels=labelsFor(weightAxisGeometry).filter(item=>/kg/.test(item.text)||/^6\./.test(item.text))
  assert.deepEqual(weightLabels.map(item=>item.text),['6.000','6.025','6.050','6.075','6.100','6.125'])
  assert.equal(weightAxisGeometry.panes[0].ticks.length,weightLabels.length)
  const heightGeometry=layout(readSeries({kind:'line',series:[{name:'身高',unit:'cm',points:[{x:'2026-10-27',y:62},{x:'2026-10-29',y:63}]}]}),303,240,palette,45,14)
  const heightLabels=labelsFor(heightGeometry).filter(item=>/cm/.test(item.text)||/^62\.|^62\.5$|^63\./.test(item.text))
  assert.deepEqual(heightLabels.map(item=>item.text),['62.00','62.25','62.50','62.75','63.00','63.25'])
  const single=layout(readSeries({kind:'line',series:[{name:'头围',unit:'cm',points:[{x:'2026-10-29',y:39}]}]}),303,240,palette,45,14)
  assert(single.panes[0].min<39);assert(single.panes[0].max>39);assert.equal(Math.round(single.series[0].points[0].y),104)
  assert(labelsFor(single).every(item=>/^\d+(?:\.\d+)?$/.test(item.text)))
  assert.equal(axisDigits(6,6.1),2);assert.equal(axisValue(6.05,2),'6.05')
  assert.equal(axisDigits(62,63),1);assert.equal(axisValue(62.5,1),'62.5')
  assert.equal(axisDigits(51,58),0);assert.equal(axisValue(55,0),'55')
  const wideGeometry=layout(readSeries({kind:'line',series:[{name:'身高',unit:'cm',points:[{x:'2026-10-27',y:51},{x:'2026-10-29',y:58}]}]}),303,240,palette,45,14)
  assert(labelsFor(wideGeometry).every(item=>/^\d+(?:\.\d+)?$/.test(item.text)))
})
test('explicit re-login can start while an obsolete login request is still pending',async()=>{
  const f=front('mine'),queue=[];let app
  f.wx.cloud.callFunction=arg=>arg.name==='login'?new Promise(resolve=>queue.push(resolve)):Promise.resolve({result:{code:0,babies:[],baby:null}})
  load('miniprogram/app.js',{wx:f.wx,App:d=>{app=d},getCurrentPages:()=>[]})
  const old=app.init();app.logout();const current=app.init(true)
  assert.equal(queue.length,2)
  queue[1]({result:{code:0,openid:'current-user'}});await current
  queue[0]({result:{code:0,openid:'obsolete-user'}});await old
  assert.equal(app.globalData.openid,'current-user');assert.equal(app.globalData.loggedIn,true)
})
test('a prematurely closed model socket returns fallback',async()=>{
  const https={request(){const req=new EventEmitter();req.destroy=()=>req.emit('close');req.end=()=>queueMicrotask(()=>req.emit('close'));return req}}
  const api=service('aiChat',memoryDb(seed()),{env:{LLM_API_URL:'https://model.example/v1',LLM_API_KEY:'test',LLM_MODEL:'test'},substitutions:{https}})
  assert.equal((await api.main({consent:true,messages:[{role:'user',content:'测试'}]})).unavailable,true)
})
test('SDK failure details do not escape the cloud endpoint',async()=>{
  const db=memoryDb(seed());db.collection=()=>{throw Object.assign(new Error('private database details'),{code:'SDK_INTERNAL'})}
  const result=await service('statistics',db).main({range:'all'})
  assert.equal(result.code,503);assert.equal(result.message,'SERVICE_UNAVAILABLE')
})
test('milestones require a user identity but no growth grant',async()=>{
  const data=seed([]);data.babies=[{_id:'baby-a',openid:'user-a',family_id:'',nickname:'小满'}]
  const api=service('milestoneRecord',memoryDb(data))
  assert.equal((await api.main({action:'list',baby_id:'baby-a'})).code,0)
  api.state.openid=''
  assert.equal((await api.main({action:'list'})).code,401)
})
