const { fail } = require('./lib/runtime')
const MAX_BYTES = 2 * 1024 * 1024
function ownedImages(value, openid) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 3) fail(400, 'INVALID_IMAGES')
  const prefix = `ai-chat/${openid}/`
  if (value.some(id => {
    if (typeof id !== 'string' || id.length > 500) return true
    const match = new RegExp('^cloud://[A-Za-z0-9_.-]+/(.+)$').exec(id)
    return !match || !match[1].startsWith(prefix) || !/^[\w-]{8,100}\.(?:jpg|jpeg|png|webp)$/.test(match[1].slice(prefix.length))
  }) || new Set(value).size !== value.length) fail(400, 'INVALID_IMAGES')
  return value
}
function mime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return ''
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return ''
}
async function content(cloud, fileIDs) {
  return Promise.all(fileIDs.map(async fileID => {
    const result = await cloud.downloadFile({ fileID })
    const bytes = result.fileContent
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) fail(413, 'IMAGE_TOO_LARGE')
    const type = mime(bytes)
    if (!type) fail(400, 'UNSUPPORTED_IMAGE')
    return { type: 'image_url', image_url: { url: `data:${type};base64,${bytes.toString('base64')}` } }
  }))
}
async function cleanup(cloud, fileIDs) {
  if (!fileIDs.length) return
  try { await cloud.deleteFile({ fileList: fileIDs }) } catch (error) { /* 端侧再清理；中断和失败残留须设置云存储生命周期兜底。 */ }
}
module.exports = { ownedImages, content, cleanup }
