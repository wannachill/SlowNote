const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const { load } = require('./helpers.cjs')

const settings = load('cloudfunctions/_shared/ai-settings.js')
const storedOf = prompts => ({ showThinking: true, prompts })

test('默认提示词包含本轮新增的关键约束', () => {
  const { SAFETY, DEFAULTS } = settings
  assert.match(SAFETY, /未附带的类别不推断/)
  assert.match(SAFETY, /背景只在明确给出时使用，不自行推算/)
  assert.match(SAFETY, /不输出用户标识、文件标识/)
  assert.doesNotMatch(SAFETY, /不推断年龄或健康结论/, '与 aiChat 主动注入月龄的实现冲突，已移除')
  assert.match(DEFAULTS.style, /结论先行/)
  assert.match(DEFAULTS.style, /定时报告不适用此规则/)
  assert.match(DEFAULTS.vision, /可见事实 → 判断局限 → 线下确认/)
  assert.match(DEFAULTS.report, /可独立阅读，不写寒暄、不反问/)
  assert.match(DEFAULTS.report, /未展开的记录与未附带的类别不推断/)
  assert.doesNotMatch(DEFAULTS.report, /没有记录不代表没有发生/, '该句由 aiReport 的 user 消息注入，system 不再重复')
  assert.match(DEFAULTS.style, /二级小标题/)
  assert.match(DEFAULTS.style, /只用双星号加粗/)
  assert.match(DEFAULTS.style, /不要整段加粗/)
  assert.match(DEFAULTS.style, /不输出表格或图表代码/, '渲染器不支持表格与图表，提示词不得诱导模型输出')
  assert.match(DEFAULTS.report, /各起一行二级小标题/)
  assert.match(DEFAULTS.report, /不输出表格或图表代码/)
})

test('三场景按锁定段 → 风格段 → 场景段分层，互斥不重复', () => {
  const { compose, SAFETY, VISION_SAFETY, HISTORY_NOTE, DEFAULTS } = settings
  const chat = compose({}, '')
  assert.ok(chat.includes(SAFETY) && chat.includes(HISTORY_NOTE) && chat.includes(DEFAULTS.style))
  assert.ok(!chat.includes(VISION_SAFETY) && !chat.includes(DEFAULTS.vision) && !chat.includes(DEFAULTS.report))

  const vision = compose({}, 'vision')
  assert.ok(vision.includes(SAFETY) && vision.includes(VISION_SAFETY) && vision.includes(DEFAULTS.vision))
  assert.ok(!vision.includes(HISTORY_NOTE) && !vision.includes(DEFAULTS.report))

  const report = compose({}, 'report', { days: 29, period: '上个月' })
  assert.ok(report.includes(SAFETY))
  assert.ok(report.includes('上个月（共29天）的成长报告'))
  assert.ok(report.includes('不写寒暄、不反问'))
  assert.ok(report.includes('定时报告不适用此规则'))
  assert.ok(!report.includes(HISTORY_NOTE) && !report.includes(VISION_SAFETY) && !report.includes(DEFAULTS.vision))
  assert.ok(!report.includes('{days}') && !report.includes('{period}'))
})

test('可编辑三项不超各自上限，三场景 system 长度可控且以 SAFETY 开头', () => {
  const { DEFAULTS, LIMITS, PROMPT_KEYS, compose, SAFETY } = settings
  for (const key of PROMPT_KEYS) {
    assert.ok(DEFAULTS[key].length > 0)
    assert.ok(DEFAULTS[key].length <= LIMITS[key], `${key} 超出上限`)
  }
  for (const [scene, vars] of [['', {}], ['vision', {}], ['report', { days: 7, period: '最近一周' }]]) {
    const text = compose({}, scene, vars)
    assert.ok(text.length < 1200, `${scene || 'chat'} system 过长：${text.length}`)
    assert.ok(text.startsWith(SAFETY))
  }
})

test('历史默认全文静默升级为新默认，不误标为自定义', () => {
  const { PREVIOUS_DEFAULTS, DEFAULTS, normalizePrompts, customOf } = settings
  assert.ok(PREVIOUS_DEFAULTS.length >= 1, '每次调整默认值都需保留一份历史全文')
  const legacy = PREVIOUS_DEFAULTS[0]
  assert.deepEqual(normalizePrompts(legacy), DEFAULTS)
  const custom = customOf(storedOf(legacy))
  for (const key of ['style', 'vision', 'report']) assert.equal(custom[key], false, `${key} 不应被误标为自定义`)
  assert.equal(custom.showThinking, false)
})

