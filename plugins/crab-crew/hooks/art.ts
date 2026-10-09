import type { Captain, CrewMember } from '../types'
import {
  CAPTAIN,
  actionOf,
  captainQuip,
  characterOf,
  crewSummary,
  crewTotals,
  elapsed,
  fmtTime,
  fmtTokens,
  modelName,
  poseOf,
  progressLabel,
  progressOf,
  quipOf,
  titleOf,
} from './crew'
import type { Character, Pose } from './crew'

// ---------------------------------------------------------------------------
// Pixel crabs: a 30×28 grid, one costume per character. The body keeps the
// brand clay; the character lives in its hat, its prop and how it moves.

const CLAY = '#D97757'
const INK = '#1F1E1D'
const GOLD = '#F5C542'

/** `cls` puts a pixel in a group: `bd` (default) body and costume, `la`/`lb` the leg pairs, else a prop. */
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: readonly string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

type Face = 'open' | 'up' | 'happy' | 'x' | 'closed'

const eyes = (f: Fill, face: Face): void => {
  for (const x of [9, 19]) {
    if (face === 'open') f(x, 12, 2, 2, INK)
    else if (face === 'up') f(x, 11, 2, 2, INK)
    else if (face === 'happy') stamp(f, x - 1, 12, ['.kk.', 'k..k'], { k: INK })
    else if (face === 'x') stamp(f, x - 1, 11, ['k.k', '.k.', 'k.k'], { k: INK })
    else f(x - 1, 13, 4, 1, INK)
  }
}

type Look = { face: Face; armL: number; armR: number }

const body = (f: Fill, look: Look): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14 + look.armL, 4, 4, CLAY)
  f(23, 14 + look.armR, 4, 4, CLAY)
  eyes(f, look.face)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

type Costume = {
  /** How far the right claw is raised to hold the prop (negative is up). */
  hold: number
  draw: (f: Fill, color: string) => void
}

