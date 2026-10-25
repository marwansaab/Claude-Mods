// Animated SVG for the desktop pane, one drawing per row.
// The pane is redrawn on every event of the session, and a redrawn picture starts its animations over.
// So no animation here starts when it is drawn: each is pinned to the moment its row changed. A drawing
// made after that moment shows the animation part-way through (a negative delay) or, once it is over,
// carries no animation at all and stays still. The loops (the step in progress) keep their phase from
// one drawing to the next. Every drawing ends in its final state when motion is reduced.
import type { LensMove, LensSkill, LensStep } from '../types'
import type { ToolRow } from './track'

export type Drawn = { svg: string; height: number; alt: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const f1 = (n: number) => n.toFixed(1)

const STYLE = `<style>
svg{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.ink{fill:#1f1e1c}.dim{fill:#6b6a66}.faint{fill:#a3a19a}.track{fill:#ecebe6}.ring{stroke:#c9c7c0}.chip{fill:#eef3ff}.chipt{fill:#2f5bd3}.chips{stroke:#c9d8ff}
.pill{fill:#f3f2ee}.pillt{fill:#55534e}.err{fill:#e5484d}.done{fill:#22a06b}.strike{stroke:#a3a19a}.sheen{fill:#ffffff}
@media (prefers-color-scheme: dark){
.ink{fill:#ecebe8}.dim{fill:#a8a7a2}.faint{fill:#6f6d68}.track{fill:#34332f}.ring{stroke:#55534e}.chip{fill:#1d2a4a}.chipt{fill:#9db8ff}.chips{stroke:#2f4373}
.pill{fill:#2e2d2a}.pillt{fill:#cfcdc7}.err{fill:#ff6369}.done{fill:#3fc287}.strike{stroke:#6f6d68}.sheen{fill:#ffffff}}
@keyframes sl-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes sl-fade{from{opacity:0}to{opacity:1}}
@keyframes sl-pop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.18);opacity:1}100%{transform:scale(1)}}
@keyframes sl-bump{0%{transform:scale(1)}40%{transform:scale(1.35)}100%{transform:scale(1)}}
@keyframes sl-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes sl-strike{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes sl-halo{0%{transform:scale(1);opacity:.55}100%{transform:scale(2.3);opacity:0}}
@keyframes sl-spin{to{transform:rotate(360deg)}}
@keyframes sl-sheen{0%{transform:translateX(-120px)}100%{transform:translateX(var(--sl-run,600px))}}
.in{animation:sl-in .5s cubic-bezier(.2,.8,.2,1) both}
.fade{animation:sl-fade .45s ease both}
.pop{transform-box:fill-box;transform-origin:center;animation:sl-pop .55s cubic-bezier(.3,1.4,.5,1) both}
.bump{transform-box:fill-box;transform-origin:center;animation:sl-bump .45s ease-out both}
.draw{animation:sl-draw .45s ease-out both}
.strk{transform-box:fill-box;transform-origin:left center;animation:sl-strike .5s cubic-bezier(.6,0,.2,1) both}
.halo{transform-box:fill-box;transform-origin:center;animation:sl-halo 1.8s ease-out infinite}
.spin{transform-box:fill-box;transform-origin:center;animation:sl-spin 1.1s linear infinite}
.sheenr{animation:sl-sheen 2.6s cubic-bezier(.4,0,.2,1) infinite}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>`

/** How long each one-shot animation runs, in seconds, as STYLE sets it. */
const LENGTH = { in: 0.5, fade: 0.45, pop: 0.55, bump: 0.45, draw: 0.45, strk: 0.5 } as const
type Once = keyof typeof LENGTH

/** The loops' periods, in seconds, as STYLE sets them. */
const PERIOD = { halo: 1.8, spin: 1.1, sheenr: 2.6 } as const

/**
 * A one-shot animation pinned to `at` (ms), `wait` seconds after it: the class and delay that show it at
 * `now`, or nothing once it is over, or when `at` is unknown (0). Nothing then animates on a redraw.
 */
function once(name: Once, at: number, now: number, wait = 0): { cls: string; style: string } {
  if (!at) return { cls: '', style: '' }
  const since = (now - at) / 1000 - wait
  if (since >= LENGTH[name]) return { cls: '', style: '' }
  return { cls: name, style: `animation-delay:${(-since).toFixed(3)}s;` }
}

/** A loop's class and delay, so it is at the same point of its cycle in every drawing made at `now`. */
function loop(name: keyof typeof PERIOD, now: number): { cls: string; style: string } {
  return { cls: name, style: `animation-delay:${(-((now / 1000) % PERIOD[name])).toFixed(3)}s;` }
}

/** `class` and `style` attributes for an element: its own classes, then any animation's. */
function attrs(base: string, ...anims: { cls: string; style: string }[]): string {
  const cls = [base, ...anims.map(a => a.cls)].filter(Boolean).join(' ')
  const style = anims.map(a => a.style).join('')
  return `${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}`
}

/** A row comes in a little after the one above it. */
const stagger = (index: number) => Math.min(index, 8) * 0.04

const doc = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${STYLE}${body}</svg>`

/** About how wide a run of text is, in pixels, at a font size: enough to wrap and cut by. */
const textWidth = (s: string, size: number) => s.length * size * 0.56

/** Cuts a text to fit a width, ending it with an ellipsis. */
export function fit(s: string, width: number, size: number): string {
  const max = Math.max(3, Math.floor(width / (size * 0.56)))
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Greedy word wrap to a width in pixels. */
export function wrapText(s: string, width: number, size: number): string[] {
  const per = Math.max(8, Math.floor(width / (size * 0.56)))
  const lines: string[] = []
  let line = ''
  for (const word of s.replace(/\s+/g, ' ').trim().split(' ')) {
    let rest = word
    while (rest.length > per) {
      if (line) lines.push(line)
      line = ''
      lines.push(rest.slice(0, per))
      rest = rest.slice(per)
    }
    if (!rest) continue
    if (!line) line = rest
    else if (line.length + 1 + rest.length <= per) line += ` ${rest}`
    else {
      lines.push(line)
      line = rest
    }
  }
  if (line || !lines.length) lines.push(line)
  return lines
}

// ---------- colour ----------

/** Mid-tones that read on light and dark; each tool group keeps one by its name. */
const HUES = ['#8e6cf0', '#4c8dff', '#12a594', '#e2775a', '#d99a1e', '#e5579a', '#3fae5f', '#1ea7c5']
const BUILT_IN_HUE = '#7c8594'
export const ACCENT = '#d97757'
const ACCENT_2 = '#f2a65a'

export function hueOf(group: string): string {
  if (group === 'builtin') return BUILT_IN_HUE
  let h = 0
  for (const c of group) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return HUES[h % HUES.length]!
}

/** A lighter tone of a hex colour, for the far end of a gradient. */
function lighter(hex: string, by = 0.35): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * by)
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

const gradient = (id: string, from: string, to: string) =>
  `<defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`

/** Seconds a bar takes to grow. */
const GROW = 0.9

/**
 * A bar filled to `to` (0 to 1) of its track. Within GROW seconds of `at` it is still growing from `from`;
 * after that it is drawn full and still. A sheen runs along it while `isLive`.
 */
function bar(id: string, x: number, y: number, w: number, h: number, from: number, to: number, fill: string, isLive: boolean, at: number, now: number, wait = 0): string {
  const full = Math.max(to > 0 ? h : 0, w * Math.min(1, to))
  const since = at ? (now - at) / 1000 - wait : GROW
  let grow = ''
  if (full > 0 && since < GROW) {
    const start = Math.max(0, Math.min(1, (w * from) / full))
    grow =
      `<style>@keyframes ${id}{from{transform:scaleX(${start.toFixed(3)})}to{transform:scaleX(1)}}` +
      `.${id}{transform-box:fill-box;transform-origin:left center;animation:${id} ${GROW}s cubic-bezier(.25,.9,.25,1) ${(-since).toFixed(3)}s both}</style>`
  }
  const clip = `<clipPath id="${id}c"><rect x="${f1(x)}" y="${f1(y)}" width="${f1(full)}" height="${h}" rx="${h / 2}"/></clipPath>`
  // The skew sits on a wrapper: the animation's own transform would replace one on the rect.
  const sheen =
    isLive && full > 24
      ? `<g clip-path="url(#${id}c)"><g transform="skewX(-20)"><rect class="sheen sheenr" x="${f1(x)}" y="${f1(y - 2)}" width="60" height="${h + 4}" opacity=".35" style="--sl-run:${f1(full + 120)}px;${loop('sheenr', now).style}"/></g></g>`
      : ''
  return (
    `<defs>${clip}${grow}</defs>` +
    `<rect class="track" x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${h}" rx="${h / 2}"/>` +
    (full > 0 ? `<rect${grow ? ` class="${id}"` : ''} x="${f1(x)}" y="${f1(y)}" width="${f1(full)}" height="${h}" rx="${h / 2}" fill="${fill}"/>` : '') +
    sheen
  )
}

