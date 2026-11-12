const test = require('node:test'), assert = require('node:assert/strict')
const { load, front } = require('./helpers.cjs')
const { ageMonth } = require('../miniprogram/utils/date')

test('ageMonth returns integer months including zero and rejects invalid or out-of-range birthdays', () => {
  const cases = [
    ['2026-10-21', '2026-10-21', 0], ['2026-09-21', '2026-10-20', 0], ['2026-09-21', '2026-10-21', 1],
    ['2026-06-21', '2026-10-21', 4], ['2023-10-21', '2026-10-21', 36], ['2023-10-21', '2026-11-21', null],
    ['', '2026-10-21', null], ['2027-01-01', '2026-10-21', null], ['2026-02-30', '2026-10-21', null]
  ]
  for (const [birthday, today, expected] of cases) assert.equal(ageMonth(birthday, today), expected, birthday + ' / ' + today)
})

test('milestone overview counts one integer month and caches per baby and birthday', async () => {
  let calls = 0
  const f = front('index', { callFunction: async request => {
    if (request.name === 'milestoneRecord') {
      calls++
      return { result: { code: 0, milestones: [
        { key: 'a', month: 1, done: true }, { key: 'b', month: 1, done: false }, { key: 'c', month: 2, done: true }
      ] } }
    }
    return { result: { code: 0, summary: {}, marks: [] } }
  } })
  f.app.globalData.loggedIn = true; f.app.globalData.activeBabyId = 'baby-a'; f.app.globalData.baby = { baby_id: 'baby-a', birthday: '2026-09-10' }
  const overview = load('miniprogram/utils/milestone-overview.js', { wx: f.wx, getApp: () => f.app })
  const result = await overview.load()
  assert.deepEqual({ month: result.month, done: result.done, total: result.total }, { month: 1, done: 1, total: 2 })
  await overview.load(); assert.equal(calls, 1)
  overview.invalidate(); await overview.load(); assert.equal(calls, 2)
  f.page.onUnload()
})

