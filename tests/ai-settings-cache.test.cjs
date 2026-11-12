const test = require('node:test')
const assert = require('node:assert/strict')
const { load, front } = require('./helpers.cjs')

test('AI settings cache is bound to the active openid and rejects stale writes', () => {
  const f = front('ai-chat')
  f.app.globalData.openid = 'account-a'
  const cache = load('miniprogram/utils/ai-settings.js', { wx: f.wx, getApp: () => f.app })
  const accountA = { showThinking: true, prompts: { style: 'A' } }
  const accountB = { showThinking: false, prompts: { style: 'B' } }

  assert.equal(cache.writeCache(accountA), true)
  assert.deepEqual(cache.readCache(), accountA)
  f.app.globalData.openid = 'account-b'
  assert.equal(cache.readCache(), null, 'another account cannot read the previous account cache')
  assert.equal(cache.writeCache(accountB), true)
  f.app.globalData.openid = 'account-a'
  assert.equal(cache.readCache(), null, 'the single-slot cache is never mistaken for account A data')
  assert.equal(cache.writeCache(accountB, 'account-b'), false, 'a late response cannot write after the active account changes')
  cache.clearCache()
  assert.equal(f.storage[cache.CACHE_KEY], undefined)
})

test('legacy unscoped AI settings cache is discarded and logout clears the active cache', () => {
  const f = front('ai-chat')
  f.app.globalData.openid = 'account-a'
  const cache = load('miniprogram/utils/ai-settings.js', { wx: f.wx, getApp: () => f.app })
  f.storage[cache.CACHE_KEY] = { showThinking: true, prompts: { style: 'legacy' } }
  assert.equal(cache.readCache(), null)
  assert.equal(f.storage[cache.CACHE_KEY], undefined)

  let definition, appInstance
  load('miniprogram/app.js', {
    wx: f.wx,
    App: value => { definition = value },
    getCurrentPages: () => [],
    getApp: () => appInstance
  })
  appInstance = {
    ...definition,
    globalData: { ...definition.globalData, openid: 'account-a', loggedIn: true, initialized: true },
    updateNoticeBadge: definition.updateNoticeBadge
  }
  cache.writeCache({ showThinking: true, prompts: { style: 'A' } })
  appInstance.logout()
  assert.equal(f.storage[cache.CACHE_KEY], undefined)
})
