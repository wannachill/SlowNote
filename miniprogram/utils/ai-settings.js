const CACHE_KEY = 'ai.settings.cache.v1'

function currentOpenid() {
  try { return getApp().globalData.openid || '' } catch (error) { return '' }
}

function readCache() {
  try {
    const cached = wx.getStorageSync(CACHE_KEY)
    if (!cached || typeof cached !== 'object') return null
    if (!Object.prototype.hasOwnProperty.call(cached, 'openid') || cached.openid !== currentOpenid() || !cached.value || typeof cached.value !== 'object') {
      wx.removeStorageSync(CACHE_KEY)
      return null
    }
    return cached.value
  } catch (error) { return null }
}

function writeCache(value, openid = currentOpenid()) {
  if (openid !== currentOpenid()) return false
  try { wx.setStorageSync(CACHE_KEY, { openid, value }); return true }
  catch (error) { return false }
}

function clearCache() {
  try { wx.removeStorageSync(CACHE_KEY) } catch (error) { /* cache cleanup is best effort */ }
}

module.exports = { CACHE_KEY, readCache, writeCache, clearCache }