/** A rounded pill with a number or a word in it; it bumps for a moment after `at`. */
function pill(x: number, y: number, label: string, at: number, now: number): { svg: string; width: number } {
  const w = Math.max(22, textWidth(label, 11) + 14)
  const g = `<g${attrs('', once('bump', at, now))}><rect class="pill" x="${f1(x - w)}" y="${y}" width="${f1(w)}" height="18" rx="9"/><text class="pillt" x="${f1(x - w / 2)}" y="${y + 12.5}" font-size="11" font-weight="600" text-anchor="middle">${esc(label)}</text></g>`
  return { svg: g, width: w }
}

// ---------- to-do ----------

/** The list's progress: a bar that grew from the steps done before the last change, and the share done. */
export function todoProgressSvg(w: number, done: number, total: number, doneBefore: number, at: number, now: number): Drawn {
  const h = 30
  const isDone = total > 0 && done === total
  const label = isDone ? 'All done' : `${Math.round((done / Math.max(1, total)) * 100)}%`
  const labelW = 64
  const fill = isDone ? 'url(#slpd)' : 'url(#slpg)'
  const body =
    gradient('slpg', ACCENT, ACCENT_2) +
    gradient('slpd', '#22a06b', '#5fd3a0') +
    bar('slpb', 2, 12, w - labelW - 10, 7, doneBefore / Math.max(1, total), done / Math.max(1, total), fill, !isDone, at, now) +
    `<text${attrs(isDone ? 'done' : 'dim', once('fade', at, now))} x="${w - 2}" y="19" font-size="12" font-weight="600" text-anchor="end">${esc(label)}</text>`
  return { svg: doc(w, h, body), height: h, alt: `${done} of ${total} steps done` }
}

