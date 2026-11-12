const cache = require('./page-cache')

// 记录类写操作后：首页当天记录、小迈趋势与月历标记都必须重新拉取。
function invalidateRecords() {
  cache.invalidate('home')
  cache.invalidate('statistics')
}

function markSaved(date) {
  const app = getApp()
  if (!app || !app.globalData) return
  app.globalData.homeRefresh = { date: date || '', at: Date.now() }
  invalidateRecords()
}

module.exports = { markSaved, invalidateRecords }