test('home and growth show integer month counts outside daily record cards', async () => {
  const milestones = [{ key: 'head', month: 1, done: true }, { key: 'smile', month: 1, done: false }]
  let milestoneCalls = 0
  const callFunction = async request => {
    if (request.name === 'milestoneRecord') { milestoneCalls++; return { result: { code: 0, milestones, months: Array.from({ length: 36 }, (_, index) => index + 1) } } }
    return { result: { code: 0, summary: {}, marks: [] } }
  }
  const home = front('index', { callFunction })
  home.app.globalData.loggedIn = true; home.app.globalData.activeBabyId = 'baby-a'; home.app.globalData.baby = { baby_id: 'baby-a', birthday: '2026-09-10' }
  await home.page.onLoad({}); await home.page.onShow(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(home.page.data.milestoneEntry.label, '1月龄成长里程碑：已达成 1/2 项')
  assert(!home.page.data.cards.some(card => card.key === 'milestone'))
  const growth = front('growth', { app: home.app, callFunction })
  await growth.page.onLoad({}); await growth.page.onShow(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(growth.page.data.milestoneEntry.label, home.page.data.milestoneEntry.label)
  assert.equal(milestoneCalls, 1)
  const homeTemplate = require('node:fs').readFileSync('miniprogram/pages/index/index.wxml', 'utf8')
  const growthTemplate = require('node:fs').readFileSync('miniprogram/pages/growth/index.wxml', 'utf8')
  assert.match(homeTemplate, /class="milestone-entry home-milestone-entry"[^>]*bindtap="openMilestones"/)
  assert.match(growthTemplate, /class="milestone-entry"[^>]*bindtap="goMilestone"/)
  assert(!homeTemplate.includes('发育里程碑'))
  assert(!growthTemplate.includes('发育里程碑'))
  home.page.onUnload(); growth.page.onUnload()
})

test('milestone page offers 36 monthly steps, default month selection, management actions and circle check controls', () => {
  const f = front('milestone')
  const fs = require('node:fs')
  f.app.globalData.baby = { birthday: '2026-09-10' }
  return f.page.onShow().then(() => {
  const template = require('node:fs').readFileSync('miniprogram/pages/milestone/index.wxml', 'utf8')
  assert.equal(f.page.data.months.length, 36)
  assert.equal(f.page.data.activeMonth, 1)
  assert.equal(f.page.data.monthScrollInto, 'month-1')
  assert.match(template, /wx:for="\{\{months\}\}"/)
  assert.match(template, /class="heading-actions"[\s\S]*?class="link-btn" bindtap="startAdd"[\s\S]*?＋ 添加/)
  assert.doesNotMatch(template, /record-fab|fab-plus/)
  assert.doesNotMatch(template, /class="add-milestone"/)
  assert.match(template, /catchtap="startEdit"/)
  assert.match(template, /catchtap="confirmRemoveDefinition"/)
  assert.match(template, /aria-label="删除">删除<\/button>/)
  assert.doesNotMatch(template, /catchtouchstart="noop"[^>]*catchtap="startEdit"|catchtouchstart="noop"[^>]*catchtap="confirmRemoveDefinition"/)
  assert.match(template, /bindlongpress="beginDrag"/)
  assert.match(template, /bindtouchmove="onCardTouchMove"/)
  assert.match(template, /catchtap="check"/)
  assert.match(template, /catchtap="uncheck"/)
  assert.match(template, /catchtap="startEdit"/)
  assert.match(template, /catchtap="confirmRemoveDefinition"/)
  assert.match(template, /bindtouchend="onMonthSwipeEnd"/)
  assert.match(template, /class="section" bindtouchstart="onMonthSwipeStart" bindtouchend="onMonthSwipeEnd"/)
  assert.match(template, /class="heading-actions"[\s\S]*?class="link-btn" bindtap="startAdd"[\s\S]*?＋ 添加/)
  assert.match(template, /bindtap="toggleDone"/)
  assert.doesNotMatch(template, /成长里程碑详情|openSheet|closeSheet|wx:if="\{\{sheet/)
  assert.doesNotMatch(template, /bindtap="toggleManage"|bindtap="moveItem"/)
  assert.doesNotMatch(template, /toggleManage|moveItem|recordDate\}\}.*picker|记录达成.*button|取消打卡.*button/)
  assert.doesNotMatch(template, /<text>打卡<\/text>/)
  const style = fs.readFileSync('miniprogram/pages/milestone/index.wxss', 'utf8')
  assert.match(style, /prefers-reduced-motion/)
  assert.match(style, /data:image\/svg\+xml/)
  assert.match(style, /\.swipe-actions\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s)
  assert.match(style, /\.milestone-swipe\.swipe-open \.swipe-actions\s*\{[^}]*visibility:\s*visible;[^}]*pointer-events:\s*auto;/s)
  assert.match(style, /\.done-check\.pending \.done-check-mark\s*\{\s*display:\s*none;/)
  assert.match(style, /\.done-check::before\s*\{[^}]*inset:\s*calc\(\(var\(--control-height\) - var\(--icon-size\)\) \/ -2\)/)
  assert.match(style, /\.milestone\s*\{[^}]*min-height:\s*var\(--row-height\);[^}]*padding:\s*var\(--space-sm\) var\(--space-m\)/s)
  assert.match(template, /class="input definition-input"/)
  assert.match(template, /class="select-value pressable">\{\{domains\[domainIndex\]\}\}/)
  assert.match(template, /class="select-value pressable">\{\{formMonth\}\} 月龄/)
  assert.doesNotMatch(style, /\.date-row\s*\{/)
  assert.doesNotMatch(style, /url\(['"]?\.\.\/.*\.svg/)
  assert.match(style, /\.swipe-actions\s*\{[^}]*top:\s*0;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*left:\s*auto;/s)
  assert.match(style, /\.milestone\s*\{[^}]*z-index:\s*1;[^}]*background:\s*var\(--color-surface\);/s)
  f.page.onUnload()
  })
})

test('milestone list cache skips a warm request, invalidation reloads it, and refresh keeps visible rows', async () => {
  let calls = 0
  const milestones = [{ key: 'smile', month: 1, name: '会微笑', domain: '社交', sort_order: 0, done: false }]
  const f = front('milestone', { callFunction: async request => {
    if (request.data.action !== 'list') return { result: { code: 0 } }
    calls += 1
    return { result: { code: 0, months: Array.from({ length: 36 }, (_, index) => index + 1), milestones } }
  } })
  f.app.globalData.activeBabyId = 'baby-a'
  f.app.globalData.baby = { birthday: '2026-09-10' }

  await f.page.load()
  assert.equal(calls, 1)
  const cacheKey = Object.keys(f.storage).find(key => key.startsWith('slownote.cache.v1:milestone:'))
  assert(cacheKey)
  assert.deepEqual(JSON.parse(cacheKey.slice('slownote.cache.v1:milestone:'.length)), { babyId: 'baby-a' })
  let loadingStartCount = 0
  const setData = f.page.setData.bind(f.page)
  f.page.setData = (updates, done) => {
    if (updates.loading === true) loadingStartCount += 1
    setData(updates, done)
  }

  await f.page.load()
  assert.equal(calls, 1, 'a fresh cache avoids a second list request')
  assert.equal(loadingStartCount, 0)

  f.page.invalidateData()
  await f.page.load()
  assert.equal(calls, 2, 'invalidating the milestone scope forces a new list request')

  f.page.setData({ loading: false })
  const refresh = f.page.load(true)
  assert.equal(f.page.data.loading, false, 'refresh retains loaded rows without entering the skeleton state')
  assert.equal(f.page.data.visible[0].key, 'smile')
  await refresh
  assert.equal(calls, 3)
  assert.equal(loadingStartCount, 0)
  const retained = f.page.data.visible
  f.wx.cloud.callFunction = async () => { throw new Error('offline') }
  await f.page.load(true)
  assert.deepEqual(f.page.data.visible, retained, 'an offline refresh keeps the last milestone rows')
  assert(f.calls.some(call => call.type === 'toast'))
  f.page.onUnload()
})

test('baby birthday uses the native date picker and no longer registers the wheel picker', () => {
  const fs = require('node:fs')
  const template = fs.readFileSync('miniprogram/pages/baby/index.wxml', 'utf8')
  const config = JSON.parse(fs.readFileSync('miniprogram/pages/baby/index.json', 'utf8'))
  assert.match(template, /<picker mode="date" value="\{\{baby\.birthday\}\}" end="\{\{today\}\}" disabled="\{\{saving\}\}" bindchange="onBirthday"/)
  assert.equal(Object.hasOwn(config.usingComponents || {}, 'wheel-date-picker'), false)
})
