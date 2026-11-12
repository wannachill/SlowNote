const test = require('node:test'), assert = require('node:assert/strict')
const { front } = require('./helpers.cjs')
const plain = value => JSON.parse(JSON.stringify(value))

function settingsPage(storage = {}) {
  const questionsKey = 'slownote_common_questions:test-user'
  if (storage.slownote_common_questions) {
    storage[questionsKey] = storage.slownote_common_questions
    delete storage.slownote_common_questions
  }
  const f = front('ai-settings', {
    storage,
    app: { palette: null, globalData: { openid: 'test-user', loggedIn: true, initialized: true }, async init() {} }
  })
  f.questionsKey = questionsKey
  f.page.closeQuestionPanel = () => f.page.setData({ questionsPanel: false, questionsClosing: false })
  f.page.motionSettingChange = () => {}
  f.page.loadQuestions()
  return f
}

test('常见问题可编辑范围和固定状态，并通过左滑删除', () => {
  const f = settingsPage({
    slownote_common_questions: [
      { id: 'q1', text: '旧问题', range: '7d', builtin: false, pinned: false }
    ]
  })
  const page = f.page

  page.startEditQuestion({ currentTarget: { dataset: { id: 'q1' } } })
  assert.equal(page.data.questionsPanel, true)
  assert.equal(page.data.questionText, '旧问题')
  assert.equal(page.data.questionRangeIndex, 1)
  page.onQuestionInput({ detail: { value: '修改后的问题' } })
  page.onQuestionRange({ detail: { value: '5' } })
  page.onQuestionPin({ detail: { value: true }, currentTarget: { dataset: { id: 'questionPin' } } })
  page.saveQuestion()
  assert.deepEqual(JSON.parse(JSON.stringify(f.storage[f.questionsKey])), [
    { id: 'q1', text: '修改后的问题', range: 'all', builtin: false, pinned: true,
      categories: ['feeding', 'excretion', 'solid', 'growth', 'diary', 'milestone', 'custom'] }
  ])

  page.openQuestionPanel()
  page.onQuestionInput({ detail: { value: '新问题' } })
  page.onQuestionRange({ detail: { value: '3' } })
  page.onQuestionPin({ detail: { value: false }, currentTarget: { dataset: { id: 'questionPin' } } })
  page.saveQuestion()
  const added = f.storage[f.questionsKey].find(item => item.text === '新问题')
  assert.equal(added.range, 'month')
  assert.equal(added.pinned, false)

  const id = added.id
  page.confirmDanger = options => options.success({ confirm: true })
  page.removeQuestion({ currentTarget: { dataset: { id } } })
  assert.equal(f.storage[f.questionsKey].some(item => item.id === id), false)
  assert.equal(page.data.questions.some(item => item.id === id), false)
})

test('数据类型支持多选、全选与取消全选，并随问题一起保存', () => {
  const f = settingsPage({
    'slownote_common_questions:test-user': [
      { id: 'd5', text: '最近的大便和消化情况正常吗', builtin: true, pinned: false }
    ]
  })
  const page = f.page
  page.startEditQuestion({ currentTarget: { dataset: { id: 'd5' } } })
  assert.deepEqual(plain(page.data.questionCategoryValues), ['excretion', 'feeding'], '内置便便问题应预填便便+喂养')
  assert.equal(page.data.questionAllSelected, false)
  assert.equal(page.data.questionCategories.find(item => item.value === 'excretion').selected, true)
  assert.equal(page.data.questionCategories.find(item => item.value === 'growth').selected, false)

  page.onQuestionCategoryTap({ currentTarget: { dataset: { value: 'feeding' } } })
  page.onQuestionCategoryTap({ currentTarget: { dataset: { value: 'solid' } } })
  assert.deepEqual(plain(page.data.questionCategoryValues), ['excretion', 'solid'], '取消喂养并加入辅食')
  page.saveQuestion()
  assert.deepEqual(plain(f.storage[f.questionsKey][0].categories), ['excretion', 'solid'])
  assert.equal(page.data.questions[0].categoriesLabel, '便便排尿·辅食')

  page.toggleAllQuestionCategories()
  assert.deepEqual(plain(page.data.questionCategoryValues), ['feeding', 'excretion', 'solid', 'growth', 'diary', 'milestone', 'custom'])
  assert.equal(page.data.questionAllSelected, true)
  assert.equal(page.data.questionCategoryHint, '附带全部记录摘要')

  page.toggleAllQuestionCategories()
  assert.deepEqual(plain(page.data.questionCategoryValues), [])
  assert.match(page.data.questionCategoryHint, /不附带记录数据/)
  page.saveQuestion()
  assert.deepEqual(plain(f.storage[f.questionsKey][0].categories), [])
})

test('常见问题卡片横向滑动只展开当前卡片，并在离页时复位', () => {
  const f = settingsPage()
  const page = f.page
  const id = page.data.questions[0].id
  page.onQuestionCardTouchStart({
    currentTarget: { dataset: { id } },
    target: { dataset: {} },
    touches: [{ clientX: 140, clientY: 20 }]
  })
  page.onQuestionCardTouchMove({ touches: [{ clientX: 20, clientY: 22 }] })
  page.onQuestionCardTouchEnd()
  assert.equal(page.data.questions.find(item => item.id === id).swipeX, -110)
  page.onHide()
  assert.equal(page.data.questions.some(item => item.swipeX), false)
})
