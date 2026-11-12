const test = require('node:test')
const assert = require('node:assert/strict')
const markdown = require('../miniprogram/utils/markdown.js')
const { front } = require('./helpers.cjs')
const toNodes = markdown.parseMarkdown

function allNodes(nodes) {
  return (nodes || []).flatMap(node => [node, ...allNodes(node.children)])
}

test('renders bold text as a strong node', () => {
  const nodes = toNodes('这是 **重点**。')
  assert.equal(allNodes(nodes).some(node => node.name === 'strong'), true)
})

test('renders italic text as an em node', () => {
  const nodes = toNodes('这是 *提示*。')
  assert.equal(allNodes(nodes).some(node => node.name === 'em'), true)
})

test('renders inline code as a code node', () => {
  const nodes = toNodes('运行 `npm test`。')
  assert.equal(allNodes(nodes).some(node => node.name === 'code'), true)
})

test('renders unordered list items with the markdown list class', () => {
  const nodes = toNodes('- 第一项\n- 第二项')
  assert.equal(nodes.filter(node => node.attrs && node.attrs.class.includes('md-list-item')).length, 2)
})

test('renders ordered list items while keeping their numbers', () => {
  const nodes = toNodes('1. 先做\n2. 再做')
  const text = JSON.stringify(nodes)
  assert.match(text, /1\. 先做/)
  assert.match(text, /2\. 再做/)
})

test('downgrades links, rules, tables and code fences without leaking markers', () => {
  const nodes = toNodes('[文字](https://example.com)\n---\n| a | b |\n| --- | --- |\n```\ncode\n```')
  const json = JSON.stringify(nodes)
  assert.match(json, /文字/)
  assert.doesNotMatch(json, /https:\/\/example\.com/)
  assert.doesNotMatch(json, /---/)
  assert.doesNotMatch(json, /\|/)
  assert.doesNotMatch(json, /`/)
})

test('long-press opens message actions and copy uses the complete source text', async () => {
  const f = front('ai-chat')
  await f.page.onLoad()
  const original = '**粗体**\n- 原文列表'
  f.page.data.messages = [{ id: 'answer-1', role: 'assistant', content: original }]
  let copied = ''
  f.wx.setClipboardData = options => { copied = options.data; options.success() }
  f.page.showMessageActions({ currentTarget: { dataset: { i: 0 } } })
  assert.equal(f.page.data.activeMessageId, 'answer-1')
  assert.equal(copied, '')
  f.page.copyMessage({ currentTarget: { dataset: { i: 0 } } })
  assert.equal(copied, original)
  assert.equal(f.page.data.activeMessageId, '')
  assert.equal(f.calls.some(call => call.type === 'toast' && call.title === '已复制'), true)
})

test('re-asking from an assistant message uses its preceding user question', async () => {
  const f = front('ai-chat')
  await f.page.onLoad()
  f.page.data.messages = [
    { id: 'question-1', role: 'user', content: '最近三天喂养怎么样？' },
    { id: 'answer-1', role: 'assistant', content: '原回答' }
  ]
  let resent
  f.page.send = async (question, range) => { resent = { question, range } }
  f.page.showMessageActions({ currentTarget: { dataset: { i: 1 } } })
  await f.page.askAgain({ currentTarget: { dataset: { i: 1 } } })
  assert.deepEqual(resent, { question: '最近三天喂养怎么样？', range: '3d' })
  assert.equal(f.page.data.activeMessageId, '')
})

test('re-asking confirms before replacing an unsent composer draft', async () => {
  const f = front('ai-chat')
  await f.page.onLoad()
  f.page.data.messages = [{ id: 'question-1', role: 'user', content: '今天睡了多久？' }]
  f.page.setData({ question: '手动草稿', images: [{ id: 'photo-1' }] })
  let resent
  f.page.send = async (question, range) => { resent = { question, range } }
  f.wx.showModal = options => options.success({ confirm: false })
  await f.page.askAgain({ currentTarget: { dataset: { i: 0 } } })
  assert.equal(f.page.data.question, '手动草稿')
  assert.equal(f.page.data.images.length, 1)
  assert.equal(resent, undefined)

  f.wx.showModal = options => options.success({ confirm: true })
  await f.page.askAgain({ currentTarget: { dataset: { i: 0 } } })
  assert.equal(f.page.data.question, '')
  assert.equal(f.page.data.images.length, 0)
  assert.deepEqual(resent, { question: '今天睡了多久？', range: 'day' })
})
