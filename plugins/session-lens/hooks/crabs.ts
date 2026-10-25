// The crew drawn for the desktop: vector crabs, and the crew's two lists (at work, back at base) as one
// picture, so a crab can fly from one list to the other and to a new place in its own.
// As in art.ts, nothing animates from the moment it is drawn: a one-shot (a cheer, a flight, a bar
// growing) is pinned to when it happened, and a loop (legs, claws, blinks) keeps its phase across drawings.
import type { LensCaptain, LensCrab, LensMove } from '../types'
import { ACCENT, STILL, attrs, bar, doc, esc, f1, fit, gradient, lighter, loopOf, once, onceOf, stagger, textWidth } from './art'
import type { Anim, Drawn } from './art'
import { BASE_MARK, CAPTAIN_NAME, actionOf, captainPose, captainQuip, characterOf, duration, poseOf, progressLabel, progressOf, quipOf } from './crew'
import type { Accessory, Character, LegendEntry, Pose } from './crew'

const INK = '#1f1e1c'

const CRAB_STYLE = `<style>
@keyframes c-legA{0%,100%{transform:rotate(0)}50%{transform:rotate(16deg)}}
@keyframes c-legB{0%,100%{transform:rotate(16deg)}50%{transform:rotate(0)}}
@keyframes c-snip{0%,100%{transform:rotate(0)}50%{transform:rotate(-22deg)}}
@keyframes c-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.3px)}}
@keyframes c-blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
@keyframes c-dot{0%,100%{opacity:.15}50%{opacity:1}}
@keyframes c-tap{0%,100%{transform:rotate(0)}50%{transform:rotate(-20deg)}}
@keyframes c-hop{0%{transform:translateY(0)}18%{transform:translateY(-10px)}36%{transform:translateY(0)}54%{transform:translateY(-6px)}72%,100%{transform:translateY(0)}}
@keyframes c-raise{0%{transform:rotate(0)}20%,70%{transform:rotate(-38deg)}100%{transform:rotate(0)}}
@keyframes c-spark{0%{transform:scale(0);opacity:1}60%{transform:scale(1);opacity:1}100%{transform:scale(1.35);opacity:0}}
@keyframes c-swirl{to{transform:rotate(360deg)}}
@keyframes c-zz{0%{transform:translate(0,0);opacity:0}25%{opacity:1}100%{transform:translate(7px,-11px);opacity:0}}
@keyframes c-glow{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes c-wave{from{transform:translateX(-20px)}to{transform:none}}
.c-legA,.c-legB{transform-box:fill-box;transform-origin:right top;animation:c-legA .45s ease-in-out infinite}
.c-legB{animation-name:c-legB}
.c-snip{transform-box:fill-box;transform-origin:left bottom;animation:c-snip .9s ease-in-out infinite}
.c-bob{animation:c-bob .45s ease-in-out infinite}
.c-blink{transform-box:fill-box;transform-origin:center;animation:c-blink 4.2s ease-in-out infinite}
.c-dot{animation:c-dot 1.2s ease-in-out infinite}
.c-tap{transform-box:fill-box;transform-origin:right top;animation:c-tap .6s ease-in-out infinite}
.c-hop{animation:c-hop 1.3s cubic-bezier(.3,.7,.4,1) both}
.c-raise{transform-box:fill-box;transform-origin:right bottom;animation:c-raise 1.3s ease-in-out both}
.c-spark{transform-box:fill-box;transform-origin:center;animation:c-spark 1s ease-out both}
.c-swirl{transform-box:fill-box;transform-origin:center;animation:c-swirl 1.6s linear infinite}
.c-zz{animation:c-zz 2.4s ease-out infinite}
.c-glow{animation:c-glow 1.4s ease-in-out infinite}
.c-wave{animation:c-wave 4s linear infinite}
.sk1{stop-color:#dff0fa}.sk2{stop-color:#eef6f6}.sd1{stop-color:#f5e9cf}.sd2{stop-color:#ecdcb6}.wv1{stroke:#bfe0f0}.wv2{stroke:#d6ecf5}.fp{fill:#c9b48a;opacity:.8}.pole{fill:#8a8984}.bub{fill:#fff;stroke:#d8d5cc;stroke-width:.8}.bubt{fill:#1f1e1c}.bubd{fill:#6b6a66}
.gchip{fill:#e6f4ea}.gchipt{fill:#1f7a45}.rchip{fill:#fdecec}.rchipt{fill:#c0392b}.schip{fill:#efeeea}.schipt{fill:#6b6a66}
@media (prefers-color-scheme: dark){.sk1{stop-color:#1b2a33}.sk2{stop-color:#1f2b2e}.sd1{stop-color:#3a3226}.sd2{stop-color:#332b1f}.wv1{stroke:#2c4c5c}.wv2{stroke:#284451}.fp{fill:#6b5a3c}.bub{fill:#2e2d2a;stroke:#4a4843}.bubt{fill:#ecebe8}.bubd{fill:#a8a7a2}.gchip{fill:#1c3326}.gchipt{fill:#6fd39b}.rchip{fill:#3a1f1d}.rchipt{fill:#ff8a80}.schip{fill:#2e2d2a}.schipt{fill:#a8a7a2}}
</style>`

