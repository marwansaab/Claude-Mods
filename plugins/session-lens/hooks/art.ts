// Animated SVG for the desktop pane. Each drawing is one row, so a redraw replays only the rows whose
// picture changed: a step that is ticked off draws its check and strike, a tool that is called again
// grows its bar from the old count. Every drawing ends in its final state when motion is reduced.
import type { LensSkill, LensStep } from '../types'
import type { ToolRow } from './track'

export type Drawn = { svg: string; height: number; alt: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const f1 = (n: number) => n.toFixed(1)

const STYLE = `<style>
svg{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.ink{fill:#1f1e1c}.dim{fill:#6b6a66}.faint{fill:#a3a19a}.track{fill:#ecebe6}.ring{stroke:#c9c7c0}.chip{fill:#eef3ff}.chipt{fill:#2f5bd3}.chips{stroke:#c9d8ff}
.pill{fill:#f3f2ee}.pillt{fill:#55534e}.err{fill:#e5484d}.done{fill:#22a06b}.dones{stroke:#22a06b}.strike{stroke:#a3a19a}.sheen{fill:#ffffff}
@media (prefers-color-scheme: dark){
.ink{fill:#ecebe8}.dim{fill:#a8a7a2}.faint{fill:#6f6d68}.track{fill:#34332f}.ring{stroke:#55534e}.chip{fill:#1d2a4a}.chipt{fill:#9db8ff}.chips{stroke:#2f4373}
.pill{fill:#2e2d2a}.pillt{fill:#cfcdc7}.err{fill:#ff6369}.done{fill:#3fc287}.dones{stroke:#3fc287}.strike{stroke:#6f6d68}.sheen{fill:#ffffff}}
@keyframes sl-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes sl-fade{from{opacity:0}to{opacity:1}}
@keyframes sl-pop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.18);opacity:1}100%{transform:scale(1)}}
@keyframes sl-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes sl-strike{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes sl-halo{0%{transform:scale(1);opacity:.55}100%{transform:scale(2.3);opacity:0}}
@keyframes sl-spin{to{transform:rotate(360deg)}}
@keyframes sl-sheen{0%{transform:translateX(-120px)}100%{transform:translateX(var(--sl-run,600px))}}
@keyframes sl-breathe{0%,100%{opacity:1}50%{opacity:.55}}
.in{animation:sl-in .5s cubic-bezier(.2,.8,.2,1) both}
.fade{animation:sl-fade .45s ease both}
.pop{transform-box:fill-box;transform-origin:center;animation:sl-pop .55s cubic-bezier(.3,1.4,.5,1) both}
.draw{stroke-dasharray:1;animation:sl-draw .45s ease-out .12s both}
.strk{transform-box:fill-box;transform-origin:left center;animation:sl-strike .5s cubic-bezier(.6,0,.2,1) .2s both}
.halo{transform-box:fill-box;transform-origin:center;animation:sl-halo 1.8s ease-out infinite}
.spin{transform-box:fill-box;transform-origin:center;animation:sl-spin 1.1s linear infinite}
.sheenr{animation:sl-sheen 2.6s cubic-bezier(.4,0,.2,1) infinite}
.breathe{animation:sl-breathe 2.4s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>`

const doc = (w: number, h: number, body: string, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${STYLE}${extra}${body}</svg>`

const delay = (s: number) => `style="animation-delay:${s.toFixed(2)}s"`

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

/** A bar that grows from `from` to `to` (both 0 to 1) of its track, with a sheen while `isLive`. */
function bar(id: string, x: number, y: number, w: number, h: number, from: number, to: number, fill: string, isLive: boolean, wait = 0): string {
  const full = Math.max(to > 0 ? h : 0, w * Math.min(1, to))
  const start = full > 0 ? Math.max(0, Math.min(1, (w * from) / full)) : 0
  const grow = `@keyframes ${id}{from{transform:scaleX(${start.toFixed(3)})}to{transform:scaleX(1)}}`
  const clip = `<clipPath id="${id}c"><rect x="${f1(x)}" y="${f1(y)}" width="${f1(full)}" height="${h}" rx="${h / 2}"/></clipPath>`
  // The skew sits on a wrapper: the animation's own transform would replace one on the rect.
  const sheen = isLive && full > 24 ? `<g clip-path="url(#${id}c)"><g transform="skewX(-20)"><rect class="sheen sheenr" x="${f1(x)}" y="${f1(y - 2)}" width="60" height="${h + 4}" opacity=".35" style="--sl-run:${f1(full + 120)}px"/></g></g>` : ''
  return (
    `<defs>${clip}<style>${grow}.${id}{transform-box:fill-box;transform-origin:left center;animation:${id} .9s cubic-bezier(.25,.9,.25,1) ${wait.toFixed(2)}s both}</style></defs>` +
    `<rect class="track" x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${h}" rx="${h / 2}"/>` +
    (full > 0 ? `<rect class="${id}" x="${f1(x)}" y="${f1(y)}" width="${f1(full)}" height="${h}" rx="${h / 2}" fill="${fill}"/>` : '') +
    sheen
  )
}