const COSTUMES: Record<string, Costume> = {
  // Captain: navy cap with a gold badge; turns the helm while the main thread works.
  captain: {
    hold: 0,
    draw: f => {
      stamp(f, 6, 5, ['....nnnnnnnnnn....', '..nnnnnnggnnnnnn..', '.nnnnnnggggnnnnnn.', '.nnnnnnnggnnnnnnn.', 'kkkkkkkkkkkkkkkkkk'], { n: '#2B3A67', g: GOLD, k: INK })
      stamp(f, 22, 12, ['...h...', '.bbbbb.', '.b.b.b.', 'hbbsbbh', '.b.b.b.', '.bbbbb.', '...h...'], { b: '#8B5A2B', h: '#C08A50', s: GOLD }, 'wh')
    },
  },
  // Deckhand: red bandana; swishes a mop.
  deckhand: {
    hold: 0,
    draw: (f, t) => {
      stamp(f, 7, 7, ['....rrrrrrrr....', '..rrrrwrrrrwrr..', 'rrrrrrrrrrrrrrrr'], { r: t, w: '#F8F6F1' })
      f(5, 9, 2, 1, t)
      f(4, 10, 2, 1, t)
      stamp(f, 24, 4, ['..h..', '..h..', '..h..', '..h..', '..h..', '..h..', '..h..', '..h..', '..h..', '..h..', 'mmmmm', 'm.m.m', 'm.m.m'], { h: '#A0703F', m: '#E9E4D6' }, 'mop')
    },
  },
  // Scout: bush hat; sweeps the horizon with a spyglass.
  scout: {
    hold: -4,
    draw: (f, t) => {
      stamp(f, 6, 6, ['....gggggggggg....', '...gyyyyyyyyyyg...', 'gggggggggggggggggg'], { g: t, y: '#C9A86A' })
      stamp(f, 23, 7, ['bbbbbll', 'bbbbbll'], { b: '#B8862B', l: '#7A5A1E' }, 'sg')
      f(29, 7, 1, 1, '#A9D6F5', 'sg')
    },
  },
  // Navigator: bicorne; unrolls a chart.
  navigator: {
    hold: 0,
    draw: f => {
      stamp(f, 6, 6, ['kk..............kk', 'kkkk..kkkkkk..kkkk', '.kkkkkkkkkkkkkkkk.', '..gggggggggggggg..'], { k: '#2F2A3A', g: GOLD })
      stamp(f, 8, 16, ['pppppppppppppp', 'p.pp.pp.ppprpp', 'pppppppppprrrp', 'pp.pp.pp.pprpp'], { p: '#EBD9A8', '.': '#C9A86A', r: '#D0453F' }, 'map')
    },
  },
  // Professor: mortarboard and spectacles (drawn after the eyes); flips the pages of a book.
  professor: {
    hold: 0,
    draw: f => {
      stamp(f, 5, 5, ['.....kkkkkkkkkk.....', 'kkkkkkkkkkkkkkkkkkkk', '.....kkkkkkkkkk.....', '......kkkkkkkkk.....'], { k: '#2F2A3A' })
      f(23, 6, 1, 4, GOLD, 'ts')
      f(22, 10, 3, 1, GOLD, 'ts')
      for (const x of [8, 18]) {
        f(x, 11, 4, 1, '#3A3A3C')
        f(x, 14, 4, 1, '#3A3A3C')
        f(x, 11, 1, 4, '#3A3A3C')
        f(x + 3, 11, 1, 4, '#3A3A3C')
      }
      f(12, 12, 6, 1, '#3A3A3C')
      stamp(f, 0, 13, ['bbb.bbb', 'bwwbwwb', 'bwwbwwb', 'bbbbbbb'], { b: '#6B3E9E', w: '#F8F6F1' })
      f(4, 14, 2, 2, '#E9E4D6', 'pg')
    },
  },
  // Signaller: headset; waves a semaphore flag.
  signaller: {
    hold: -4,
    draw: f => {
      f(8, 7, 14, 1, '#3A3A3C')
      f(7, 8, 1, 3, '#3A3A3C')
      f(22, 8, 1, 3, '#3A3A3C')
      f(5, 10, 2, 4, '#D0453F')
      f(23, 7, 2, 3, '#D0453F')
      f(26, 2, 1, 12, '#8E929A')
      stamp(f, 27, 2, ['yyy', 'ryy', 'rry'], { y: GOLD, r: '#D0453F' }, 'fl')
    },
  },
  // Echo (a fork): beanie with a pompom; a faint double of the captain.
  echo: {
    hold: 0,
    draw: (f, t) => {
      stamp(f, 7, 5, ['.......pp.......', '....pppppppp....', '..pppppppppppp..', '.pppppppppppppp.', 'wwwwwwwwwwwwwwww'], { p: t, w: '#C9BFFA' })
    },
  },
  // Cook: toque; tosses an omelette.
  cook: {
    hold: -4,
    draw: f => {
      stamp(f, 7, 1, ['...wwwwwwwwww...', '.wwwwwwwwwwwwww.', 'wwwwwwwwwwwwwwww', 'wwwwwwgwwwwgwwww', '.wwwwwgwwwwgwww.', '..wwwwgwwwwgww..', '..gggggggggggg..', '..wwwwwwwwwwww..', '..wwwwwwwwwwww..'], { w: '#F4F3EE', g: '#D2D1C8' })
      f(22, 9, 7, 2, '#4A4A48')
      f(24, 8, 3, 1, '#F5B731', 'eg')
    },
  },
  // Sleuth: deerstalker; peers through a magnifier.
  sleuth: {
    hold: -4,
    draw: f => {
      stamp(f, 6, 4, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
      stamp(f, 23, 2, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'mg')
      f(24, 3, 3, 3, 'rgba(169,214,245,.7)', 'mg')
      f(25, 7, 1, 3, '#7A4A26', 'mg')
    },
  },
  // Wizard: starry hat; the wand sparkles.
  wizard: {
    hold: -4,
    draw: f => {
      stamp(f, 7, 0, ['.......bb.......', '......bbbb......', '......bsbb......', '.....bbbbbb.....', '.....bbbbsb.....', '....bbbbbbbb....', '...bsbbbbbbbb...', '..bbbbbbbbbbbb..', 'bbbbbbbbbbbbbbbb'], { b: '#4B3B8F', s: GOLD })
      f(6, 8, 18, 1, '#4B3B8F')
      f(26, 5, 1, 6, '#5A3519')
      stamp(f, 25, 2, ['.s.', 'sss', '.s.'], { s: GOLD }, 'sp')
    },
  },
  // Diver: mask and snorkel; bubbles rise.
  diver: {
    hold: 0,
    draw: f => {
      f(7, 10, 16, 1, '#2E8BC0')
      stamp(f, 7, 11, ['mggggm..mggggm', 'mggggmmmmggggm', 'mmmmmm..mmmmmm'], { m: '#2E8BC0', g: 'rgba(169,214,245,.45)' })
      f(23, 4, 1, 8, '#F07E2E')
      f(21, 11, 2, 1, '#F07E2E')
      f(24, 1, 2, 2, '#A9D6F5', 'bu')
      f(26, 0, 1, 1, '#A9D6F5', 'bu2')
    },
  },
}


const lookOf = (pose: Pose, hold: number): Look => {
  switch (pose) {
    case 'think':
      return { face: 'up', armL: 0, armR: hold }
    case 'cheer':
      return { face: 'happy', armL: -8, armR: -8 }
    case 'rest':
      return { face: 'happy', armL: 0, armR: hold }
    case 'dizzy':
      return { face: 'x', armL: 0, armR: 0 }
    case 'sleep':
      return { face: 'closed', armL: 0, armR: 0 }
    default:
      return { face: 'open', armL: 0, armR: hold }
  }
}

/**
 * Pure CSS on the compositor, no redraws. Periods divide one second, so the
 * once-a-second redraw of a running row restarts them in phase.
 */
export const CRAB_CSS = `<style>
g{transform-box:fill-box}
.p-walk .la{animation:st .5s steps(1) infinite}.p-walk .lb{animation:st .5s steps(1) infinite -.25s}.p-walk .bd{animation:bob .5s steps(1) infinite -.125s}
.p-fast .la{animation:st .25s steps(1) infinite}.p-fast .lb{animation:st .25s steps(1) infinite -.125s}.p-fast .bd{animation:bob .25s steps(1) infinite}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.p-think .bd{transform-origin:50% 100%;animation:sway 1s ease-in-out infinite}@keyframes sway{25%{transform:rotate(-3deg)}75%{transform:rotate(3deg)}}
.p-wait .lb{animation:tap .5s steps(1) infinite}@keyframes tap{50%{transform:translateY(-2px)}}
.p-cheer{animation:jump .5s ease-out infinite}@keyframes jump{40%{transform:translateY(-4px)}}
.p-dizzy .la{animation:wig .25s steps(1) infinite}.p-dizzy .lb{animation:wig .25s steps(1) infinite -.125s}@keyframes wig{50%{transform:translateX(1px)}}
.zz{opacity:0;animation:zz 2s linear infinite}.zz2{animation-delay:-1s}@keyframes zz{0%{opacity:0;transform:translate(0,0)}20%{opacity:1}100%{opacity:0;transform:translate(4px,-8px)}}
.dot{animation:blink 1s steps(1) infinite}.dot2{animation-delay:-.66s}.dot3{animation-delay:-.33s}@keyframes blink{50%{opacity:.15}}
.star{animation:blink .5s steps(1) infinite}.star2{animation-delay:-.25s}
.hg{transform-origin:50% 50%;animation:hg 1s steps(1) infinite}@keyframes hg{50%{transform:rotate(180deg)}}
.on .wh{transform-origin:50% 50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(90deg)}}
.on .mop{transform-origin:50% 0;animation:swish .5s ease-in-out infinite}@keyframes swish{25%{transform:rotate(-14deg)}75%{transform:rotate(14deg)}}
.on .sg{transform-origin:0 50%;animation:scan 1s ease-in-out infinite}@keyframes scan{25%{transform:rotate(-12deg)}75%{transform:rotate(6deg)}}
.on .map{transform-origin:0 50%;animation:unroll 1s ease-in-out infinite}@keyframes unroll{50%{transform:scaleX(.55)}}
.on .pg{transform-origin:0 50%;animation:flip .5s steps(1) infinite}@keyframes flip{50%{transform:scaleX(-1)}}
.on .ts{transform-origin:50% 0;animation:swing 1s ease-in-out infinite}@keyframes swing{25%{transform:rotate(20deg)}75%{transform:rotate(-20deg)}}
.on .fl{transform-origin:0 50%;animation:wave .25s steps(1) infinite}@keyframes wave{50%{transform:skewY(-14deg) scaleX(.85)}}
.on .eg{animation:toss 1s ease-in-out infinite}@keyframes toss{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:none}}
.on .mg{animation:peer 1s steps(1) infinite}@keyframes peer{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.on .sp{animation:blink .25s steps(1) infinite}
.on .bu,.on .bu2{animation:rise 1s linear infinite}.on .bu2{animation-delay:-.5s}@keyframes rise{0%{opacity:0;transform:translateY(2px)}30%{opacity:1}100%{opacity:0;transform:translateY(-6px)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}.zz{opacity:1}}
</style>`

/** One crab at (x, y), in the costume of `key` (a character, or `captain`), drawn in `pose`. */
export const crab = (x: number, y: number, key: string, pose: Pose, scale = 1.1, color = '#888780'): string => {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    const list = groups.get(cls) ?? []
    groups.set(cls, list)
    list.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  const costume = COSTUMES[key] ?? COSTUMES.deckhand
  body(f, lookOf(pose, costume?.hold ?? 0))
  costume?.draw(f, color)

  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const inner = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>${group('la')}${group('lb')}`
  const isOn = pose === 'walk' || pose === 'fast'
  const flipped = pose === 'dizzy' ? `<g transform="rotate(180 15 17)">${inner}</g>` : inner

  const extras: string[] = []
  if (pose === 'dizzy') {
    extras.push(`<g fill="${GOLD}"><rect class="star" x="6" y="27" width="3" height="1"/><rect class="star" x="7" y="26" width="1" height="3"/><rect class="star star2" x="21" y="27" width="3" height="1"/><rect class="star star2" x="22" y="26" width="1" height="3"/></g>`)
  }
  if (pose === 'sleep') {
    extras.push(`<text class="zz m" x="24" y="9" font-family="${FONT}" font-size="7" font-weight="700">z</text><text class="zz zz2 m" x="27" y="5" font-family="${FONT}" font-size="5" font-weight="700">z</text>`)
  }
  if (pose === 'wait') {
    const hg: string[] = []
    stamp((cx, cy, w, h, c) => hg.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`), 24, 0, ['hhhhh', '.sss.', '..s..', '.s.s.', 'hhhhh'], { h: '#8B5A2B', s: GOLD })
    extras.push(`<g class="hg">${hg.join('')}</g>`)
  }

  return `<g transform="translate(${x},${y}) scale(${scale})" shape-rendering="crispEdges"${pose === 'sleep' && key !== 'captain' ? ' opacity="0.7"' : ''}><g class="c-${key} p-${pose}${isOn ? ' on' : ''}">${flipped}</g>${extras.join('')}</g>`
}

