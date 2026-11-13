const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const exists = file => fs.existsSync(path.join(root, file))

test('智能提醒整条链路已下线，不残留页面、云函数与定时器', () => {
  const app = JSON.parse(read('miniprogram/app.json'))
  assert.ok(!app.pages.some(item => item.startsWith('pages/reminder')), 'app.json 不应注册提醒页')
  assert.ok(!app.pages.some(item => item.startsWith('pages/push')), '信息推送中转页也应移除')
  assert.equal(exists('miniprogram/pages/reminder'), false, '提醒页目录应删除')
  assert.equal(exists('miniprogram/pages/push'), false, '信息推送中转页目录应删除')
  assert.equal(exists('cloudfunctions/reminderRecord'), false, 'reminderRecord 云函数应删除')
  assert.equal(exists('tests/reminder-schedule.test.cjs'), false, '提醒调度测试应删除')

  const sync = read('scripts/sync-cloud-runtime.js')
  assert.doesNotMatch(sync, /reminderRecord/, '共享库同步清单不应再含 reminderRecord')

  const appWxss = read('miniprogram/app.wxss')
  assert.doesNotMatch(appWxss, /--sheet-reminder-height/, '提醒弹层高度令牌应清理')
  assert.doesNotMatch(appWxss, /\.icon-reminder/, '提醒图标样式应清理')
})

test('「我的」页入口直连定时报告，不再经过中转页', () => {
  const mine = read('miniprogram/pages/mine/index.wxml')
  assert.match(mine, /data-url="\/pages\/ai-tasks\/index"[^>]*aria-label="定时报告"/)
  assert.match(mine, /<text class="settings-name">定时报告<\/text>/)
  assert.doesNotMatch(mine, /pages\/push/, '不应再指向已删除的中转页')
  assert.doesNotMatch(mine, /信息推送/, '入口名不应再叫信息推送')
})

test('定时报告页面文案与数据模型保持自洽', () => {
  const wxml = read('miniprogram/pages/ai-tasks/index.wxml')
  const js = read('miniprogram/pages/ai-tasks/index.js')
  assert.match(wxml, /<text class="sub-nav-title">定时报告<\/text>/)
  assert.match(wxml, /报告任务/)
  assert.match(wxml, /数据类型/)
  assert.match(wxml, /bindtap="toggleAllCategories"/)
  assert.match(wxml, /class="text-action task-all-action"/)
  assert.match(wxml, /aria-label="报告时间"/)
  assert.doesNotMatch(wxml, /定时分析|分析任务|分析类目/, '不应残留旧功能名')
  assert.match(js, /定时报告：报告任务管理/)

  const notifications = read('miniprogram/pages/ai-notifications/index.wxml')
  assert.match(notifications, /<text class="sub-nav-title">历史报告<\/text>/)
  assert.doesNotMatch(notifications, /小迈 · 通知|报告通知/)
})

test('云端推送文案使用「定时报告」，不再出现旧名称', () => {
  const report = read('cloudfunctions/aiReport/index.js')
  assert.match(report, /小迈定时报告/)
  assert.match(report, /title: revoked \? '报告任务已暂停' : \(task\.report_title \|\| '小迈定时报告'\)/, '通知标题取任务填写的报告标题，未填写时回退默认')
  assert.doesNotMatch(report, /小迈的成长分析/, '旧推送标题应替换')
})

test('文档不再把智能提醒写成现有功能', () => {
  const prd = read('docs/prd/slownote-prd.md')
  assert.match(prd, /\| 定时报告 \|/)
  assert.doesNotMatch(prd, /\| 小迈定时分析 \|/)
  assert.doesNotMatch(prd, /信息推送\/小迈配置入口/)

  const structure = read('docs/rules/project-structure.md')
  assert.match(structure, /当前 19 个页面/)
  assert.match(structure, /15 个可调用函数/)
  assert.doesNotMatch(structure, /reminder-schedule\.test\.cjs/)
})