/** A rounded pill with a number or a word in it. */
function pill(x: number, y: number, label: string, cls = 'pill', textCls = 'pillt', pop = false): { svg: string; width: number } {
  const w = Math.max(22, textWidth(label, 11) + 14)
  const g = `<g class="${pop ? 'pop' : ''}"><rect class="${cls}" x="${f1(x - w)}" y="${y}" width="${f1(w)}" height="18" rx="9"/><text class="${textCls}" x="${f1(x - w / 2)}" y="${y + 12.5}" font-size="11" font-weight="600" text-anchor="middle">${esc(label)}</text></g>`
  return { svg: g, width: w }
}

// ---------- to-do ----------

/** The list's progress: a bar that grows from the steps done before the last change, and the share done. */
export function todoProgressSvg(w: number, done: number, total: number, doneBefore: number): Drawn {
  const h = 30
  const isDone = total > 0 && done === total
  const label = isDone ? 'All done' : `${Math.round((done / Math.max(1, total)) * 100)}%`
  const labelW = 64
  const fill = isDone ? 'url(#slpd)' : 'url(#slpg)'
  const body =
    gradient('slpg', ACCENT, ACCENT_2) +
    gradient('slpd', '#22a06b', '#5fd3a0') +
    bar('slpb', 2, 12, w - labelW - 10, 7, doneBefore / Math.max(1, total), done / Math.max(1, total), fill, !isDone) +
    `<text class="${isDone ? 'done' : 'dim'} fade" x="${w - 2}" y="19" font-size="12" font-weight="600" text-anchor="end">${esc(label)}</text>`
  return { svg: doc(w, h, body), height: h, alt: `${done} of ${total} steps done` }
}