/** Seconds of the one-shots above, as CRAB_STYLE sets them. */
const CHEER = 1.3
const SPARK = 1
const FLY = 0.8
const GLOW = 0.5

/** Loops' periods, as CRAB_STYLE sets them. */
const P = { leg: 0.45, snip: 0.9, bob: 0.45, blink: 4.2, dot: 1.2, tap: 0.6, swirl: 1.6, zz: 2.4, glow: 1.4 } as const

/** A darker tone of a hex colour, for outlines and legs. */
function darker(hex: string, by = 0.3): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c * (1 - by))
  return `#${((mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255)).toString(16).padStart(6, '0')}`
}

/** A loop run at another pace than its class sets: its period, so its phase still holds across drawings. */
const faster = (a: Anim, period: number): Anim => ({ cls: a.cls, style: `${a.style}animation-duration:${period}s;` })

const star = (x: number, y: number, r: number, fill: string, a: Anim = STILL) =>
  `<g transform="translate(${f1(x)} ${f1(y)})"><path${attrs('', a)} d="M0,${-r} L${f1(r * 0.27)},${f1(-r * 0.27)} L${r},0 L${f1(r * 0.27)},${f1(r * 0.27)} L0,${r} L${f1(-r * 0.27)},${f1(r * 0.27)} L${-r},0 L${f1(-r * 0.27)},${f1(-r * 0.27)} Z" fill="${fill}"/></g>`

// ---------- one crab, in a 48 × 44 box ----------

