// The crew drawn for the desktop: vector crabs, and the crew's two lists (at work, back at base) as one
// picture, so a crab can fly from one list to the other and to a new place in its own.
// As in art.ts, nothing animates from the moment it is drawn: a one-shot (a cheer, a flight, a bar
// growing) is pinned to when it happened, and a loop (legs, claws, blinks) keeps its phase across drawings.
import type { LensCrab, LensMove } from '../types'
import { STILL, attrs, bar, doc, esc, f1, fit, gradient, lighter, loopOf, once, onceOf, stagger, textWidth } from './art'
import type { Anim, Drawn } from './art'
import { BASE_MARK, actionOf, characterOf, duration, poseOf, progressLabel, progressOf } from './crew'
import type { Accessory, Character, Pose } from './crew'

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
@keyframes c-lift{0%{transform:translateY(0)}50%{transform:translateY(-3px)}100%{transform:translateY(0)}}
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
.c-lift{animation:c-lift .8s ease-in-out both}
.gchip{fill:#e6f4ea}.gchipt{fill:#1f7a45}.rchip{fill:#fdecec}.rchipt{fill:#c0392b}.schip{fill:#efeeea}.schipt{fill:#6b6a66}
@media (prefers-color-scheme: dark){.gchip{fill:#1c3326}.gchipt{fill:#6fd39b}.rchip{fill:#3a1f1d}.rchipt{fill:#ff8a80}.schip{fill:#2e2d2a}.schipt{fill:#a8a7a2}}
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

const star = (x: number, y: number, r: number, fill: string, a: Anim = STILL) =>
  `<g transform="translate(${f1(x)} ${f1(y)})"><path${attrs('', a)} d="M0,${-r} L${f1(r * 0.27)},${f1(-r * 0.27)} L${r},0 L${f1(r * 0.27)},${f1(r * 0.27)} L0,${r} L${f1(-r * 0.27)},${f1(r * 0.27)} L${-r},0 L${f1(-r * 0.27)},${f1(-r * 0.27)} Z" fill="${fill}"/></g>`

// ---------- one crab, in a 48 × 44 box ----------

/** The left half: legs, a claw on its arm, an eye on its stalk. The right half is its mirror. */
function half(c: Character, pose: Pose, now: number, endedAt: number, gid: string): string {
  const shell = c.color
  const line = darker(shell)
  const working = pose === 'work'
  const legA = working ? loopOf('c-legA', P.leg, now) : STILL
  const legB = working ? loopOf('c-legB', P.leg, now) : STILL
  const tap = pose === 'wait' ? loopOf('c-tap', P.tap, now) : STILL
  const legs =
    `<path${attrs('', legA)} d="M13,29 q-5,1 -8,5" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
    `<path${attrs('', legB)} d="M14,32 q-5,2 -7,7" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
    `<path${attrs('', pose === 'wait' ? tap : legA)} d="M16,34 q-3,3 -4,7" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
  const snip = working ? loopOf('c-snip', P.snip, now) : STILL
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
      .map(([x, y], i) => star(x!, y!, 2.6, i % 2 ? '#ffd54a' : c.color, onceOf('c-spark', SPARK, endedAt, now, 0.15 + i * 0.07)))
      .join('')
  const working = pose === 'work'
  const hop = pose === 'done' ? onceOf('c-hop', CHEER, endedAt, now) : working ? loopOf('c-bob', P.bob, now) : STILL
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

// ---------- the crew as one picture ----------

const ROW = { head: 26, work: 72, base: 48, gap: 8 } as const

/** A crew order's two halves: the crabs at work, and the ones back at base. */
function splitOrder(order: readonly string[]): { work: string[]; base: string[] } {
  const cut = order.indexOf(BASE_MARK)
  return cut < 0 ? { work: [...order], base: [] } : { work: order.slice(0, cut), base: order.slice(cut + 1) }
}

type Layout = { y: Map<string, number>; working: Set<string>; heads: { label: string; count: number; y: number }[]; workEnd: number; height: number }

/** Where each crab's row sits for a crew order, the base mark between its two halves. */
function layoutOf(order: readonly string[]): Layout {
  const { work, base } = splitOrder(order)
  const y = new Map<string, number>()
  const heads: Layout['heads'] = []
  let at = 0
  if (work.length) {
    heads.push({ label: 'AT WORK', count: work.length, y: at })
    at += ROW.head
    for (const id of work) {
      y.set(id, at)
      at += ROW.work
    }
  }
  const workEnd = at
  if (base.length) {
    if (work.length) at += ROW.gap
    heads.push({ label: 'BACK AT BASE', count: base.length, y: at })
    at += ROW.head
    for (const id of base) {
      y.set(id, at)
      at += ROW.base
    }
  }
  return { y, working: new Set(work), heads, workEnd, height: at }
}

/** A crab at work: the crab, its name and role, its task, what it is doing, and its progress. */
function workRow(w: number, m: LensCrab, i: number, now: number): string {
  const c = characterOf(m.character)
  const x0 = 60
  const p = progressOf(m)
  const label = progressLabel(m)
  const labelW = textWidth(label, 12) + 4
  const meta = `${m.toolCalls} call${m.toolCalls === 1 ? '' : 's'} · ${duration(now - m.startedAt)}`
  const metaW = textWidth(meta, 10.5) + 8
  const title = `<text x="${x0}" y="18" font-size="13"><tspan class="ink" font-weight="650">${esc(fit(m.name, 140, 13))}</tspan><tspan class="dim"> the ${esc(c.role)}</tspan></text>`
  const pct = `<text x="${w - 2}" y="18" font-size="12" font-weight="700" fill="${c.color}" text-anchor="end">${esc(label)}</text>`
  const task = `<text class="dim" x="${x0}" y="34" font-size="11.5">${esc(fit(m.description, w - x0 - metaW - 6, 11.5))}</text>`
  const metaText = `<text class="faint" x="${w - 2}" y="34" font-size="10.5" text-anchor="end">${esc(meta)}</text>`
  const action = `<circle cx="${x0 + 3}" cy="45.5" r="2.6" fill="${c.color}"/><text x="${x0 + 10}" y="49" font-size="11.5" font-style="italic" fill="${darker(c.color, 0.1)}">${esc(fit(actionOf(m, now), w - x0 - labelW - 14, 11.5))}</text>`
  const grow = bar(`cb${i}`, x0, 58, w - x0 - 2, 5, m.progressBefore, p.value, `url(#cbg${i})`, true, m.progressAt, now)
  return (
    gradient(`cbg${i}`, c.color, lighter(c.color)) +
    `<g transform="translate(4 12)">${crabMarkup(m, poseOf(m, now), now, `cg${i}`)}</g>` +
    title +
    pct +
    task +
    metaText +
    action +
    grow
  )
}

const CHIP: Record<Exclude<LensCrab['status'], 'running'>, { label: string; cls: string }> = {
  done: { label: 'done', cls: 'g' },
  failed: { label: 'failed', cls: 'r' },
  stopped: { label: 'stopped', cls: 's' },
}

/** A crab back at base: a smaller crab, its name and role, how its run ended, its task and how long it took. */
function baseRow(w: number, m: LensCrab, i: number, now: number): string {
  const c = characterOf(m.character)
  const x0 = 54
  const chip = CHIP[m.status === 'running' ? 'done' : m.status]
  const chipW = textWidth(chip.label, 10.5) + 14
  const took = duration((m.endedAt ?? now) - m.startedAt)
  return (
    `<g transform="translate(9 6) scale(.78)">${crabMarkup(m, poseOf(m, now), now, `cg${i}`)}</g>` +
    `<text x="${x0}" y="19" font-size="12.5"><tspan class="ink" font-weight="650">${esc(fit(m.name, 130, 12.5))}</tspan><tspan class="dim"> the ${esc(c.role)}</tspan></text>` +
    `<g${attrs('', once('pop', m.endedAt ?? 0, now, 0.5))}><rect class="${chip.cls}chip" x="${f1(w - 2 - chipW)}" y="7" width="${f1(chipW)}" height="17" rx="8.5"/><text class="${chip.cls}chipt" x="${f1(w - 2 - chipW / 2)}" y="19" font-size="10.5" font-weight="650" text-anchor="middle">${chip.label}</text></g>` +
    `<text class="faint" x="${f1(w - 8 - chipW)}" y="19" font-size="10.5" text-anchor="end">${esc(took)}</text>` +
    `<text class="faint" x="${x0}" y="36" font-size="11">${esc(fit(m.description, w - x0 - 4, 11))}</text>`
  )
}

const crabAlt = (m: LensCrab, now: number) => `${m.name} the ${characterOf(m.character).role}, ${m.status === 'running' ? `${progressLabel(m)}, ${actionOf(m, now)}` : m.status}`

/**
 * The crew as one picture: its crabs at work, then the ones back at base. For a moment after the
 * crew's order last changed (`move`), each crab that moved flies from its old place to its new one,
 * a crab that just finished flies down into the base list, and a new one flies in at the foot of
 * the working list; the crab with the news is lit as it lands and painted above the rest. A crab not
 * in flight comes in after `enterAt` (its section opened).
 */
export function crewSvg(w: number, working: LensCrab[], base: LensCrab[], move: LensMove | undefined, enterAt: number, now: number): Drawn {
  const order = [...working.map(m => m.id), BASE_MARK, ...base.map(m => m.id)]
  const lay = layoutOf(order)
  const since = move ? (now - move.at) / 1000 : Infinity
  const old = move && move.from.length && since < FLY + GLOW ? layoutOf(move.from) : null
  // A list's header glides with its crabs: one jumping ahead would sit on top of the crabs still in flight.
  const heads = lay.heads
    .map((h, i) => {
      const was = old?.heads.find(o => o.label === h.label)
      const dy = was && since < FLY ? was.y - h.y : 0
      const id = `ch${i}`
      const glide = dy
        ? `<defs><style>@keyframes ${id}{from{transform:translateY(${dy}px)}to{transform:none}}.${id}{animation:${id} ${FLY}s cubic-bezier(.25,.8,.25,1) ${(-since).toFixed(3)}s both}</style></defs>`
        : ''
      const enter = old && !was ? onceOf('fade', 0.45, move?.at ?? 0, now) : once('fade', enterAt, now)
      // Capitals with letter-spacing run wider than textWidth's guess for mixed case.
      const countX = 2 + h.label.length * (10.5 * 0.68 + 0.7) + 5
      return (
        `${glide}<g transform="translate(0 ${h.y})"><g${attrs(dy ? id : '', enter)}>` +
        `<text class="dim" x="2" y="16" font-size="10.5" font-weight="700" letter-spacing=".7">${h.label}</text>` +
        `<text class="faint" x="${f1(countX)}" y="16" font-size="10.5" font-weight="700">${h.count}</text></g></g>`
      )
    })
    .join('')
  // Which crabs overtook another in their own list: compared among the crabs in that list both before
  // and after, so a crab that only closes a gap left by one that went is not lit as news.
  const oldParts = move ? splitOrder(move.from) : { work: [], base: [] }
  const newParts = splitOrder(order)
  const overtook = new Set<string>()
  for (const part of ['work', 'base'] as const) {
    const before = oldParts[part]
    const after = newParts[part]
    const common = after.filter(id => before.includes(id))
    const was = before.filter(id => common.includes(id))
    common.forEach((id, k) => {
      if (k < was.indexOf(id)) overtook.add(id)
    })
  }
  const still: string[] = []
  const pushed: string[] = []
  const flying: string[] = []
  const all = [...working, ...base]
  all.forEach((m, i) => {
    const isWorking = lay.working.has(m.id)
    const y = lay.y.get(m.id) ?? 0
    const h = isWorking ? ROW.work : ROW.base
    const row = isWorking ? workRow(w, m, i, now) : baseRow(w, m, i, now)
    const oldY = old ? (old.y.get(m.id) ?? lay.workEnd) : y
    const dy = oldY - y
    if (!old || dy === 0) {
      const enter = once('in', enterAt, now, stagger(i))
      still.push(`<g transform="translate(0 ${y})"><g${attrs('', enter)}>${row}</g></g>`)
      return
    }
    const isNew = !old.y.has(m.id)
    const crossed = !isNew && old.working.has(m.id) !== isWorking
    const isNews = isNew || crossed || overtook.has(m.id)
    const id = `cf${i}`
    // A slight lift at mid-flight, so a crab reads as flying rather than sliding.
    const fly =
      since < FLY
        ? `@keyframes ${id}{0%{transform:translateY(${dy}px)${isNew ? ';opacity:0' : ''}}55%{transform:translateY(${f1(dy * 0.3 - (isNews ? 5 : 0))}px);opacity:1}100%{transform:none;opacity:1}}` +
          `.${id}{animation:${id} ${FLY}s cubic-bezier(.25,.8,.25,1) ${(-since).toFixed(3)}s both}`
        : ''
    const glow = isNews ? `.${id}h{animation:sl-fade ${(FLY + GLOW).toFixed(2)}s ease-in reverse ${(-since).toFixed(3)}s both}` : ''
    ;(isNews ? flying : pushed).push(
      `<defs><style>${fly}${glow}</style></defs>` +
        `<g transform="translate(0 ${y})"><g${fly ? ` class="${id}"` : ''}>` +
        (isNews ? `<rect class="${id}h" x="-2" y="1" width="${w + 4}" height="${h - 2}" rx="10" fill="${characterOf(m.character).color}" fill-opacity=".14"/>` : '') +
        `${row}</g></g>`,
    )
  })
  const height = Math.max(1, lay.height)
  const alt = [
    working.length ? `At work: ${working.map(m => crabAlt(m, now)).join('; ')}` : '',
    base.length ? `Back at base: ${base.map(m => crabAlt(m, now)).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('. ')
  return { svg: doc(w, height, heads + still.join('') + pushed.join('') + flying.join(''), CRAB_STYLE), height, alt }
}
