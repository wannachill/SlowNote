const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const { front } = require('./helpers.cjs')

test('记录快照默认折叠为五行并可在气泡内展开或收起', () => {
  const f = front('ai-chat')
  const snapshot = Array.from({ length: 9 }, (_, index) => `2026-10-${String(21 - index).padStart(2, '0')}｜里程碑｜事项 ${index + 1}`).join('\n')
  f.page.data.messages = [{ id: 'user-1', role: 'user', content: '最近有什么新进步', snapshot }]
  let views = f.page._messageViews(f.page.data.messages)
  assert.equal(views[0].snapshotPreview.split('\n').length, 5)
  assert.equal(views[0].snapshotHasMore, true)
  assert.equal(views[0].snapshotExpanded, false)

  f.page.toggleSnapshot({ currentTarget: { dataset: { i: 0 } } })
  assert.equal(f.page.data.messageViews[0].snapshotExpanded, true)
  assert.equal(f.page.data.messageViews[0].snapshot, snapshot)
  f.page.toggleSnapshot({ currentTarget: { dataset: { i: 0 } } })
  assert.equal(f.page.data.messageViews[0].snapshotExpanded, false)
})

test('快照折叠按钮保留主题令牌并限制气泡预览行数', () => {
  const wxml = fs.readFileSync('miniprogram/pages/ai-chat/index.wxml', 'utf8')
  const wxss = fs.readFileSync('miniprogram/pages/ai-chat/index.wxss', 'utf8')
  assert.equal((wxml.match(/catchtap="toggleSnapshot"/g) || []).length, 2)
  assert.match(wxml, /item\.snapshotExpanded \? item\.snapshot : item\.snapshotPreview/)
  assert.match(wxss, /-webkit-line-clamp:\s*5/)
  assert.match(wxss, /color:\s*var\(--color-accent-ink\)/)
})
