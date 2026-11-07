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