/** One step: its mark, then its text wrapped beside it. A change of status replays only this row. */
export function stepSvg(w: number, step: LensStep, index: number): Drawn {
  const size = 13
  const lineH = 19
  const textX = 30
  const isDone = step.status === 'completed'
  const isNow = step.status === 'in_progress'
  const text = isNow && step.active ? step.active : step.text
  const lines = wrapText(text, w - textX - 4, size)
  const h = Math.max(26, lines.length * lineH + 8)
  const cy = 14
  let mark: string
  if (isDone) {
    mark =
      `<g class="pop"><circle cx="12" cy="${cy}" r="8.5" class="done"/></g>` +
      `<path class="draw" pathLength="1" d="M8 ${cy + 0.3} l2.7 2.7 l5.3 -5.6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  } else if (isNow) {
    mark =
      gradient('slsa', ACCENT, ACCENT_2) +
      `<circle class="halo" cx="12" cy="${cy}" r="6" fill="${ACCENT}"/>` +
      `<circle cx="12" cy="${cy}" r="9" fill="none" stroke="${ACCENT}" stroke-opacity=".22" stroke-width="2"/>` +
      // A whole circle with a dash showing a third of it: its box is the ring's, so it turns on the ring's centre.
      `<circle class="spin" cx="12" cy="${cy}" r="9" fill="none" stroke="url(#slsa)" stroke-width="2.2" stroke-linecap="round" pathLength="100" stroke-dasharray="30 70"/>` +
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
        .map((l, i) => `<line class="strike strk" ${delay(0.2 + i * 0.08)} x1="${textX}" x2="${f1(textX + Math.min(w - textX - 4, l.length * size * 0.49))}" y1="${f1(cy + i * lineH)}" y2="${f1(cy + i * lineH)}" stroke-width="1.4" stroke-linecap="round"/>`)
        .join('')
    : ''
  const sheen =
    isNow && lines.length
      ? `<defs><clipPath id="slst">${lines.map((l, i) => `<text x="${textX}" y="${f1(cy + 4.5 + i * lineH)}" font-size="${size}" font-weight="${weight}">${esc(l)}</text>`).join('')}</clipPath></defs>` +
        `<g clip-path="url(#slst)"><g transform="skewX(-20)"><rect class="sheen sheenr" x="${textX}" y="0" width="70" height="${h}" opacity=".55" style="--sl-run:${f1(w + 120)}px"/></g></g>`
      : ''
  const body = `<g class="in" ${delay(Math.min(index, 8) * 0.04)}>${mark}${words}${strikes}${sheen}</g>`
  const state = isDone ? 'done' : isNow ? 'in progress' : 'to do'
  return { svg: doc(w, h, body), height: h, alt: `Step ${index + 1}, ${state}: ${text}` }
}

// ---------- skills ----------

/** One skill: a slash tile, its name, an "always loaded" chip and its use count. */
export function skillSvg(w: number, skill: LensSkill, index: number): Drawn {
  const h = 32
  const tile =
    gradient('slsk', '#8e6cf0', '#c4a8ff') +
    `<g class="pop" ${delay(Math.min(index, 8) * 0.04)}><rect x="2" y="5" width="22" height="22" rx="7" fill="url(#slsk)"/><text x="13" y="21" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">/</text></g>`
  const uses = skill.count ? pill(w - 2, 7, skill.count === 1 ? '1 use' : `${skill.count} uses`, 'pill', 'pillt', skill.count > 1) : { svg: '', width: 0 }
  const chipLabel = 'always loaded'
  const chipW = textWidth(chipLabel, 10.5) + 14
  const chipX = w - 2 - uses.width - (uses.width ? 6 : 0) - chipW
  const chip = skill.isAlways
    ? `<g class="fade"><rect class="chip chips" x="${f1(chipX)}" y="7" width="${f1(chipW)}" height="18" rx="9" stroke-width="1"/><text class="chipt" x="${f1(chipX + chipW / 2)}" y="19.5" font-size="10.5" font-weight="600" text-anchor="middle">${chipLabel}</text></g>`
    : ''
  const nameRoom = (skill.isAlways ? chipX : w - uses.width - 8) - 36
  const name = `<text class="ink" x="34" y="20.5" font-size="13" font-weight="550">${esc(fit(skill.name, nameRoom, 13))}</text>`
  const body = `<g class="in" ${delay(Math.min(index, 8) * 0.04)}>${tile}${name}${chip}${uses.svg}</g>`
  const parts = [skill.isAlways ? 'always loaded' : '', skill.count ? `${skill.count} use${skill.count === 1 ? '' : 's'}` : ''].filter(Boolean)
  return { svg: doc(w, h, body), height: h, alt: `/${skill.name}${parts.length ? `, ${parts.join(', ')}` : ''}` }
}

// ---------- tools ----------

/** A group's tile: its initials on its hue. */
export function groupTileSvg(group: string, label: string): Drawn {
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
    `<g class="pop"><rect x="1" y="1" width="24" height="24" rx="7" fill="url(#slgt)"/><text x="13" y="${initials.length > 1 ? 17 : 18}" font-size="${initials.length > 1 ? 10.5 : 12.5}" font-weight="700" fill="#fff" text-anchor="middle">${esc(initials)}</text></g>`
  return { svg: doc(26, 26, body), height: 26, alt: `${label} tools` }
}

/** A group's total, with a small stack of its tools' shares. */
export function groupTotalSvg(group: string, count: number, errors: number, tools: number): Drawn {
  const label = `${count}`
  const w = Math.max(60, textWidth(label, 11) + 50)
  const hue = hueOf(group)
  const dots = Array.from({ length: Math.min(tools, 4) }, (_, i) => `<circle cx="${8 + i * 7}" cy="13" r="3" fill="${hue}" opacity="${1 - i * 0.18}"/>`).join('')
  const err = errors ? `<circle class="err" cx="${8 + Math.min(tools, 4) * 7 + 2}" cy="13" r="3"/>` : ''
  const p = pill(w - 1, 4, label, 'pill', 'pillt', true)
  return { svg: doc(w, 26, `<g class="fade">${dots}${err}</g>${p.svg}`), height: 26, alt: `${count} calls${errors ? `, ${errors} failed` : ''}` }
}

/**
 * How full a tool's bar is: a log scale that fills at 50 calls. It depends on the tool's own count alone,
 * so a call to one tool redraws that row and no other.
 */
export const barShare = (count: number) => Math.min(1, Math.log2(1 + count) / Math.log2(51))

/** One tool: its name, the group it is in when the list is flat, a bar that grows in, and its count. */
export function toolSvg(w: number, row: ToolRow, index: number, showGroup: boolean): Drawn {
  const h = 36
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
    ? `<g class="fade"><circle class="err" cx="${f1(w - countW - errW + 5)}" cy="11" r="3.5"/><text class="err" x="${f1(w - countW - errW + 12)}" y="14.5" font-size="10.5" font-weight="600">${esc(errLabel)}</text></g>`
    : ''
  const grew = row.count > row.countBefore && row.countBefore > 0
  const body =
    `<g class="in" ${delay(Math.min(index, 10) * 0.035)}>` +
    gradient(`${id}g`, hue, lighter(hue)) +
    `<text class="ink" x="2" y="15" font-size="13" font-weight="550">${esc(fit(row.label, nameRoom, 13))}</text>` +
    tag +
    err +
    `<text class="ink ${grew ? 'pop' : ''}" x="${w - 2}" y="15" font-size="12.5" font-weight="700" text-anchor="end">${count}</text>` +
    bar(id, 2, 24, w - 4, 5, 0, barShare(row.count), `url(#${id}g)`, false, 0.1 + Math.min(index, 10) * 0.035) +
    `</g>`
  const alt = `${row.label}${showGroup ? ` (${row.groupLabel})` : ''}: ${row.count} call${row.count === 1 ? '' : 's'}${row.errors ? `, ${row.errors} failed` : ''}`
  return { svg: doc(w, h, body), height: h, alt }
}

/** A chevron that turns as its section opens or closes. */
export function chevronSvg(isOpen: boolean): Drawn {
  const from = isOpen ? -90 : 90
  const spin = `@keyframes slcv{from{transform:rotate(${from}deg)}to{transform:none}}.cv{transform-box:fill-box;transform-origin:center;animation:slcv .35s cubic-bezier(.3,1.3,.5,1) both}`
  const d = isOpen ? 'M5 8 l5 5 l5 -5' : 'M8 5 l5 5 l-5 5'
  return { svg: doc(20, 20, `<style>${spin}</style><path class="cv" d="${d}" fill="none" stroke="${ACCENT}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`), height: 20, alt: isOpen ? 'open' : 'closed' }
}
