// Integrity and drift checks on a prototype: the desk's own (wording, surfaces, chips), the project's own
// validator's report read line by line, the quote matching that keeps a finding to words that are there,
// and the fingerprints that tell a walk its sources changed. Nothing here writes.
import type { CheckFinding, Loaded, OsText } from '../types'
import { htmlToMd } from './prototype'

/** Settings the desk's own checks read. */
export type CheckOptions = {
  /** Wording that suggests something of value leaves the product; empty: not checked. */
  valueWords: string
  /** Figures that read as prices or payouts; empty: not checked. */
  figurePattern: string
}

const PRONOUN = /\b(he|she|his|her|hers|him|himself|herself)\b/i

/** A short, stable id for a finding: the same problem keeps its id from one run to the next. */
export function hashOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const findingId = (where: string, title: string) => `F-${hashOf(`${where}|${title}`).slice(0, 6)}`

function regex(src: string): RegExp | undefined {
  if (!src.trim()) return undefined
  try {
    return new RegExp(src, 'i')
  } catch {
    return undefined
  }
}

const both = (v: OsText | undefined): string[] => (v === undefined ? [] : typeof v === 'string' ? [v] : [v.ios ?? '', v.android ?? ''].filter(Boolean))
const plain = (t: string) => htmlToMd(t).replace(/[*_`]/g, '')

/** The desk's own checks: they need nothing but the files, and run whatever the project uses. */
export function deskChecks(l: Loaded, opts: CheckOptions): CheckFinding[] {
  const out: CheckFinding[] = []
  const add = (f: Omit<CheckFinding, 'id' | 'source'>) => out.push({ ...f, id: findingId(f.where, f.title), source: 'desk' })
  const r = l.register
  const items = new Set(r.items.map(i => i.id))
  const surfaces = new Map(r.surfaces.map(s => [s.key, s]))
  const valueOut = regex(opts.valueWords)
  const figure = regex(opts.figurePattern)

  for (const s of r.surfaces) {
    if (!s.owner) add({ severity: 'medium', where: `surface ${s.key}`, title: `Surface "${s.name}" does not say who draws it`, body: 'Every surface names its owner: ours, or the OS, store or ad network that draws it.' })
    else if (typeof s.module === 'object' && (!s.module.ios || !s.module.android))
      add({ severity: 'low', where: `surface ${s.key}`, title: `Surface "${s.name}" names its API on one phone only`, body: `Give both sides of \`module\` (\`none\` where a phone has no equivalent).` })
  }

  for (const e of r.journeys) {
    for (const k of e.surfaces) if (!surfaces.has(k)) add({ severity: 'high', where: e.code, title: `${e.code} uses surface "${k}", which is not in the surfaces table`, body: 'A journey may only show a surface the register lists, with who draws it.' })
    for (const id of e.questions) if (!items.has(id)) add({ severity: 'high', where: e.code, title: `${e.code} lists ${id}, which the register does not mirror`, body: 'Every chip a journey names is in the register’s questions.' })
    const j = l.journeys[e.code]
    if (!j) continue
    if (j.problem) {
      add({ severity: 'high', where: `${e.code} page`, title: `${e.code}’s page could not be read`, body: `${e.file}: ${j.problem}` })
      continue
    }
    let hasPlaceholder = false
    const figures: string[] = []
    const texts: { where: string; label: string; text: string }[] = []
    for (const p of j.preconditions) texts.push(...both(p).map(text => ({ where: `${e.code} preconditions`, label: 'a precondition', text })))
    for (const st of j.steps) {
      const where = `${e.code} step ${st.index + 1}`
      for (const id of st.chips) if (!e.questions.includes(id)) add({ severity: 'medium', where, title: `${where} shows ${id}, which ${e.code}’s register entry does not list`, body: 'Chips live in the journey’s register entry; add it there, or take it off the step.' })
      texts.push(...both(st.title).map(text => ({ where, label: 'the title', text })))
      texts.push(...both(st.caption).map(text => ({ where, label: 'the caption', text })))
      for (const c of st.callouts) texts.push(...both(c.text).map(text => ({ where, label: 'a callout', text })))
    }
    for (const t of texts) {
      const p = plain(t.text)
      if (/placeholder/i.test(p)) hasPlaceholder = true
      if (PRONOUN.test(p)) add({ severity: 'low', where: t.where, title: `Gendered pronoun in ${t.label} of ${t.where}`, quote: p.match(PRONOUN)?.[0], body: 'Captions name people, or say “they”.' })
      const hit = valueOut ? p.match(valueOut) : null
      if (hit) add({ severity: 'medium', where: t.where, title: `“${hit[0]}” in ${t.label} of ${t.where}`, quote: hit[0], body: 'The wording suggests something of value leaves the product. Read it against the house rule; a hit is a prompt to read, not proof.' })
      const fig = figure ? p.match(figure) : null
      if (fig && figures.length < 4 && !figures.includes(fig[0])) figures.push(fig[0])
    }
    if (figures.length && !hasPlaceholder)
      add({ severity: 'low', where: e.code, title: `${e.code} shows figures without calling them placeholders`, quote: figures[0], body: `Figures such as ${figures.map(f => `“${f}”`).join(', ')} read as decided. Label them as placeholders in a note or the preconditions until they are decided.` })
  }
  return out
}