/**
 * One step: its mark, then its text wrapped beside it. It comes in after `enterAt` (it joined the list, or
 * its section opened), and draws its check and strike after its own `changedAt`.
 */
export function stepSvg(w: number, step: LensStep, index: number, enterAt: number, now: number): Drawn {
  const size = 13
  const lineH = 19
  const textX = 30
  const isDone = step.status === 'completed'
  const isNow = step.status === 'in_progress'
  const changedAt = step.changedAt ?? 0
  const text = isNow && step.active ? step.active : step.text
  const lines = wrapText(text, w - textX - 4, size)
  const h = Math.max(26, lines.length * lineH + 8)
  const cy = 14
  let mark: string
  if (isDone) {
    mark =
      `<g${attrs('', once('pop', changedAt, now))}><circle cx="12" cy="${cy}" r="8.5" class="done"/></g>` +
      `<path${attrs('', once('draw', changedAt, now, 0.12))} pathLength="1" stroke-dasharray="1" d="M8 ${cy + 0.3} l2.7 2.7 l5.3 -5.6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  } else if (isNow) {
    mark =
      gradient('slsa', ACCENT, ACCENT_2) +
      `<circle${attrs('', loop('halo', now))} cx="12" cy="${cy}" r="6" fill="${ACCENT}"/>` +
      `<circle cx="12" cy="${cy}" r="9" fill="none" stroke="${ACCENT}" stroke-opacity=".22" stroke-width="2"/>` +
      // A whole circle with a dash showing a third of it: its box is the ring's, so it turns on the ring's centre.
      `<circle${attrs('', loop('spin', now))} cx="12" cy="${cy}" r="9" fill="none" stroke="url(#slsa)" stroke-width="2.2" stroke-linecap="round" pathLength="100" stroke-dasharray="30 70"/>` +
      `<circle cx="12" cy="${cy}" r="4.2" fill="${ACCENT}"/>`
  } else {
    mark = `<circle cx="12" cy="${cy}" r="7.5" fill="none" class="ring" stroke-width="1.6"/>`
  }
  const cls = isDone ? 'faint' : isNow ? 'ink' : 'dim'
  const weight = isNow ? 650 : 450
  const words = lines
    .map((l, i) => `<text class="${cls}" x="${textX}" y="${f1(cy + 4.5 + i * lineH)}" font-size="${size}" font-weight="${weight}">${esc(l)}</text>`)
    .join('')
  const strikes = isDone
    ? lines
        // A tighter guess than for wrapping: a strike that runs past the words shows more than one that stops short.
        .map(
          (l, i) =>
            `<line${attrs('strike', once('strk', changedAt, now, 0.2 + i * 0.08))} x1="${textX}" x2="${f1(textX + Math.min(w - textX - 4, l.length * size * 0.49))}" y1="${f1(cy + i * lineH)}" y2="${f1(cy + i * lineH)}" stroke-width="1.4" stroke-linecap="round"/>`,
        )
        .join('')
    : ''
  const sheen =
    isNow && lines.length
      ? `<defs><clipPath id="slst">${lines.map((l, i) => `<text x="${textX}" y="${f1(cy + 4.5 + i * lineH)}" font-size="${size}" font-weight="${weight}">${esc(l)}</text>`).join('')}</clipPath></defs>` +
        `<g clip-path="url(#slst)"><g transform="skewX(-20)"><rect class="sheen sheenr" x="${textX}" y="0" width="70" height="${h}" opacity=".55" style="--sl-run:${f1(w + 120)}px;${loop('sheenr', now).style}"/></g></g>`
      : ''
  const body = `<g${attrs('', once('in', enterAt, now, stagger(index)))}>${mark}${words}${strikes}${sheen}</g>`
  const state = isDone ? 'done' : isNow ? 'in progress' : 'to do'
  return { svg: doc(w, h, body), height: h, alt: `Step ${index + 1}, ${state}: ${text}` }
}

// ---------- lists that move ----------

/** Seconds a row takes to fly to its new place, and how long its highlight lingers after. */
const FLY = 0.7
const GLOW = 0.5

/**
 * Where a row flies from, for a moment after its list's last change of order: its old slot, or below the
 * list's end when it has just joined. Null when it stays put, the moment is over, or flights are off.
 */
function flightOf(name: string, index: number, rowH: number, move: LensMove | undefined, now: number, canFly: boolean): { dy: number; isNew: boolean; since: number } | null {
  if (!canFly || !move?.from.length) return null
  const since = (now - move.at) / 1000
  if (since >= FLY + GLOW) return null
  const was = move.from.indexOf(name)
  const fromIndex = was >= 0 ? was : move.to.length
  const dy = (fromIndex - index) * rowH
  return dy === 0 ? null : { dy, isNew: was < 0, since }
}

/**
 * A list drawn as one picture, so a row can fly past the others to its new place. Each row is drawn by
 * `draw`; one in flight goes from its old slot to its new one, its highlight fading as it lands, and is
 * painted above the rows it passes. One not in flight comes in after its `enterAt`.
 */
function listSvg<T extends { name: string }>(
  w: number,
  rowH: number,
  items: T[],
  move: LensMove | undefined,
  canFly: boolean,
  now: number,
  enterAt: (item: T) => number,
  hue: (item: T) => string,
  draw: (item: T, index: number, enterAt: number) => string,
  defs = '',
): string {
  const still: string[] = []
  // Rows pushed down make room; the row that moved up or joined is the news, lit and painted on top.
  const pushed: string[] = []
  const flying: string[] = []
  items.forEach((item, i) => {
    const y = i * rowH
    const f = flightOf(item.name, i, rowH, move, now, canFly)
    if (!f) {
      still.push(`<g transform="translate(0 ${y})">${draw(item, i, enterAt(item))}</g>`)
      return
    }
    const id = `slf${i}`
    const fly =
      f.since < FLY
        ? `@keyframes ${id}{from{transform:translateY(${f.dy}px)${f.isNew ? ';opacity:0' : ''}}to{transform:none;opacity:1}}` +
          `.${id}{animation:${id} ${FLY}s cubic-bezier(.2,.85,.25,1) ${(-f.since).toFixed(3)}s both}`
        : ''
    const isNews = f.isNew || f.dy > 0
    const glow = isNews ? `.${id}h{animation:sl-fade ${(FLY + GLOW).toFixed(2)}s ease-in reverse ${(-f.since).toFixed(3)}s both}` : ''
    ;(isNews ? flying : pushed).push(
      `<defs><style>${fly}${glow}</style></defs>` +
        `<g transform="translate(0 ${y})"><g${fly ? ` class="${id}"` : ''}>` +
        (isNews ? `<rect class="${id}h" x="-2" y="1" width="${w + 4}" height="${rowH - 2}" rx="8" fill="${hue(item)}" fill-opacity=".16"/>` : '') +
        // A row in flight needs no entrance of its own: the flight is its entrance.
        `${draw(item, i, 0)}</g></g>`,
    )
  })
  return doc(w, Math.max(1, items.length * rowH), defs + still.join('') + pushed.join('') + flying.join(''))
}

// ---------- skills ----------

const SKILL_ROW = 32

/** One skill: a slash tile, its name, an "always loaded" chip and its use count, which bumps on each use. */
function skillRow(w: number, skill: LensSkill, index: number, enterAt: number, now: number): string {
  const tile =
    `<g${attrs('', once('pop', enterAt, now, stagger(index)))}><rect x="2" y="5" width="22" height="22" rx="7" fill="url(#slsk)"/><text x="13" y="21" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">/</text></g>`
  const uses = skill.count ? pill(w - 2, 7, skill.count === 1 ? '1 use' : `${skill.count} uses`, skill.count > 1 ? skill.lastAt : 0, now) : { svg: '', width: 0 }
  const chipLabel = 'always loaded'
  const chipW = textWidth(chipLabel, 10.5) + 14
  const chipX = w - 2 - uses.width - (uses.width ? 6 : 0) - chipW
  const chip = skill.isAlways
    ? `<g><rect class="chip chips" x="${f1(chipX)}" y="7" width="${f1(chipW)}" height="18" rx="9" stroke-width="1"/><text class="chipt" x="${f1(chipX + chipW / 2)}" y="19.5" font-size="10.5" font-weight="600" text-anchor="middle">${chipLabel}</text></g>`
    : ''
  const nameRoom = (skill.isAlways ? chipX : w - uses.width - 8) - 36
  const name = `<text class="ink" x="34" y="20.5" font-size="13" font-weight="550">${esc(fit(skill.name, nameRoom, 13))}</text>`
  return `<g${attrs('', once('in', enterAt, now, stagger(index)))}>${tile}${name}${chip}${uses.svg}</g>`
}

const skillAlt = (s: LensSkill) => {
  const parts = [s.isAlways ? 'always loaded' : '', s.count ? `${s.count} use${s.count === 1 ? '' : 's'}` : ''].filter(Boolean)
  return `/${s.name}${parts.length ? `, ${parts.join(', ')}` : ''}`
}

/** Every skill, in order, as one picture: a skill that moves up flies there, a new one flies in from below. */
export function skillListSvg(w: number, skills: LensSkill[], move: LensMove | undefined, sectionAt: number, now: number): Drawn {
  const svg = listSvg(
    w,
    SKILL_ROW,
    skills,
    move,
    true,
    now,
    s => Math.max(s.firstAt ?? 0, sectionAt),
    () => '#8e6cf0',
    (s, i, enterAt) => skillRow(w, s, i, enterAt, now),
    gradient('slsk', '#8e6cf0', '#c4a8ff'),
  )
  return { svg, height: Math.max(1, skills.length * SKILL_ROW), alt: skills.map(skillAlt).join('; ') }
}

// ---------- tools ----------

/** A group's tile: its initials on its hue, popping in after `enterAt`. */
export function groupTileSvg(group: string, label: string, enterAt: number, now: number): Drawn {
  const hue = hueOf(group)
  const initials =
    group === 'builtin'
      ? '⌘'
      : label
          .replace(/^Desktop app · /, 'D ')
          .split(/\s+/)
          .filter(w => /^[A-Za-z0-9]/.test(w))
          .slice(0, 2)
          .map(w => w[0]!.toUpperCase())
          .join('') || '•'
  const body =
    gradient('slgt', hue, lighter(hue)) +
    `<g${attrs('', once('pop', enterAt, now))}><rect x="1" y="1" width="24" height="24" rx="7" fill="url(#slgt)"/><text x="13" y="${initials.length > 1 ? 17 : 18}" font-size="${initials.length > 1 ? 10.5 : 12.5}" font-weight="700" fill="#fff" text-anchor="middle">${esc(initials)}</text></g>`
  return { svg: doc(26, 26, body), height: 26, alt: `${label} tools` }
}

/** A group's total, with a small stack of its tools' shares; the total bumps after `at`, its last call. */
export function groupTotalSvg(group: string, count: number, errors: number, tools: number, at: number, now: number): Drawn {
  const label = `${count}`
  const w = Math.max(60, textWidth(label, 11) + 50)
  const hue = hueOf(group)
  const dots = Array.from({ length: Math.min(tools, 4) }, (_, i) => `<circle cx="${8 + i * 7}" cy="13" r="3" fill="${hue}" opacity="${1 - i * 0.18}"/>`).join('')
  const err = errors ? `<circle class="err" cx="${8 + Math.min(tools, 4) * 7 + 2}" cy="13" r="3"/>` : ''
  const p = pill(w - 1, 4, label, at, now)
  return { svg: doc(w, 26, `${dots}${err}${p.svg}`), height: 26, alt: `${count} calls${errors ? `, ${errors} failed` : ''}` }
}

/**
 * How full a tool's bar is: a log scale that fills at 50 calls. It depends on the tool's own count alone,
 * so a call to one tool changes that row's bar and no other.
 */
export const barShare = (count: number) => Math.min(1, Math.log2(1 + count) / Math.log2(51))

const TOOL_ROW = 36

/**
 * One tool: its name, its server when the list is flat, its bar and its count. It comes in after
 * `enterAt`; after each call (`lastAt`) the bar grows from the old count and the count bumps.
 */
function toolRow(w: number, row: ToolRow, index: number, showGroup: boolean, enterAt: number, now: number): string {
  const hue = hueOf(row.group)
  const id = `slt${index}`
  const count = String(row.count)
  const countW = textWidth(count, 12.5) + 4
  const errLabel = row.errors ? `${row.errors} failed` : ''
  const errW = errLabel ? textWidth(errLabel, 10.5) + 16 : 0
  const tagLabel = showGroup ? row.groupLabel : ''
  const tagW = tagLabel ? Math.min(140, textWidth(tagLabel, 10.5) + 22) : 0
  const nameRoom = w - countW - errW - tagW - 20
  const tag = tagLabel
    ? `<g><circle cx="${f1(w - countW - errW - tagW + 6)}" cy="11" r="3.5" fill="${hue}"/><text class="dim" x="${f1(w - countW - errW - tagW + 13)}" y="14.5" font-size="10.5">${esc(fit(tagLabel, tagW - 20, 10.5))}</text></g>`
    : ''
  const err = errLabel
    ? `<g><circle class="err" cx="${f1(w - countW - errW + 5)}" cy="11" r="3.5"/><text class="err" x="${f1(w - countW - errW + 12)}" y="14.5" font-size="10.5" font-weight="600">${esc(errLabel)}</text></g>`
    : ''
  // A row that has just come in grows its bar from empty with the others; a later call grows it from the old count.
  const entering = once('in', enterAt, now, stagger(index)).cls !== ''
  const grewAt = entering ? enterAt : row.lastAt
  const from = entering ? 0 : barShare(row.countBefore)
  return (
    `<g${attrs('', once('in', enterAt, now, stagger(index)))}>` +
    gradient(`${id}g`, hue, lighter(hue)) +
    `<text class="ink" x="2" y="15" font-size="13" font-weight="550">${esc(fit(row.label, nameRoom, 13))}</text>` +
    tag +
    err +
    `<text${attrs('ink', row.countBefore > 0 ? once('bump', row.lastAt, now) : { cls: '', style: '' })} x="${w - 2}" y="15" font-size="12.5" font-weight="700" text-anchor="end">${count}</text>` +
    bar(id, 2, 24, w - 4, 5, from, barShare(row.count), `url(#${id}g)`, false, grewAt, now, entering ? 0.1 + stagger(index) : 0) +
    `</g>`
  )
}

const toolAlt = (r: ToolRow, showGroup: boolean) =>
  `${r.label}${showGroup ? ` (${r.groupLabel})` : ''}: ${r.count} call${r.count === 1 ? '' : 's'}${r.errors ? `, ${r.errors} failed` : ''}`

/**
 * A list of tools as one picture: a server's tools, or every tool when the list is flat. A tool that
 * changes place flies there; a new one flies in from below. `canFly` is off while the filter narrows the list.
 */
export function toolListSvg(w: number, rows: ToolRow[], showGroup: boolean, move: LensMove | undefined, canFly: boolean, enterAt: (r: ToolRow) => number, now: number): Drawn {
  const svg = listSvg(w, TOOL_ROW, rows, move, canFly, now, enterAt, r => hueOf(r.group), (r, i, at) => toolRow(w, r, i, showGroup, at, now))
  return { svg, height: Math.max(1, rows.length * TOOL_ROW), alt: rows.map(r => toolAlt(r, showGroup)).join('; ') }
}