// ---------------------------------------------------------------------------
// Text measurement and SVG scaffolding.

export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"

export const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/** Rough advance of system UI text, in em; enough to size bubbles and cut lines. */
const charEm = (ch: string): number => (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Zmw@%]/.test(ch) ? 0.72 : 0.56)

export const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

export const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

const PALETTE = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.ln{stroke:#e4e4e1}.sand{fill:#E9DCBC}.fp{fill:#CDB98C}.bub{fill:#ffffff;stroke:#d8d6d0}.k{fill:#ecebe8}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.ln{stroke:#333331}.sand{fill:#4a4232}.fp{fill:#6b5f45}.bub{fill:#2b2b2a;stroke:#444442}.k{fill:#2c2c2b}}
.live{animation:p 1s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PALETTE}${CRAB_CSS}${body}</svg>`

const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1.5" fill="#9a9a96"/>`
}

/** A speech bubble, or a thought bubble with dots that blink in turn. */
const bubble = (x: number, y: number, text: string, isFlipped: boolean, isThought: boolean, maxW: number): string => {
  const size = 11
  const dotsW = isThought ? 16 : 0
  const shown = fitText(text, size, Math.max(30, maxW - 14 - dotsW))
  const w = Math.round(textWidth(shown, size) + 14 + dotsW)
  const h = 18
  const tailX = isFlipped ? x + w - 12 : x + 12
  const tail = isThought
    ? `<circle class="bub" cx="${tailX + (isFlipped ? 2 : -2)}" cy="${y + h + 3}" r="2.2"/><circle class="bub" cx="${tailX + (isFlipped ? 5 : -5)}" cy="${y + h + 7}" r="1.4"/>`
    : `<path class="bub" d="M${tailX - 4} ${y + h - 0.5}L${tailX + (isFlipped ? 4 : -4)} ${y + h + 6}L${tailX + 4} ${y + h - 0.5}Z"/><rect class="bub" style="stroke:none" x="${tailX - 3.4}" y="${y + h - 2}" width="6.8" height="2"/>`
  const dots = isThought
    ? [0, 1, 2].map(i => `<circle class="m dot${i ? ` dot${i + 1}` : ''}" cx="${x + w - dotsW - 2 + i * 5 + 3}" cy="${y + h / 2}" r="1.5"/>`).join('')
    : ''
  return `<g><rect class="bub" x="${x}" y="${y}" width="${w}" height="${h}" rx="9"/>${tail}<text class="t" x="${x + 7}" y="${y + 12.5}" font-family="${FONT}" font-size="${size}">${xml(shown)}</text>${dots}</g>`
}

