function init(page, options) {
  if (!page || page._motionInactive || !wx.createSelectorQuery) return
  page._confettiRunning = false
  page._confettiFrame = null
  page._confettiReducedMotion = false
  const query = wx.createSelectorQuery().in(page)
  query.select(options.canvasId).fields({ node: true, size: true, computedStyle: ['display'] }, result => {
    if (page._motionInactive || !result) return
    page._confettiReducedMotion = result.display === 'none'
    if (page._confettiReducedMotion || !result.node || !result.width || !result.height) return
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const ratio = info.pixelRatio || 1
    const canvas = result.node
    canvas.width = Math.round(result.width * ratio)
    canvas.height = Math.round(result.height * ratio)
    const ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)
    page._confettiSurface = { canvas, ctx, width: result.width, height: result.height }
  })
  query.select(options.measureId).boundingClientRect(rect => {
    if (rect) page._confettiParticleSize = Math.max(rect.width, rect.height)
  })
  query.exec()
}

function celebrate(page, origin) {
  const surface = page && page._confettiSurface
  if (!surface || page._confettiReducedMotion || page._confettiRunning || page._motionInactive) return
  let palette = {}
  try { palette = getApp().palette || {} } catch (error) {}
  const colors = [palette.accent, palette.accentInk, palette.secondary, palette.text, palette.grid].filter(Boolean)
  const particleSize = page._confettiParticleSize
  if (!colors.length || !particleSize) return
  const { canvas, ctx, width, height } = surface
  if (!canvas.requestAnimationFrame || !canvas.cancelAnimationFrame) return
  const point = origin || { x: width / 2, y: height * 2 / 3 }
  page._confettiRunning = true
  const random = (min, max) => min + Math.random() * (max - min)
  const count = 100
  const particles = Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + random(-35, 35) * Math.PI / 180
    return {
      color: colors[Math.floor(Math.random() * colors.length)],
      backColor: palette.dark ? palette.background : palette.text,
      shape: ['strip', 'disc', 'square'][Math.floor(Math.random() * 3)],
      speed: random(300, 560), gravity: random(360, 480), drag: random(1.2, 1.65),
      angle, rotation: random(0, Math.PI * 2), spin: random(-8, 8),
      width: random(particleSize * 0.65, particleSize), height: particleSize * 0.55, sway: random(8, 28),
      phase: random(0, Math.PI * 2), frequency: random(3, 8),
      fadeStart: random(2.15, 2.7), life: random(2.8, 3.45)
    }
  })
  const version = page._confettiVersion = (page._confettiVersion || 0) + 1
  let startedAt = null
  const frame = timestamp => {
    if (version !== page._confettiVersion || page._motionInactive || !page._confettiRunning) return
    page._confettiFrame = null
    if (startedAt === null) startedAt = timestamp
    const elapsed = Math.max(0, (timestamp - startedAt) / 1000)
    ctx.clearRect(0, 0, width, height)
    let visible = false
    particles.forEach(particle => {
      const time = elapsed
      if (time >= particle.life) return
      visible = true
      const decay = Math.exp(-particle.drag * time)
      const travel = (1 - decay) / particle.drag
      const vx = Math.cos(particle.angle) * particle.speed
      const vy = Math.sin(particle.angle) * particle.speed
      const x = point.x + vx * travel + Math.sin(time * particle.frequency + particle.phase) * particle.sway * Math.min(time, 1)
      const y = point.y + vy * travel + (particle.gravity / particle.drag) * (time - travel)
      const fade = time <= particle.fadeStart ? 1 : Math.max(0, 1 - (time - particle.fadeStart) / (particle.life - particle.fadeStart))
      const rotation = particle.rotation + particle.spin * time
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rotation)
      const flip = Math.cos(time * particle.spin)
      ctx.scale(flip, 1)
      ctx.globalAlpha = fade
      ctx.fillStyle = flip < 0 ? particle.backColor : particle.color
      if (particle.shape === 'disc') {
        ctx.beginPath()
        ctx.arc(0, 0, particle.width / 2, 0, Math.PI * 2)
        ctx.fill()
      } else if (particle.shape === 'square') {
        ctx.fillRect(-particle.width / 2, -particle.width / 2, particle.width, particle.width)
      } else {
        ctx.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height)
      }
      ctx.restore()
    })
    if (visible) page._confettiFrame = canvas.requestAnimationFrame(frame)
    else stop(page)
  }
  page._confettiFrame = canvas.requestAnimationFrame(frame)
}

function stop(page) {
  if (!page) return
  page._confettiVersion = (page._confettiVersion || 0) + 1
  const surface = page._confettiSurface
  if (surface && page._confettiFrame !== null && page._confettiFrame !== undefined) {
    surface.canvas.cancelAnimationFrame(page._confettiFrame)
  }
  page._confettiFrame = null
  page._confettiRunning = false
  if (surface) surface.ctx.clearRect(0, 0, surface.width, surface.height)
}

module.exports = { init, celebrate, stop }
