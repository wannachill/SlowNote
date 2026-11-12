function requestId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}` }
const network = require('./net')
const messages = { 401: '请先登录，再继续记录', 413: '记录较多，请缩小时间范围', 429: '小迈需要歇一会儿，请稍后再试', 400: '请检查填写内容', 409: '状态已变化，请刷新后重试', 501: '服务尚未配置，请稍后再试', 503: '暂时连接不上，请稍后再试' }
function requireWriteAccess() {
  const { loggedIn } = getApp().globalData
  if (!loggedIn) {
    wx.showToast({ title: '请先登录后再保存', icon: 'none' })
    return false
  }
  return true
}
async function call(name, data = {}) {
  if (!getApp().globalData.loggedIn) throw Object.assign(new Error(messages[401]), { code: 401 })
  try {
    if (!wx.cloud) throw new Error('云服务暂不可用，请稍后再试')
    const result = (await wx.cloud.callFunction({ name, data })).result
    if (!result || result.code !== 0) {
      const code = result && result.code
      // 保留云函数自己的 message（如 INVALID_SETTINGS），否则无法区分“参数错”和“代码是旧的”。
      throw Object.assign(new Error(messages[code] || '暂未完成，请稍后再试'), { code, serverMessage: result && result.message })
    }
    network.clearError()
    return result
  } catch (error) {
    if (error && error.code !== undefined && error.code !== null) throw error
    // 云函数不存在、缺依赖、超时等也会走到这里。保留原始错误，否则调用方只能看到“网络慢”。
    const networkError = Object.assign(new Error('网络有些慢，请检查连接后重试'), { network: true, origin: error })
    network.report(networkError)
    throw networkError
  }
}
const toastError = (error) => wx.showToast({ title: error.message || '暂未完成，请重试', icon: 'none' })
module.exports = { call, requestId, toastError, requireWriteAccess }
