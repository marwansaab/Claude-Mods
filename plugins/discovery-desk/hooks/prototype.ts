// Reading a UX prototype: the register (`prototype.js`) and its journey pages (`Kit.journey({...})`),
// as data and never run. The vault (or whatever the project keeps as its record) is canonical; these
// files mirror it, and this mod only reads them.
import type { Appears, Callout, Journey, JourneyEntry, Os, OsText, Raised, Register, RegisterItem, Step } from '../types'
import { LiteralError, parseLiteral } from './literal'
import type { Literal } from './literal'

/** The ids and status words a project uses: prefixes, then statuses with the undecided one first, the decided one second. */
export type Vocab = { q: string; d: string; adr: string; qStatuses: string[]; dStatuses: string[]; adrStatuses: string[] }

export const DEFAULT_VOCAB: Vocab = {
  q: 'Q-',
  d: 'D-',
  adr: 'ADR-',
  qStatuses: ['open', 'decided', 'deferred', 'withdrawn'],
  dStatuses: ['proposed', 'decided', 'rejected'],
  adrStatuses: ['proposed', 'decided'],
}

type Obj = { [key: string]: Literal }
const isObj = (v: Literal): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const s = (v: Literal): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const list = (v: Literal): Literal[] => (Array.isArray(v) ? v : [])
const strings = (v: Literal): string[] => list(v).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
/** A string, or `{ ios, android }` where both are strings or absent. */
const osText = (v: Literal): OsText | undefined => {
  if (typeof v === 'string') return v
  if (isObj(v) && ('ios' in v || 'android' in v)) return { ios: s(v.ios), android: s(v.android) }
  return undefined
}

export function kindOf(id: string, vocab: Vocab): RegisterItem['kind'] {
  if (id.startsWith(vocab.adr)) return 'adr'
  if (id.startsWith(vocab.q)) return 'question'
  if (id.startsWith(vocab.d)) return 'decision'
  return 'other'
}

const statusesOf = (kind: RegisterItem['kind'], vocab: Vocab) =>
  kind === 'question' ? vocab.qStatuses : kind === 'decision' ? vocab.dStatuses : kind === 'adr' ? vocab.adrStatuses : []

/** The text after `marker` and an `=` or `(`: where the literal starts. */
function literalAfter(text: string, marker: RegExp, name: string): Literal {
  const m = marker.exec(text)
  if (!m) throw new LiteralError(`no ${name} found`)
  return parseLiteral(text, m.index + m[0].length).value
}

/** Reads `window.PROTOTYPE = {...}`. Throws, saying why, when the file is not a plain literal. */
export function readRegister(text: string, vocab: Vocab = DEFAULT_VOCAB): Register {
  const raw = literalAfter(text, /PROTOTYPE\s*=\s*/, 'PROTOTYPE = {…}')
  if (!isObj(raw)) throw new LiteralError('PROTOTYPE is not an object')
  const ini = isObj(raw.initiative) ? raw.initiative : {}
  const personas = isObj(raw.personas) ? raw.personas : {}
  const surfaces = isObj(raw.surfaces) ? raw.surfaces : {}
  const questions = isObj(raw.questions) ? raw.questions : {}
  return {
    initiative: {
      id: s(ini.id) ?? '',
      name: s(ini.name) ?? s(ini.id) ?? 'Untitled initiative',
      vault: s(ini.vault),
      overview: s(ini.overview),
      catalogue: s(ini.catalogue),
      storyMap: s(ini.storyMap),
      features: s(ini.features),
    },
    personas: Object.entries(personas)
      .filter(([, p]) => isObj(p))
      .map(([id, p]) => {
        const o = p as Obj
        return { id, name: s(o.name), initials: s(o.initials), role: s(o.role), team: s(o.team), archetype: s(o.archetype), status: s(o.status), summary: s(o.summary) }
      }),
    surfaces: Object.entries(surfaces)
      .filter(([, x]) => isObj(x))
      .map(([key, x]) => {
        const o = x as Obj
        return { key, name: s(o.name) ?? key, owner: s(o.owner), module: osText(o.module), where: s(o.where) }
      }),
    journeys: list(raw.journeys)
      .filter(isObj)
      .map(o => ({
        code: s(o.code) ?? '',
        title: s(o.title) ?? s(o.code) ?? '',
        file: s(o.file) ?? '',
        persona: s(o.persona),
        status: s(o.status),
        summary: s(o.summary),
        surfaces: strings(o.surfaces),
        questions: strings(o.questions),
      }))
      .filter(j => j.code),
    items: Object.entries(questions)
      .filter(([, q]) => isObj(q))
      .map(([id, q]) => {
        const o = q as Obj
        return { id, kind: kindOf(id, vocab), status: s(o.status) ?? '', title: s(o.title) ?? id, detail: s(o.detail) }
      }),
  }
}