// ---------------------------------------------------------------------------
// The panel's drawings (desktop): each row is one SVG.

export const RUNNING_H = 98
export const FINISHED_H = 54
export const HEADER_H = 58
export const ROSTER_H = 44
export const BAND_H = 26

const CRAB_W = 33

export const runningSvg = (W: number, m: CrewMember, at: number, showQuips: boolean): string => {
  const c = characterOf(m.character)
  const pose = poseOf(m, at)
  const { value } = progressOf(m)
  const right = `${fmtTime(elapsed(m, at))}`
  const meta = [modelName(m.model), actionOf(m, at), `${m.toolCalls} tools`, m.tokens ? `${fmtTokens(m.tokens)} tok` : ''].filter(Boolean).join(' · ')
  const label = progressLabel(m)
  const metaW = W - textWidth(label, 11) - 14

  // The lane: the crab walks toward the flag as its work progresses.
  const laneBottom = RUNNING_H - 8
  const crabX = Math.round(value * (W - CRAB_W - 20))
  const crabY = laneBottom - 31
  const prints: string[] = []
  for (let fx = 4, k = 0; fx < crabX - 2; fx += 7, k++) prints.push(`<rect class="fp" x="${fx}" y="${laneBottom - 2 + (k % 2)}" width="3" height="1.5" rx=".75"/>`)

  let speech = ''
  if (showQuips) {
    const text = quipOf(m, at)
    const room = W - 20
    const bw = Math.min(room, textWidth(text, 11) + 14 + (pose === 'think' ? 16 : 0))
    const isFlipped = crabX + 26 + bw > W - 18
    const bx = isFlipped ? Math.max(0, crabX + 8 - bw) : crabX + 26
    speech = bubble(bx, 38, text, isFlipped, pose === 'think', room)
  }

  return svg(
    W,
    RUNNING_H,
    `<text x="0" y="14" font-family="${FONT}" font-size="13"><tspan class="t" font-weight="600">${xml(m.name)}</tspan><tspan fill="${c.color}" font-weight="600"> the ${xml(c.role)}</tspan><tspan class="s"> · ${xml(fitText(m.description || m.type, 13, Math.max(40, W - 60 - textWidth(`${m.name} the ${c.role} · `, 13))))}</tspan></text>
<text class="s" x="${W - 14}" y="14" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${right}</text>
${statusMark(W - 4, 10, m.status, c.color)}
<text class="s" x="0" y="30" font-family="${FONT}" font-size="11">${xml(fitText(meta, 11, metaW))}</text>
<text x="${W}" y="30" text-anchor="end" font-family="${FONT}" font-size="11" font-weight="600" fill="${c.color}" font-variant-numeric="tabular-nums">${label}</text>
<rect class="sand" x="0" y="${laneBottom}" width="${W}" height="3" rx="1.5"/>
${prints.join('')}
<rect class="m" x="${W - 11}" y="${laneBottom - 26}" width="1.5" height="26"/>
<path d="M${W - 9.5} ${laneBottom - 26}L${W - 1} ${laneBottom - 21.5}L${W - 9.5} ${laneBottom - 17}Z" fill="${c.color}"/>
${speech}
${crab(crabX, crabY, m.character, pose, 1.1, c.color)}
<line class="ln" x1="0" y1="${RUNNING_H - 0.5}" x2="${W}" y2="${RUNNING_H - 0.5}"/>`,
  )
}

