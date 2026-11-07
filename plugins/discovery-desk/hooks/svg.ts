// Animated SVG for the desktop pane: the desk header, the card stepper, the progress ring and a journey's
// step strip. Each drawing ends in its final state when motion is reduced (the animations only lead into it).
// The style sheet, the stepper and the ring are adapted from review-desk's scenes.ts.
import type { CardState } from './walk'
import type { Tone } from './prototype'

export type Drawn = { svg: string; height: number; alt: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = `<style>
svg{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.ink{fill:#1f1e1c}.dim{fill:#6b6a66}.ln{stroke:#d8d6cf}.lnf{fill:#d8d6cf}.card{fill:#ffffff;stroke:#e4e2db}.surf{fill:#f4f3ee}
.t-q{fill:#6a3fb5}.t-d{fill:#1565c0}.t-ok{fill:#2e7d32}.t-off{fill:#8d8b85}.t-teal{fill:#0f766e}
.on{fill:#2e7d32}.half{fill:#b26a00}.off{fill:#d8d6cf}.cur{stroke:#c2185b}.s-good{stroke:#2e7d32}
@media (prefers-color-scheme: dark){
.ink{fill:#ececec}.dim{fill:#a8a8a4}.ln{stroke:#3c3b38}.lnf{fill:#3c3b38}.card{fill:#2b2b29;stroke:#3c3b38}.surf{fill:#232321}
.t-q{fill:#b39ddb}.t-d{fill:#64b5f6}.t-ok{fill:#81c784}.t-off{fill:#8d8b85}.t-teal{fill:#4db6ac}
.on{fill:#81c784}.half{fill:#ffb74d}.off{fill:#3c3b38}.cur{stroke:#f06292}.s-good{stroke:#81c784}}
@keyframes dd-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes dd-fade{from{opacity:0}to{opacity:1}}
@keyframes dd-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes dd-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes dd-pop{0%{transform:scale(0)}70%{transform:scale(1.18)}100%{transform:scale(1)}}
@keyframes dd-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.in{animation:dd-in .55s cubic-bezier(.2,.7,.2,1) both}
.fade{animation:dd-fade .5s ease both}
.grow{transform-box:fill-box;transform-origin:left center;animation:dd-grow .9s cubic-bezier(.3,.7,.2,1) both}
.draw{stroke-dasharray:1;animation:dd-draw .7s ease-out both}
.pop{transform-box:fill-box;transform-origin:center;animation:dd-pop .5s ease-out both}
.bob{animation:dd-bob 2.8s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>`

const svgDoc = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${STYLE}${body}</svg>`

const delay = (s: number) => `style="animation-delay:${s.toFixed(2)}s"`

/** The home's header: a phone with chips beside it, what waits and what is open. */
export function deskHeaderSvg(w: number, waiting: number, open: number, proposed: number, initiatives: number): Drawn {
  const phone =
    `<g class="in"><g class="${waiting ? 'bob' : ''}"><rect x="18" y="8" width="44" height="76" rx="8" class="card" stroke-width="1.5"/>` +
    `<rect x="24" y="18" width="32" height="10" rx="2" class="t-teal" opacity=".85"/><rect x="24" y="33" width="32" height="4" rx="2" class="lnf"/>` +
    `<rect x="24" y="41" width="24" height="4" rx="2" class="lnf"/><rect x="34" y="76" width="12" height="3" rx="1.5" class="lnf"/></g></g>`
  const chips = (['q', 'd', 'ok'] as const)
    .map((t, i) => `<circle cx="${74}" cy="${24 + i * 18}" r="6" class="t-${t} pop" ${delay(0.15 + 0.1 * i)}/>`)
    .join('')
  const x = 96
  const title = `<text x="${x}" y="32" font-size="17" font-weight="700" class="ink in">Discovery desk</text>`
  const line1 = waiting ? `${waiting} walk${waiting === 1 ? '' : 's'} waiting for you` : 'No walk waiting'
  const line2 = `${initiatives} initiative${initiatives === 1 ? '' : 's'} · ${open} open question${open === 1 ? '' : 's'} · ${proposed} proposed`
  const body =
    phone +
    chips +
    title +
    `<g class="fade" ${delay(0.2)}><text x="${x}" y="54" font-size="12.5" class="dim">${esc(line1)}</text><text x="${x}" y="71" font-size="12.5" class="dim">${esc(line2)}</text></g>`
  return { svg: svgDoc(w, 92, body), height: 92, alt: `Discovery desk: ${line1}; ${line2}.` }
}

/** One numbered disc per card: a tick when answered, amber when begun, the current one ringed. */
export function stepperSvg(w: number, states: CardState[], current: number): Drawn {
  const n = states.length
  const done = states.filter(s => s === 'done').length
  const alt = `Card ${current + 1} of ${n}; ${done} answered.`
  const gap = Math.min(64, (w - 28) / Math.max(1, n))
  if (gap < 30) {
    const r = Math.max(2.5, Math.min(5, gap / 2 - 1.5))
    const dots = states
      .map((s, i) => {
        const cx = 12 + r + i * gap
        return (i === current ? `<circle cx="${cx}" cy="14" r="${r + 3}" fill="none" stroke-width="2" class="cur"/>` : '') + `<circle cx="${cx}" cy="14" r="${r}" class="${s === 'done' ? 'on' : s === 'partial' ? 'half' : 'off'}"/>`
      })
      .join('')
    return { svg: svgDoc(w, 28, dots), height: 28, alt }
  }
  const r = 12
  const x0 = 14 + r
  const line = n > 1 ? `<line x1="${x0}" y1="20" x2="${x0 + (n - 1) * gap}" y2="20" stroke-width="2" class="ln"/>` : ''
  const discs = states
    .map((s, i) => {
      const cx = x0 + i * gap
      const isCur = i === current
      const ring = isCur ? `<circle cx="${cx}" cy="20" r="${r + 4.5}" fill="none" stroke-width="2.5" class="cur"/>` : ''
      const disc =
        s === 'done'
          ? `<circle cx="${cx}" cy="20" r="${r}" class="on"/><path d="M ${cx - 5} 20.5 l 3.5 3.5 l 6.5 -7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
          : s === 'partial'
            ? `<circle cx="${cx}" cy="20" r="${r}" class="half"/><text x="${cx}" y="24.2" font-size="11.5" font-weight="700" text-anchor="middle" fill="#fff">${i + 1}</text>`
            : `<circle cx="${cx}" cy="20" r="${r}" class="card" stroke-width="1.5"/><text x="${cx}" y="24.2" font-size="11.5" font-weight="${isCur ? 700 : 500}" text-anchor="middle" class="${isCur ? 'ink' : 'dim'}">${i + 1}</text>`
      return `<g class="pop" ${delay(0.04 * i)}>${ring}${disc}</g>`
    })
    .join('')
  return { svg: svgDoc(w, 40, line + discs), height: 40, alt }
}