/** The label of each screen in the page's stage: its first `data-module` (ours) or `data-host` (someone else's). */
export function screenLabels(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /<section\b[^>]*\bid="([^"]+)"[^>]*>/g
  const sections = [...html.matchAll(re)]
  sections.forEach((m, n) => {
    const tag = m[0]
    if (!/class="[^"]*\bscreen\b/.test(tag)) return
    const body = html.slice(m.index! + tag.length, sections[n + 1]?.index ?? html.length)
    const label = /data-(?:module|host)="([^"]+)"/.exec(body)?.[1]
    if (label) out[m[1]!] = decode(label)
  })
  return out
}

/** Reads a journey page's `Kit.journey({...})`; a page that cannot be read comes back with its problem. */
export function readJourney(html: string, entry: JourneyEntry): Journey {
  const empty: Journey = { code: entry.code, title: entry.title, file: entry.file, preconditions: [], storyMap: [], alsoInvolved: [], steps: [] }
  let raw: Literal
  try {
    raw = literalAfter(html, /Kit\.journey\(\s*/, 'Kit.journey({…})')
  } catch (err) {
    return { ...empty, problem: err instanceof Error ? err.message : String(err) }
  }
  if (!isObj(raw)) return { ...empty, problem: 'Kit.journey is not given an object' }
  const labels = screenLabels(html)
  // Before any step names one, the stage shows its first screen.
  let screen: string | undefined = /<section\b[^>]*\bclass="[^"]*\bscreen\b[^"]*"[^>]*\bid="([^"]+)"/.exec(html)?.[1]
  const steps: Step[] = list(raw.steps)
    .filter(isObj)
    .map((o, index) => {
      const actions = list(o.actions).filter(Array.isArray) as Literal[][]
      screen = s(o.screen) ?? screen
      for (const a of actions) if (a[0] === 'screen' && s(a[1])) screen = s(a[1])
      const callouts: Callout[] = actions
        .filter(a => a[0] === 'note' && osText(a[2]))
        .map(a => ({ text: osText(a[2])!, tone: s(a[4]) }))
      const os = o.os === 'ios' || o.os === 'android' ? (o.os as Os) : undefined
      return {
        index,
        title: osText(o.title) ?? `Step ${index + 1}`,
        caption: osText(o.caption) ?? '',
        actor: s(o.actor),
        os,
        screen,
        screenLabel: screen ? labels[screen] : undefined,
        chips: strings(o.questions),
        callouts,
      }
    })
  const notes = isObj(raw.osNotes) ? raw.osNotes : {}
  return {
    code: s(raw.code) ?? entry.code,
    title: s(raw.title) ?? entry.title,
    file: entry.file,
    useCase: osText(raw.useCase),
    trigger: osText(raw.trigger),
    preconditions: list(raw.preconditions).map(osText).filter((x): x is OsText => x !== undefined),
    outcome: osText(raw.outcome),
    osNotes: { ios: s(notes.ios), android: s(notes.android) },
    storyMap: strings(raw.storyMap),
    alsoInvolved: strings(raw.alsoInvolved),
    steps,
    problem: steps.length ? undefined : 'the journey has no steps',
  }
}