/** The left half: legs, a claw on its arm, an eye on its stalk. The right half is its mirror. */
function half(c: Character, pose: Pose, now: number, endedAt: number, gid: string): string {
  const shell = c.color
  const line = darker(shell)
  const working = pose === 'work' || pose === 'scurry'
  // A scurrying crab steps and snips at about twice its pace.
  const pace = (cls: string, period: number) => (pose === 'scurry' ? faster(loopOf(cls, period / 2, now), period / 2) : loopOf(cls, period, now))
  const legA = working ? pace('c-legA', P.leg) : STILL
  const legB = working ? pace('c-legB', P.leg) : STILL
  const tap = pose === 'wait' ? loopOf('c-tap', P.tap, now) : STILL
  const legs =
    `<path${attrs('', legA)} d="M13,29 q-5,1 -8,5" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
    `<path${attrs('', legB)} d="M14,32 q-5,2 -7,7" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
    `<path${attrs('', pose === 'wait' ? tap : legA)} d="M16,34 q-3,3 -4,7" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
  const snip = working ? pace('c-snip', P.snip) : STILL
  const raise = pose === 'done' ? onceOf('c-raise', CHEER, endedAt, now) : STILL
  const claw =
    `<g${attrs('', raise)}>` +
    `<path d="M13,25 q-4,-3 -6,-7.5" stroke="${line}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
    `<path d="M2.5,14 Q3,19.5 9.5,16.5 L7,14 Z" fill="url(#${gid})" stroke="${line}" stroke-width=".7" stroke-linejoin="round"/>` +
    `<path${attrs('', snip)} d="M2.5,13.5 Q3.5,7.5 10,10.5 L7.2,13.2 Z" fill="${lighter(shell, 0.2)}" stroke="${line}" stroke-width=".7" stroke-linejoin="round"/>` +
    `</g>`
  const stalk = `<path d="M19,21 L18,13.5" stroke="${line}" stroke-width="2" stroke-linecap="round"/>`
  let eye: string
  if (pose === 'done') eye = `<path d="M15,12 q3,-3.6 6,0" stroke="${INK}" stroke-width="1.7" fill="none" stroke-linecap="round"/>`
  else if (pose === 'failed') eye = `<path d="M15.6,9.6 l4.8,4.8 M20.4,9.6 l-4.8,4.8" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`
  else if (pose === 'stopped') eye = `<path d="M15,11.2 q3,2.6 6,0" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
  else {
    const look = pose === 'think' ? { x: 18.4, y: 9.9 } : pose === 'wait' ? { x: 16.9, y: 11.3 } : { x: 18.7, y: 11.5 }
    eye =
      `<g${attrs('', loopOf('c-blink', P.blink, now))}>` +
      `<circle cx="18" cy="11" r="3.7" fill="#fff" stroke="${line}" stroke-width=".8"/>` +
      `<circle cx="${look.x}" cy="${look.y}" r="1.75" fill="${INK}"/><circle cx="${f1(look.x + 0.6)}" cy="${f1(look.y - 0.6)}" r=".55" fill="#fff"/>` +
      `</g>`
  }
  return legs + claw + stalk + eye
}

/** What the crab wears for its role, drawn over its shell and eyes. */
function accessory(kind: Accessory, line: string, now: number): string {
  switch (kind) {
    case 'bandana':
      return `<path d="M11.5,25 Q24,15.5 36.5,25 Q24,21.5 11.5,25 Z" fill="#2f3b6b"/><circle cx="36.6" cy="25.4" r="1.6" fill="#2f3b6b"/><path d="M36.8,26 l2.6,3.2 M36.8,26 l3.4,1" stroke="#2f3b6b" stroke-width="1.3" stroke-linecap="round"/>`
    case 'cap':
      return `<path d="M15.5,22.2 Q24,12.8 32.5,22.2 Z" fill="#e8c574" stroke="#b8933f" stroke-width=".7"/><path d="M28.5,21.7 q5.5,-1 8.6,1.2" stroke="#b8933f" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="24" cy="15.8" r=".9" fill="#b8933f"/>`
    case 'tricorn':
      return `<path d="M12.5,22.2 L24,15 L35.5,22.2 Q24,19.2 12.5,22.2 Z" fill="#1f2a44"/><path d="M14.5,21.4 Q24,18.6 33.5,21.4" stroke="#e0b44a" stroke-width=".9" fill="none"/>`
    case 'glasses':
      return `<circle cx="18" cy="11" r="4.8" fill="none" stroke="#2b2a28" stroke-width="1.1"/><circle cx="30" cy="11" r="4.8" fill="none" stroke="#2b2a28" stroke-width="1.1"/><path d="M22.8,11 Q24,9.8 25.2,11" stroke="#2b2a28" stroke-width="1.1" fill="none"/>`
    case 'antenna':
      return `<path d="M24,19 L24,9.5" stroke="${line}" stroke-width="1.4" stroke-linecap="round"/><circle${attrs('', loopOf('c-glow', P.glow, now))} cx="24" cy="8" r="2.6" fill="#ffd54a"/>`
    case 'halo':
      return `<ellipse cx="24" cy="4.8" rx="7.2" ry="2" fill="none" stroke="#ffd54a" stroke-width="1.7"/>`
    case 'toque':
      return `<path d="M18,21.2 h12 v-2.6 q4,-1 2.2,-4.8 q-1.8,-3 -5,-1.1 q-2,-3.6 -6.4,0 q-3.2,-1.9 -5,1.1 q-1.8,3.8 2.2,4.8 z" fill="#ffffff" stroke="#d6d4ce" stroke-width=".8"/>`
    case 'deerstalker':
      return `<path d="M15,22.2 Q24,13.4 33,22.2 Z" fill="#8a6a45" stroke="#6b5233" stroke-width=".7"/><path d="M19,17.6 L29,17.6 M17.4,19.8 L30.6,19.8" stroke="#6b5233" stroke-width=".6"/><path d="M33,22 l3.4,1.4 M15,22 l-3.4,1.4" stroke="#6b5233" stroke-width="1.5" stroke-linecap="round"/>`
    case 'wizard':
      return `<ellipse cx="24" cy="21.4" rx="9" ry="1.9" fill="#4b3fa8"/><path d="M17.2,21.2 L24.5,5.6 L30.8,21.2 Z" fill="#5b4fc0"/>${star(25.2, 13.5, 1.8, '#ffd54a')}`
    case 'captain':
      return `<path d="M14.5,21.6 Q24,12.2 33.5,21.6 Z" fill="#1f2a44"/><path d="M13.5,21.6 h21" stroke="#111a2e" stroke-width="2.2" stroke-linecap="round"/><path d="M28.5,22 q5,.2 8.2,2.2" stroke="#111a2e" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="24" cy="17.4" r="1.9" fill="#e0b44a"/><path d="M15.5,19.6 Q24,15.2 32.5,19.6" stroke="#e0b44a" stroke-width=".7" fill="none"/>`
    case 'goggles':
      return `<path d="M13,11 L35,11" stroke="#1d6f8f" stroke-width="1.6"/><circle cx="18" cy="11" r="4.9" fill="#bfe9f7" fill-opacity=".35" stroke="#1d6f8f" stroke-width="1.8"/><circle cx="30" cy="11" r="4.9" fill="#bfe9f7" fill-opacity=".35" stroke="#1d6f8f" stroke-width="1.8"/>`
  }
}

/**
 * A crab in a 48 × 44 box, in its pose: working (legs scuttle, claws snip, eyes blink), thinking (dots
 * pulse above), waiting (a foot taps), done (a cheer just after it finished, then a happy rest), failed
 * (crossed eyes, stars circling) or stopped (asleep, z's rising). `gid` keeps its gradient's id unique.
 */
export function crabMarkup(m: Pick<LensCrab, 'character' | 'endedAt'>, pose: Pose, now: number, gid: string): string {
  const c = characterOf(m.character)
  const line = darker(c.color)
  const endedAt = m.endedAt ?? 0
  const left = half(c, pose, now, endedAt, gid)
  let mouth: string
  if (pose === 'done') mouth = `<path d="M20.5,30.4 q3.5,3.6 7,0" stroke="${line}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
  else if (pose === 'failed') mouth = `<path d="M20.4,32 q1.2,-1.3 2.4,0 q1.2,1.3 2.4,0 q1.2,-1.3 2.4,0" stroke="${line}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`
  else if (pose === 'think') mouth = `<circle cx="24" cy="31.6" r="1.3" fill="${line}"/>`
  else if (pose === 'stopped') mouth = `<path d="M22,31.4 h4" stroke="${line}" stroke-width="1.3" stroke-linecap="round"/>`
  else mouth = `<path d="M21.6,30.8 q2.4,1.7 4.8,0" stroke="${line}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`
  const body =
    `<ellipse cx="24" cy="28" rx="13.5" ry="9.6" fill="url(#${gid})" stroke="${line}" stroke-width=".9"/>` +
    `<ellipse cx="19.4" cy="24.3" rx="5.2" ry="2.1" fill="#fff" opacity=".38" transform="rotate(-12 19.4 24.3)"/>` +
    mouth
  let extra = ''
  if (pose === 'think')
    extra = [0, 1, 2]
      .map(i => `<circle${attrs('', loopOf('c-dot', P.dot, now - i * 250))} cx="${37 + i * 4}" cy="${7 - i * 2}" r="${1.3 + i * 0.25}" fill="${line}"/>`)
      .join('')
  else if (pose === 'failed')
    extra = `<g${attrs('', loopOf('c-swirl', P.swirl, now))}>${star(18, 4.5, 2.2, '#ffd54a')}${star(30, 4.5, 2.2, '#ffd54a')}${star(24, 1.8, 1.6, '#ffb84d')}${star(24, 7.6, 1.6, '#ffb84d')}</g>`
  else if (pose === 'stopped')
    extra = [0, 1]
      .map(i => `<text${attrs('', loopOf('c-zz', P.zz, now - i * 1200))} x="${33 + i * 4}" y="${12 - i * 3}" font-size="${8 - i * 1.5}" font-weight="700" fill="${line}">z</text>`)
      .join('')
  else if (pose === 'done')
    extra = [
      [5, 5],
      [43, 7],
      [3, 29],
      [45, 28],
    ]
      // Sparkles burst once, while the crab cheers; once they are over they are not drawn at all.
      .map(([x, y], i) => ({ x: x!, y: y!, i, burst: onceOf('c-spark', SPARK, endedAt, now, 0.15 + i * 0.07) }))
      .filter(s => s.burst.cls)
      .map(s => star(s.x, s.y, 2.6, s.i % 2 ? '#ffd54a' : c.color, s.burst))
      .join('')
  const working = pose === 'work' || pose === 'scurry'
  const hop =
    pose === 'done'
      ? onceOf('c-hop', CHEER, endedAt, now)
      : pose === 'scurry'
        ? faster(loopOf('c-bob', P.bob / 2, now), P.bob / 2)
        : working
          ? loopOf('c-bob', P.bob, now)
          : STILL
  return (
    gradient(gid, lighter(c.color, 0.3), c.color) +
    `<ellipse cx="24" cy="41" rx="13" ry="2.2" fill="#000" fill-opacity=".14"/>` +
    `<g${attrs('', hop)}>` +
    left +
    `<g transform="translate(48 0) scale(-1 1)">${left}</g>` +
    body +
    accessory(c.accessory, line, now) +
    `</g>` +
    extra
  )
}

