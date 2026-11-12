const STORAGE_KEY = 'slownote_theme_pref'
// 可选主题：每套都是与默认蓝相同的柔和弥散渐变质感，仅色相不同。
// dark: true 的主题（深色）自带暗色基调，等价于原来的“深色模式”，但作为独立主题色存在。
const COLORS = [
  { id: 'blue', name: '治愈蓝', dot: 'linear-gradient(135deg, #598BFD, #35B3C9)' },
  { id: 'pink', name: '樱粉', dot: 'linear-gradient(135deg, #FF8ABF, #C79EEB)' },
  { id: 'orange', name: '暖橙', dot: 'linear-gradient(135deg, #FFA55C, #FF8A6E)' },
  { id: 'mint', name: '薄荷绿', dot: 'linear-gradient(135deg, #5FD3A8, #8FE3C9)' },
  { id: 'purple', name: '紫色', dot: 'linear-gradient(135deg, #A98BE0, #C9A8E8)' },
  { id: 'dark', name: '深色', dot: 'linear-gradient(135deg, #3A4D63, #141B24)', dark: true }
]
const COLOR_IDS = COLORS.map(c => c.id)
function normalize(pref) {
  const color = pref && COLOR_IDS.includes(pref.color) ? pref.color : 'blue'
  return { color }
}
function preference() {
  try {
    const stored = wx.getStorageSync(STORAGE_KEY)
    return normalize(stored)
  } catch (error) { return normalize() }
}
// 颜色映射到微信原生控件（开关、导航栏）所用的纯色。
function accentFor(color, dark) {
  if (color === 'pink') return dark ? '#E08CB4' : '#E26D9C'
  if (color === 'orange') return dark ? '#F6B26B' : '#DE8A3C'
  if (color === 'mint') return dark ? '#79DAB4' : '#2BAE85'
  if (color === 'purple') return dark ? '#B79BE6' : '#8E63D6'
  return dark ? '#6FA8DC' : '#5B9BD5'
}
// 颜色映射到图表/彩屑所用的强调墨色，跟随主题色相。
function accentInkFor(color, dark) {
  if (dark) {
    if (color === 'pink') return '#F2B8D2'
    if (color === 'orange') return '#FBD0A0'
    if (color === 'mint') return '#9CE6C9'
    if (color === 'purple') return '#CBB4EE'
    return '#A8C8E8'
  }
  if (color === 'pink') return '#C2517E'
  if (color === 'orange') return '#C9762C'
  if (color === 'mint') return '#1E9D74'
  if (color === 'purple') return '#7E57C2'
  return '#2E6DA6'
}
// 颜色映射到原生导航栏/页面背景色，贴合各自浅/深色基调。
function backgroundFor(color, dark) {
  if (color === 'pink') return dark ? '#201821' : '#FDEFF5'
  if (color === 'orange') return dark ? '#1F1813' : '#FDF3E7'
  if (color === 'mint') return dark ? '#10241D' : '#EAFBF3'
  if (color === 'purple') return dark ? '#1B1626' : '#F5EFFB'
  return dark ? '#141D27' : '#EDF4FB'
}
function resolve(pref = preference()) {
  const def = COLORS.find(c => c.id === pref.color) || COLORS[0]
  const dark = !!def.dark
  return {
    pref: { color: def.id }, dark, color: def.id,
    themeClass: `theme-color-${def.id}${dark ? ' mode-dark' : ''}`,
    accent: accentFor(def.id, dark),
    accentInk: accentInkFor(def.id, dark),
    background: backgroundFor(def.id, dark),
    grid: dark ? '#3A3A3A' : '#C7D9EA',
    secondary: dark ? '#B4B4B4' : '#5C7184', text: dark ? '#F2F2F2' : '#26343F'
  }
}
function save(pref) { const value = normalize(pref); wx.setStorageSync(STORAGE_KEY, value); return value }
function nativeColors(palette, preservePageBackground = false) {
  wx.setNavigationBarColor({ frontColor: palette.dark ? '#ffffff' : '#000000', backgroundColor: palette.background, animation: { duration: 0 } })
  if (!preservePageBackground && wx.setBackgroundColor) wx.setBackgroundColor({ backgroundColor: palette.background, backgroundColorTop: palette.background, backgroundColorBottom: palette.background })
}
module.exports = { normalize, preference, resolve, save, nativeColors, COLORS }
