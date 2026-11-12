const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), path = require('path')
const { front } = require('./helpers.cjs')

const dir = path.join(__dirname, '..', 'miniprogram', 'pages', 'ai-history')
const wxml = fs.readFileSync(path.join(dir, 'index.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(dir, 'index.wxss'), 'utf8')
const js = fs.readFileSync(path.join(dir, 'index.js'), 'utf8')

const rows = () => [
  { sessionId: 'a', title: 'A', timeText: '今天 09:00', swipeX: 0 },
  { sessionId: 'b', title: 'B', timeText: '昨天 18:00', swipeX: 0 }
]

test('历史对话改为左滑露出删除，不再常显删除图标', () => {
  assert.match(wxml, /class="history-swipe \{\{item\.swipeX \? 'swipe-open' : ''\}\}"/)
  assert.match(wxml, /class="swipe-action delete-action"[^>]*catchtap="onRemove"/)
  assert.match(wxml, /bindtouchstart="onCardTouchStart"/)
  assert.match(wxml, /bindtouchmove="onCardTouchMove"/)
  assert.match(wxml, /bindtouchend="onCardTouchEnd"/)
  assert.match(wxml, /bindtouchcancel="onCardTouchEnd"/)
  assert.match(wxml, /style="transform: translate\(\{\{item\.swipeX\}\}px, 0\);?"/)
  assert.match(wxml, /aria-label="删除对话\{\{item\.title\}\}"/)
  assert.match(wxml, /aria-label="查看对话\{\{item\.title\}\}"/)
  assert.doesNotMatch(wxml, /history-remove|record-delete-symbol/)
  assert.doesNotMatch(wxml, /左滑可删除|可添加、编辑或删除/)
})

test('删除动作宽度与历史报告一致，样式沿用设计 token', () => {
  assert.match(js, /ACTION_WIDTH_RPX = 110/)
  assert.match(js, /setListItemFields|setListFields/)
  assert.match(wxss, /width: calc\(var\(--swipe-action-width\) \/ 2\)/)
  assert.match(wxss, /transition: transform var\(--motion-feedback\) var\(--curve-spring\)/)
  assert.match(wxss, /background: var\(--color-notice\)/)
  assert.doesNotMatch(wxss, /\.history-remove/)
})

test('左滑打开与收起只改动当前行的 swipeX', () => {
  const { page } = front('ai-history')
  const list = rows()
  page.setData({ list })
  const first = page.data.list[0]
  page.onCardTouchStart({ currentTarget: { dataset: { id: 'b' } }, touches: [{ clientX: 200, clientY: 50 }] })
  page.onCardTouchMove({ touches: [{ clientX: 100, clientY: 50 }] })
  assert.ok(page.data.list[1].swipeX < 0)
  assert.equal(page.data.list[0], first, '未滑动的行不应被替换')
  page.onCardTouchEnd()
  assert.equal(page.data.list[1].swipeX, -page.actionWidth())
  assert.equal(page._openSwipeKey, 'b')
  page.closeSwipe()
  assert.equal(page.data.list[1].swipeX, 0)
  assert.equal(page._openSwipeKey, '')
})

test('纵向滚动不被横向手势劫持', () => {
  const { page } = front('ai-history')
  page.setData({ list: rows() })
  page.onCardTouchStart({ currentTarget: { dataset: { id: 'b' } }, touches: [{ clientX: 200, clientY: 50 }] })
  page.onCardTouchMove({ touches: [{ clientX: 202, clientY: 140 }] })
  assert.equal(page.data.list[1].swipeX, 0)
  page.onCardTouchEnd()
  assert.equal(page.data.list[1].swipeX, 0)
})

test('已滑开的卡片点击只收起，不载入对话', () => {
  const { page, wx } = front('ai-history')
  wx.navigateBack = () => { throw new Error('收起时不该返回上一页') }
  const list = rows()
  list[0].swipeX = -20
  page.setData({ list })
  page.onSelect({ currentTarget: { dataset: { id: 'a' } } })
  assert.equal(page.data.list[0].swipeX, 0)
})

test('未滑开时点击照常载入对话，删除仍走二次确认', () => {
  const { page, wx } = front('ai-history')
  let emitted = null, back = 0
  page.getOpenerEventChannel = () => ({ emit: (name, id) => { emitted = { name, id } } })
  wx.navigateBack = () => { back += 1 }
  page.setData({ list: rows() })
  page.onSelect({ currentTarget: { dataset: { id: 'a' } } })
  assert.deepEqual(emitted, { name: 'select', id: 'a' })
  assert.equal(back, 1)
  assert.match(js, /confirmDanger/)
  assert.match(js, /title: '删除对话'/)
  assert.match(js, /content: '删除后无法恢复，确定删除这段对话吗？'/)
})
