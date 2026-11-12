// Offline consistency checks; WeChat compiler and device checks remain separate.
const fs = require('fs'), path = require('path'), vm = require('vm')
const root = path.join(__dirname, '..'), errors = []
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
function files(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e =>
    e.name === 'node_modules' ? [] : e.isDirectory() ? files(dir + '/' + e.name) : [dir + '/' + e.name])
}
const sources = [...files('miniprogram'), ...files('cloudfunctions'), ...files('scripts')]
let javascript = 0, json = 0
for (const file of sources) {
  try {
    if (file.endsWith('.js')) { new vm.Script(read(file), { filename: file }); javascript++ }
    if (file.endsWith('.json')) { JSON.parse(read(file)); json++ }
  } catch (error) { errors.push(file + ': ' + error.message) }
}
const app = JSON.parse(read('miniprogram/app.json'))
const tabs = app.tabBar.list.map(t => t.pagePath)
if (!app.darkmode || app.themeLocation !== 'theme.json' || !app.tabBar.custom || tabs.join(',') !== 'pages/index/index,pages/statistics/index,pages/mine/index') errors.push('App theme/tab configuration differs from product structure')
const css = read('miniprogram/app.wxss')
const tokens = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]))
const { front } = require('../tests/helpers.cjs')
for (const page of app.pages) {
  const base = 'miniprogram/' + page
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) if (!fs.existsSync(path.join(root, base + ext))) errors.push('Missing ' + base + ext)
  const wxml = read(base + '.wxml'), style = read(base + '.wxss')
  const stack = []
  for (const match of wxml.matchAll(/<!--[\s\S]*?-->|<\/?[a-z][\w-]*(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    const tag = match[0]
    if (tag.startsWith('<!--')) continue
    const name = tag.match(/^<\/?([\w-]+)/)[1]
    if (tag.startsWith('</')) { if (stack.pop() !== name) errors.push(base + ': unbalanced ' + tag) }
    else if (!tag.endsWith('/>')) stack.push(name)
  }
  if (stack.length) errors.push(base + ': unclosed ' + stack.join(','))
  if (!wxml.includes('theme-root {{themeClass}}')) errors.push(base + ': missing themed root')
  const definition = front(page.split('/')[1]).page
  for (const binding of wxml.matchAll(/(?:bind|catch)(?::)?(?:tap|input|change|submit|blur|focus|confirm)\s*=\s*"([^"]+)"/g)) {
    if (typeof definition[binding[1]] !== 'function') errors.push(base + ': missing handler ' + binding[1])
  }
  if (/{{[^}]*\.\w+\s*\(/.test(wxml)) errors.push(base + ': WXML method call')
  for (const m of style.matchAll(/var\((--[\w-]+)/g)) if (!tokens.has(m[1])) errors.push(base + ': undefined token ' + m[1])
  if (/#[a-f\d]{3,8}\b|rgba?\(|\b\d+(?:rpx|px)\b/i.test(style)) errors.push(base + ': hardcoded visual value')
}
for (const directory of fs.readdirSync(path.join(root, 'cloudfunctions'))) {
  const lib = path.join(root, 'cloudfunctions', directory, 'lib')
  if (!fs.existsSync(lib)) continue
  for (const file of ['runtime.js', 'aggregation.js', 'llm.js', 'schedule.js', 'ai-settings.js']) {
    if (read('cloudfunctions/' + directory + '/lib/' + file) !== read('cloudfunctions/_shared/' + file)) errors.push(directory + ': stale shared ' + file)
  }
}
for (const doc of ['prd/slownote-prd.md', 'rules/frontend-standard.md', 'rules/project-structure.md', 'rules/introduction.md', 'database-design.md', 'deployment-checklist.md']) {
  if (!fs.existsSync(path.join(root, 'docs', doc))) errors.push('Missing document ' + doc)
}
console.log(JSON.stringify({ javascript, json, pages: app.pages.length, tabs: tabs.length, errors }, null, 2))
if (errors.length) process.exitCode = 1
