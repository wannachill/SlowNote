// Observe visible content and stagger its entrance without changing page data.
const STAGGER = 80
const CYCLE = 4

function observe(page, options) {
  const opts = options || {}
  const selector = opts.selector
  if (!selector || typeof page.createIntersectionObserver !== 'function') return
  if (page._revealObserver) return
  const seen = page._revealSeen || (page._revealSeen = {})
  let order = page._revealOrder || 0
  let observer = null
  try {
    observer = page.createIntersectionObserver({ thresholds: [0.01], observeAll: true })
    observer.relativeToViewport({ bottom: opts.bottom == null ? -40 : opts.bottom })
    observer.observe(selector, res => {
      const dataset = res && res.dataset
      const id = dataset && dataset.revealId
      if (id === undefined || id === null || id === '') return
      if (seen[id] || page._motionInactive) return
      seen[id] = true
      const delay = (order % CYCLE) * STAGGER
      page._revealOrder = ++order
      page.setData({ ['reveal.' + id]: '--reveal-delay:' + delay + 'ms;' })
    })
  } catch (error) {
    observer = null
  }
  page._revealObserver = observer || null
}

function reset(page) {
  page._revealSeen = {}
  page._revealOrder = 0
  dispose(page)
  page.setData({ reveal: {} })
}

function dispose(page) {
  if (page._revealObserver) {
    try { page._revealObserver.disconnect() } catch (error) {}
    page._revealObserver = null
  }
}

module.exports = { observe, reset, dispose, STAGGER }
