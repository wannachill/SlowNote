// 轻触反馈：节流 + 失败静默。
// 按 Apple 反馈原则（utility）：只用于有意义的动作（弹层开合、提交成功、删除），避免过度反馈。
// type: 'light' | 'medium' | 'heavy'（基础库 2.19+ 支持）
let last = 0
function tap(type) {
  const t = type || 'light'
  if (Date.now() - last < 120) return
  last = Date.now()
  wx.vibrateShort({ type: t, fail: function () {} })
}
module.exports = { tap }
