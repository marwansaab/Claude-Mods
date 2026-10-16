// Animated SVG for the desktop pane: the desk header, the card strip and explainer scenes.
// Each drawing ends in its final state when motion is reduced (the animations only lead into it).
import type { Claim, Scene, SceneItem, Tone } from '../types'
import type { CardState } from './pack'

export type Drawn = { svg: string; height: number; alt: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = `<style>
svg{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.ink{fill:#1f1e1c}.dim{fill:#6b6a66}.faint{fill:#a3a19a}.ln{stroke:#d8d6cf}.lnf{fill:#d8d6cf}.card{fill:#ffffff;stroke:#e4e2db}.surf{fill:#f4f3ee}
.f-subject{fill:#c2185b}.f-context{fill:#6b6a66}.f-risk{fill:#b26a00}.f-question{fill:#6a3fb5}.f-decision{fill:#1565c0}.f-good{fill:#2e7d32}
.s-subject{stroke:#c2185b}.s-context{stroke:#8d8b85}.s-risk{stroke:#b26a00}.s-question{stroke:#6a3fb5}.s-decision{stroke:#1565c0}.s-good{stroke:#2e7d32}
.b-subject{fill:#fce4ec}.b-context{fill:#f1f0ec}.b-risk{fill:#fff3e0}.b-question{fill:#efe7fb}.b-decision{fill:#e3f0fc}.b-good{fill:#e6f4e7}
.g-A{fill:#1b5e20}.g-B{fill:#388e3c}.g-C{fill:#8d8b3a}.g-D{fill:#757575}.g-x{fill:#c62828}
.on{fill:#2e7d32}.half{fill:#b26a00}.off{fill:#d8d6cf}.cur{stroke:#c2185b}
@media (prefers-color-scheme: dark){
.ink{fill:#ececec}.dim{fill:#a8a8a4}.faint{fill:#77756f}.ln{stroke:#3c3b38}.lnf{fill:#3c3b38}.card{fill:#2b2b29;stroke:#3c3b38}.surf{fill:#232321}
.f-subject{fill:#f06292}.f-context{fill:#a8a8a4}.f-risk{fill:#ffb74d}.f-question{fill:#b39ddb}.f-decision{fill:#64b5f6}.f-good{fill:#81c784}
.s-subject{stroke:#f06292}.s-context{stroke:#8d8b85}.s-risk{stroke:#ffb74d}.s-question{stroke:#b39ddb}.s-decision{stroke:#64b5f6}.s-good{stroke:#81c784}
.b-subject{fill:#43202d}.b-context{fill:#2f2f2c}.b-risk{fill:#3d2d14}.b-question{fill:#2f2640}.b-decision{fill:#1b2d40}.b-good{fill:#1f3321}
.g-A{fill:#66bb6a}.g-B{fill:#81c784}.g-C{fill:#c5c36a}.g-D{fill:#9e9e9e}.g-x{fill:#ef5350}
.on{fill:#81c784}.half{fill:#ffb74d}.off{fill:#3c3b38}.cur{stroke:#f06292}}
@keyframes rd-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes rd-fade{from{opacity:0}to{opacity:1}}
@keyframes rd-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes rd-rise{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes rd-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes rd-pop{0%{transform:scale(0)}70%{transform:scale(1.18)}100%{transform:scale(1)}}
@keyframes rd-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes rd-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.in{animation:rd-in .55s cubic-bezier(.2,.7,.2,1) both}
.fade{animation:rd-fade .5s ease both}
.grow{transform-box:fill-box;transform-origin:left center;animation:rd-grow .9s cubic-bezier(.3,.7,.2,1) both}
.rise{transform-box:fill-box;transform-origin:center bottom;animation:rd-rise .7s cubic-bezier(.3,.7,.2,1) both}
.draw{stroke-dasharray:1;animation:rd-draw .7s ease-out both}
.pop{transform-box:fill-box;transform-origin:center;animation:rd-pop .5s ease-out both}
.bob{animation:rd-bob 2.8s ease-in-out infinite}
.pulse{animation:rd-pulse 1.6s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>`

const svgDoc = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${STYLE}${body}</svg>`

const delay = (s: number) => `style="animation-delay:${s.toFixed(2)}s"`
const toneOf = (t?: Tone): Tone => t ?? 'context'

/** Greedy word wrap to an approximate number of characters per line. */
export function wrap(text: string, perLine: number, maxLines = 6): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if (!line) line = w
    else if ((line + ' ' + w).length <= perLine) line += ' ' + w
    else {
      lines.push(line)
      line = w
    }
    if (lines.length === maxLines) break
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = (lines[maxLines - 1] ?? '').replace(/.{0,2}$/, '…')
  return lines.map(l => (l.length > perLine + 6 ? l.slice(0, perLine + 4) + '…' : l))
}

const textLines = (x: number, y: number, lines: string[], size: number, cls: string, lh = 1.3, weight = 400, anchor = 'start') =>
  lines
    .map((l, i) => `<text x="${x}" y="${(y + i * size * lh).toFixed(1)}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" class="${cls}">${esc(l)}</text>`)
    .join('')

/** A claim chip: id and grade, the claim's text as its tooltip. */
function badge(x: number, y: number, id: string | undefined, claims: Map<string, Claim>, anchor: 'start' | 'end' = 'end'): string {
  if (!id) return ''
  const c = claims.get(id)
  const label = `${id}${c?.grade ? ` ${c.grade}` : ''}`
  const w = 9 + label.length * 6.2
  const x0 = anchor === 'end' ? x - w : x
  const cls = c?.grade && c.grade !== 'D' ? `g-${c.grade}` : c?.grade === 'D' ? 'g-D' : 'g-x'
  const tip = c ? `${c.text}${c.source ? ` (${c.source})` : ''}` : 'Claim not listed'
  return `<g><title>${esc(tip)}</title><rect x="${x0}" y="${y}" width="${w}" height="15" rx="7.5" class="${cls}"/><text x="${x0 + w / 2}" y="${y + 11}" font-size="10" font-weight="600" text-anchor="middle" fill="#fff">${esc(label)}</text></g>`
}

// ---------- the desk ----------

/** The list's header: a stack of review cards, the pending count and the share answered. */
export function deskHeaderSvg(w: number, pending: number, reviewed: number, answered: number, cards: number): Drawn {
  const share = cards ? answered / cards : 0
  const stack = [0, 1, 2]
    .map(i => {
      const x = 18 + i * 7
      const y = 18 - i * 5
      const tone = ['decision', 'question', 'subject'][i]
      return `<g ${delay(0.08 * i)} class="in"><g class="${i === 2 && pending ? 'bob' : ''}"><rect x="${x}" y="${y}" width="46" height="58" rx="6" class="card"/><rect x="${x}" y="${y}" width="5" height="58" rx="2" class="f-${tone}"/><rect x="${x + 11}" y="${y + 12}" width="26" height="4" rx="2" class="lnf"/><rect x="${x + 11}" y="${y + 21}" width="20" height="4" rx="2" class="lnf"/><rect x="${x + 11}" y="${y + 30}" width="24" height="4" rx="2" class="lnf"/></g></g>`
    })
    .join('')
  const bubble = pending
    ? `<g class="pop" ${delay(0.35)}><circle cx="78" cy="16" r="12" class="f-subject"/><text x="78" y="20.5" font-size="12" font-weight="700" text-anchor="middle" fill="#fff">${pending > 99 ? '99+' : pending}</text></g>`
    : ''
  const barX = 110
  const barW = Math.max(60, w - barX - 20)
  const words = pending ? `${pending} waiting for you` : 'Nothing waiting'
  const sub = `${reviewed} reviewed${cards ? ` · ${answered} of ${cards} open cards answered` : ''}`
  const lines = wrap(`${words} · ${sub}`, Math.max(16, Math.floor(barW / 6.4)), 3)
  const barY = 52 + lines.length * 16 - 4
  const h = Math.max(92, barY + 22)
  const body =
    stack +
    bubble +
    `<text x="${barX}" y="32" font-size="17" font-weight="700" class="ink in">Review desk</text>` +
    `<g class="fade" ${delay(0.2)}>${textLines(barX, 52, lines, 12.5, 'dim', 1.3)}</g>` +
    `<rect x="${barX}" y="${barY}" width="${barW}" height="6" rx="3" class="surf"/>` +
    (share > 0 ? `<rect x="${barX}" y="${barY}" width="${(barW * share).toFixed(1)}" height="6" rx="3" class="f-good grow" ${delay(0.3)}/>` : '')
  return { svg: svgDoc(w, h, body), height: h, alt: `Review desk: ${words}; ${sub}.` }
}

/** One dot per card, coloured by the owner's progress, the current one ringed. */
export function stripSvg(w: number, states: CardState[], current: number): Drawn {
  const n = states.length
  const h = 30
  const gap = Math.min(26, Math.max(8, (w - 24) / Math.max(1, n)))
  const r = Math.max(3, Math.min(7, gap / 2 - 2))
  const x0 = 12 + r
  const dots = states
    .map((s, i) => {
      const cx = x0 + i * gap
      const cls = s === 'done' ? 'on' : s === 'partial' ? 'half' : 'off'
      const ring = i === current ? `<circle cx="${cx}" cy="15" r="${r + 3.5}" fill="none" stroke-width="2" class="cur pulse"/>` : ''
      return `${ring}<circle cx="${cx}" cy="15" r="${r}" class="${cls} pop" ${delay(0.03 * i)}/>`
    })
    .join('')
  const line = n > 1 ? `<line x1="${x0}" y1="15" x2="${x0 + (n - 1) * gap}" y2="15" stroke-width="2" class="ln"/>` : ''
  const done = states.filter(s => s === 'done').length
  return { svg: svgDoc(Math.max(w, x0 + n * gap), h, line + dots), height: h, alt: `Card ${current + 1} of ${n}; ${done} answered.` }
}

// ---------- explainer scenes ----------

type Box = { x: number; y: number; w: number; h: number }

function itemBox(b: Box, it: SceneItem, claims: Map<string, Claim>, d: number, titlePer: number, textPer: number): string {
  const tone = toneOf(it.tone)
  const t = wrap(it.title, titlePer, 3)
  const body = it.text ? wrap(it.text, textPer, 6) : []
  return (
    `<g transform="translate(${b.x},${b.y})"><g class="in" ${delay(d)}>` +
    `<rect width="${b.w}" height="${b.h}" rx="8" class="b-${tone}"/><rect width="4" height="${b.h}" rx="2" class="f-${tone}"/>` +
    textLines(14, 21, t, 13.5, 'ink', 1.25, 650) +
    textLines(14, 21 + t.length * 17 + 4, body, 12, 'dim', 1.35) +
    badge(b.w - 8, 7, it.claim, claims) +
    `</g></g>`
  )
}

const boxHeight = (it: SceneItem, titlePer: number, textPer: number) =>
  20 + wrap(it.title, titlePer, 3).length * 17 + (it.text ? 4 + wrap(it.text, textPer, 6).length * 16.2 : 0) + 6

function cardsScene(w: number, items: SceneItem[], claims: Map<string, Claim>): Drawn {
  const cols = w >= 640 ? Math.min(3, items.length) : w >= 420 ? Math.min(2, items.length) : 1
  const gap = 12
  const cw = (w - 24 - gap * (cols - 1)) / cols
  const tp = Math.floor((cw - 28) / 7.6)
  const xp = Math.floor((cw - 28) / 6.4)
  let y = 12
  let body = ''
  for (let r = 0; r * cols < items.length; r++) {
    const row = items.slice(r * cols, r * cols + cols)
    const rh = Math.max(...row.map(it => boxHeight(it, tp, xp)))
    row.forEach((it, i) => (body += itemBox({ x: 12 + i * (cw + gap), y, w: cw, h: rh }, it, claims, 0.12 * (r * cols + i), tp, xp)))
    y += rh + gap
  }
  return { svg: svgDoc(w, y, body), height: y, alt: items.map(i => `${i.title}${i.text ? `: ${i.text}` : ''}`).join('. ') }
}

function listScene(w: number, items: SceneItem[], claims: Map<string, Claim>): Drawn {
  const per = Math.floor((w - 70) / 7)
  let y = 14
  let body = ''
  items.forEach((it, i) => {
    const t = wrap(it.title, per, 3)
    const x = it.text ? wrap(it.text, Math.floor((w - 70) / 6.4), 4) : []
    const h = t.length * 17 + x.length * 16 + 10
    body +=
      `<g transform="translate(14,${y})"><g class="in" ${delay(0.15 * i)}>` +
      `<circle cx="9" cy="9" r="9" class="f-${toneOf(it.tone)}"/><text x="9" y="13" font-size="10.5" font-weight="700" text-anchor="middle" fill="#fff">${i + 1}</text>` +
      textLines(28, 13, t, 13.5, 'ink', 1.25, 600) +
      textLines(28, 13 + t.length * 17, x, 12, 'dim', 1.35) +
      badge(w - 30, 0, it.claim, claims) +
      `</g></g>`
    y += h + 8
  })
  return { svg: svgDoc(w, y + 4, body), height: y + 4, alt: items.map((i, n) => `${n + 1}. ${i.title}${i.text ? `: ${i.text}` : ''}`).join(' ') }
}

function flowScene(w: number, items: SceneItem[], claims: Map<string, Claim>): Drawn {
  const n = items.length
  const isRow = w >= 560 && n <= 5
  if (!isRow) {
    const bw = w - 60
    const tp = Math.floor((bw - 28) / 7.6)
    const xp = Math.floor((bw - 28) / 6.4)
    let y = 12
    let body = ''
    items.forEach((it, i) => {
      const h = boxHeight(it, tp, xp)
      body += itemBox({ x: 30, y, w: bw, h }, it, claims, 0.35 * i, tp, xp)
      if (i < n - 1)
        body += `<path d="M ${w / 2} ${y + h + 2} L ${w / 2} ${y + h + 20}" pathLength="1" fill="none" stroke-width="2" class="s-context draw" ${delay(0.35 * i + 0.25)}/><path d="M ${w / 2 - 5} ${y + h + 14} L ${w / 2} ${y + h + 21} L ${w / 2 + 5} ${y + h + 14}" fill="none" stroke-width="2" class="s-context fade" ${delay(0.35 * i + 0.5)}/>`
      y += h + 24
    })
    return { svg: svgDoc(w, y, body), height: y, alt: items.map(i => i.title).join(' → ') }
  }
  const gap = 34
  const bw = (w - 24 - gap * (n - 1)) / n
  const tp = Math.floor((bw - 28) / 7.6)
  const xp = Math.floor((bw - 28) / 6.4)
  const h = Math.max(...items.map(it => boxHeight(it, tp, xp)))
  let body = ''
  items.forEach((it, i) => {
    const x = 12 + i * (bw + gap)
    body += itemBox({ x, y: 14, w: bw, h }, it, claims, 0.35 * i, tp, xp)
    if (i < n - 1) {
      const ax = x + bw + 4
      const ay = 14 + h / 2
      body += `<path d="M ${ax} ${ay} L ${ax + gap - 8} ${ay}" pathLength="1" fill="none" stroke-width="2" class="s-context draw" ${delay(0.35 * i + 0.25)}/><path d="M ${ax + gap - 14} ${ay - 5} L ${ax + gap - 7} ${ay} L ${ax + gap - 14} ${ay + 5}" fill="none" stroke-width="2" class="s-context fade" ${delay(0.35 * i + 0.5)}/>`
    }
  })
  return { svg: svgDoc(w, h + 28, body), height: h + 28, alt: items.map(i => i.title).join(' → ') }
}

function timelineScene(w: number, items: SceneItem[], claims: Map<string, Claim>): Drawn {
  const n = items.length
  if (w < 520 || n > 7) {
    let y = 16
    let body = `<line x1="26" y1="10" x2="26" y2="${10 + n * 54}" stroke-width="2" pathLength="1" class="ln draw"/>`
    items.forEach((it, i) => {
      const x = wrap(it.text ?? '', Math.floor((w - 70) / 6.4), 2)
      body +=
        `<circle cx="26" cy="${y + 4}" r="7" class="f-${toneOf(it.tone)} pop" ${delay(0.25 * i + 0.2)}/>` +
        `<g class="in" ${delay(0.25 * i + 0.3)}>${textLines(44, y + 9, [it.title], 13.5, 'ink', 1.2, 650)}${textLines(44, y + 26, x, 12, 'dim')}${badge(w - 12, y - 4, it.claim, claims)}</g>`
      y += 54
    })
    return { svg: svgDoc(w, y, body), height: y, alt: items.map(i => `${i.title}${i.text ? `: ${i.text}` : ''}`).join('; ') }
  }
  const step = (w - 60) / Math.max(1, n - 1)
  const per = Math.max(10, Math.floor(step / 6.6))
  const h = 170
  let body = `<line x1="30" y1="85" x2="${w - 30}" y2="85" stroke-width="2" pathLength="1" class="ln draw"/>`
  items.forEach((it, i) => {
    const cx = n === 1 ? w / 2 : 30 + i * step
    const isUp = i % 2 === 0
    const t = wrap(it.title, per, 2)
    const x = wrap(it.text ?? '', per + 2, 2)
    const ty = isUp ? 70 - (t.length + x.length - 1) * 15 : 106
    body +=
      `<circle cx="${cx}" cy="85" r="8" class="f-${toneOf(it.tone)} pop" ${delay(0.25 * i + 0.3)}/>` +
      `<g class="in" ${delay(0.25 * i + 0.4)}>${textLines(cx, ty, t, 12.5, 'ink', 1.2, 650, 'middle')}${textLines(cx, ty + t.length * 15, x, 11, 'dim', 1.3, 400, 'middle')}</g>` +
      badge(cx + 4, isUp ? 92 : 64, it.claim, claims, 'start')
  })
  return { svg: svgDoc(w, h, body), height: h, alt: items.map(i => `${i.title}${i.text ? `: ${i.text}` : ''}`).join('; ') }
}

function funnelScene(w: number, items: { label: string; value?: string; tone?: Tone; claim?: string }[], claims: Map<string, Claim>): Drawn {
  const n = items.length
  const lh = 44
  const top = Math.min(w - 40, 560)
  const cx = w / 2
  let body = ''
  items.forEach((it, i) => {
    const w1 = top * (1 - i / (n + 0.6))
    const w2 = top * (1 - (i + 1) / (n + 0.6))
    const y = 10 + i * (lh + 4)
    body +=
      `<g class="in" ${delay(0.22 * i)}><path d="M ${cx - w1 / 2} ${y} L ${cx + w1 / 2} ${y} L ${cx + w2 / 2} ${y + lh} L ${cx - w2 / 2} ${y + lh} Z" class="b-${toneOf(it.tone ?? (i === n - 1 ? 'subject' : 'context'))}"/>` +
      `<text x="${cx}" y="${y + lh / 2 + (it.value ? -2 : 5)}" font-size="13" font-weight="650" text-anchor="middle" class="ink">${esc(it.label)}</text>` +
      (it.value ? `<text x="${cx}" y="${y + lh / 2 + 14}" font-size="11.5" text-anchor="middle" class="dim">${esc(it.value)}</text>` : '') +
      badge(cx + w1 / 2 - 4, y + 4, it.claim, claims) +
      `</g>`
  })
  const h = 14 + n * (lh + 4)
  return { svg: svgDoc(w, h, body), height: h, alt: items.map(i => `${i.label}${i.value ? ` ${i.value}` : ''}`).join(' → ') }
}

function barsScene(w: number, s: Extract<Scene, { kind: 'bars' }>, claims: Map<string, Claim>): Drawn {
  const labelW = Math.min(220, Math.max(90, w * 0.3))
  const valW = 74
  const trackX = labelW + 16
  const trackW = Math.max(40, w - trackX - valW - 12)
  const max = s.max ?? Math.max(...s.items.map(i => i.value), s.mark?.value ?? 0, 1)
  const rh = 34
  let body = ''
  s.items.forEach((it, i) => {
    const y = 12 + i * rh
    const share = Math.max(0, Math.min(1, it.value / max))
    body +=
      `<g class="fade" ${delay(0.12 * i)}>${textLines(labelW, y + 15, wrap(it.label, Math.floor(labelW / 6.6), 1), 12.5, 'ink', 1.2, 500, 'end')}</g>` +
      `<rect x="${trackX}" y="${y + 3}" width="${trackW}" height="16" rx="4" class="surf"/>` +
      (share > 0 ? `<rect x="${trackX}" y="${y + 3}" width="${(trackW * share).toFixed(1)}" height="16" rx="4" class="f-${toneOf(it.tone ?? 'decision')} grow" ${delay(0.12 * i + 0.1)}/>` : '') +
      `<text x="${trackX + trackW + 8}" y="${y + 15.5}" font-size="12.5" font-weight="650" class="ink fade" ${delay(0.12 * i + 0.7)}>${esc(it.display ?? String(it.value))}</text>` +
      badge(trackX + trackW + valW + 4, y + 3, it.claim, claims)
  })
  const h = 16 + s.items.length * rh + (s.mark ? 18 : 0)
  if (s.mark) {
    const mx = trackX + trackW * Math.max(0, Math.min(1, s.mark.value / max))
    body += `<line x1="${mx}" y1="8" x2="${mx}" y2="${12 + s.items.length * rh}" stroke-width="2" stroke-dasharray="4 3" class="s-decision fade" ${delay(0.9)}/>`
    if (s.mark.label) body += `<text x="${mx}" y="${h - 4}" font-size="11" text-anchor="middle" class="f-decision fade" ${delay(1)}>${esc(s.mark.label)}</text>`
  }
  return { svg: svgDoc(w, h, body), height: h, alt: s.items.map(i => `${i.label}: ${i.display ?? i.value}`).join('; ') + (s.mark?.label ? `; ${s.mark.label} at ${s.mark.value}` : '') }
}

function tilesScene(w: number, items: { value: string; label: string; tone?: Tone; claim?: string }[], claims: Map<string, Claim>): Drawn {
  const cols = Math.max(1, Math.min(items.length, Math.floor((w - 12) / 150)))
  const gap = 12
  const tw = (w - 24 - gap * (cols - 1)) / cols
  const th = 104
  let body = ''
  items.forEach((it, i) => {
    const x = 12 + (i % cols) * (tw + gap)
    const y = 10 + Math.floor(i / cols) * (th + gap)
    const size = Math.max(18, Math.min(34, (tw - 20) / Math.max(3, it.value.length) * 1.6))
    body +=
      `<g transform="translate(${x},${y})"><g class="in" ${delay(0.15 * i)}><rect width="${tw}" height="${th}" rx="10" class="b-${toneOf(it.tone ?? 'subject')}"/>` +
      `<g class="pop" ${delay(0.15 * i + 0.2)}><text x="${tw / 2}" y="${54}" font-size="${size.toFixed(0)}" font-weight="750" text-anchor="middle" class="f-${toneOf(it.tone ?? 'subject')}">${esc(it.value)}</text></g>` +
      textLines(tw / 2, 76, wrap(it.label, Math.floor(tw / 6.6), 2), 11.5, 'dim', 1.3, 400, 'middle') +
      badge(tw - 6, 6, it.claim, claims) +
      `</g></g>`
  })
  const h = 20 + Math.ceil(items.length / cols) * (th + gap) - gap
  return { svg: svgDoc(w, h, body), height: h, alt: items.map(i => `${i.value} ${i.label}`).join('; ') }
}

function compareScene(w: number, s: Extract<Scene, { kind: 'compare' }>): Drawn {
  const cols = s.columns.length
  const labelW = Math.min(200, w * 0.28)
  const cw = (w - 24 - labelW) / Math.max(1, cols)
  const per = Math.max(8, Math.floor(cw / 6.5))
  let y = 12
  let body = `<g class="fade">${s.columns.map((c, i) => textLines(12 + labelW + i * cw + 8, y + 14, wrap(c, per, 2), 12, 'ink', 1.2, 700)).join('')}</g>`
  y += 30
  s.rows.forEach((row, r) => {
    const cells = row.cells.slice(0, cols).map(c => wrap(c, per, 3))
    const label = wrap(row.label, Math.floor(labelW / 6.8), 3)
    const rh = Math.max(label.length, ...cells.map(c => c.length), 1) * 16 + 14
    const isSubject = row.tone === 'subject'
    body +=
      `<g transform="translate(0,${y})"><g class="in" ${delay(0.12 * r + 0.1)}>` +
      `<rect x="8" y="0" width="${w - 16}" height="${rh}" rx="6" class="${isSubject ? 'b-subject' : r % 2 ? 'surf' : 'b-context'}"/>` +
      textLines(16, 18, label, 12.5, isSubject ? 'f-subject' : 'ink', 1.28, 650) +
      cells.map((c, i) => textLines(12 + labelW + i * cw + 8, 18, c, 12, 'ink', 1.33)).join('') +
      `</g></g>`
    y += rh + 4
  })
  return {
    svg: svgDoc(w, y + 8, body),
    height: y + 8,
    alt: `Comparison of ${s.columns.join(', ')}: ` + s.rows.map(r => `${r.label}: ${r.cells.join(', ')}`).join('; '),
  }
}

function matrixScene(w: number, s: Extract<Scene, { kind: 'matrix' }>, claims: Map<string, Claim>): Drawn {
  const size = Math.min(w - 70, 460)
  const x0 = (w - size) / 2 + 14
  const y0 = 14
  const half = size / 2
  const q = s.quadrants ?? []
  const quads = [
    [x0, y0],
    [x0 + half, y0],
    [x0, y0 + half],
    [x0 + half, y0 + half],
  ]
    .map(([x = 0, y = 0], i) => `<rect x="${x + 2}" y="${y + 2}" width="${half - 4}" height="${half - 4}" rx="6" class="${i === 1 ? 'b-subject' : 'surf'} fade" ${delay(0.08 * i)}/>` + (q[i] ? textLines(x + 10, y + 20, wrap(q[i], Math.floor(half / 7), 2), 11.5, 'faint', 1.25, 600) : ''))
    .join('')
  const dots = s.dots
    .map((d, i) => {
      const cx = x0 + d.x * size
      const cy = y0 + (1 - d.y) * size
      return `<g class="pop" ${delay(0.4 + 0.12 * i)}><circle cx="${cx}" cy="${cy}" r="7" class="f-${toneOf(d.tone ?? 'decision')}"/></g><text x="${cx + 11}" y="${cy + 4}" font-size="11.5" font-weight="600" class="ink fade" ${delay(0.5 + 0.12 * i)}>${esc(d.label)}</text>${badge(cx - 9, cy - 24, d.claim, claims, 'start')}`
    })
    .join('')
  const axes =
    `<text x="${x0 + size / 2}" y="${y0 + size + 22}" font-size="12" text-anchor="middle" class="dim">${esc(s.x)} →</text>` +
    `<text transform="translate(${x0 - 14},${y0 + size / 2}) rotate(-90)" font-size="12" text-anchor="middle" class="dim">${esc(s.y)} →</text>`
  const h = y0 + size + 34
  return { svg: svgDoc(w, h, quads + axes + dots), height: h, alt: `${s.y} against ${s.x}: ` + s.dots.map(d => d.label).join(', ') }
}

/** Draws one explainer scene at width `w`; the animation replays whenever the step changes. */
export function sceneSvg(w: number, scene: Scene, claimList: Claim[] = []): Drawn {
  const claims = new Map(claimList.map(c => [c.id, c]))
  switch (scene.kind) {
    case 'cards':
      return cardsScene(w, scene.items, claims)
    case 'list':
      return listScene(w, scene.items, claims)
    case 'flow':
      return flowScene(w, scene.items, claims)
    case 'timeline':
      return timelineScene(w, scene.items, claims)
    case 'funnel':
      return funnelScene(w, scene.items, claims)
    case 'bars':
      return barsScene(w, scene, claims)
    case 'tiles':
      return tilesScene(w, scene.items, claims)
    case 'compare':
      return compareScene(w, scene)
    case 'matrix':
      return matrixScene(w, scene, claims)
  }
}

/** The same scene for a text surface: what it says, line by line. */
export function sceneText(scene: Scene): string[] {
  switch (scene.kind) {
    case 'cards':
    case 'list':
    case 'timeline':
      return scene.items.map((i, n) => `${scene.kind === 'list' ? `${n + 1}.` : scene.kind === 'timeline' ? '◆' : '▪'} ${i.title}${i.text ? ` — ${i.text}` : ''}${i.claim ? ` [${i.claim}]` : ''}`)
    case 'flow':
      return [scene.items.map(i => i.title).join(' → '), ...scene.items.filter(i => i.text).map(i => `  ${i.title}: ${i.text}`)]
    case 'funnel':
      return scene.items.map((i, n) => `${' '.repeat(n)}▼ ${i.label}${i.value ? ` (${i.value})` : ''}`)
    case 'bars': {
      const max = scene.max ?? Math.max(...scene.items.map(i => i.value), scene.mark?.value ?? 0, 1)
      const pad = Math.max(...scene.items.map(i => i.label.length))
      return [
        ...scene.items.map(i => `${i.label.padEnd(pad)} ${'█'.repeat(Math.max(0, Math.round((i.value / max) * 20)))} ${i.display ?? i.value}`),
        ...(scene.mark ? [`${''.padEnd(pad)} ┊ ${scene.mark.label ?? 'mark'}: ${scene.mark.value}`] : []),
      ]
    }
    case 'tiles':
      return scene.items.map(i => `${i.value}  ${i.label}`)
    case 'compare':
      return [`| | ${scene.columns.join(' | ')} |`, ...scene.rows.map(r => `| ${r.label} | ${r.cells.join(' | ')} |`)]
    case 'matrix':
      return [`${scene.y} (up) against ${scene.x} (right):`, ...scene.dots.map(d => `• ${d.label} (${Math.round(d.x * 100)}, ${Math.round(d.y * 100)})`)]
  }
}
