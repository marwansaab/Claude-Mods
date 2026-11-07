// What the kit's hub page shows, read for the desk: the core loop drawn in `index.html`, the story the
// initiative README tells, the placeholders the journeys name, and per-journey progress. Nothing here writes.
import type { Journey, Loaded, Loop, OsText } from '../types'
import { decode, htmlToMd, isUndecided, toneOf } from './prototype'
import type { Vocab } from './prototype'

const text = (html: string) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/**
 * The hub's core loop: `.life` rows of `.st` states joined by arrows. A plain `.st` is the main path,
 * `.st.end` where it loops, `.st.side` a state beside it, `.st.flag` a warning. Absent when the hub draws none.
 */
export function readLoop(html: string): Loop | undefined {
  if (!/class="life\b/.test(html)) return undefined
  const loop: Loop = { main: [], side: [], flags: [] }
  for (const m of html.matchAll(/<span class="st(?:\s+([\w\s-]*))?"[^>]*>([\s\S]*?)<\/span>/g)) {
    const kinds = (m[1] ?? '').split(/\s+/)
    const label = text(m[2] ?? '')
    if (!label) continue
    if (kinds.includes('flag')) loop.flags.push(label.replace(/^⚑\s*/, ''))
    else if (kinds.includes('side')) loop.side.push(label)
    else if (kinds.includes('end')) loop.end = label
    else loop.main.push(label)
  }
  const before = html.slice(0, html.search(/class="life\b/))
  const heads = [...before.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)]
  const title = heads.at(-1)?.[1]
  if (title) loop.title = text(title)
  const note = /<p class="life-note"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1]
  if (note) loop.note = text(note)
  return loop.main.length || loop.side.length ? loop : undefined
}

/** The README section that tells the story: the first `##` heading with story, cast or world in it. */
export function readStory(md: string): { title: string; body: string } | undefined {
  const lines = md.split(/\r?\n/)
  const at = lines.findIndex(l => /^##\s+.*\b(story|cast|world)\b/i.test(l))
  if (at < 0) return undefined
  const end = lines.findIndex((l, i) => i > at && /^##?\s/.test(l))
  const body = lines.slice(at + 1, end < 0 ? undefined : end).join('\n').trim()
  return body ? { title: lines[at]!.replace(/^##\s+/, '').trim(), body } : undefined
}

const each = (v: OsText | undefined): string[] => (v === undefined ? [] : typeof v === 'string' ? [v] : [v.ios ?? '', v.android ?? ''].filter(Boolean))

/** Every sentence across the journeys that calls something a placeholder, once each. */
export function placeholders(l: Loaded, max = 12): { journey: string; text: string }[] {
  const seen = new Set<string>()
  const out: { journey: string; text: string }[] = []
  for (const e of l.register.journeys) {
    const j = l.journeys[e.code]
    if (!j) continue
    const texts = [...j.preconditions.flatMap(each), ...j.steps.flatMap(st => st.callouts.flatMap(c => each(c.text)))]
    for (const t of texts) {
      for (const s of htmlToMd(t).replace(/\*\*/g, '').split(/(?<=[.;])\s+/)) {
        if (!/placeholder/i.test(s)) continue
        const key = s.toLowerCase().replace(/\W+/g, ' ').trim()
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ journey: e.code, text: s.trim() })
        if (out.length >= max) return out
      }
    }
  }
  return out
}

/** Where each surface shows: the journeys whose register entry lists it. */
export function surfaceUse(l: Loaded): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const e of l.register.journeys) for (const k of e.surfaces) (out[k] ??= []).push(e.code)
  return out
}

/** A journey's chips: how many the record has decided, and how many still wait. */
export function progressOf(l: Loaded, code: string, vocab: Vocab): { decided: number; waiting: number } {
  const entry = l.register.journeys.find(j => j.code === code)
  const j: Journey | undefined = l.journeys[code]
  const ids = [...new Set([...(entry?.questions ?? []), ...(j?.steps.flatMap(st => st.chips) ?? [])])]
  let decided = 0
  let waiting = 0
  for (const id of ids) {
    const item = l.register.items.find(i => i.id === id)
    if (isUndecided(item, vocab)) waiting++
    else if (toneOf(item, vocab) === 'ok') decided++
  }
  return { decided, waiting }
}
