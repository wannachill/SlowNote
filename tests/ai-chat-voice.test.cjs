const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const app = JSON.parse(read('miniprogram/app.json'))
const script = read('miniprogram/pages/ai-chat/index.js')
const template = read('miniprogram/pages/ai-chat/index.wxml')
const styles = read('miniprogram/pages/ai-chat/index.wxss')
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length))

test('personal subject does not declare the unavailable WechatSI plugin', () => {
  assert.equal(Object.hasOwn(app, 'plugins'), false)
})

test('recognition plugin is lazy-loaded and event handlers register once', () => {
  const manager = section(script, 'getVoiceManager() {', 'startVoice() {')
  assert.match(manager, /if \(this\._siManager !== undefined\) return this\._siManager/)
  assert.match(manager, /try\s*\{\s*const plugin = requirePlugin\('WechatSI'\)/)
  assert.match(manager, /catch \(error\)/)
  assert.match(manager, /this\._siHandlersRegistered = true/)
  assert.equal((manager.match(/manager\.on(?:Start|Recognize|Stop|Error)\(/g) || []).length, 4)
  assert.match(manager, /setData\(\{ liveTranscript: res && res\.result \|\| '' \}\)/)
  assert.doesNotMatch(manager, /liveTranscript\s*\+=|liveTranscript\s*=\s*liveTranscript\s*\+/)
})

test('final plugin text wins and empty results use the cleaned asrProxy fallback', () => {
  const stop = section(script, 'finishLiveVoice(res) {', 'failVoice(message) {')
  assert(stop.indexOf('if (text)') < stop.indexOf('res.tempFilePath'))
  assert.match(stop, /if \(text\) \{ this\.finishVoiceText\(text\); return \}/)
  assert.match(stop, /if \(res && res\.tempFilePath\) \{ this\.transcribeWithAsr\(res\.tempFilePath\); return \}/)
  const fallback = section(script, 'async transcribeWithAsr(tempFilePath) {', '// —— 提问 ——')
  assert.match(fallback, /call\('asrProxy', \{ consent: true, fileID: upload\.fileID \}\)/)
  assert.match(fallback, /wx\.cloud\.deleteFile\(\{ fileList: \[audioFileID\] \}\)/)
  assert.match(script, /question: question \? `\$\{question\} \$\{value\}` : value/)
})

test('recording preview is accessible, token-styled, and cleared on cancel and unload', () => {
  assert.match(template, /wx:if="\{\{recording \|\| voiceTranscribing\}\}"[^>]*aria-live="polite"/)
  assert.match(template, /class="voice-live-text">\{\{liveTranscript\}\}/)
  assert.match(template, /recording \? '正在录音' : '正在转写…'/)
  assert.match(template, /class="voice-live-placeholder">松开结束/)
  assert.match(template, /bindtouchcancel="onInputTouchCancel"/)
  const textStyle = styles.match(/\.voice-live-text\s*\{([^}]+)\}/)
  const placeholderStyle = styles.match(/\.voice-live-placeholder\s*\{([^}]+)\}/)
  assert(textStyle && placeholderStyle)
  assert.match(textStyle[1], /-webkit-line-clamp:\s*2/)
  assert.match(textStyle[1], /var\(--color-/)
  assert.match(textStyle[1], /var\(--font-/)
  assert.match(placeholderStyle[1], /var\(--color-/)
  assert.match(placeholderStyle[1], /var\(--font-/)
  assert.doesNotMatch(textStyle[1] + placeholderStyle[1], /#[\da-f]{3,8}\b|\b\d+(?:px|rpx)\b/i)
  const unload = section(script, 'onUnload() {', 'onInput(e) {')
  assert.match(unload, /this\.data\.liveTranscript = ''/)
  assert.match(unload, /this\._siManager\.stop\(\)/)
  assert.match(unload, /this\._recorder\.stop\(\)/)
  assert.match(script, /event\.type === 'touchcancel'[\s\S]*?liveTranscript: ''/)
})

test('microphone button is removed and the input box owns the hold gesture', () => {
  assert.doesNotMatch(template, /voice-button|voice-symbol|bindtouchstart="startVoice"/)
  assert.doesNotMatch(styles, /\.voice-button|\.voice-symbol/)
  assert.match(template, /class="chat-input-shell \{\{recording \? 'recording' : ''\}\} \{\{voiceTranscribing \? 'transcribing' : ''\}\}" catchtap="focusTextInput"/)
  assert.match(template, /bindtouchstart="onInputTouchStart" bindtouchmove="onInputTouchMove" bindtouchend="onInputTouchEnd" bindtouchcancel="onInputTouchCancel"/)
  assert.equal((template.match(/bindtouchstart="onInputTouchStart"/g) || []).length, 1)
  assert.equal((template.match(/bindtouchend="onInputTouchEnd"/g) || []).length, 1)
  assert.equal((template.match(/bindtouchcancel="onInputTouchCancel"/g) || []).length, 1)
  assert.match(template, /发消息或长按说话…/)
  assert.match(template, /aria-label="向小迈提问，长按可语音输入"/)
})

test('recording state is shown on the input box with theme tokens', () => {
  const shell = styles.match(/\.chat-input-shell\s*\{([^}]+)\}/)
  const active = styles.match(/\.chat-input-shell\.recording, \.chat-input-shell\.transcribing\s*\{([^}]+)\}/)
  assert(shell && active)
  assert.match(shell[1], /flex:\s*1/)
  assert.match(shell[1], /var\(--radius-small\)/)
  assert.match(active[1], /var\(--color-accent-soft\)/)
  assert.doesNotMatch(shell[1] + active[1], /#[\da-f]{3,8}\b|\b\d+(?:px|rpx)\b/i)
})

test('short taps keep text input; only a sustained hold starts recording', () => {
  const start = section(script, 'onInputTouchStart(e) {', 'onInputTouchMove(e) {')
  const end = section(script, 'onInputTouchEnd(e) {', 'onInputTouchCancel() {')
  assert.match(script, /const INPUT_HOLD_MS = 350/)
  assert.match(start, /this\._inputTouchActive \|\|/)
  assert.match(start, /setTimeout\(\(\) => \{[\s\S]*?this\.startVoice\(\)[\s\S]*?\}, INPUT_HOLD_MS\)/)
  assert.match(end, /this\.clearInputHold\(\)/)
  assert.match(end, /if \(this\._voiceActive\) this\.stopVoice\(\{ type: 'touchend' \}\)/)
  assert.match(section(script, 'startVoice() {', 'stopVoice(event) {'), /try \{ wx\.hideKeyboard\(\) \}[\s\S]*?focusInput: false/)
  assert.match(section(script, 'stopVoice(event) {', 'finishLiveVoice(res) {'), /if \(!this\._voiceActive \|\| this\._voiceStopping\) return/)
})

test('finger movement cancels a pending hold; cancel gesture discards the recording', () => {
  const move = section(script, 'onInputTouchMove(e) {', 'onInputTouchEnd(e) {')
  const cancel = section(script, 'onInputTouchCancel() {', 'getVoiceManager() {')
  assert.match(script, /const INPUT_HOLD_MOVE_TOLERANCE = 12/)
  assert.match(move, /Math\.abs\(touch\.clientX - this\._inputTouchX\) > INPUT_HOLD_MOVE_TOLERANCE/)
  assert.match(move, /Math\.abs\(touch\.clientY - this\._inputTouchY\) > INPUT_HOLD_MOVE_TOLERANCE/)
  assert.match(move, /this\._inputTouchMoved = true[\s\S]*?this\.clearInputHold\(\)/)
  assert.match(cancel, /this\.stopVoice\(\{ type: 'touchcancel' \}\)/)
})

test('hold timer and touch state are cleaned on unload', () => {
  const unload = section(script, 'onUnload() {', 'onInput(e) {')
  assert.equal((unload.match(/this\.clearInputHold\(\)/g) || []).length, 1)
  assert.match(unload, /this\._inputTouchActive = false/)
  assert.match(section(script, 'clearInputHold() {', 'onInputTouchStart(e) {'), /clearTimeout\(this\._inputHoldTimer\)/)
})


test('native textarea is disabled before short tap classification and has no overlay during editing', () => {
  const textarea = template.match(/<textarea class="chat-input[^"]*"[^>]+/)[0]
  assert.doesNotMatch(textarea, /bindtouch|catchtouch/)
  assert.match(textarea, /disabled="\{\{!focusInput \|\| sending \|\| attaching \|\| recording \|\| selecting\}\}"/)
  assert.match(textarea, /bindfocus="onInputFocus"/)
  assert.match(textarea, /disable-default-padding="\{\{true\}\}"/)
  assert.match(template, /wx:if="\{\{!focusInput\}\}" class="voice-touch-zone"/)
  assert.match(styles, /\.voice-touch-zone\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0/)
})

test('input, placeholder and both action buttons share the same vertical center', () => {
  for (const selector of ['send-button', 'input-tool']) {
    const rule = styles.match(new RegExp('(?:^|\\n)\\.' + selector + '\\s*\\{([^}]+)\\}'))[1]
    assert.match(rule, /height:\s*var\(--control-height\)/)
    assert.match(rule, /min-height:\s*var\(--control-height\)/)
  }
  assert.match(styles, /\.chat-input-row\s*\{[^}]*align-items:\s*center/)
  assert.match(styles, /\.chat-input-shell\s*\{[^}]*min-height:\s*var\(--control-height\)/)
  assert.match(styles, /\.chat-input\s*\{[^}]*min-height:\s*calc\(var\(--font-body\) \* var\(--line-body\)\)[^}]*padding:\s*0;/)
  assert.match(styles, /\.input-tool-count\s*\{[^}]*position:\s*absolute/)
  const placeholder = styles.match(/\.chat-input-placeholder\s*\{([^}]+)\}/)[1]
  assert.match(placeholder, /position:\s*absolute;[\s\S]*inset:\s*0;/)
  assert.match(placeholder, /display:\s*flex;[\s\S]*align-items:\s*center;/)
  assert.match(placeholder, /padding:\s*0 var\(--space-s\);/)
  assert.match(placeholder, /pointer-events:\s*none;/)
  assert.doesNotMatch(placeholder, /translate|margin-top|padding-top/)
  assert.match(template, /<textarea[^>]*placeholder=""/)
  assert.match(template, /wx:if="\{\{!question && !recording && !voiceTranscribing\}\}" class="chat-input-placeholder" aria-hidden="true"/)
  assert.match(styles, /\.chat-input-placeholder-text\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/)
  const input = template.slice(template.indexOf('<view class="chat-input-shell'), template.indexOf('<button class="btn-primary send-button'))
  assert.match(input, /class="recording-tip"/)
  assert.doesNotMatch(template.slice(0, template.indexOf('<view class="compose-box">')), /class="recording-tip"/)
})

test('unexpected native focus and late keyboard events cannot bypass the hold gate', () => {
  const { front } = require('./helpers.cjs')
  const f = front('ai-chat'), page = f.page
  let hidden = 0
  f.wx.hideKeyboard = () => { hidden++ }
  page.setData({ question: '草稿', inputCursor: 1 })
  page.onInputFocus()
  page.onKeyboardHeight({ detail: { height: 300 } })
  assert.equal(page.data.focusInput, false)
  assert.equal(page.data.keyboardHeight, 0)
  assert.equal(page.data.question, '草稿')
  assert.equal(page.data.inputCursor, 1)
  assert.equal(hidden, 2)
  page.onUnload()
})

test('short tap enables the editor once, preserves the draft, and releases the native cursor for editing', () => {
  const { front } = require('./helpers.cjs')
  const { page } = front('ai-chat')
  const patches = [], setData = page.setData
  page.setData = function (patch) { patches.push(patch); setData.call(this, patch) }
  page.setData({ question: '保留这段文字', inputCursor: 2 })
  page.onInputTouchStart({ touches: [{ clientX: 80, clientY: 300 }], timeStamp: 100 })
  page.focusTextInput({ type: 'tap' })
  assert.equal(page.data.focusInput, false, 'touchdown cannot focus')
  page.onInputTouchEnd({ timeStamp: 220 })
  page.focusTextInput({ type: 'tap' })
  page.focusTextInput({ type: 'tap' })
  assert.equal(patches.filter(p => p.focusInput === true).length, 1)
  page.onInputFocus()
  assert.equal(page.data.focusInput, true)
  assert.equal(page.data.inputCursor, 2)
  page.onInput({ detail: { value: '保留新的文字', cursor: 3 } })
  page.onInputBlur({ detail: { cursor: 4 } })
  assert.equal(page.data.question, '保留新的文字')
  assert.equal(page.data.inputCursor, 4)
  assert.equal(page.data.focusInput, false)
  page.onUnload()
})

test('a delayed hold timer never turns an already released long hold into text input', () => {
  const { front } = require('./helpers.cjs')
  const { page } = front('ai-chat')
  let starts = 0
  page.startVoice = () => { starts++ }
  page.onInputTouchStart({ touches: [{ clientX: 80, clientY: 300 }], timeStamp: 100 })
  page.onInputTouchEnd({ timeStamp: 600 })
  page.focusTextInput({ type: 'tap' })
  assert.equal(page._inputHoldTimer, null)
  assert.equal(page.data.focusInput, false)
  assert.equal(starts, 0, 'must not start recording after release either')
  page.onUnload()
})

test('recorder permission error and trailing taps cannot open the keyboard or leave a pending voice state', async () => {
  const { front } = require('./helpers.cjs')
  const f = front('ai-chat'), page = f.page
  let onError
  page.getVoiceManager = () => null
  f.wx.getRecorderManager = () => ({ onStop() {}, onError(fn) { onError = fn }, start() {}, stop() {} })
  page.onInputTouchStart({ touches: [{ clientX: 80, clientY: 300 }] })
  await new Promise(resolve => setTimeout(resolve, 370))
  onError()
  page.onInputTouchEnd()
  page.focusTextInput({ type: 'tap' })
  assert.equal(page.data.focusInput, false)
  assert.equal(page._voiceActive, false)
  assert.equal(page.data.recording, false)
  assert.equal(page.data.voiceTranscribing, false)
  assert.equal(page.data.selecting, false)
  assert.match(page.data.error, /录音/)
  page.onUnload()
})

test('hiding the page cancels pending holds and an active recording without transcribing', async () => {
  const { front } = require('./helpers.cjs')
  const { page } = front('ai-chat')
  let starts = 0, stops = 0, transcribes = 0
  page._siManager = { start() { starts++ }, stop() { stops++ } }
  page.getVoiceManager = () => page._siManager
  page.transcribeWithAsr = () => { transcribes++ }
  const event = { touches: [{ clientX: 80, clientY: 300 }] }
  page.onInputTouchStart(event)
  page.onHide()
  assert.equal(page._inputHoldTimer, null)
  page.focusTextInput({ type: 'tap' })
  assert.equal(page.data.focusInput, false)
  assert.equal(starts, 0)
  page._inputHidden = false
  page.onInputTouchStart(event)
  await new Promise(resolve => setTimeout(resolve, 370))
  page.onHide()
  page.finishLiveVoice({ tempFilePath: 'cancelled.mp3', result: '不要追加' })
  page.onInputTouchEnd()
  assert.equal(starts, 1)
  assert.equal(stops, 1)
  assert.equal(transcribes, 0)
  assert.equal(page.data.question, '')
  assert.equal(page.data.voiceTranscribing, false)
  assert.equal(page.data.selecting, false)
  page.onUnload()
})

test('multi-touch cancels the pending gesture and cannot focus the input', () => {
  const { front } = require('./helpers.cjs')
  const { page } = front('ai-chat')
  page.onInputTouchStart({ touches: [{ clientX: 80, clientY: 300 }] })
  page.onInputTouchStart({ touches: [{ clientX: 80, clientY: 300 }, { clientX: 100, clientY: 310 }] })
  page.onInputTouchEnd()
  page.focusTextInput({ type: 'tap' })
  assert.equal(page._inputHoldTimer, null)
  assert.equal(page.data.focusInput, false)
  page.onUnload()
})

test('recording from an already focused editor stops once and transcribes without refocusing', () => {
  const { front } = require('./helpers.cjs')
  const { page } = front('ai-chat')
  let starts = 0, stops = 0
  page._siManager = { start() { starts++ }, stop() { stops++ } }
  page.getVoiceManager = () => page._siManager
  page.setData({ question: '已有草稿', focusInput: true, inputCursor: 2, keyboardHeight: 300 })
  page.startVoice()
  assert.equal(page.data.focusInput, false)
  assert.equal(page.data.keyboardHeight, 0)
  page.stopVoice({ type: 'touchend' })
  page.stopVoice({ type: 'touchend' })
  assert.equal(page.data.voiceTranscribing, true)
  page.finishLiveVoice({ result: '追加结果' })
  assert.equal(starts, 1)
  assert.equal(stops, 1)
  assert.equal(page.data.question, '已有草稿 追加结果')
  assert.equal(page.data.inputCursor, 2)
  assert.equal(page.data.focusInput, false)
  assert.equal(page.data.voiceTranscribing, false)
  assert.equal(page.data.selecting, false)
  page.onUnload()
})

for (const fails of [false, true]) test('one-shot ASR clears the inline progress and temporary audio on ' + (fails ? 'failure' : 'success'), async () => {
  const { front, NOW } = require('./helpers.cjs')
  let requests = 0, uploads = 0, deletes = 0
  const f = front('ai-chat', { callFunction: async ({ name }) => {
    assert.equal(name, 'asrProxy')
    requests++
    if (fails) throw Error('network unavailable')
    return { result: { code: 0, configured: true, text: '转写结果' } }
  } })
  f.wx.cloud.uploadFile = async () => { uploads++; return { fileID: 'cloud://temporary-audio' } }
  f.wx.cloud.deleteFile = async ({ fileList }) => {
    deletes++
    assert.deepEqual(Array.from(fileList), ['cloud://temporary-audio'])
  }
  const page = f.page
  page._voiceStarted = +NOW - 2000
  page.setData({ question: '已有文字', focusInput: false })
  const pending = page.transcribeWithAsr('recording.mp3')
  assert.equal(page.data.voiceTranscribing, true)
  assert.equal(page.data.selecting, true)
  await pending
  assert.equal(page.data.voiceTranscribing, false)
  assert.equal(page.data.recording, false)
  assert.equal(page.data.selecting, false)
  assert.equal(page.data.focusInput, false)
  assert.equal(page.data.question, fails ? '已有文字' : '已有文字 转写结果')
  assert.equal(uploads, 1)
  assert.equal(requests, 1)
  assert.equal(deletes, 1)
  if (fails) assert(f.calls.some(call => call.type === 'toast' && /转写失败/.test(call.title)))
  page.onUnload()
})

for (const input of ['', '保留已有文字']) test('hold isolates native focus and preserves text/cursor: ' + (input || 'empty'), async () => {
  const { front } = require('./helpers.cjs')
  const f = front('ai-chat'), page = f.page
  let started = 0, stopped = 0, hidden = 0
  f.wx.hideKeyboard = () => { hidden++ }
  page._siManager = { start() { started++ }, stop() { stopped++ } }
  page.getVoiceManager = () => page._siManager
  page.setData({ question: input, inputCursor: 3, focusInput: false })
  const event = { touches: [{ clientX: 150, clientY: 400 }] }
  page.onInputTouchStart(event)
  page.onInputTouchStart(event)
  await new Promise(resolve => setTimeout(resolve, 370))
  assert.equal(started, 1, 'overlay/shell duplicates do not start twice')
  assert.equal(hidden, 1)
  assert.equal(page.data.recording, true)
  assert.equal(page.data.focusInput, false)
  assert.equal(page.data.question, input)
  assert.equal(page.data.inputCursor, 3)
  page.onInputTouchEnd()
  page.focusTextInput()
  assert.equal(stopped, 1)
  assert.equal(page.data.focusInput, false, 'the trailing tap after a hold must not open keyboard')
  page._voiceActive = false
  page.setData({ recording: false, selecting: false })
  page.onInputTouchStart(event)
  page.onInputTouchEnd()
  page.focusTextInput()
  assert.equal(page.data.focusInput, true)
  page.onInputBlur()
  page.onInputTouchStart(event)
  page.onInputTouchMove({ touches: [{ clientX: 164, clientY: 400 }] })
  page.onInputTouchEnd()
  page.focusTextInput()
  assert.equal(page.data.focusInput, false, 'cancelled movement cannot focus the textarea')
  page.onUnload()
})