export const finishedSvg = (W: number, m: CrewMember, at: number, showQuips: boolean): string => {
  const c = characterOf(m.character)
  const pose = poseOf(m, at)
  const how = m.status === 'done' ? 'Back aboard' : m.status === 'failed' ? 'Went overboard' : 'Called back'
  const meta = [how, fmtTime(elapsed(m, at)), modelName(m.model), `${m.toolCalls} tools`, m.tokens ? `${fmtTokens(m.tokens)} tok` : ''].filter(Boolean).join(' · ')
  const textW = W - 40 - 16
  return svg(
    W,
    FINISHED_H,
    `${crab(0, 16, m.character, pose, 1, c.color)}
<text x="40" y="14" font-family="${FONT}" font-size="13"><tspan class="t" font-weight="600">${xml(m.name)}</tspan><tspan fill="${c.color}" font-weight="600"> the ${xml(c.role)}</tspan><tspan class="s"> · ${xml(fitText(m.description || m.type, 13, Math.max(40, textW - textWidth(`${m.name} the ${c.role} · `, 13))))}</tspan></text>
<text class="s" x="40" y="30" font-family="${FONT}" font-size="11">${xml(fitText(meta, 11, textW))}</text>
${showQuips ? `<text class="m" x="40" y="45" font-family="${FONT}" font-size="11" font-style="italic">“${xml(fitText(quipOf(m, at), 11, textW))}”</text>` : ''}
${statusMark(W - 6, 10, m.status, c.color)}
<line class="ln" x1="0" y1="${FINISHED_H - 0.5}" x2="${W}" y2="${FINISHED_H - 0.5}"/>`,
  )
}

