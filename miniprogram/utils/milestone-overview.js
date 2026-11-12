const { ageMonth } = require('./date')

const CACHE_MS = 60000

function summarize(milestones, babyId, birthday, month = ageMonth(birthday)) {
  if (month == null) return { babyId: babyId || '', birthday: birthday || '', month: null, done: 0, total: 0, at: Date.now() }
  const current = (milestones || []).filter(item => Number(item.month) === month)
  return {
    babyId: babyId || '',
    birthday: birthday || '',
    month,
    done: current.filter(item => item.done).length,
    total: current.length,
    at: Date.now()
  }
}

function store(milestones, babyId, birthday) {
  const app = getApp()
  if (!app || !app.globalData) return null
  const overview = summarize(milestones, babyId, birthday)
  app.globalData.milestoneOverview = overview
  app.globalData.milestoneOverviewRequest = null
  return overview
}

function invalidate() {
  const app = getApp()
  if (app && app.globalData) {
    app.globalData.milestoneOverviewRevision = (app.globalData.milestoneOverviewRevision || 0) + 1
    app.globalData.milestoneOverview = null
    app.globalData.milestoneOverviewRequest = null
  }
}

async function load() {
  const app = getApp()
  if (!app || !app.globalData) return null
  const babyId = app.globalData.activeBabyId || ''
  const birthday = (app.globalData.baby && app.globalData.baby.birthday) || ''
  const month = ageMonth(birthday)
  if (!babyId || month == null) return summarize([], babyId, birthday, month)
  const revision = app.globalData.milestoneOverviewRevision || 0

  const cached = app.globalData.milestoneOverview
  if (cached && cached.babyId === babyId && cached.birthday === birthday && cached.month === month && Date.now() - cached.at < CACHE_MS) return cached
  if (app.globalData.milestoneOverviewRequest && app.globalData.milestoneOverviewRequest.babyId === babyId && app.globalData.milestoneOverviewRequest.month === month) {
    return app.globalData.milestoneOverviewRequest.promise
  }

  const request = Promise.resolve(wx.cloud.callFunction({ name: 'milestoneRecord', data: { action: 'list', baby_id: babyId } }))
    .then(response => {
      const result = response && response.result
      if (!result || result.code !== 0) throw new Error('MILESTONE_OVERVIEW_FAILED')
      if (revision !== (app.globalData.milestoneOverviewRevision || 0) || (app.globalData.activeBabyId || '') !== babyId || ((app.globalData.baby && app.globalData.baby.birthday) || '') !== birthday) return null
      return store(result.milestones, babyId, birthday)
    })
    .catch(() => null)
    .finally(() => {
      const pending = app.globalData.milestoneOverviewRequest
      if (pending && pending.promise === request) app.globalData.milestoneOverviewRequest = null
    })
  app.globalData.milestoneOverviewRequest = { babyId, month, promise: request }
  return request
}

module.exports = { summarize, store, invalidate, load }
