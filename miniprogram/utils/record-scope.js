function currentBabyName() {
  const app = getApp()
  const baby = app && app.globalData && app.globalData.baby
  return baby && typeof baby.nickname === 'string' && baby.nickname.trim() ? baby.nickname.trim() : '未选择宝宝'
}

module.exports = { currentBabyName }