export const headerSvg = (W: number, captain: Captain, crew: readonly CrewMember[], at: number): string => {
  const pose: Pose = captain.isBusy ? (captain.activity === 'think' ? 'think' : 'walk') : 'sleep'
  const t = crewTotals(crew, at)
  const stats = crew.length ? `${crewSummary(crew, at)} · ${fmtTokens(t.tokens)} tok · ${fmtTime(t.time)}` : 'No crew dispatched yet'
  const textW = W - 44
  return svg(
    W,
    HEADER_H,
    `${crab(0, 18, 'captain', pose, 1.1, CAPTAIN.color)}
<text x="44" y="15" font-family="${FONT}" font-size="14"><tspan class="t" font-weight="600">${CAPTAIN.name}</tspan><tspan class="s" font-size="12"> · ${CAPTAIN.role}</tspan></text>
<text class="s" x="44" y="32" font-family="${FONT}" font-size="12">${xml(fitText(captainQuip(captain), 12, textW))}</text>
<text class="m" x="44" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(stats, 11, textW))}</text>
<line class="ln" x1="0" y1="${HEADER_H - 0.5}" x2="${W}" y2="${HEADER_H - 0.5}"/>`,
  )
}

export const rosterSvg = (W: number, c: Character, types: string): string =>
  svg(
    W,
    ROSTER_H,
    `${crab(0, 8, c.key, 'walk', 1, c.color)}
<text x="40" y="16" font-family="${FONT}" font-size="12"><tspan fill="${c.color}" font-weight="600">${xml(c.role)}</tspan><tspan class="s"> · ${xml(types)} · ${xml(c.names.slice(0, 3).join(', '))}…</tspan></text>
<text class="m" x="40" y="32" font-family="${FONT}" font-size="11" font-style="italic">${xml(fitText(c.trait, 11, W - 44))}</text>`,
  )

