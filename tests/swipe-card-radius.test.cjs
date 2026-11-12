const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), path = require('path')

const root = path.join(__dirname, '..', 'miniprogram')
const pageStyle = name => fs.readFileSync(path.join(root, 'pages', name, 'index.wxss'), 'utf8')
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const rule = (text, selector) => {
  const matched = new RegExp('^' + escape(selector) + '\\s*\\{([^}]*)\\}', 'm').exec(text)
  assert.ok(matched, `应存在 ${selector} 规则`)
  return matched[1]
}

// 常用问题是基准：内层卡片直角，圆角由外层容器统一裁切。
const lists = [
  { name: '常用问题', dir: 'ai-settings', wrap: '.question-swipe', card: '.question-item' },
  { name: '定时报告任务', dir: 'ai-tasks', wrap: '.task-swipe', card: '.task-item' },
  { name: '宝宝信息', dir: 'baby', wrap: '.baby-swipe', card: '.baby-row' },
  { name: '成长里程碑', dir: 'milestone', wrap: '.milestone-swipe', card: '.milestone' },
  { name: '历史对话', dir: 'ai-history', wrap: '.history-swipe', card: '.history-item' },
  { name: '历史报告', dir: 'ai-notifications', wrap: '.report-swipe', card: '.report-card' }
]

for (const { name, dir, wrap, card } of lists) {
  test(`${name}：左滑卡片圆角由外层容器统一裁切，内层不留右侧圆角`, () => {
    const style = pageStyle(dir)
    const outer = rule(style, wrap)
    const inner = rule(style, card)
    assert.match(outer, /border-radius:\s*var\(--radius\)/, '外层容器负责整卡圆角')
    assert.match(outer, /overflow:\s*hidden/, '外层容器裁切内层直角')
    assert.match(outer, /background:\s*var\(--color-surface\)/, '滑开后不露出页面渐变底色')
    assert.match(outer, /isolation:\s*isolate/, '隔离层级，删除按钮不盖住卡片')
    assert.match(inner, /border-radius:\s*0\s*;/, '内层卡片须为直角，否则左滑后右缘留弧形缺口')
    assert.doesNotMatch(inner, /border-radius:\s*var\(--radius\)/)
  })
}

test('历史报告内层卡片覆盖全局 .card 的圆角与阴影', () => {
  const app = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
  assert.match(rule(app, '.card'), /border-radius:\s*var\(--radius\)/)
  assert.match(rule(app, '.card'), /box-shadow:\s*var\(--shadow-card\)/)
  const card = rule(pageStyle('ai-notifications'), '.report-card')
  assert.match(card, /border-radius:\s*0\s*;/, '必须覆盖 .card 的圆角')
  assert.match(card, /box-shadow:\s*none/, '左滑时右缘阴影会压在删除按钮上，须去掉')
})

test('删除动作区保留右侧圆角，与外层裁切边缘一致', () => {
  for (const { dir, wrap } of lists) {
    const style = pageStyle(dir)
    assert.match(style, /border-radius:\s*0 var\(--radius\) var\(--radius\) 0/, `${dir} 动作区右侧圆角`)
    assert.ok(rule(style, wrap), `${dir} 外层容器存在`)
  }
})