// ---------- text ----------

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', times: '×', middot: '·', rarr: '→', larr: '←', bull: '•', minus: '−',
}

export const decode = (t: string) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : all
    }
    return ENTITIES[code.toLowerCase()] ?? all
  })

/** A caption's HTML as Markdown: bold, italic, code and line breaks kept; every other tag dropped. */
export function htmlToMd(html: string): string {
  const md = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t: string) => (t.trim() ? `**${t.trim()}**` : t))
    .replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t: string) => (t.trim() ? `_${t.trim()}_` : t))
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, t: string) => `\`${t}\``)
    .replace(/<[^>]+>/g, '')
  return decode(md)
    .split('\n')
    .map(l => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim()
}

/** The text for a phone: its own side, else the other side. */
export function pick(v: OsText | undefined, os: Os): string {
  if (v === undefined) return ''
  if (typeof v === 'string') return v
  return v[os] ?? v[os === 'ios' ? 'android' : 'ios'] ?? ''
}

export const OS_LABEL: Record<Os, string> = { ios: 'iOS', android: 'Android' }

// ---------- steps and chips ----------

/** The steps that play on a phone, in order. */
export const stepsOn = (j: Journey, os: Os) => j.steps.filter(st => !st.os || st.os === os)

/** The step to show on `os` for a wanted step index: that one, or the nearest that plays there. */
export function nearestStep(j: Journey, os: Os, index: number): Step | undefined {
  const on = stepsOn(j, os)
  return on.find(st => st.index === index) ?? on.reduce<Step | undefined>((best, st) => (!best || Math.abs(st.index - index) < Math.abs(best.index - index) ? st : best), undefined)
}

/** How a chip is coloured: an open question purple, a proposal blue, a decision green, the rest grey. */
export type Tone = 'q' | 'd' | 'ok' | 'off' | 'none'

export function toneOf(item: RegisterItem | undefined, vocab: Vocab): Tone {
  if (!item) return 'none'
  const statuses = statusesOf(item.kind, vocab)
  if (item.status === statuses[1]) return 'ok'
  if (item.status === statuses[0]) return item.kind === 'question' ? 'q' : 'd'
  return 'off'
}

/** Whether a chip still waits for the owner: an open question or a proposal. */
export const isUndecided = (item: RegisterItem | undefined, vocab: Vocab) => {
  const t = toneOf(item, vocab)
  return t === 'q' || t === 'd'
}

export function counts(register: Register, vocab: Vocab): { open: number; proposed: number; decided: number } {
  let open = 0
  let proposed = 0
  let decided = 0
  for (const it of register.items) {
    const t = toneOf(it, vocab)
    if (t === 'q') open++
    else if (t === 'd') proposed++
    else if (t === 'ok') decided++
  }
  return { open, proposed, decided }
}

/** Every step, in every journey, that carries a chip. */
export function appearsAt(journeys: Journey[], id: string): Appears[] {
  return journeys.flatMap(j => j.steps.filter(st => st.chips.includes(id)).map(st => ({ journey: j.code, step: st.index, os: st.os })))
}

/**
 * The next free question number: after the highest in the register and every one already raised,
 * never reusing one. The record may hold a higher one still; Claude checks there before recording it.
 */
export function nextQuestionId(register: Register, raised: Raised[], vocab: Vocab): string {
  const prefix = vocab.q
  const ids = [...register.items.map(i => i.id), ...raised.map(r => r.id)].filter(id => id.startsWith(prefix))
  let max = 0
  let width = 2
  for (const id of ids) {
    const m = /^(\d+)$/.exec(id.slice(prefix.length))
    if (!m) continue
    max = Math.max(max, Number(m[1]))
    width = Math.max(width, m[1]!.length)
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`
}