/** The band above the prompt: the crew at work, walking, and how far along they are. */
export const bandSvg = (W: number, crew: readonly CrewMember[], at: number, progress: number): string => {
  const running = crew.filter(m => m.status === 'running')
  const shown = (running.length ? running : crew).slice(-Math.max(1, Math.floor((W * 0.45) / 26)))
  const crabs = shown.map((m, i) => crab(i * 26, 3, m.character, running.length ? poseOf(m, at) : 'rest', 0.72, characterOf(m.character).color)).join('')
  const x0 = shown.length * 26 + 6
  const names = running.length
    ? `${running.slice(0, 3).map(m => m.name).join(', ')}${running.length > 3 ? ` +${running.length - 3}` : ''}: ${crewSummary(crew, at)}`
    : `All back aboard · ${crewSummary(crew, at)}`
  const barW = Math.max(40, Math.min(160, W * 0.2))
  const textW = W - x0 - barW - 52
  const barX = W - barW - 40
  return svg(
    W,
    BAND_H,
    `${crabs}
<text class="t" x="${x0}" y="17" font-family="${FONT}" font-size="12.5">${xml(fitText(names, 12.5, textW))}</text>
<rect class="k" x="${barX}" y="9" width="${barW}" height="8" rx="4"/>
<rect x="${barX}" y="9" width="${Math.round(barW * progress)}" height="8" rx="4" fill="${running.length ? CLAY : '#3B9C5F'}"/>
<text class="s" x="${W}" y="17" text-anchor="end" font-family="${FONT}" font-size="11.5" font-variant-numeric="tabular-nums">${running.length ? '≈' : ''}${Math.round(progress * 100)}%</text>`,
  )
}

// ---------------------------------------------------------------------------
// Terminal crabs: the classic ASCII crab, its frame switched by the clock tick.

export const asciiCrab = (pose: Pose, tick: number): string => {
  const odd = tick % 2 === 1
  switch (pose) {
    case 'walk':
    case 'fast':
      return odd ? '(\\|)(°,,°)(|/)' : '(\\/)(°,,°)(\\/)'
    case 'think':
      return odd ? '(\\/)(˘,,˘)(\\/)' : '(\\/)(°,,°)(\\/)'
    case 'wait':
      return '(\\/)(°,,°)(\\/)'
    case 'cheer':
      return odd ? '\\(^,,^)/' : '_(^,,^)_'
    case 'rest':
      return '(\\/)(^,,^)(\\/)'
    case 'dizzy':
      return '(/\\)(x,,x)(/\\)'
    case 'sleep':
      return '(\\/)(-,,-)(\\/)'
  }
}

/** A crab on its lane in text: footprints behind it, the flag ahead. */
export const asciiLane = (pose: Pose, tick: number, value: number, width: number): { before: string; crab: string; after: string } => {
  const c = asciiCrab(pose, tick)
  const room = Math.max(0, width - c.length - 2)
  const isMoving = pose === 'walk' || pose === 'fast'
  const pos = Math.min(room, Math.round(value * room) + (isMoving && tick % 2 ? 1 : 0))
  return { before: '.'.repeat(pos), crab: c, after: ' '.repeat(Math.max(0, room - pos)) + ' ⚑' }
}
