const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), path = require('path')

const root = path.join(__dirname, '..')
const pagesRoot = path.join(root, 'miniprogram', 'pages')

function wxmlFiles(dir = pagesRoot) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return wxmlFiles(full)
    return entry.name.endsWith('.wxml') ? [full] : []
  })
}

const templates = wxmlFiles().map(file => ({
  file: path.relative(root, file).replace(/\\/g, '/'),
  text: fs.readFileSync(file, 'utf8')
}))
const allTemplates = templates.map(item => item.text).join('\n')

// 禁用清单与理由见 docs/rules/frontend-standard.md §4.1：界面自明的动作说明、自述/营销式长句。
const FORBIDDEN = [
  '可添加、编辑或删除',
  '左滑可删除',
  '点卡片切换当前宝宝',
  '点右上方添加',
  '使用提示',
  '可维护多个宝宝',
  '完善宝宝的昵称、生日与性别',
  '选择数据类型、数据范围与报告频率',
  '这一天的第一笔，从这里开始',
  '去首页记下宝宝的第一笔记录',
  '添加一项符合宝宝情况的观察目标',
  '随时提问，也可以添加照片',
  '稍后就能在首页看到',
  '控制小迈聊天页是否显示深度思考入口',
  '决定小迈怎么组织和表达回答，不影响固定安全规则'
]

test('页面模板不含界面自明的操作说明与自述式长句', () => {
  assert.ok(templates.length >= 15, '应扫描到全部页面模板')
  for (const page of ['ai-tasks', 'ai-settings', 'ai-notifications', 'baby', 'statistics', 'feeding', 'solid', 'excretion']) {
    assert.ok(templates.some(item => item.file.includes(`pages/${page}/index.wxml`)), `未扫描到 ${page}`)
  }
  for (const { file, text } of templates) {
    for (const phrase of FORBIDDEN) {
      assert.ok(!text.includes(phrase), `${file} 仍含冗余文案「${phrase}」`)
    }
  }
})

test('顶部提示卡一句话说完，不超过 40 字', () => {
  const tips = templates.flatMap(({ file, text }) =>
    [...text.matchAll(/<view class="page-tip">([\s\S]*?)<\/view>/g)].map(match => ({ file, text: match[1].trim() })))
  assert.ok(tips.length >= 1, '至少保留一处页面关键行为说明')
  for (const tip of tips) {
    assert.ok(tip.text.length > 0 && tip.text.length <= 40, `${tip.file} 提示过长：${tip.text.length} 字`)
  }
})

test('合规告知、数据限制与变量说明不参与精简', () => {
  const tasks = fs.readFileSync(path.join(pagesRoot, 'ai-tasks', 'index.wxml'), 'utf8')
  assert.match(tasks, /同意将所选数据类型的记录明细发送给第三方 AI 服务商/)
  assert.match(tasks, /可能包含日记正文、里程碑事项及辅食或自定义备注/)
  assert.match(tasks, /不发送姓名、生日原文、照片或身份标识/)
  assert.match(tasks, /AI 生成，仅供参考/)
  assert.match(tasks, /每月 1 日生成上月简报，数据范围固定为上月整月/)

  const settings = fs.readFileSync(path.join(pagesRoot, 'ai-settings', 'index.wxml'), 'utf8')
  assert.match(settings, /\{days\}/)
  assert.match(settings, /\{period\}/)
  assert.match(settings, /小迈不能联网/)
  assert.match(settings, /这部分不可修改/)
})

test('错误、空状态与重试引导仍保留，只是不叠加重复说明', () => {
  assert.match(allTemplates, /重试/)
  assert.match(allTemplates, /暂无|还没有|没有该类型的记录/)
  assert.match(allTemplates, /去首页记一笔/)
  assert.match(allTemplates, /换个日期范围试试/)
  assert.match(allTemplates, /role="alert"/)
})

test('精简后不留无用节点与样式', () => {
  assert.doesNotMatch(allTemplates, /baby-hint-title|empty-guide-copy/)
  const babyStyle = fs.readFileSync(path.join(pagesRoot, 'baby', 'index.wxss'), 'utf8')
  const statsStyle = fs.readFileSync(path.join(pagesRoot, 'statistics', 'index.wxss'), 'utf8')
  assert.doesNotMatch(babyStyle, /\.baby-hint-title/)
  assert.doesNotMatch(statsStyle, /\.empty-guide-copy/)
})
