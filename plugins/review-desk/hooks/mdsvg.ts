// Markdown drawn as SVG text, so the desktop app shows it in a frame where it can be selected and copied.
// The app draws its own text elements unselectable; an interactive Svg's text is not. The mod wraps the
// text itself, by an estimate of glyph widths, and keeps to the Markdown a review uses: paragraphs,
// headings, lists, quotes, **bold**, *italic*, `code` and links (drawn with their address, not clickable).

const FONT = 14
const LINE = Math.round(FONT * 1.5)
const GAP = 8

type Style = 'n' | 'b' | 'i' | 'bi' | 'c' | 'l'
type Run = { text: string; style: Style }
type Block = { kind: 'p' | 'h' | 'li' | 'quote'; runs: Run[]; bullet?: string; level?: number }

/** Average glyph width for a style, in ems: generous, so a line is never wider than the box. */
const EM: Record<Style, number> = { n: 0.53, i: 0.53, l: 0.53, b: 0.58, bi: 0.58, c: 0.62 }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = `<style>
svg{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:${FONT}px}
text{fill:#1f1e1c}.d text{fill:#6b6a66}.dim{fill:#6b6a66}.b{font-weight:700}.i{font-style:italic}.c{font-family:ui-monospace,Consolas,monospace;fill:#8a4b08}.l{fill:#1565c0;text-decoration:underline}.u{fill:#6b6a66}.bar{fill:#c9c7bf}.h{font-weight:700}
@media (prefers-color-scheme: dark){text{fill:#ececec}.d text,.dim,.u{fill:#a8a8a4}.c{fill:#ffcc80}.l{fill:#64b5f6}.bar{fill:#4a4946}}
</style>`

/** Inline Markdown to styled runs. A link becomes its text, then its address in brackets. */
export function inlineRuns(src: string, base: Style = 'n'): Run[] {
  const runs: Run[] = []
  const re = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g
  let at = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > at) runs.push({ text: src.slice(at, m.index), style: base })
    if (m[2] !== undefined) runs.push({ text: m[2], style: 'bi' })
    else if (m[3] !== undefined || m[4] !== undefined) runs.push({ text: (m[3] ?? m[4])!, style: base === 'i' ? 'bi' : 'b' })
    else if (m[5] !== undefined || m[6] !== undefined) runs.push({ text: (m[5] ?? m[6])!, style: base === 'b' ? 'bi' : 'i' })
    else if (m[7] !== undefined) runs.push({ text: m[7], style: 'c' })
    else if (m[8] !== undefined) {
      runs.push({ text: m[8], style: 'l' })
      if (m[9] && m[9] !== m[8]) runs.push({ text: ` (${m[9]})`, style: 'n' })
    }
    at = m.index + m[0].length
  }
  if (at < src.length) runs.push({ text: src.slice(at), style: base })
  return runs.filter(r => r.text)
}

/** Block Markdown to blocks; a table is kept as plain rows. */
export function blocksOf(md: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', runs: inlineRuns(para.join(' ')) })
    para = []
  }
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    const q = /^>\s?(.*)$/.exec(line)
    if (h) {
      flush()
      blocks.push({ kind: 'h', runs: inlineRuns(h[2] ?? '', 'b'), level: h[1]!.length })
    } else if (li) {
      flush()
      const marker = li[2]!
      blocks.push({ kind: 'li', runs: inlineRuns(li[3] ?? ''), bullet: /\d/.test(marker) ? marker : '•', level: Math.min(3, Math.floor((li[1] ?? '').length / 2)) })
    } else if (q) {
      flush()
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'quote' && (q[1] ?? '').trim()) last.runs.push({ text: ' ', style: 'n' }, ...inlineRuns(q[1] ?? ''))
      else if ((q[1] ?? '').trim()) blocks.push({ kind: 'quote', runs: inlineRuns(q[1] ?? '') })
    } else if (/^\|.*\|$/.test(line.trim())) {
      flush()
      if (!/^\|[\s:|-]+\|$/.test(line.trim())) blocks.push({ kind: 'p', runs: inlineRuns(line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()).join('  ·  ')) })
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) flush()
    else para.push(line.trim())
  }
  flush()
  return blocks
}

type Piece = { text: string; style: Style; w: number }