/** One crab on its own, 48 × 44: for a crab drawn outside the crew list. */
export function crabSvg(m: Pick<LensCrab, 'character' | 'endedAt'>, pose: Pose, now: number, alt: string): Drawn {
  return { svg: doc(48, 44, crabMarkup(m, pose, now, 'cg'), CRAB_STYLE), height: 44, alt }
}

// ---------- the crew: the beach, and a picture per list ----------

/**
 * Heights: a lane of the beach; the beach's sky and waves above its lanes, and the sand below them;
 * a working crab's row; a crab's row among those reported back.
 */
const ROW = { lane: 38, sky: 24, shore: 10, work: 42, base: 50 } as const

/** How tall the beach is for this many lanes: the captain's, and one per crab on it. */
const beachH = (lanes: number) => ROW.sky + lanes * ROW.lane + ROW.shore

/** A crew order's two halves: the crabs on the beach, and the ones that reported back. */
function splitOrder(order: readonly string[]): { work: string[]; base: string[] } {
  const cut = order.indexOf(BASE_MARK)
  return cut < 0 ? { work: [...order], base: [] } : { work: order.slice(0, cut), base: order.slice(cut + 1) }
}

/** Seconds a crab takes to walk to where its progress has got to. */
const WALK = 1.1

/** A speech bubble beside a crab, or a dashed thought bubble with dots that blink in turn. */
function bubbleAt(x: number, y: number, text: string, isLeft: boolean, isThought: boolean, maxW: number, pop: Anim, now: number): string {
  const size = 10.5
  const dotsW = isThought ? 15 : 0
  const shown = fit(text, Math.max(30, maxW - 14 - dotsW), size)
  const bw = textWidth(shown, size) + 14 + dotsW
  const bx = isLeft ? x - bw : x
  const tail = isThought
    ? `<circle class="bub" cx="${f1(isLeft ? bx + bw + 3 : bx - 3)}" cy="${y + 12}" r="1.8"/>`
    : `<path class="bub" d="M${f1(isLeft ? bx + bw - 1 : bx + 1)},${y + 6} L${f1(isLeft ? bx + bw + 6 : bx - 6)},${y + 11} L${f1(isLeft ? bx + bw - 1 : bx + 1)},${y + 13} Z"/>`
  const dots = isThought
    ? [0, 1, 2].map(i => `<circle${attrs('bubd', loopOf('c-dot', P.dot, now - i * 250))} cx="${f1(bx + bw - dotsW + i * 4.5 + 1)}" cy="${y + 9}" r="1.3"/>`).join('')
    : ''
  return (
    `<g${attrs('', pop)}>` +
    `<rect class="bub" x="${f1(bx)}" y="${y}" width="${f1(bw)}" height="18" rx="9"${isThought ? ' stroke-dasharray="3 2"' : ''}/>` +
    tail +
    `<text class="bubt" x="${f1(bx + 7)}" y="${y + 12.6}" font-size="${size}"${isThought ? ' font-style="italic"' : ''}>${esc(shown)}</text>` +
    dots +
    `</g>`
  )
}