test('多代历史默认值与混合存储都能归一，不误标为自定义', () => {
  const { PREVIOUS_DEFAULTS, DEFAULTS, normalizePrompts, customOf } = settings
  assert.ok(PREVIOUS_DEFAULTS.length >= 2, '加粗规则上线后应保留两代历史默认值')
  PREVIOUS_DEFAULTS.forEach((legacy, index) => {
    assert.deepEqual(normalizePrompts(legacy), DEFAULTS, `第 ${index + 1} 代默认值应升级`)
    for (const key of ['style', 'vision', 'report']) {
      assert.equal(customOf(storedOf(legacy))[key], false, `第 ${index + 1} 代 ${key} 不应被误标`)
    }
  })
  const mixed = storedOf({ style: PREVIOUS_DEFAULTS[0].style, vision: '自定义图片说明', report: PREVIOUS_DEFAULTS[1].report })
  const flags = customOf(mixed)
  assert.equal(flags.style, false)
  assert.equal(flags.vision, true)
  assert.equal(flags.report, false)
  assert.equal(normalizePrompts(mixed.prompts).vision, '自定义图片说明')
})

test('真实自定义提示词原样保留并标记为已自定义', () => {
  const { PREVIOUS_DEFAULTS, DEFAULTS, normalizePrompts, customOf } = settings
  const custom = '请只用粤语回答，且每条建议不超过两行。'
  const stored = storedOf({ ...PREVIOUS_DEFAULTS[0], style: custom })
  const normalized = normalizePrompts(stored.prompts)
  assert.equal(normalized.style, custom)
  assert.equal(normalized.vision, DEFAULTS.vision)
  assert.equal(normalized.report, DEFAULTS.report)
  const flags = customOf(stored)
  assert.equal(flags.style, true)
  assert.equal(flags.vision, false)
  assert.equal(flags.report, false)
})

test('空值与空白串仍回退到当前默认值', () => {
  const { normalizePrompts, customOf, DEFAULTS } = settings
  assert.deepEqual(normalizePrompts({}), DEFAULTS)
  assert.deepEqual(normalizePrompts({ style: '  ', vision: '', report: null }), DEFAULTS)
  const flags = customOf(storedOf({ style: '  ', vision: '' }))
  assert.equal(flags.style, false)
  assert.equal(flags.vision, false)
})

test('llm.js 不再维护第二份默认提示词，兜底复用 compose', () => {
  const source = fs.readFileSync('cloudfunctions/_shared/llm.js', 'utf8')
  assert.match(source, /require\('\.\/ai-settings'\)/)
  assert.match(source, /const SYSTEM = compose\(\{\}, ''\)/)
  assert.match(source, /options\.vision \? compose\(\{\}, 'vision'\) : SYSTEM/)
  assert.doesNotMatch(source, /用温和简明中文回答。只根据提供的信息/, '旧独立 SYSTEM 文案不应残留')
  assert.doesNotMatch(source, /照片仅代表当前拍摄瞬间/, '视觉安全条文应由 ai-settings 单一来源提供')
  const llm = load('cloudfunctions/_shared/llm.js')
  assert.equal(llm.SYSTEM, settings.compose({}, ''))
})

test('aiSettings 的 build 标记随默认提示词升级', () => {
  const source = fs.readFileSync('cloudfunctions/aiSettings/index.js', 'utf8')
  assert.match(source, /build: 'ai-settings-4'/)
  assert.doesNotMatch(source, /build: 'ai-settings-[23]'/)
})

test('14 份 lib 副本与 _shared 的提示词文件逐字一致', () => {
  const dirs = fs.readdirSync('cloudfunctions', { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== '_shared')
    .map(e => `cloudfunctions/${e.name}/lib`)
    .filter(p => fs.existsSync(p))
  assert.equal(dirs.length, 14)
  for (const file of ['ai-settings.js', 'llm.js']) {
    const master = fs.readFileSync(`cloudfunctions/_shared/${file}`, 'utf8')
    for (const dir of dirs) assert.equal(fs.readFileSync(`${dir}/${file}`, 'utf8'), master, `${dir}/${file} 未同步`)
  }
})
