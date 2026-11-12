const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./helpers.cjs')

test('custom tab bar ignores additional tab changes while a switch is pending', () => {
  let definition
  const switches = []
  const theme = { resolve: () => ({ themeClass: 'theme-light' }) }
  const wx = { switchTab: options => switches.push(options) }
  const app = { palette: theme.resolve(), globalData: {} }
  load('miniprogram/custom-tab-bar/index.js', {
    Component(value) { definition = value },
    getApp: () => app,
    getCurrentPages: () => [], wx
  }, { '../utils/theme': theme })

  const instance = {
    data: {
      selected: 0,
      tabMotionReady: false,
      tabs: [
        { path: 'pages/index/index' },
        { path: 'pages/statistics/index' },
        { path: 'pages/mine/index' }
      ]
    },
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    refresh() {}
  }

  definition.methods.switchTab.call(instance, { currentTarget: { dataset: { index: 1 } } })
  definition.methods.switchTab.call(instance, { currentTarget: { dataset: { index: 2 } } })

  assert.equal(switches.length, 1)
  assert.equal(switches[0].url, '/pages/statistics/index')
  assert.equal(app._tabSwitchPending, true)
  clearTimeout(instance._switchTimer)
  app._tabSwitchPending = false
})

test('unauthorized page redirects once across onLoad and onShow', async () => {
  let pageDefinition
  let redirects = 0
  const theme = {
    resolve: () => ({ themeClass: 'theme-light', accent: '#000' }),
    nativeColors() {}
  }
  const motion = {
    data: {}, methods: {}, reset() {}, afterTheme() {},
    dispose: { call() {} }
  }
  const app = { palette: theme.resolve(), globalData: { initialized: true, loggedIn: false } }
  const wx = {
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    switchTab() { redirects++ }
  }
  const getCurrentPages = () => []
  const themedPage = load('miniprogram/utils/page.js', {
    Page(value) { pageDefinition = value }, wx, getApp: () => app, getCurrentPages
  }, { './theme': theme, './motion': motion })
  themedPage({ data: {} })

  const instance = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    route: 'pages/baby/index',
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    getTabBar: () => null
  }
  instance.onLoad({})
  await instance._entryReady
  await instance.onShow()

  assert.equal(redirects, 1)
  assert.equal(instance._redirectingToMine, true)
})