/** The findings in a validator's report: lines that start `ERROR` or `warn`, each `<where>: <message>`. */
export function readReport(stdout: string): CheckFinding[] {
  const out: CheckFinding[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const m = /^\s*(ERROR|WARN(?:ING)?)\s+(.*)$/i.exec(raw)
    if (!m) continue
    const isError = m[1]!.toUpperCase() === 'ERROR'
    const text = m[2]!.trim()
    const cut = text.indexOf(': ')
    const where = cut > 0 && cut < 60 ? text.slice(0, cut) : 'prototype'
    const message = cut > 0 && cut < 60 ? text.slice(cut + 2) : text
    // Drift names the record: the vault, the catalogue, a note's frontmatter. A page's own "note" callouts do not.
    const isDrift = /\b(vault|catalogue|record|frontmatter|story map|(ADR|persona) note)\b/i.test(message)
    out.push({
      id: findingId(where, message),
      source: 'validator',
      severity: isError ? 'high' : 'low',
      where,
      title: message.length > 110 ? `${message.slice(0, 107)}…` : message,
      body: isDrift ? `${message}\n\nThe record is canonical: this is the prototype differing from it, so fix the prototype toward the record, unless the record is wrong.` : message,
      isDrift,
    })
  }
  return out
}

/** The text a quote is matched in: tags, entities and Markdown marks gone; quotes, dashes and spaces made plain. */
export function forMatching(text: string): string {
  return plain(text)
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether a quote is in a text, forgiving markup, typographic quotes, dashes and whitespace, nothing else. */
export const isQuoted = (quote: string, text: string) => forMatching(text).includes(forMatching(quote))

/** A file's text for the journey or path a finding names, or every file when it names none. */
export function filesFor(where: string | undefined, l: Loaded, files: Record<string, string>): string[] {
  if (!where) return Object.values(files)
  const code = /\b(J\d+)\b/.exec(where)?.[1]
  const entry = code ? l.register.journeys.find(j => j.code === code) : undefined
  if (entry && files[entry.file] !== undefined) return [files[entry.file]!]
  const path = where.replace(/\\/g, '/').replace(/^\.?\//, '')
  if (files[path] !== undefined) return [files[path]!]
  if (/prototype\.js|register/i.test(where) && files['prototype.js'] !== undefined) return [files['prototype.js']!]
  return Object.values(files)
}

/** A vault note's path on disk for a reference: as given, or with `.md` added. */
export const notePaths = (ref: string) => {
  const r = ref.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\[\[|\]\]$/g, '')
  return r.toLowerCase().endsWith('.md') ? [r] : [`${r}.md`, r]
}
