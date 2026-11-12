const test = require('node:test')
const assert = require('node:assert/strict')
const refs = require('../miniprogram/utils/references')
const { dateKey } = require('../miniprogram/utils/date')
const { front } = require('./helpers.cjs')

test('month age follows completed calendar months and clamps month-end anniversaries', () => {
  assert.equal(refs.monthAge('2026-10-28', '2026-10-28'), 0)
  assert.equal(refs.monthAge('2026-10-28', '2026-10-27'), null)
  assert.equal(refs.monthAge('2026-01-31', '2026-02-28'), 1)
  assert.equal(refs.monthAge('2026-01-31', '2026-03-01'), 1)
  assert.equal(refs.monthAge('2025-10-28', '2026-10-28'), 12)
  assert.equal(refs.monthAge('2024-02-29', '2025-02-28'), 12)
  assert.equal(refs.monthAge('', '2026-10-28'), null)
  assert.equal(refs.monthAge('2024-01-31', '2024-02-28'), 0)
  assert.equal(refs.monthAge('2024-01-31', '2024-02-29'), 1)
  assert.equal(refs.monthAge('2024-01-30', '2024-03-29'), 1)
  assert.equal(refs.monthAge('2024-01-30', '2024-03-30'), 2)
  assert.equal(refs.monthAge('2026-10-30', '2026-10-29'), null)
  assert.equal(refs.monthAge('', '2026-10-29'), null)
})

test('age stages use inclusive lower bounds and exclusive upper bounds', () => {
  assert.equal(refs.stageOf(0), '0-1')
  assert.equal(refs.stageOf(3), '3-4')
  assert.equal(refs.stageOf(4), '4-6')
  assert.equal(refs.stageOf(1), '1-2')
  assert.equal(refs.stageOf(5), '4-6')
  assert.equal(refs.stageOf(6), '6-9')
  assert.equal(refs.stageOf(9), '9-12')
  assert.equal(refs.stageOf(12), '12-24')
  assert.equal(refs.stageOf(24), '24-36')
  assert.equal(refs.stageOf(35), '24-36')
  assert.equal(refs.stageOf(36), '36-')
  assert.equal(refs.stageOf(-1), null)
  assert.equal(refs.stageOf('6'), null)
})

test('feeding hints distinguish nursing duration from daily bottle volume', () => {
  const birthday = dateKey()
  const breast = refs.feedingHint(birthday, 'breast')
  const bottle = refs.feedingHint(birthday, 'bottle')
  assert.match(breast, /每天 8–12 次/)
  assert.match(breast, /单侧 10–20 分钟/)
  assert.match(bottle, /每天 8–12 次/)
  assert.match(bottle, /合计 500–750 ml/)
  assert.equal(refs.feedingHint('', 'bottle'), '')
  assert.equal(refs.feedingHint('2999-01-01', 'bottle'), '')
})

test('solid and excretion hints omit unsupported ranges and follow the selected kind', () => {
  const newborn = dateKey()
  const sixMonthsAgo = new Date(new Date(newborn + 'T12:00:00').setMonth(new Date(newborn + 'T12:00:00').getMonth() - 6))
  const sixMonthBirthday = dateKey(sixMonthsAgo)
  assert.equal(refs.solidHint(newborn), '')
  assert.match(refs.excretionHint(newborn, 'stool'), /每天 2–5 次/)
  assert.match(refs.excretionHint(newborn, 'urine'), /每天 6–8 次/)
  assert.match(refs.excretionHint(sixMonthBirthday, 'stool'), /加辅食后次数差异变大/)
  assert.equal(refs.excretionHint(sixMonthBirthday, 'urine'), '')
  assert.equal(refs.excretionHint('', 'stool'), '')
  assert.equal(refs.solidHint('2999-01-01'), '')
})

test('growth hint reports month-to-month weight and height ranges', () => {
  const hint = refs.growthHint('2020-01-01')
  assert.match(hint, /每月约长/)
  assert.match(hint, /体重 150–250 g/)
  assert.match(hint, /身高 0\.4–0\.6 cm/)
  assert.doesNotMatch(hint, /头围/)
  assert.equal(refs.growthHint(''), '')
})

test('feeding and excretion forms refresh the hint when their type changes', async () => {
  const feeding = front('feeding')
  await feeding.page.onLoad({ panel: 'feed' })
  assert.match(feeding.page.data.refHint, /单侧 15–20 分钟/)
  feeding.page.selectType({ currentTarget: { dataset: { type: 'bottle' } } })
  assert.match(feeding.page.data.refHint, /合计 500–750 ml/)

  const excretion = front('excretion')
  await excretion.page.onLoad({ panel: 'excretion' })
  assert.match(excretion.page.data.refHint, /每天 1–3 次/)
  excretion.page.selectExKind({ currentTarget: { dataset: { kind: 'urine' } } })
  assert.match(excretion.page.data.refHint, /每天 6–8 次/)
})

test('all four registration forms render hints only when a valid birthday exists', async () => {
  const appForBirthday = birthday => ({
    palette: null,
    globalData: { loggedIn: true, initialized: true, baby: { birthday } },
    async init() {}
  })
  for (const name of ['feeding', 'solid', 'excretion', 'growth']) {
    const filled = front(name, { app: appForBirthday('2026-03-10') })
    await filled.page.onLoad({})
    assert.notEqual(filled.page.data.refHint, '', name + ' should show a month-age hint')

    const empty = front(name, { app: appForBirthday('') })
    await empty.page.onLoad({})
    assert.equal(empty.page.data.refHint, '', name + ' should hide its hint without birthday')
  }
})
