const https = require('https')
const { endpoint, fail, access, hash, createOnce } = require('./lib/runtime')

exports.main = endpoint(async ({ event, cloud, db, openid }) => {
  if (event.consent !== true) fail(400, 'CONSENT_REQUIRED')
  await access(db, openid)
  const fileID = typeof event.fileID === 'string' && event.fileID.length <= 512 ? event.fileID : ''
  if (!fileID || !fileID.startsWith('cloud://')) fail(400, 'INVALID_FILE')
  const pathMatch = /^cloud:\/\/[A-Za-z0-9_.-]+\/audio\/([^/]+)\/([^/]+)$/.exec(fileID)
  if (!pathMatch || pathMatch[1] !== openid || !/\.(mp3|m4a|wav|aac|ogg)$/i.test(pathMatch[2]) || !/^[\w-]{8,100}$/.test(pathMatch[2].replace(/\.[a-z0-9]+$/i, ''))) fail(400, 'INVALID_FILE')
  if (!process.env.ASR_URL || !process.env.ASR_KEY) return { code: 0, configured: false, text: '' }
  let url
  try { url = new URL(process.env.ASR_URL) } catch (error) { return { code: 0, configured: false, text: '' } }
  const minute = Math.floor(Date.now() / 60000)
  let allowed = false
  for (let slot = 0; slot < 3; slot++) {
    const result = await createOnce(db, 'ai_rate_limits', hash('asr:' + openid + ':' + minute + ':' + slot), { openid, expires_at: new Date((minute + 2) * 60000), created_at: db.serverDate() })
    if (!result.duplicate) { allowed = true; break }
  }
  if (!allowed) fail(429, 'RATE_LIMITED')
  const download = await cloud.downloadFile({ fileID })
  const buffer = download.fileContent
  if (!buffer || buffer.length < 1024 || buffer.length > 15 * 1024 * 1024) fail(400, 'INVALID_AUDIO')
  const model = process.env.ASR_MODEL || 'whisper-1'
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileID)
  const ext = match ? match[1].toLowerCase() : 'm4a'
  const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : 'audio/m4a'
  const boundary = '----slownote' + Date.now().toString(36)
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`)
  const tail = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n--${boundary}--\r\n`)
  const body = Buffer.concat([head, buffer, tail])
  const result = await new Promise(resolve => {
    let settled = false
    const finish = value => { if (!settled) { settled = true; resolve(value) } }
    const req = https.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.ASR_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk; if (data.length > 131072) { finish({ text: '' }); req.destroy() } })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          const text = parsed.text || (parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content)
          finish(typeof text === 'string' && text.trim() ? { text: text.trim().slice(0, 2000) } : { text: '' })
        } catch (error) { finish({ text: '' }) }
      })
      res.on('error', () => finish({ text: '' }))
    })
    req.on('error', () => finish({ text: '' }))
    const deadline = setTimeout(() => { finish({ text: '' }); req.destroy() }, 30000)
    req.on('close', () => clearTimeout(deadline))
    req.end(body)
  })
  if (!result.text) fail(503, 'ASR_FAILED')
  return { code: 0, configured: true, text: result.text }
})
