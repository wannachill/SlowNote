const listeners = new Set()
let state = { online: null, error: null }
let errorSequence = 0

function snapshot() {
  return { online: state.online, error: state.error ? { ...state.error } : null }
}

function syncGlobalData() {
  if (typeof getApp !== 'function') return
  const app = getApp()
  if (!app || !app.globalData) return
  app.globalData.online = state.online
  app.globalData.netError = state.error ? { ...state.error } : null
}

function emit() {
  syncGlobalData()
  const current = snapshot()
  listeners.forEach(listener => listener(current))
}

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  listener(snapshot())
  return () => listeners.delete(listener)
}

function setOnline(value) {
  const online = typeof value === 'boolean' ? value : null
  if (online === state.online) return
  state = { online, error: online === false ? null : state.error }
  emit()
}

function report(error) {
  if (!error || error.network !== true || state.online === false) return
  errorSequence += 1
  state = { ...state, error: { id: `${Date.now()}-${errorSequence}`, at: Date.now() } }
  emit()
}

function clearError() {
  if (!state.error) return
  state = { ...state, error: null }
  emit()
}

module.exports = { subscribe, setOnline, report, clearError, getState: snapshot }
