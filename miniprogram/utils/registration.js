const { closeLater } = require('./motion')

// Keep the form mounted for its existing exit motion, then reveal the home page.
function close(page, saved = false) {
  if (saved) page._registrationSaved = true
  if (page._motionInactive || page.data.closing || (page.data.submitting && !saved)) return
  page.setData({ closing: true })
  closeLater(page, () => {
    if (!page.data.panelMode) {
      page.setData({ panel: '', closing: false })
      return
    }
    const pages = getCurrentPages()
    const home = pages.findIndex(item => item.route === 'pages/index/index')
    const fallback = () => wx.switchTab({
      url: '/pages/index/index',
      fail: () => page.setData({ closing: false })
    })
    if (home >= 0 && home < pages.length - 1) {
      wx.navigateBack({ delta: pages.length - 1 - home, fail: fallback })
    } else fallback()
  })
}

module.exports = { close }