/** The main thread on the beach: the captain, and how far along Claude's own to-do list is. */
export type Skipper = { captain: LensCaptain; done: number; total: number; doneBefore: number; changedAt: number }

/** Someone walking a lane: the captain or a crab. */
type Walker = {
  key: string
  look: Pick<LensCrab, 'character' | 'endedAt'>
  pose: Pose
  /** How far along, 0 to 1, where it was before it last moved, and when that was. */
  progress: number
  before: number
  movedAt: number
  /** Done and standing past its flag, for a moment before it reports back. */
  isPast: boolean
  line: string
  saidAt: number
}

const crabWalker = (m: LensCrab, now: number): Walker => ({
  key: m.id,
  look: m,
  pose: poseOf(m, now),
  progress: progressOf(m).value,
  before: Math.min(1, m.progressBefore),
  movedAt: m.progressAt,
  isPast: m.status === 'done',
  line: quipOf(m, now),
  saidAt: m.lastActiveAt,
})

const captainWalker = (s: Skipper): Walker => ({
  key: 'captain',
  look: { character: 'captain' },
  pose: captainPose(s.captain),
  progress: s.total ? s.done / s.total : 0,
  before: s.total ? s.doneBefore / s.total : 0,
  movedAt: s.changedAt,
  isPast: false,
  line: captainQuip(s.captain),
  saidAt: s.captain.lastActiveAt,
})

/**
 * The beach: one scene with a lane each, the captain's first. Each walks its lane toward its flag as its
 * progress climbs (the captain's is Claude's own to-do list), footprints behind it, with its line in a
 * bubble beside it. A crab that is done walks past its flag and stands there, cheering, until it reports
 * back. A step is pinned to when the progress moved; a lane that changes place glides there, and a new
 * one fades in.
 */
