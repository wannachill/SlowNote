const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { load } = require('./helpers.cjs')

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('隐私政策页已注册、有入口且为免登录公开页', () => {
  const appJson = JSON.parse(read('miniprogram/app.json'))
  assert.ok(appJson.pages.includes('pages/privacy/index'), 'app.json 需注册隐私政策页')
  const mine = read('miniprogram/pages/mine/index.wxml')
  assert.match(mine, /data-url="\/pages\/privacy\/index"/)
  assert.match(mine, /aria-label="隐私政策"/)
  const pageUtils = read('miniprogram/utils/page.js')
  assert.match(pageUtils, /PUBLIC_PAGES[\s\S]*'pages\/privacy\/index'/, '隐私政策须登录前可查看')
  assert.match(pageUtils, /PUBLIC_PAGES\.includes\(this\.route\)/)
})

test('隐私政策正文覆盖合规必需条款，小程序与文档口径一致', () => {
  const content = read('miniprogram/utils/privacy-content.js')
  const doc = read('docs/legal/privacy-policy.md')
  for (const text of [content, doc]) {
    assert.match(text, /不收集微信号、微信昵称、头像、手机号/)
    assert.match(text, /DeepSeek/)
    assert.match(text, /硅基流动/, '语音转写第三方服务商须在政策与小程序正文同时写明')
    assert.match(text, /模型训练/)
    assert.match(text, /中华人民共和国境内|中国境内/)
    assert.match(text, /7 个工作日/)
    assert.match(text, /转写完成后删除/)
    assert.match(text, /14 岁以下/)
    assert.match(text, /录音用于语音识别|长按输入框|临时音频/)
  }
  const { SECTIONS } = load('miniprogram/utils/privacy-content.js')
  assert.equal(SECTIONS.length, 9)
  for (const section of SECTIONS) {
    assert.ok(section.title && section.paragraphs.length > 0)
    for (const line of section.paragraphs) assert.ok(typeof line === 'string' && line.trim())
  }
})

test('隐私政策页复用主题与设计令牌，不硬编码颜色', () => {
  const wxml = read('miniprogram/pages/privacy/index.wxml')
  const wxss = read('miniprogram/pages/privacy/index.wxss')
  assert.match(wxml, /class="theme-root \{\{themeClass\}\} page/)
  assert.match(wxml, /class="sub-nav"/)
  assert.match(wxml, /wx:for="\{\{sections\}\}"/)
  assert.match(wxml, /\{\{contactLabel\}\}/)
  assert.match(wxss, /var\(--color-text-2\)/)
  assert.match(wxss, /var\(--font-body\)/)
  assert.doesNotMatch(wxss, /#[0-9a-fA-F]{3,8}/)
})

test('合规占位符已清除，联系邮箱未公示时 #15 不得勾选', () => {
  const { CONTACT_EMAIL } = load('miniprogram/utils/privacy-content.js')
  const doc = read('docs/legal/privacy-policy.md')
  const checklist = read('docs/release-checklist.md')
  assert.doesNotMatch(read('docs/prd/slownote-prd.md'), /\[待补充：上线前确认\]/)
  assert.doesNotMatch(read('docs/database-design.md'), /\[待补充：上线前确认\]/)
  const checked = /^- \[x\] \*\*#15/m.test(checklist)
  const placeholder = CONTACT_EMAIL === '' || /CONTACT_EMAIL/.test(doc)
  assert.equal(checked, !placeholder, '联系邮箱补齐后需替换两处占位并勾选 #15；未补齐时不得勾选')
})
