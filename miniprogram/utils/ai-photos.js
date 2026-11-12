const { requestId } = require('./api')
const MAX_BYTES = 2 * 1024 * 1024
const invoke = (method, options) => new Promise((resolve, reject) => method({ ...options, success: resolve, fail: reject }))
async function choose(count) {
  if (!wx.chooseMedia) throw new Error('请升级微信后再添加照片')
  let result
  try { result = await invoke(wx.chooseMedia, { count, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'] }) }
  catch (error) { if (/cancel/i.test(error.errMsg || '')) return []; throw new Error('未能选择照片，请重试') }
  const selected = []
  for (const file of (result.tempFiles || []).slice(0, count)) {
    let path = file.tempFilePath
    try {
      if (wx.compressImage) {
        try { path = (await invoke(wx.compressImage, { src: path, quality: 75 })).tempFilePath || path }
        catch (error) { /* 部分微信版本不支持压缩PNG/WebP，仍按原图实际类型和体积校验。 */ }
      }
      const info = await invoke(wx.getImageInfo, { src: path })
      const type = String(info.type).toLowerCase()
      if (!['jpeg', 'jpg', 'png', 'webp'].includes(type)) throw new Error('FORMAT')
      const stat = await invoke(options => wx.getFileSystemManager().getFileInfo(options), { filePath: path })
      if (!stat.size || stat.size > MAX_BYTES) throw new Error('SIZE')
      selected.push({ id: requestId(), path, ext: type === 'jpeg' ? 'jpg' : type })
    } catch (error) {
      throw new Error(error.message === 'SIZE' ? '照片压缩后仍超过 2MB，请裁剪后重试' : '请选择 JPG、PNG 或 WebP 照片')
    }
  }
  return selected
}
async function upload(images, openid, fileIDs, disposed) {
  if (!images.length) return
  if (!openid || !/^[\w-]+$/.test(openid) || !wx.cloud || !wx.cloud.uploadFile) throw new Error('请先登录再上传照片')
  for (const photo of images) {
    if (disposed()) return
    try {
      const result = await wx.cloud.uploadFile({ cloudPath: `ai-chat/${openid}/${requestId()}.${photo.ext}`, filePath: photo.path })
      if (!result.fileID) throw new Error('UPLOAD_FAILED')
      fileIDs.push(result.fileID)
    } catch (error) { throw new Error('照片上传失败，请检查网络后重试') }
  }
}
async function cleanup(fileIDs) {
  if (!fileIDs.length || !wx.cloud || !wx.cloud.deleteFile) return
  try { await wx.cloud.deleteFile({ fileList: fileIDs }) } catch (error) { /* 服务端同步清理；中断残留由存储生命周期兜底。 */ }
}
module.exports = { choose, upload, cleanup }