function beachMarkup(w: number, walkers: Walker[], oldLanes: Map<string, number> | null, since: number, now: number): string {
  const h = beachH(walkers.length)
  const flagX = w - 50
  const laneW = flagX - 40
  const sky =
    `<defs><linearGradient id="bsky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="sk1"/><stop offset="${f1(ROW.sky / h)}" class="sk2"/><stop offset="${f1((ROW.sky + 4) / h)}" class="sd1"/><stop offset="1" class="sd2"/></linearGradient>` +
    `<clipPath id="bclip"><rect x="0" y="0" width="${w}" height="${h}" rx="12"/></clipPath></defs>`
  const wave = (y: number, cls: string, period: number, a: number) => {
    let d = `M-40,${y}`
    for (let x = -40; x < w + 40; x += 20) d += ` q5,${-a} 10,0 q5,${a} 10,0`
    return `<path${attrs(cls, loopOf('c-wave', period, now))} d="${d}" fill="none" stroke-width="2" stroke-linecap="round"/>`
  }
  const lanes = walkers
    .map((m, i) => {
      const c = characterOf(m.look.character)
      const top = ROW.sky + i * ROW.lane
      const x = m.isPast ? flagX + 8 : 4 + m.progress * laneW
      const fromX = 4 + m.before * laneW
      const walkSince = (now - m.movedAt) / 1000
      const id = `cw${i}`
      const walking =
        m.movedAt && walkSince < WALK && Math.abs(fromX - x) > 0.5
          ? `<style>@keyframes ${id}{from{transform:translateX(${f1(fromX - x)}px)}to{transform:none}}.${id}{animation:${id} ${WALK}s cubic-bezier(.3,.8,.3,1) ${(-walkSince).toFixed(3)}s both}</style>`
          : ''
      const prints: string[] = []
      for (let fx = 8, k = 0; fx < x + 2; fx += 10, k++) prints.push(`<rect class="fp" x="${fx}" y="${top + 31 + (k % 2)}" width="3" height="1.6" rx=".8"/>`)
      const flag = `<rect class="pole" x="${flagX}" y="${top + 8}" width="1.6" height="26"/><path d="M${flagX + 1.6},${top + 8} l9,4.5 l-9,4.5 Z" fill="${c.color}"/>`
      const crab = `<g transform="translate(${f1(x)} ${top + 2}) scale(.72)">${crabMarkup(m.look, m.pose, now, `bc${i}`)}</g>`
      const roomRight = flagX - (x + 40)
      // The bubble goes where the line fits: right of the crab, else left if there is more room there.
      const need = textWidth(m.line, 10.5) + 30
      const isLeft = m.isPast || (need > roomRight && x - 6 > roomRight)
      const bubble = bubbleAt(isLeft ? x - 2 : x + 38, top + 6, m.line, isLeft, m.pose === 'think', isLeft ? x - 6 : roomRight, once('pop', m.saidAt, now), now)
      // A lane that changed place glides there with its crab; a new lane fades in. The captain's stays first.
      const was = i === 0 ? 0 : oldLanes?.get(m.key)
      const glide = oldLanes && since < FLY ? (was === undefined ? 'new' : was !== i ? (was - i) * ROW.lane : 0) : 0
      const lid = `cl${i}`
      const laneStyle =
        glide === 'new'
          ? `<style>.${lid}{animation:sl-fade ${FLY}s ease ${(-since).toFixed(3)}s both}</style>`
          : glide
            ? `<style>@keyframes ${lid}{from{transform:translateY(${glide}px)}to{transform:none}}.${lid}{animation:${lid} ${FLY}s cubic-bezier(.25,.8,.25,1) ${(-since).toFixed(3)}s both}</style>`
            : ''
      return `${walking}${laneStyle}<g${laneStyle ? ` class="${lid}"` : ''}>${prints.join('')}${flag}<g${walking ? ` class="${id}"` : ''}>${crab}</g>${bubble}</g>`
    })
    .join('')
  return (
    sky +
    `<g clip-path="url(#bclip)"><rect x="0" y="0" width="${w}" height="${h}" fill="url(#bsky)"/>` +
    wave(ROW.sky - 3, 'wv1', 4, 2.4) +
    wave(ROW.sky + 1, 'wv2', 6, 1.8) +
    lanes +
    `</g>`
  )
}

/** A crab at work, under the beach: its name and role, its task, its progress, its calls and time. */
function workRow(w: number, m: LensCrab, now: number): string {
  const c = characterOf(m.character)
  const label = progressLabel(m)
  const meta = `${m.toolCalls} call${m.toolCalls === 1 ? '' : 's'} · ${duration(now - m.startedAt)}`
  const metaW = textWidth(meta, 10.5) + 8
  return (
    `<circle cx="6" cy="13" r="4" fill="${c.color}"/>` +
    `<text x="16" y="17" font-size="13"><tspan class="ink" font-weight="650">${esc(fit(m.name, 140, 13))}</tspan><tspan class="dim"> the ${esc(c.role)}</tspan></text>` +
    `<text x="${w - 2}" y="17" font-size="12" font-weight="700" fill="${c.color}" text-anchor="end">${esc(label)}</text>` +
    `<text class="dim" x="16" y="33" font-size="11.5">${esc(fit(m.description, w - 16 - metaW - 6, 11.5))}</text>` +
    `<text class="faint" x="${w - 2}" y="33" font-size="10.5" text-anchor="end">${esc(meta)}</text>`
  )
}

const CHIP: Record<Exclude<LensCrab['status'], 'running'>, { label: string; cls: string }> = {
  done: { label: 'done', cls: 'g' },
  failed: { label: 'failed', cls: 'r' },
  stopped: { label: 'stopped', cls: 's' },
}

/** A crab back at base: a smaller crab, its name and role, how its run ended, its last line and its task. */
function baseRow(w: number, m: LensCrab, i: number, now: number): string {
  const c = characterOf(m.character)
  const x0 = 54
  const chip = CHIP[m.status === 'running' ? 'done' : m.status]
  const chipW = textWidth(chip.label, 10.5) + 14
  const took = duration((m.endedAt ?? now) - m.startedAt)
  const line = `“${quipOf(m, now)}”`
  const lineW = textWidth(line, 11) + 8
  return (
    `<g transform="translate(9 6) scale(.78)">${crabMarkup(m, poseOf(m, now), now, `cg${i}`)}</g>` +
    `<text x="${x0}" y="19" font-size="12.5"><tspan class="ink" font-weight="650">${esc(fit(m.name, 130, 12.5))}</tspan><tspan class="dim"> the ${esc(c.role)}</tspan></text>` +
    `<g${attrs('', once('pop', m.endedAt ?? 0, now, 0.5))}><rect class="${chip.cls}chip" x="${f1(w - 2 - chipW)}" y="7" width="${f1(chipW)}" height="17" rx="8.5"/><text class="${chip.cls}chipt" x="${f1(w - 2 - chipW / 2)}" y="19" font-size="10.5" font-weight="650" text-anchor="middle">${chip.label}</text></g>` +
    `<text class="faint" x="${f1(w - 8 - chipW)}" y="19" font-size="10.5" text-anchor="end">${esc(took)}</text>` +
    `<text x="${x0}" y="37" font-size="11"><tspan class="dim" font-style="italic">${esc(line)}</tspan><tspan class="faint"> · ${esc(fit(m.description, Math.max(30, w - x0 - lineW - 8), 11))}</tspan></text>`
  )
}

