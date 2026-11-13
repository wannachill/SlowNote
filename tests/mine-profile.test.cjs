const test = require('node:test'), assert = require('node:assert/strict')
const { front } = require('./helpers.cjs')
const fs = require('node:fs')

test('mine page profile card shows current baby details and navigates to baby maintenance', () => {
  const f = front('mine')
  f.app.globalData.loggedIn = true
  f.app.globalData.baby = { baby_id: 'baby-a', nickname: '小满', birthday: '2026-09-10', avatar: '' }
  f.page.refresh()
  assert.equal(f.page.data.babyNickname, '小满')
  assert.equal(f.page.data.babyAgeDays, 41)
  f.page.goBaby()
  assert.equal(f.calls.at(-1).url, '/pages/baby/index')
  const template = fs.readFileSync('miniprogram/pages/mine/index.wxml', 'utf8')
  assert(!template.includes('记录保存于云端'))
  assert(!template.includes('参考值仅供育儿参考'))
  assert(!template.includes('{{babyBirthday}}'))
  assert(!/aria-label="宝宝信息"/.test(template))
  assert.match(template, /class="card profile-card profile-baby-card" bindtap="goBaby"/)
})

test('mine page still exposes login action for logged-out users', () => {
  const template = fs.readFileSync('miniprogram/pages/mine/index.wxml', 'utf8')
  assert.match(template, /wx:else class="card profile-card profile-login-card"/)
  assert.match(template, /class="btn-primary form-submit[\s\S]*?bindtap="login"/)
})

test('home, Xiao Mai, and mine reserve matching top-heading height and start below net banner', () => {
  const read = page => fs.readFileSync(`miniprogram/pages/${page}/index.wxml`, 'utf8')
  const homeStyle = fs.readFileSync('miniprogram/pages/index/index.wxss', 'utf8')
  const statisticsStyle = fs.readFileSync('miniprogram/pages/statistics/index.wxss', 'utf8')
  const mineStyle = fs.readFileSync('miniprogram/pages/mine/index.wxss', 'utf8')
  assert.match(read('index'), /<view class="baby-header page-top-heading">/)
  assert.match(read('statistics'), /class="toolbar statistics-header page-top-heading"/)
  assert.match(read('mine'), /class="page-heading page-top-heading"/)
  assert.match(homeStyle, /\.baby-header\s*\{[^}]*height:\s*176rpx/s)
  assert.match(mineStyle, /\.mine-page > \.page-heading\s*\{[^}]*height:\s*176rpx/s)
  assert.match(statisticsStyle, /height:\s*calc\(env\(safe-area-inset-top\) \+ var\(--tab-page-top\) \+ 176rpx\)/)
  assert.match(homeStyle, /\.baby-name\s*\{[^}]*font-size:\s*var\(--font-heading\);[^}]*font-weight:\s*var\(--weight-semibold\);[^}]*line-height:\s*var\(--line-tight\);/s)
  assert.match(homeStyle, /\.baby-main\s*\{[^}]*margin-top:\s*28rpx;/s)
  assert.match(statisticsStyle, /\.statistics-header\s*\{[^}]*justify-content:\s*flex-start;[^}]*padding:\s*calc\(env\(safe-area-inset-top\) \+ var\(--tab-page-top\) \+ 28rpx\)/s)
  assert.match(statisticsStyle, /\.statistics-header\s*\{[^}]*gap:\s*0;/s)
  assert.match(mineStyle, /\.mine-page > \.page-heading\s*\{[^}]*justify-content:\s*flex-start;[^}]*padding-top:\s*28rpx;/s)
  assert.match(statisticsStyle, /\.ask-entry\s*\{[^}]*margin:\s*0;/s)
})

test('three tab headings stay transparent so the theme gradient has no seam', () => {
  const app = fs.readFileSync('miniprogram/app.wxss', 'utf8')
  const rule = /\.page-top-heading\s*\{([^}]*)\}/.exec(app)
  assert.ok(rule, '全局 page-top-heading 规则应存在')
  assert.doesNotMatch(rule[1], /background\s*:/, '标题区不得再铺纯色背景，否则与主题渐变拼接出分割线')
  assert.doesNotMatch(rule[1], /margin-(right|left)\s*:/, '无背景时不需要负 margin 外扩')
  assert.match(rule[1], /margin-bottom:\s*var\(--space-m\)/, '保留 32rpx 留白，首个内容块三页对齐')
  assert.match(app, /background-image:\s*var\(--bg-mesh\)/, '整页主题渐变仍需保留')
  const headingSelectors = {
    index: /\.baby-header\s*\{([^}]*)\}/s,
    statistics: /\.statistics-header\s*\{([^}]*)\}/s,
    mine: /\.mine-page > \.page-heading\s*\{([^}]*)\}/s
  }
  for (const [page, selector] of Object.entries(headingSelectors)) {
    const template = fs.readFileSync(`miniprogram/pages/${page}/index.wxml`, 'utf8')
    assert.match(template, /page-top-heading/, `${page} 应复用全局标题区规则`)
    const style = fs.readFileSync(`miniprogram/pages/${page}/index.wxss`, 'utf8')
    const body = selector.exec(style)?.[1] || ''
    assert.ok(body, `${page} 标题区样式应存在`)
    assert.doesNotMatch(body, /background\s*:/, `${page} 标题区不得有独立背景色`)
    assert.doesNotMatch(body, /position:\s*sticky/, `${page} 标题区不得 sticky，否则透明时滚动内容会透出`)
  }
})

test('three tab pages share one compact top inset', () => {
  const app = fs.readFileSync('miniprogram/app.wxss', 'utf8')
  const token = /--tab-page-top:\s*(\d+)rpx/.exec(app)
  assert.ok(token, '顶部留白应由统一令牌控制')
  const inset = Number(token[1])
  assert.ok(inset >= 72 && inset <= 96, `顶部留白 ${inset}rpx 应落在 72~96rpx：比 128rpx 紧凑，也不像 64rpx 那样贴着状态栏与胶囊`)
  for (const page of ['index', 'statistics', 'mine']) {
    const style = fs.readFileSync(`miniprogram/pages/${page}/index.wxss`, 'utf8')
    assert.match(style, /var\(--tab-page-top\)/, `${page} 顶部偏移必须引用统一令牌`)
    assert.doesNotMatch(style, /128rpx/, `${page} 不得写死旧的顶部留白`)
  }
})

test('shrinking the top inset never drops the status-bar safe area', () => {
  const read = page => fs.readFileSync(`miniprogram/pages/${page}/index.wxss`, 'utf8')
  const home = read('index'), mine = read('mine'), statistics = read('statistics')
  for (const [page, style] of [['index', home], ['mine', mine]]) {
    assert.match(style, /\.tab-page\s*\{[^}]*padding-top:\s*calc\(env\(safe-area-inset-top\) \+ var\(--tab-page-top\)\)/s, `${page} 需保留状态栏安全区`)
  }
  assert.match(statistics, /height:\s*calc\(env\(safe-area-inset-top\) \+ var\(--tab-page-top\) \+ 176rpx\)/)
  assert.match(statistics, /padding:\s*calc\(env\(safe-area-inset-top\) \+ var\(--tab-page-top\) \+ 28rpx\)/)
})