/** A glyph's width in ems for a sans-serif face, by shape; a little generous, so text never overruns. */
function glyph(ch: string): number {
  if (/[ilj.,'!|:;`]/.test(ch)) return 0.3
  if (/[ftr()\[\]{}\-"\s]/.test(ch)) return 0.38
  if (/[mw]/.test(ch)) return 0.82
  if (/[MW]/.test(ch)) return 0.95
  if (/[A-Z]/.test(ch)) return 0.7
  if (/[0-9]/.test(ch)) return 0.58
  if (/[a-z]/.test(ch)) return 0.56
  return 0.9 // symbols, emoji, other scripts
}

const BOLD = 1.08

const widthOf = (text: string, style: Style, size: number) => {
  if (style === 'c') return text.length * EM.c * size
  let ems = 0
  for (const ch of text) ems += glyph(ch)
  return ems * size * (style === 'b' || style === 'bi' ? BOLD : 1)
}

/** Wraps runs into lines no wider than `max`; a word wider than a line is cut. */
function wrapRuns(runs: Run[], max: number, size: number): Piece[][] {
  const lines: Piece[][] = [[]]
  let used = 0
  const put = (text: string, style: Style) => {
    const w = widthOf(text, style, size)
    lines[lines.length - 1]!.push({ text, style, w })
    used += w
  }
  for (const run of runs) {
    for (const token of run.text.split(/(\s+)/)) {
      if (!token) continue
      const isSpace = /^\s+$/.test(token)
      if (isSpace) {
        if (used > 0) put(' ', run.style)
        continue
      }
      let word = token
      let w = widthOf(word, run.style, size)
      if (used + w > max && used > 0) {
        const line = lines[lines.length - 1]!
        while (line.length && line[line.length - 1]!.text === ' ') line.pop()
        lines.push([])
        used = 0
      }
      while (w > max) {
        let fit = 1
        while (fit < word.length && widthOf(word.slice(0, fit + 1), run.style, size) <= max) fit++
        put(word.slice(0, fit), run.style)
        lines.push([])
        used = 0
        word = word.slice(fit)
        w = widthOf(word, run.style, size)
      }
      if (word) put(word, run.style)
    }
  }
  return lines.filter((l, i) => l.length || i === 0)
}

/** Neighbouring pieces of one style become one run, so a link or a bold phrase is one span. */
const merged = (pieces: Piece[]) =>
  pieces.reduce<Piece[]>((out, p) => {
    const last = out[out.length - 1]
    if (last && last.style === p.style) last.text += p.text
    else out.push({ ...p })
    return out
  }, [])

const tspans = (pieces: Piece[]) =>
  merged(pieces)
    .map(p => (p.style === 'n' ? esc(p.text) : `<tspan class="${p.style === 'bi' ? 'b i' : p.style}">${esc(p.text)}</tspan>`))
    .join('')

export type TextDrawn = { svg: string; height: number; alt: string }

/** Markdown at a width, as an SVG of selectable text, its height, and the plain text for `alt`. */
export function markdownSvg(md: string, width: number, isDim = false): TextDrawn {
  const blocks = blocksOf(md)
  let y = 0
  let body = ''
  const plain: string[] = []
  blocks.forEach((b, n) => {
    if (n > 0) y += GAP
    const size = b.kind === 'h' ? (b.level === 1 ? FONT + 4 : b.level === 2 ? FONT + 2 : FONT + 1) : FONT
    const lh = Math.round(size * 1.5)
    const indent = b.kind === 'li' ? 18 + (b.level ?? 0) * 16 : b.kind === 'quote' ? 14 : 0
    const lines = wrapRuns(b.runs, Math.max(60, width - indent - 4), size)
    const top = y
    lines.forEach((line, i) => {
      y += lh
      const cls = b.kind === 'h' ? ' class="h"' : ''
      body += `<text x="${indent}" y="${(y - lh * 0.3).toFixed(1)}"${cls}${b.kind === 'h' ? ` style="font-size:${size}px"` : ''} xml:space="preserve">${tspans(line)}</text>`
      if (i === 0 && b.kind === 'li') body += `<text x="${indent - 14}" y="${(y - lh * 0.3).toFixed(1)}" class="u">${esc(b.bullet ?? '•')}</text>`
    })
    if (b.kind === 'quote') body += `<rect x="0" y="${top + 3}" width="3" height="${Math.max(0, y - top - 4)}" rx="1.5" class="bar"/>`
    plain.push((b.kind === 'li' ? `${b.bullet} ` : '') + b.runs.map(r => r.text).join(''))
  })
  const height = Math.max(LINE, Math.ceil(y + 4))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${STYLE}<g${isDim ? ' class="d"' : ''}>${body}</g></svg>`
  return { svg, height, alt: plain.join('\n') }
}