const IDLE_SKIPPER: Skipper = { captain: { isBusy: false, activity: 'other', detail: '', lastActiveAt: 0 }, done: 0, total: 0, doneBefore: 0, changedAt: 0 }

const crabAlt = (m: LensCrab, now: number) => `${m.name} the ${characterOf(m.character).role}, ${m.status === 'running' ? `${progressLabel(m)}, ${actionOf(m, now)}` : m.status}`

/** For a moment after the crew's order last changed: how long ago that was, and the order before it. */
function lastMove(move: LensMove | undefined, now: number): { since: number; before: { work: string[]; base: string[] } } | null {
  if (!move?.from.length) return null
  const since = (now - move.at) / 1000
  return since < FLY + GLOW ? { since, before: splitOrder(move.from) } : null
}

/**
 * The beach as a picture: the captain's lane, then one per crab on it. For a moment after the crew's
 * order changed, a lane that moved glides to its new place and a new one fades in. It comes in after
 * `enterAt` (its section opened).
 */
export function beachSvg(w: number, working: LensCrab[], move: LensMove | undefined, enterAt: number, now: number, skipper: Skipper = IDLE_SKIPPER): Drawn {
  const last = lastMove(move, now)
  const oldLanes = last ? new Map(last.before.work.map((id, i) => [id, i + 1])) : null
  const walkers = [captainWalker(skipper), ...working.map(m => crabWalker(m, now))]
  const h = beachH(walkers.length)
  const body = `<g${attrs('', once('fade', enterAt, now))}>${beachMarkup(w, walkers, oldLanes, last?.since ?? Infinity, now)}</g>`
  const alt = [`${CAPTAIN_NAME}: ${captainQuip(skipper.captain)}`, ...working.map(m => `${m.name}: ${quipOf(m, now)}`)].join('. ')
  return { svg: doc(w, h, body, CRAB_STYLE), height: h, alt }
}

/**
 * One list of the crew as a picture: the crabs at work (a row each under the beach), or those that
 * reported back. For a moment after the crew's order changed, a row that moved within the list flies to
 * its new place; a crab new to the list flies in, lit (at the foot of those at work, or from just under
 * its title into the top of those back) and is painted above the rest. Rows not in flight come in after
 * `enterAt` (the list or its section opened).
 */
export function crewListSvg(w: number, kind: 'work' | 'base', list: LensCrab[], move: LensMove | undefined, enterAt: number, now: number): Drawn {
  const last = lastMove(move, now)
  const before = last ? last.before[kind] : null
  const h = kind === 'work' ? ROW.work : ROW.base
  const still: string[] = []
  const pushed: string[] = []
  const flying: string[] = []
  list.forEach((m, i) => {
    const y = i * h
    const row = kind === 'work' ? workRow(w, m, now) : baseRow(w, m, i, now)
    const was = before ? before.indexOf(m.id) : i
    const isNew = before !== null && was < 0
    // A crab new to the list comes from below its last row (at work), or from just above its first (back).
    const oldY = !before ? y : isNew ? (kind === 'work' ? list.length * h : -h) : was * h
    const dy = oldY - y
    if (!last || dy === 0) {
      still.push(`<g transform="translate(0 ${y})"><g${attrs('', once('in', enterAt, now, stagger(i)))}>${row}</g></g>`)
      return
    }
    const since = last.since
    const id = `cf${i}`
    // A slight lift at mid-flight, so a crab reads as flying rather than sliding.
    const fly =
      since < FLY
        ? `@keyframes ${id}{0%{transform:translateY(${dy}px)${isNew ? ';opacity:0' : ''}}55%{transform:translateY(${f1(dy * 0.3 - (isNew ? 5 : 0))}px);opacity:1}100%{transform:none;opacity:1}}` +
          `.${id}{animation:${id} ${FLY}s cubic-bezier(.25,.8,.25,1) ${(-since).toFixed(3)}s both}`
        : ''
    const glow = isNew ? `.${id}h{animation:sl-fade ${(FLY + GLOW).toFixed(2)}s ease-in reverse ${(-since).toFixed(3)}s both}` : ''
    ;(isNew ? flying : pushed).push(
      `<defs><style>${fly}${glow}</style></defs>` +
        `<g transform="translate(0 ${y})"><g${fly ? ` class="${id}"` : ''}>` +
        (isNew ? `<rect class="${id}h" x="-2" y="1" width="${w + 4}" height="${h - 2}" rx="10" fill="${characterOf(m.character).color}" fill-opacity=".14"/>` : '') +
        `${row}</g></g>`,
    )
  })
  const height = Math.max(1, list.length * h)
  const alt = `${kind === 'work' ? 'At work' : 'Reported back'}: ${list.map(m => crabAlt(m, now)).join('; ')}`
  return { svg: doc(w, height, still.join('') + pushed.join('') + flying.join(''), CRAB_STYLE), height, alt }
}

