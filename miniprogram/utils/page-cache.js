// 页面读缓存：内存 + 本地存储双层。
// 同一份数据 60 秒内可复用，写操作通过 invalidate 立刻失效，避免切 tab 反复请求云端。
const TTL = 60000
const KEY_PREFIX = 'slownote.cache.v1:'
const INDEX_KEY = KEY_PREFIX + 'index'
const MAX_KEYS = 40
const MAX_PERSIST = 64 * 1024

const memory = new Map()

function keyOf(scope, params) { return KEY_PREFIX + scope + ':' + JSON.stringify(params || {}) }
function scopePrefix(scope) { return KEY_PREFIX + scope }
function inScope(key, prefix) { return key === prefix || key.indexOf(prefix + ':') === 0 || key.indexOf(prefix + '.') === 0 }

function readIndex() {
  try { const value = wx.getStorageSync(INDEX_KEY); return Array.isArray(value) ? value : [] } catch (error) { return [] }
}
function writeIndex(list) {
  try { wx.setStorageSync(INDEX_KEY, list) } catch (error) { /* 存储满时只保留内存缓存 */ }
}
function dropStorage(key) {
  try { wx.removeStorageSync(key) } catch (error) { /* 存储不可用时忽略 */ }
}

function entryOf(scope, params) {
  const key = keyOf(scope, params)
  const hit = memory.get(key)
  if (hit) {
    if (Date.now() - hit.at < TTL) return hit
    memory.delete(key)
  }
  let stored = null
  try { stored = wx.getStorageSync(key) } catch (error) { stored = null }
  if (!stored || typeof stored.at !== 'number') return null
  if (Date.now() - stored.at >= TTL) { dropStorage(key); return null }
  memory.set(key, stored)
  return stored
}

// 命中未过期缓存时返回数据，否则 null。
function read(scope, params) {
  const entry = entryOf(scope, params)
  return entry ? entry.value : null
}

// 只判断是否命中未过期缓存，不关心内容。
function fresh(scope, params) { return !!entryOf(scope, params) }

function write(scope, params, value) {
  const key = keyOf(scope, params)
  const entry = { at: Date.now(), value }
  memory.set(key, entry)
  let serialized = ''
  try { serialized = JSON.stringify(entry) } catch (error) { return value }
  if (!serialized || serialized.length > MAX_PERSIST) { dropStorage(key); return value }
  try {
    wx.setStorageSync(key, entry)
    const index = readIndex().filter(item => item !== key)
    index.push(key)
    while (index.length > MAX_KEYS) dropStorage(index.shift())
    writeIndex(index)
  } catch (error) { /* 存储写失败不影响内存缓存 */ }
  return value
}

// 按 scope 前缀失效，例如 invalidate('home') 会清掉 home.daily。
function invalidate(scope) {
  const prefix = scopePrefix(scope)
  for (const key of [...memory.keys()]) if (inScope(key, prefix)) memory.delete(key)
  const keep = []
  readIndex().forEach(key => { if (inScope(key, prefix)) dropStorage(key); else keep.push(key) })
  writeIndex(keep)
}

function clear() {
  memory.clear()
  readIndex().forEach(dropStorage)
  writeIndex([])
}

module.exports = { TTL, read, fresh, write, invalidate, clear, keyOf }
