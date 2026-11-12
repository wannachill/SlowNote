// Small, dependency-free Markdown subset for rich-text nodes.
// It intentionally favors removing unsupported syntax over exposing markers.
function textNode(text) {
  return text ? { type: 'text', text } : null
}

function cleanGlyphs(value) {
  return Array.from(String(value || '')).filter(char => {
      const point = char.codePointAt(0)
      return !(point === 0xfe0e || point === 0xfe0f || point === 0x200d || point === 0x20e3 ||
        (point >= 0x2600 && point <= 0x27bf) || (point >= 0x2b00 && point <= 0x2bff) ||
        (point >= 0x1f000 && point <= 0x1faff) || (point >= 0x1f1e6 && point <= 0x1f1ff))
    })
    .join('')
}

function plainText(value, trimLines = true) {
  const stripped = String(value || '')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/`{1,3}/g, '')
    .replace(/[~*_]/g, '')
    .replace(/[<>|]/g, '')
  return cleanGlyphs(stripped).split('\n').map(line => {
    const normalized = line.replace(/ {2,}/g, ' ')
    return trimLines ? normalized.trim() : normalized
  }).join('\n')
}

function inlineNodes(value, depth = 0) {
  let source = String(value || '')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
  const nodes = []
  const pattern = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]*`|\*[^*\n]+?\*|_[^_\n]+?_)/g
  let last = 0
  let match
  while ((match = pattern.exec(source))) {
    const before = plainText(source.slice(last, match.index), false)
    if (before) nodes.push(textNode(before))
    const token = match[0]
    let name = ''
    let className = ''
    let inner = ''
    if (token.startsWith('**') || token.startsWith('__')) {
      name = 'strong'; className = 'md-strong'; inner = token.slice(2, -2)
    } else if (token.startsWith('`')) {
      name = 'code'; className = 'md-inline-code'; inner = token.slice(1, -1)
    } else {
      name = 'em'; className = 'md-em'; inner = token.slice(1, -1)
    }
    const children = name === 'code' || depth > 2
      ? [textNode(plainText(inner, false))].filter(Boolean)
      : inlineNodes(inner, depth + 1)
    nodes.push({ name, attrs: { class: className }, children })
    last = match.index + token.length
  }
  const tail = plainText(source.slice(last), false)
  if (tail) nodes.push(textNode(tail))
  return nodes
}

function lineNode(value, className = 'md-paragraph') {
  return { name: 'div', attrs: { class: className }, children: inlineNodes(value) }
}

function isRule(line) {
  return /^\s*(?:---+|___+|\*\s*\*\s*\*\s*)$/.test(line)
}

function isTableRule(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function cleanTableLine(line) {
  return line.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseMarkdown(input) {
  const source = String(input == null ? '' : input).replace(/\r\n?/g, '\n')
  if (!source) return []
  const output = []
  const lines = source.split('\n')
  let paragraph = []
  let inFence = false

  const flush = () => {
    if (!paragraph.length) return
    const children = []
    paragraph.forEach((line, index) => {
      if (index) children.push({ name: 'br' })
      children.push(...inlineNodes(line))
    })
    output.push({ name: 'div', attrs: { class: 'md-paragraph' }, children })
    paragraph = []
  }

  lines.forEach(rawLine => {
    const fence = /^\s*```/.test(rawLine)
    if (fence) { inFence = !inFence; return }
    const line = cleanGlyphs(rawLine.replace(/\t/g, '    ')).replace(/ {2,}/g, ' ').trim()
    if (!inFence && !line.trim()) { flush(); return }
    if (!inFence && isRule(line)) { flush(); return }

    const heading = !inFence && line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) { flush(); output.push(lineNode(heading[2], `md-heading md-heading-${heading[1].length}`)); return }
    const unordered = !inFence && line.match(/^\s*[-*+]\s+(.+)$/)
    if (unordered) { flush(); output.push(lineNode(`• ${unordered[1]}`, 'md-list-item md-unordered')); return }
    const ordered = !inFence && line.match(/^\s*(\d+)[.)]\s+(.+)$/)
    if (ordered) { flush(); output.push(lineNode(`${ordered[1]}. ${ordered[2]}`, 'md-list-item md-ordered')); return }
    const quote = !inFence && line.match(/^\s*>\s?(.*)$/)
    if (quote) { paragraph.push(quote[1]); return }
    if (!inFence && isTableRule(line)) { flush(); return }
    paragraph.push(!inFence && line.includes('|') ? cleanTableLine(line) : line)
  })
  flush()
  return output
}

module.exports = parseMarkdown
module.exports.parseMarkdown = parseMarkdown