// ---------- the band above the prompt ----------

export const BAND_H = 32

/**
 * The crew band: the crabs out since the last prompt (at work first), who is at work, and one bar of the
 * crew's progress, a finished crab counting as done. The bar grows from where it was at the crew's last
 * change; it shimmers while anyone is still out.
 */
export function bandSvg(w: number, shown: readonly LensCrab[], now: number): Drawn {
  const working = shown.filter(m => m.status === 'running')
  const valueOf = (m: LensCrab) => (m.status === 'running' ? progressOf(m).value : 1)
  const at = Math.max(0, ...shown.map(m => m.progressAt))
  const mean = shown.reduce((s, m) => s + valueOf(m), 0) / Math.max(1, shown.length)
  const before = shown.reduce((s, m) => s + (m.progressAt === at ? m.progressBefore : valueOf(m)), 0) / Math.max(1, shown.length)
  const room = Math.max(1, Math.floor((w * 0.32) / 30))
  const faces = [...working, ...shown.filter(m => m.status !== 'running')].slice(0, room)
  const crabs = faces.map((m, i) => `<g transform="translate(${i * 30} 3) scale(.6)">${crabMarkup(m, poseOf(m, now), now, `bg${i}`)}</g>`).join('')
  const x0 = faces.length * 30 + 8
  const back = shown.length - working.length
  const who = working.length
    ? `${working
        .slice(0, 3)
        .map(m => m.name)
        .join(', ')}${working.length > 3 ? ` +${working.length - 3}` : ''} at work${back ? ` · ${back} back` : ''}`
    : `All back at base · ${back}`
  const barW = Math.max(48, Math.min(170, w * 0.24))
  const pctW = 40
  const barX = w - pctW - barW
  const label = `${working.length ? '≈' : ''}${Math.round(mean * 100)}%`
  const color = working.length ? ACCENT : '#22a06b'
  const body =
    crabs +
    `<text class="ink" x="${x0}" y="20.5" font-size="12.5" font-weight="550">${esc(fit(who, barX - x0 - 10, 12.5))}</text>` +
    gradient('bbg', color, lighter(color)) +
    bar('bbar', barX, 13, barW, 7, before, mean, 'url(#bbg)', working.length > 0, at, now) +
    `<text${attrs('dim', once('bump', at, now))} x="${w - 2}" y="20.5" font-size="11.5" font-weight="650" text-anchor="end">${esc(label)}</text>`
  return {
    svg: doc(w, BAND_H, body, CRAB_STYLE),
    height: BAND_H,
    alt: `Crew: ${who}, ${label} along`,
  }
}

// ---------- who's who ----------

/**
 * The characters on duty as a strip of small cards: each one's crab, its role, and the agent types it
 * stands for. The cards wrap to as many rows as the width needs, and pop in when the legend opens (`openedAt`).
 */
export function legendSvg(w: number, entries: readonly LegendEntry[], openedAt: number, now: number): Drawn {
  const cellW = 150
  const cellH = 34
  const perRow = Math.max(1, Math.floor(w / cellW))
  const cells = entries
    .map((e, i) => {
      const x = (i % perRow) * cellW
      const y = Math.floor(i / perRow) * cellH
      // Agent types are names, shown as code and spelled as they are; the captain's note is plain words.
      const under = e.note
        ? `<text class="dim" x="34" y="28" font-size="10.5">${esc(e.note)}</text>`
        : `<text class="dim" x="34" y="28" font-size="10" font-family="ui-monospace,SFMono-Regular,Consolas,monospace">${esc(fit(e.types.join(', '), cellW - 40, 10.5))}</text>`
      return (
        `<g transform="translate(${x} ${y})"><g${attrs('', once('pop', openedAt, now, stagger(i)))}>` +
        `<g transform="translate(0 2) scale(.62)">${crabMarkup({ character: e.character }, 'work', 0, `lg${i}`)}</g>` +
        `<text x="34" y="14" font-size="12" font-weight="650" fill="${e.color}">${esc(e.role)}</text>` +
        under +
        `</g></g>`
      )
    })
    .join('')
  const height = Math.max(1, Math.ceil(entries.length / perRow) * cellH)
  // A still crab here: the legend says who is who, the beach does the walking.
  const still = cells.replace(/ class="c-(legA|legB|snip|bob|blink)" style="[^"]*"/g, '')
  return { svg: doc(w, height, still, CRAB_STYLE), height, alt: `Who's who: ${entries.map(e => `${e.role} = ${e.note ?? e.types.join(', ')}`).join('; ')}` }
}