/** A small ring that fills with a share: cards answered, steps walked. */
export function ringSvg(done: number, total: number, noun = 'cards answered'): Drawn {
  const size = 52
  const r = 21
  const c = size / 2
  const share = total ? done / total : 0
  let arc = ''
  if (share >= 1) arc = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="5" class="s-good"/>`
  else if (share > 0) {
    const a = share * 2 * Math.PI - Math.PI / 2
    arc = `<path d="M ${c} ${c - r} A ${r} ${r} 0 ${share > 0.5 ? 1 : 0} 1 ${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}" pathLength="1" fill="none" stroke-width="5" stroke-linecap="round" class="s-good draw"/>`
  }
  const body = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="5" class="ln"/>${arc}<text x="${c}" y="${c + 4.5}" font-size="13" font-weight="700" text-anchor="middle" class="ink">${done}/${total}</text>`
  return { svg: svgDoc(size, size, body), height: size, alt: `${done} of ${total} ${noun}` }
}

/** What a step strip needs per step: the strongest chip tone on it, and whether it was walked. */
export type StripStep = { tone: Tone; isWalked: boolean }

/** A journey's steps on one phone: each disc coloured by its chips, a tick when walked, the current one ringed. */
export function stripSvg(w: number, steps: StripStep[], current: number): Drawn {
  const n = steps.length
  const walked = steps.filter(s => s.isWalked).length
  const waiting = steps.filter(s => s.tone === 'q' || s.tone === 'd').length
  const alt = `Step ${current + 1} of ${n}; ${walked} walked; ${waiting} with an open question or proposal.`
  const gap = Math.min(48, (w - 24) / Math.max(1, n))
  const r = Math.max(4, Math.min(10, gap / 2 - 3))
  const x0 = 12 + r
  const line = n > 1 ? `<line x1="${x0}" y1="18" x2="${x0 + (n - 1) * gap}" y2="18" stroke-width="2" class="ln"/>` : ''
  const discs = steps
    .map((s, i) => {
      const cx = x0 + i * gap
      const fill = s.tone === 'none' ? 'card' : `t-${s.tone}`
      const ring = i === current ? `<circle cx="${cx}" cy="18" r="${r + 4}" fill="none" stroke-width="2.5" class="cur"/>` : ''
      const tick = s.isWalked ? `<path d="M ${cx - r * 0.45} 18.5 l ${r * 0.3} ${r * 0.3} l ${r * 0.55} ${-r * 0.6}" fill="none" stroke="${s.tone === 'none' ? '#2e7d32' : '#fff'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ''
      return `<g class="pop" ${delay(0.03 * i)}>${ring}<circle cx="${cx}" cy="18" r="${r}" class="${fill}" stroke-width="1.5"/>${tick}</g>`
    })
    .join('')
  return { svg: svgDoc(w, 36, line + discs), height: 36, alt }
}

// ---------- the hub ----------

/** Greedy word wrap to about `per` characters a line, at most `max` lines. */
export function wrap(text: string, per: number, max = 4): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if (!line) line = w
    else if ((line + ' ' + w).length <= per) line += ' ' + w
    else {
      lines.push(line)
      line = w
      if (lines.length === max) break
    }
  }
  if (line && lines.length < max) lines.push(line)
  if (lines.length === max && words.join(' ').length > lines.join(' ').length) lines[max - 1] = `${lines[max - 1]!.replace(/.{0,1}$/, '')}…`
  return lines
}

const lines = (x: number, y: number, list: string[], size: number, cls: string, anchor = 'start') =>
  list.map((l, i) => `<text x="${x}" y="${(y + i * size * 1.3).toFixed(1)}" font-size="${size}" text-anchor="${anchor}" class="${cls}">${esc(l)}</text>`).join('')

/** The core loop: the main path as boxes joined by arrows, then the states beside it and the flags. */
export function loopSvg(w: number, loop: { main: string[]; end?: string; side: string[]; flags: string[] }): Drawn {
  const main = [...loop.main, ...(loop.end ? [loop.end] : [])]
  const bw = 150
  const gap = 26
  const cols = Math.max(1, Math.floor((w - 20 + gap) / (bw + gap)))
  const per = 22
  let y = 10
  let body = ''
  for (let r = 0; r * cols < main.length; r++) {
    const row = main.slice(r * cols, r * cols + cols)
    const wrapped = row.map(s => wrap(s, per))
    const h = 18 + Math.max(...wrapped.map(l => l.length)) * 14
    row.forEach((s, i) => {
      const n = r * cols + i
      const x = 10 + i * (bw + gap)
      const isEnd = !!loop.end && n === main.length - 1
      body += `<g class="in" ${delay(0.06 * n)}><rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="10" class="card" stroke-width="${isEnd ? 3.5 : 1.5}"/>`
      body += lines(x + 10, y + 18, wrapped[i]!, 11.5, 'ink') + '</g>'
      if (i < row.length - 1) body += `<path d="M ${x + bw + 4} ${y + h / 2} h ${gap - 10} l -5 -4 m 5 4 l -5 4" fill="none" stroke-width="1.6" class="ln fade" ${delay(0.06 * n + 0.1)}/>`
    })
    y += h + 14
  }
  const colW = Math.max(160, (w - 30) / 2)
  const sideCols = w >= 360 ? 2 : 1
  const sw = sideCols === 2 ? colW : w - 20
  const sideItems = loop.side.map(s => wrap(s, Math.floor(sw / 6.6), 3))
  for (let i = 0; i < sideItems.length; i += sideCols) {
    const pair = sideItems.slice(i, i + sideCols)
    const h = 14 + Math.max(...pair.map(l => l.length)) * 14
    pair.forEach((l, k) => {
      const x = 10 + k * (sw + 10)
      body += `<g class="fade" ${delay(0.3 + 0.03 * (i + k))}><rect x="${x}" y="${y}" width="${sw}" height="${h}" rx="8" fill="none" stroke-width="1.3" stroke-dasharray="5 4" class="ln"/>${lines(x + 9, y + 16, l, 11, 'dim')}</g>`
    })
    y += h + 8
  }
  for (const f of loop.flags) {
    const l = wrap(`⚑ ${f}`, Math.floor((w - 20) / 6.6), 3)
    const h = 14 + l.length * 14
    body += `<g class="fade" ${delay(0.5)}><rect x="10" y="${y}" width="${w - 20}" height="${h}" rx="8" class="flag"/>${lines(19, y + 16, l, 11, 'warn')}</g>`
    y += h + 8
  }
  const svg = svgDoc(w, y + 4, body).replace('</style>', '.flag{fill:#fff3e0}.warn{fill:#b26a00}@media (prefers-color-scheme: dark){.flag{fill:#3d2d14}.warn{fill:#ffb74d}}</style>')
  return { svg, height: y + 4, alt: `The core loop: ${main.join(' → ')}.${loop.side.length ? ` Beside it: ${loop.side.join('; ')}.` : ''}${loop.flags.length ? ` Flags: ${loop.flags.join('; ')}.` : ''}` }
}

/** Per journey, the chips decided (green) and still waiting (purple). */
export function progressSvg(w: number, rows: { label: string; decided: number; waiting: number }[]): Drawn {
  const max = Math.max(1, ...rows.map(r => r.decided + r.waiting))
  const x0 = 46
  const bw = Math.max(60, w - x0 - 70)
  const body = rows
    .map((r, i) => {
      const y = 8 + i * 24
      const d = (bw * r.decided) / max
      const q = (bw * r.waiting) / max
      return (
        `<text x="10" y="${y + 12}" font-size="11.5" font-weight="600" class="ink">${esc(r.label)}</text>` +
        `<rect x="${x0}" y="${y + 2}" width="${bw}" height="12" rx="6" class="surf"/>` +
        (d ? `<rect x="${x0}" y="${y + 2}" width="${d.toFixed(1)}" height="12" rx="6" class="t-ok grow" ${delay(0.05 * i)}/>` : '') +
        (q ? `<rect x="${(x0 + d).toFixed(1)}" y="${y + 2}" width="${q.toFixed(1)}" height="12" rx="6" class="t-q grow" ${delay(0.05 * i + 0.2)}/>` : '') +
        `<text x="${x0 + bw + 8}" y="${y + 12}" font-size="11" class="dim">${r.decided} · ${r.waiting}</text>`
      )
    })
    .join('')
  const h = 16 + rows.length * 24
  return { svg: svgDoc(w, h, body), height: h, alt: rows.map(r => `${r.label}: ${r.decided} decided, ${r.waiting} waiting`).join('; ') }
}

/** A journey as a map of its steps on one phone: a line of discs coloured by chips, each with its title. */
export function mapSvg(w: number, steps: { n: number; title: string; sub: string; tone: Tone; isWalked: boolean; isCurrent: boolean }[]): Drawn {
  const per = Math.max(20, Math.floor((w - 50) / 6.8))
  let y = 12
  let body = ''
  const tops: number[] = []
  for (const s of steps) {
    tops.push(y)
    const title = wrap(`${s.n}. ${s.title}`, per, 2)
    const fill = s.tone === 'none' ? 'card' : `t-${s.tone}`
    body +=
      `<g class="in" ${delay(0.03 * s.n)}>` +
      (s.isCurrent ? `<circle cx="20" cy="${y + 6}" r="11" fill="none" stroke-width="2.5" class="cur"/>` : '') +
      `<circle cx="20" cy="${y + 6}" r="7" class="${fill}" stroke-width="1.5"/>` +
      (s.isWalked ? `<path d="M 16.5 ${y + 6.5} l 2.5 2.5 l 4.5 -5" fill="none" stroke="${s.tone === 'none' ? '#2e7d32' : '#fff'}" stroke-width="1.8" stroke-linecap="round"/>` : '') +
      lines(38, y + 10, title, 12, 'ink') +
      (s.sub ? lines(38, y + 10 + title.length * 15.6, [s.sub], 10.5, 'dim') : '') +
      '</g>'
    y += 14 + title.length * 15.6 + (s.sub ? 12 : 0)
  }
  const line = tops.length > 1 ? `<line x1="20" y1="${tops[0]! + 6}" x2="20" y2="${tops.at(-1)! + 6}" stroke-width="2" class="ln"/>` : ''
  return { svg: svgDoc(w, y + 4, line + body), height: y + 4, alt: steps.map(s => `${s.n}. ${s.title}${s.sub ? ` (${s.sub})` : ''}`).join('; ') }
}
