import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register as RegisterHooks, Timer } from 'claude-code'

import type { Ask, CheckFinding, CheckRun, DeskView, Draft, InitiativeSummary, Journey, Loaded, Notes, OpenWalk, Os, Raised, Response, SourceMark, Walk, WalkStatus, WalkSummary } from '../types'
import { deskChecks, hashOf, notePaths, readReport } from './checks'
import { FILES, README, isWindowsPath, join, moveArgv, notesName, relTo, submittedAtOf } from './disk'
import { DEFAULT_VOCAB, counts, nearestStep, nextQuestionId, readJourney, readRegister, stepsOn } from './prototype'
import type { Vocab } from './prototype'
import {
  ANSWER_DESCRIPTION,
  ANSWER_SCHEMA,
  PUBLISH_DESCRIPTION,
  PUBLISH_SCHEMA,
  cleanWalk,
  emptyNotes,
  handOffPrompt,
  journeySetPrompt,
  outcomeJson,
  outcomeMarkdown,
  phonePrompt,
  polishPrompt,
  raisedPrompt,
  readNotesPrompt,
  readDraft,
  readNotes,
  readWalk,
  scaffoldPrompt,
  summaryOf,
} from './walk'
import { homeView, initiativeView, journeyView, newView, walkView } from './view'
import { readLoop, readStory } from './hub'
import type { Actions } from './view'

const PANE = 'discovery-desk'
const PANE_TITLE = 'Discovery desk'
const TOOL = 'mcp__discovery-desk__publish_walk'
const LIST_TOOL = 'mcp__discovery-desk__list_walks'
const ANSWER_TOOL = 'mcp__discovery-desk__answer_question'
const PLAY_MS = 4500

const START_VIEW: DeskView = {
  screen: 'home',
  tab: 'pending',
  step: {},
  os: 'ios',
  stepView: 'all',
  isContextOpen: false,
  isPlaying: false,
  hubTab: 'journeys',
  questionFilter: 'undecided',
  isMapOpen: false,
  card: 0,
  part: {},
  isSummaryOpen: false,
  isConfirming: false,
  showAllAsks: false,
}

const initiatives = atom({ plugin: 'discovery-desk', key: 'initiatives' } as const, [] as InitiativeSummary[])
const walks = atom({ plugin: 'discovery-desk', key: 'walks' } as const, [] as WalkSummary[])
const view = atom({ plugin: 'discovery-desk', key: 'view' } as const, START_VIEW)
const loaded = atom({ plugin: 'discovery-desk', key: 'loaded' } as const, null as Loaded | null)
const notesAtom = atom({ plugin: 'discovery-desk', key: 'notes' } as const, null as Notes | null)
const open = atom({ plugin: 'discovery-desk', key: 'open' } as const, null as OpenWalk | null)
const typing = atom({ plugin: 'discovery-desk', key: 'typing' } as const, {} as Record<string, string>)
const rootRef = atom({ plugin: 'discovery-desk', key: 'root' } as const, '')
const checksAtom = atom({ plugin: 'discovery-desk', key: 'checks' } as const, {} as Record<string, CheckRun>)
const dirty = atom({ plugin: 'discovery-desk', key: 'dirty' } as const, [] as string[])
const recordWritten = atom({ plugin: 'discovery-desk', key: 'recordWritten' } as const, false)

/** The obsidian-cli-mcp tools that write a note; a project with another record names its own in vaultWriteTools. */
const VAULT_WRITES = 'obsidian.*__(write_note|append_note|prepend|patch_heading|patch_block|set_property|find_and_replace|create_base|move|rename|delete)$'
const VALUE_WORDS = String.raw`\b(cash[ -]?out|redeem(ed|able)?|withdraw(al)?s? (your )?(chips|coins|winnings|balance)|win real|real[- ]money (prize|reward|payout)s?|gift ?cards?|sweepstakes?|convert (your )?(chips|coins))\b`
const FIGURES = String.raw`[$£€]\s?\d|\b\d+\s?(coins?|chips?|gems?|credits?)\b`
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/** A field's address less its redraw counter (`ask:Q-1#2` is the question field of card Q-1). */
const fieldKey = (key: string) => key.replace(/#\d+$/, '')

/** The view as stored, with any field an older version did not keep filled in. */
function viewOf(v: Partial<DeskView> | undefined): DeskView {
  return { ...START_VIEW, os: cfg.defaultOs, ...v, step: v?.step ?? {}, part: v?.part ?? {}, planView: v?.planView ?? {} }
}

/** The person's settings: set by `register` on every load. */
const cfg = {
  folder: 'Discovery',
  prototypeRoot: '',
  vault: '',
  defaultOs: 'ios' as Os,
  autoOpen: true,
  handOff: true,
  selectableText: true,
  vocab: DEFAULT_VOCAB as Vocab,
  validator: '',
  validatorOffline: '--no-vault',
  vaultRoot: '',
  autoValidate: true,
  guardMode: 'warn' as 'off' | 'warn' | 'block',
  vaultWriteTools: new RegExp(VAULT_WRITES, 'i'),
  valueWords: VALUE_WORDS,
  figurePattern: FIGURES,
  scaffold: '',
}

/** The play timer: a module variable, so a reload stops playback (the view is reset to match on load). */
let playTimer: Timer | undefined

/** The desk observes and stores; nothing it does may fail a tool call, a command or a turn. */
async function safely<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch {
    return undefined
  }
}

async function nowIso($: EngineInterface): Promise<string> {
  return new Date(await $.clock.now()).toISOString()
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

async function dirsOf($: EngineInterface, path: string): Promise<string[]> {
  try {
    if (!(await $.fs.exists(path))) return []
    return (await $.fs.list(path)).filter(e => e.kind === 'dir' && !e.name.startsWith('.')).map(e => e.name)
  } catch {
    return []
  }
}

// ---------- the prototypes ----------

const isAbsolute = (p: string) => /^([A-Za-z]:[\\/]|[\\/])/.test(p)

/** Every folder that holds a register: the prototype root itself, or a folder under it, or their `UX Prototype`. */
async function scanInitiatives($: EngineInterface): Promise<InitiativeSummary[]> {
  const project = await $.session.root()
  const base = cfg.prototypeRoot ? (isAbsolute(cfg.prototypeRoot) ? cfg.prototypeRoot : join(project, cfg.prototypeRoot)) : project
  const skip = new Set([cfg.folder.toLowerCase(), 'node_modules'])
  const candidates = [base, ...(await dirsOf($, base)).filter(d => !skip.has(d.toLowerCase())).map(d => join(base, d))]
  const out: InitiativeSummary[] = []
  for (const dir of candidates) {
    for (const folder of [join(dir, 'UX Prototype'), dir]) {
      const text = await readText($, join(folder, 'prototype.js'))
      if (text === undefined) continue
      const rel = relTo(project, folder)
      try {
        const r = readRegister(text, cfg.vocab)
        out.push({ id: r.initiative.id, name: r.initiative.name, folder, rel, journeys: r.journeys.length, ...counts(r, cfg.vocab) })
      } catch (err) {
        out.push({ id: '', name: rel, folder, rel, journeys: 0, open: 0, proposed: 0, decided: 0, problem: `prototype.js could not be read: ${err instanceof Error ? err.message : String(err)}` })
      }
      break
    }
  }
  return out.sort((a, b) => (a.id || a.name).localeCompare(b.id || b.name, undefined, { numeric: true }))
}

/** One initiative, read whole: its register and every journey page. */
async function readInitiative($: EngineInterface, folder: string): Promise<Loaded | undefined> {
  const text = await readText($, join(folder, 'prototype.js'))
  if (text === undefined) return undefined
  let register
  try {
    register = readRegister(text, cfg.vocab)
  } catch {
    return undefined
  }
  if (cfg.vault) register = { ...register, initiative: { ...register.initiative, vault: cfg.vault } }
  const journeys: Record<string, Journey> = {}
  for (const e of register.journeys) {
    const html = e.file ? await readText($, join(folder, ...e.file.split('/'))) : undefined
    journeys[e.code] = html === undefined ? { code: e.code, title: e.title, file: e.file, preconditions: [], storyMap: [], alsoInvolved: [], steps: [], problem: 'the page could not be read' } : readJourney(html, e)
  }
  const hub = await readText($, join(folder, 'index.html'))
  // The README sits beside the UX Prototype folder, or in the prototype folder itself.
  const parent = /[\\/]UX Prototype$/i.test(folder) ? folder.replace(/[\\/]UX Prototype$/i, '') : folder
  const readme = (await readText($, join(parent, 'README.md'))) ?? (await readText($, join(folder, 'README.md')))
  return { folder, rel: relTo(await $.session.root(), folder), register, journeys, loop: hub ? readLoop(hub) : undefined, story: readme ? readStory(readme) : undefined }
}

/** The initiative a walk names: by register id, or by its folder name. */
async function findInitiative($: EngineInterface, name: string): Promise<InitiativeSummary | undefined> {
  const list = await read($, initiatives)
  const wanted = name.trim().toLowerCase()
  const match = (l: InitiativeSummary[]) =>
    l.find(i => i.id.toLowerCase() === wanted) ?? l.find(i => i.rel.toLowerCase() === wanted || i.rel.toLowerCase().split('/').includes(wanted))
  return match(list) ?? match(await scanInitiatives($))
}

/** The text of the files a prototype is made of, by their path in its folder. */
async function prototypeFiles($: EngineInterface, l: Loaded): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const path of ['prototype.js', ...l.register.journeys.map(j => j.file).filter(Boolean)]) {
    const text = await readText($, join(l.folder, ...path.split('/')))
    if (text !== undefined) out[path] = text
  }
  return out
}

/** A record note's text from the vault on disk (read only), or null when it is not there. */
async function recordNote($: EngineInterface, ref: string): Promise<string | null> {
  if (!cfg.vaultRoot) return null
  for (const path of notePaths(ref)) {
    const text = await readText($, join(cfg.vaultRoot, ...path.split('/')))
    if (text !== undefined) return text
  }
  return null
}

/** Fingerprints of what a walk is built from: the register, its journeys' pages and the catalogue note. */
async function sourcesFor($: EngineInterface, l: Loaded, journeys: string[]): Promise<SourceMark[]> {
  const marks: SourceMark[] = []
  const add = (path: string, label: string, text: string | undefined | null) => text != null && marks.push({ path, label, hash: hashOf(text) })
  const register = join(l.folder, 'prototype.js')
  add(register, 'prototype.js', await readText($, register))
  for (const e of l.register.journeys.filter(j => !journeys.length || journeys.includes(j.code))) {
    const path = join(l.folder, ...e.file.split('/'))
    add(path, `the ${e.code} page`, await readText($, path))
  }
  const catalogue = l.register.initiative.catalogue
  if (cfg.vaultRoot && catalogue) {
    for (const rel of notePaths(catalogue)) {
      const path = join(cfg.vaultRoot, ...rel.split('/'))
      const text = await readText($, path)
      if (text !== undefined) {
        add(path, 'the catalogue', text)
        break
      }
    }
  }
  return marks
}

/** The sources that changed (or went) since a walk was published. */
async function staleOf($: EngineInterface, walk: Walk): Promise<string[]> {
  const out: string[] = []
  for (const s of walk.sources ?? []) {
    const text = await readText($, s.path)
    if (text === undefined || hashOf(text) !== s.hash) out.push(s.label)
  }
  return out
}

/** A command line split into words, double quotes keeping spaces. */
const argvOf = (line: string) => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2] ?? '').filter(Boolean)

// ---------- the desk folder ----------

async function rootOf($: EngineInterface): Promise<string> {
  const known = await read($, rootRef)
  if (known) return known
  const root = join(await $.session.root(), cfg.folder)
  await update($, rootRef, () => root)
  return root
}

const notesPath = (root: string, id: string) => join(root, 'notes', notesName(id))

async function readNotesFor($: EngineInterface, id: string): Promise<Notes> {
  return readNotes(await readText($, notesPath(await rootOf($), id)))
}

async function listWalks($: EngineInterface, root: string): Promise<WalkSummary[]> {
  const out: WalkSummary[] = []
  for (const status of ['pending', 'reviewed'] as WalkStatus[]) {
    for (const name of await dirsOf($, join(root, status))) {
      const dir = join(root, status, name)
      const text = await readText($, join(dir, FILES.walk))
      if (text === undefined) continue
      const walk = readWalk(text)
      if (!walk) {
        out.push({ id: name, title: `${name} (walk.json does not parse)`, initiative: '', journeys: [], status, createdAt: '', cards: 0, answered: 0, isBroken: true })
        continue
      }
      const draft = readDraft(await readText($, join(dir, FILES.draft)))
      const submittedAt = submittedAtOf(await readText($, join(dir, FILES.outcomeJson)))
      // A pending folder left behind by a submit whose move failed: its copy is in reviewed/.
      if (status === 'pending' && submittedAt && submittedAt >= walk.createdAt) continue
      out.push({ ...summaryOf(walk, draft, status, cfg.vocab, submittedAt), id: name })
    }
  }
  const at = (w: WalkSummary) => w.submittedAt ?? w.createdAt
  return out.sort((a, b) => (a.status === b.status ? at(b).localeCompare(at(a)) : a.status === 'pending' ? -1 : 1))
}

async function loadWalk($: EngineInterface, root: string, status: WalkStatus, id: string): Promise<OpenWalk | undefined> {
  const dir = join(root, status, id)
  const text = await readText($, join(dir, FILES.walk))
  const walk = text === undefined ? undefined : readWalk(text)
  if (!walk) return undefined
  const draft = readDraft(await readText($, join(dir, FILES.draft)))
  const submittedAt = submittedAtOf(await readText($, join(dir, FILES.outcomeJson)))
  return { walk, draft, status, submittedAt }
}

async function refresh($: EngineInterface): Promise<void> {
  const root = await rootOf($)
  const found = await scanInitiatives($)
  const list = await listWalks($, root)
  await update($, initiatives, () => found)
  await update($, walks, () => list)
  const waiting = list.filter(w => w.status === 'pending').length
  const current = (await read($, loaded))?.folder
  const focus = found.find(i => i.folder === current) ?? (found.length === 1 ? found[0] : undefined)
  const run = focus ? (await read($, checksAtom))[focus.folder] : undefined
  const checked = !run ? '' : run.problem ? ' · checks could not run' : run.errors ? ` · ✗ ${run.errors} error${run.errors === 1 ? '' : 's'}` : run.warnings ? ` · checks ⚠ ${run.warnings}` : ' · checks ✓'
  const parts = [waiting ? `${waiting} walk${waiting === 1 ? '' : 's'} waiting` : '', focus && !focus.problem ? `${focus.id || focus.name}: ${focus.open} open · ${focus.proposed} proposed${checked}` : '']
  const text = parts.filter(Boolean).join(' · ')
  $.ui.status(text ? `${text} · /discovery` : undefined)
}

// ---------- the open initiative and its notes ----------

async function openInitiative($: EngineInterface, folder: string, screen: DeskView['screen'] = 'initiative'): Promise<void> {
  const got = await readInitiative($, folder)
  await update($, loaded, () => got ?? null)
  await update($, notesAtom, () => null)
  if (got) {
    const notes = await readNotesFor($, got.register.initiative.id || got.rel)
    await update($, notesAtom, () => notes)
  }
  stopPlay()
  await update($, view, x => ({ ...viewOf(x), screen, initiative: folder, isPlaying: false }))
  await safely(() => refresh($))
}

async function changeNotes($: EngineInterface, fn: (n: Notes) => Notes): Promise<void> {
  const l = await read($, loaded)
  if (!l) return
  const at = await nowIso($)
  const next = { ...fn((await read($, notesAtom)) ?? emptyNotes()), updatedAt: at }
  await update($, notesAtom, () => next)
  await safely(async () => {
    const root = await rootOf($)
    const readme = join(root, 'README.md')
    if (!(await $.fs.exists(readme))) await $.fs.write(readme, README)
    await $.fs.write(notesPath(root, l.register.initiative.id || l.rel), JSON.stringify(next, null, 2))
  })
}

function stopPlay(): void {
  playTimer?.cancel()
  playTimer = undefined
}

async function setStep($: EngineInterface, index: number, keepPlaying = false): Promise<void> {
  if (!keepPlaying) stopPlay()
  await update($, view, x => {
    const v = viewOf(x)
    return v.journey ? { ...v, step: { ...v.step, [v.journey]: Math.max(0, index) }, isPlaying: keepPlaying && v.isPlaying } : v
  })
}

/** One tick of Play: the next step on the phone shown, stopping at the last. */
async function advance($: EngineInterface): Promise<void> {
  const v = viewOf(await read($, view))
  const l = await read($, loaded)
  const j = l && v.journey ? l.journeys[v.journey] : undefined
  if (!v.isPlaying || v.screen !== 'journey' || !j) return stopPlay()
  const on = stepsOn(j, v.os)
  const st = nearestStep(j, v.os, v.step[j.code] ?? 0)
  const next = st ? on[on.indexOf(st) + 1] : undefined
  if (!next) {
    stopPlay()
    await update($, view, x => ({ ...viewOf(x), isPlaying: false }))
    return
  }
  await setStep($, next.index, true)
}

async function play($: EngineInterface, isOn: boolean): Promise<void> {
  stopPlay()
  await update($, view, x => ({ ...viewOf(x), isPlaying: isOn }))
  if (isOn) playTimer = $.clock.every(PLAY_MS, () => void safely(() => advance($)))
}

async function raise($: EngineInterface, key: string, text: string): Promise<void> {
  const t = text.trim()
  const l = await read($, loaded)
  if (!t || !l) return
  const [code, idx] = key.split('/')
  const v = viewOf(await read($, view))
  const at = await nowIso($)
  await changeNotes($, n => {
    const q: Raised = { id: nextQuestionId(l.register, n.raised, cfg.vocab), text: t, journey: code ?? '', step: Number(idx) || 0, os: v.os, at }
    return { ...n, raised: [...n.raised, q] }
  })
  $.ui.toast('Question added: hand it to Claude from the initiative page, or with your next walk')
}

async function sendRaised($: EngineInterface): Promise<void> {
  const l = await read($, loaded)
  const n = await read($, notesAtom)
  const unsent = (n?.raised ?? []).filter(q => !q.sentAt)
  if (!l || !unsent.length) return
  const at = await nowIso($)
  await $.prompt.submit({ text: raisedPrompt(l, unsent, notesPath(await rootOf($), l.register.initiative.id || l.rel)) })
  await changeNotes($, x => ({ ...x, raised: x.raised.map(q => (q.sentAt ? q : { ...q, sentAt: at })) }))
  $.ui.toast('Questions handed to Claude')
}

// ---------- the open walk ----------

async function changeDraft($: EngineInterface, fn: (d: Draft) => Draft): Promise<void> {
  const at = await nowIso($)
  const current = await read($, open)
  if (!current || current.status !== 'pending') return
  const draft = { ...fn(current.draft), updatedAt: at }
  await update($, open, o => (o ? { ...o, draft } : o))
  const v = viewOf(await read($, view))
  if (!v.openId) return
  const root = await rootOf($)
  await safely(() => $.fs.write(join(root, 'pending', v.openId!, FILES.draft), JSON.stringify(draft, null, 2)))
  const answered = summaryOf(current.walk, draft, 'pending', cfg.vocab).answered
  await update($, walks, list => list.map(w => (w.status === 'pending' && w.id === v.openId ? { ...w, answered } : w)))
}

/** Writes what was typed without pressing Enter: walk answers into the draft, step notes into the notes. */
async function flushTyping($: EngineInterface): Promise<void> {
  const typed = await read($, typing)
  const keys = Object.keys(typed).filter(k => k.startsWith('t:') || k.startsWith('note:'))
  if (!keys.length) return
  await update($, typing, t => Object.fromEntries(Object.entries(t).filter(([k]) => !keys.includes(k))))
  const texts = keys.filter(k => k.startsWith('t:'))
  if (texts.length)
    await changeDraft($, d => {
      const responses = { ...d.responses }
      for (const k of texts) responses[k.slice(2)] = { ...responses[k.slice(2)], text: typed[k] }
      return { ...d, responses }
    })
  const notes = keys.filter(k => k.startsWith('note:'))
  if (notes.length)
    await changeNotes($, n => {
      const steps = { ...n.steps }
      for (const k of notes) steps[k.slice(5)] = { ...steps[k.slice(5)], text: typed[k] }
      return { ...n, steps }
    })
}

async function respond($: EngineInterface, key: string, patch: Partial<Response>): Promise<void> {
  await flushTyping($)
  await changeDraft($, d => ({ ...d, responses: { ...d.responses, [key]: { ...d.responses[key], ...patch } } }))
}

async function ask($: EngineInterface, question: string): Promise<void> {
  const q = question.trim()
  const current = await read($, open)
  const v = viewOf(await read($, view))
  if (!q || !current) return
  const card = current.walk.cards[Math.min(v.card, current.walk.cards.length - 1)]
  if (!card) return
  const at = await $.clock.now()
  const entry: Ask = { id: `a${at.toString(36)}`, question: q, card: card.id, about: `${card.id} ${card.title}`, at: new Date(at).toISOString() }
  if (current.status === 'pending') await changeDraft($, d => ({ ...d, asks: [...d.asks, entry] }))
  else await update($, open, o => (o ? { ...o, draft: { ...o.draft, asks: [...o.draft.asks, entry] } } : o))
  const folder = v.openId ?? current.walk.id
  const where = join(await rootOf($), current.status, folder, FILES.walk)
  await $.prompt.submit({
    text: [
      `A question from the discovery desk, on ${card.type} card ${card.id} "${card.title}" of the walk "${current.walk.title}" (${current.walk.initiative.id}, ${where}):`,
      '',
      q,
      '',
      `Research it with whatever you need: the web, this project, its record. Then put your answer on the card with answer_question (walk "${folder}", ask "${entry.id}"), in Markdown short enough for a side panel, and list what you drew on as sources with their URLs. Do not change any record unless I ask.`,
    ].join('\n'),
  })
}

async function submit($: EngineInterface): Promise<void> {
  await flushTyping($)
  const current = await read($, open)
  const v = viewOf(await read($, view))
  if (!current || current.status !== 'pending' || !v.openId) return
  const root = await rootOf($)
  const at = await nowIso($)
  const id = v.openId
  const done = await safely(async () => {
    const l = await readInitiative($, join(await $.session.root(), ...current.walk.initiative.rel.split('/')))
    const notesKey = current.walk.initiative.id || current.walk.initiative.rel
    const notes = await readNotesFor($, notesKey)
    const raised = notes.raised.filter(q => !q.sentAt)
    const extras = { notes, raised, loaded: l ?? null, vault: l?.register.initiative.vault }
    const from = join(root, 'pending', id)
    const md = outcomeMarkdown(current.walk, current.draft, at, cfg.vocab, extras)
    const json = JSON.stringify(outcomeJson(current.walk, current.draft, at, cfg.vocab, extras), null, 2)
    const draft = JSON.stringify(current.draft, null, 2)
    await $.fs.write(join(from, FILES.draft), draft)
    await $.fs.write(join(from, FILES.outcome), md)
    await $.fs.write(join(from, FILES.outcomeJson), json)
    let slot = id
    for (let n = 2; await $.fs.exists(join(root, 'reviewed', slot)); n++) slot = `${id}--${n}`
    const to = join(root, 'reviewed', slot)
    await $.fs.write(join(root, 'reviewed', '.keep'), '')
    const run = await $.process.run(moveArgv(from, to), { timeoutMs: 20_000 }).catch(() => undefined)
    const isMoved = run?.exitCode === 0 && (await $.fs.exists(join(to, FILES.walk)))
    if (!isMoved) {
      await $.fs.write(join(to, FILES.walk), JSON.stringify(current.walk, null, 2))
      await $.fs.write(join(to, FILES.draft), draft)
      await $.fs.write(join(to, FILES.outcome), md)
      await $.fs.write(join(to, FILES.outcomeJson), json)
    }
    // The raised questions now travel with this outcome.
    if (raised.length) {
      const sent = { ...notes, raised: notes.raised.map(q => (q.sentAt ? q : { ...q, sentAt: at })), updatedAt: at }
      await $.fs.write(notesPath(root, notesKey), JSON.stringify(sent, null, 2))
      const shown = await read($, loaded)
      if (shown && (shown.register.initiative.id || shown.rel) === notesKey) await update($, notesAtom, () => sent)
    }
    return join(to, FILES.outcome)
  })
  if (!done) {
    $.ui.toast('Could not save the outcome. Nothing was submitted.')
    return
  }
  await update($, open, () => null)
  await update($, view, (x): DeskView => ({ ...viewOf(x), screen: 'home', openId: undefined, openStatus: undefined, card: 0, part: {}, isConfirming: false }))
  await refresh($)
  $.ui.toast(cfg.handOff ? 'Walk submitted and handed to Claude' : 'Walk submitted')
  if (cfg.handOff) await safely(() => $.prompt.submit({ text: handOffPrompt(current.walk, done, !!current.draft.isPlanOnly) }))
}

async function openWalk($: EngineInterface, status: WalkStatus, id: string): Promise<void> {
  const root = await rootOf($)
  const loadedWalk = await loadWalk($, root, status, id)
  const got = loadedWalk && status === 'pending' ? { ...loadedWalk, stale: await staleOf($, loadedWalk.walk) } : loadedWalk
  await update($, open, () => got ?? null)
  if (got) {
    const folder = join(await $.session.root(), ...got.walk.initiative.rel.split('/'))
    if ((await read($, loaded))?.folder !== folder) {
      const l = await readInitiative($, folder)
      await update($, loaded, () => l ?? null)
      await update($, notesAtom, () => null)
      if (l) {
        const n = await readNotesFor($, l.register.initiative.id || l.rel)
        await update($, notesAtom, () => n)
      }
    }
  }
  stopPlay()
  const isFresh = !!got && status === 'pending' && Object.keys(got.draft.responses).length === 0
  await update($, view, (x): DeskView => ({ ...viewOf(x), screen: 'walk', openId: id, openStatus: status, card: 0, part: {}, isConfirming: false, showAllAsks: false, isPlaying: false, isSummaryOpen: isFresh && !!got?.walk.summary }))
}

async function closeWalk($: EngineInterface): Promise<void> {
  await flushTyping($)
  await update($, open, () => null)
  await update($, view, (x): DeskView => ({ ...viewOf(x), screen: 'home', openId: undefined, openStatus: undefined, card: 0, part: {}, isConfirming: false }))
  await refresh($)
}

async function moveTo($: EngineInterface, patch: (v: DeskView) => DeskView): Promise<void> {
  await flushTyping($)
  await update($, view, x => patch(viewOf(x)))
}

async function commitField($: EngineInterface, key: string, text: string): Promise<void> {
  if (key.startsWith('new:')) {
    await update($, typing, t => ({ ...t, [key]: text }))
    return
  }
  await update($, typing, t => Object.fromEntries(Object.entries(t).filter(([k]) => k !== key)))
  if (key.startsWith('ask:')) await ask($, text)
  else if (key.startsWith('t:')) await respond($, key.slice(2), { text })
  else if (key.startsWith('raise:')) await raise($, key.slice(6), text)
  else if (key.startsWith('note:')) await changeNotes($, n => ({ ...n, steps: { ...n.steps, [key.slice(5)]: { ...n.steps[key.slice(5)], text } } }))
}

/** Puts text on the clipboard: the surface's own first, else the system's clipboard command. */
async function copyText($: EngineInterface, text: string, surface: string): Promise<void> {
  const viaSurface = await $.ui.copy({ text, surface: surface as never }).catch(() => ({ isCopied: false as const }))
  if (viaSurface.isCopied) {
    $.ui.toast('Copied')
    return
  }
  const tries: string[][] = isWindowsPath(await rootOf($))
    ? [['powershell', '-NoProfile', '-NonInteractive', '-Command', '[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())']]
    : [['pbcopy'], ['wl-copy'], ['xclip', '-selection', 'clipboard']]
  for (const argv of tries) {
    const run = await $.process.run(argv, { stdin: text, timeoutMs: 10_000 }).catch(() => undefined)
    if (run?.exitCode === 0) {
      $.ui.toast('Copied')
      return
    }
  }
  $.ui.toast('Could not reach the clipboard')
}

function actionsFor($: EngineInterface): Actions {
  const run = (work: () => Promise<unknown>) => void safely(work)
  return {
    home: () =>
      run(async () => {
        await flushTyping($)
        stopPlay()
        await update($, view, (x): DeskView => ({ ...viewOf(x), screen: 'home', isPlaying: false }))
        await refresh($)
      }),
    refresh: () =>
      run(async () => {
        await refresh($)
        const v = viewOf(await read($, view))
        if (v.initiative && v.screen !== 'home') {
          const l = await readInitiative($, v.initiative)
          await update($, loaded, () => l ?? null)
        }
      }),
    tab: tab => run(() => update($, view, x => ({ ...viewOf(x), tab }))),
    openInitiative: folder => run(() => openInitiative($, folder)),
    openJourney: (code, step) =>
      run(() => moveTo($, v => ({ ...v, screen: 'journey', journey: code, step: { ...v.step, [code]: step ?? v.step[code] ?? 0 } }))),
    leaveJourney: () =>
      run(async () => {
        stopPlay()
        await moveTo($, v => ({ ...v, screen: v.openId ? 'walk' : 'initiative', isPlaying: false }))
      }),
    goStep: index => run(() => setStep($, index)),
    setOs: os => run(() => moveTo($, v => ({ ...v, os }))),
    setStepView: stepView => run(() => moveTo($, v => ({ ...v, stepView }))),
    toggleContext: () => run(() => moveTo($, v => ({ ...v, isContextOpen: !v.isContextOpen }))),
    play: isOn => run(() => play($, isOn)),
    walked: (key, isWalked) =>
      run(async () => {
        await flushTyping($)
        const os = viewOf(await read($, view)).os
        await changeNotes($, n => ({ ...n, steps: { ...n.steps, [key]: { ...n.steps[key], isWalked, os } } }))
      }),
    polish: code =>
      run(async () => {
        const l = await read($, loaded)
        if (!l) return
        await $.prompt.submit({ text: polishPrompt(l, code, cfg.vocab) })
        $.ui.toast(`Asked Claude to put ${code} up for a walk`)
      }),
    phone: (code, index) =>
      run(async () => {
        const l = await read($, loaded)
        if (!l) return
        await $.prompt.submit({ text: phonePrompt(l, code, index, viewOf(await read($, view)).os) })
        $.ui.toast('Asked Claude to open it in the browser pane')
      }),
    sendRaised: () => run(() => sendRaised($)),
    runChecks: isOffline =>
      run(async () => {
        const v = viewOf(await read($, view))
        if (v.initiative) await runChecks($, v.initiative, { isOffline })
      }),
    hubTab: hubTab => run(() => moveTo($, v => ({ ...v, hubTab }))),
    questionFilter: questionFilter => run(() => moveTo($, v => ({ ...v, questionFilter }))),
    toggleMap: () => run(() => moveTo($, v => ({ ...v, isMapOpen: !v.isMapOpen }))),
    planOnly: () => run(() => changeDraft($, d => ({ ...d, isPlanOnly: !d.isPlanOnly }))),
    journeySet: () =>
      run(async () => {
        const l = await read($, loaded)
        if (!l) return
        await $.prompt.submit({ text: journeySetPrompt(l) })
        $.ui.toast('Asked Claude to put the journey set up for review')
      }),
    readNotes: () =>
      run(async () => {
        const l = await read($, loaded)
        if (!l) return
        await $.prompt.submit({ text: readNotesPrompt(l) })
        $.ui.toast('Asked Claude to put the discovery notes up to read')
      }),
    newInitiative: () =>
      run(async () => {
        stopPlay()
        await moveTo($, v => ({ ...v, screen: 'new', isPlaying: false }))
      }),
    scaffold: () =>
      run(async () => {
        await flushTyping($)
        const typed = await read($, typing)
        const f = (k: string) => (typed[`new:${k}`] ?? '').trim()
        if (!f('id') || !f('name')) return
        await $.prompt.submit({ text: scaffoldPrompt({ id: f('id'), name: f('name'), storyMap: f('storyMap'), features: f('features'), pitch: f('pitch'), device: f('device') }, cfg.scaffold) })
        await update($, typing, t => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith('new:'))))
        await moveTo($, v => ({ ...v, screen: 'home' }))
        $.ui.toast(`Asked Claude to scaffold ${f('id')}`)
      }),
    republish: () =>
      run(async () => {
        const current = await read($, open)
        if (!current) return
        await $.prompt.submit({
          text: `The discovery desk walk "${current.walk.title}" (\`${current.walk.id}\`, ${current.walk.initiative.id}) was built from files that changed since: ${(current.stale ?? []).join(', ')}. Re-read them and the record, then publish the walk again with publish_walk under the same id; my answers for cards that keep their ids are kept.`,
        })
        $.ui.toast('Asked Claude to publish it again')
      }),
    openWalk: (status, id) => run(() => openWalk($, status, id)),
    closeWalk: () => run(() => closeWalk($)),
    goCard: n => run(() => moveTo($, v => ({ ...v, card: Math.max(0, n), isConfirming: false, showAllAsks: false }))),
    respond: (key, patch) => run(() => respond($, key, patch)),
    toggleRow: (cardId, rowId) =>
      run(async () => {
        await flushTyping($)
        await changeDraft($, d => {
          const r = d.responses[cardId] ?? {}
          return { ...d, responses: { ...d.responses, [cardId]: { ...r, rows: { ...r.rows, [rowId]: !(r.rows?.[rowId] ?? true) } } } }
        })
      }),
    decideRow: (cardId, rowId, isOn) =>
      run(async () => {
        await flushTyping($)
        await changeDraft($, d => {
          const r = d.responses[cardId] ?? {}
          return { ...d, responses: { ...d.responses, [cardId]: { ...r, rows: { ...r.rows, [rowId]: isOn } } } }
        })
      }),
    setPlanView: (cardId, mode) => run(() => moveTo($, v => ({ ...v, planView: { ...(v.planView ?? {}), [cardId]: mode } }))),
    goPart: (cardId, n) => run(() => moveTo($, v => ({ ...v, part: { ...v.part, [cardId]: Math.max(0, n) } }))),
    type: (key, text) => run(() => update($, typing, t => ({ ...t, [fieldKey(key)]: text }))),
    commit: (key, text) => run(() => commitField($, fieldKey(key), text)),
    toggleSummary: () => run(() => update($, view, x => ({ ...viewOf(x), isSummaryOpen: !viewOf(x).isSummaryOpen }))),
    showAllAsks: () => run(() => update($, view, x => ({ ...viewOf(x), showAllAsks: true }))),
    submit: () => run(() => submit($)),
    confirm: isOn => run(() => moveTo($, v => ({ ...v, isConfirming: isOn }))),
    resend: () =>
      run(async () => {
        const current = await read($, open)
        const v = viewOf(await read($, view))
        if (!current || !v.openId) return
        await $.prompt.submit({ text: handOffPrompt(current.walk, join(await rootOf($), 'reviewed', v.openId, FILES.outcome), !!current.draft.isPlanOnly) })
        $.ui.toast('Outcome sent to Claude')
      }),
    copy: (text, surface) => run(() => copyText($, text, surface)),
  }
}

// ---------- the tools ----------

async function publish($: EngineInterface, input: Record<string, unknown>) {
  const name = typeof input.initiative === 'string' ? input.initiative : ''
  if (!name.trim()) return { deny: 'publish_walk needs "initiative": the register\'s initiative id (e.g. INIT-005) or its folder name. list_walks lists them.' }
  const found = await findInitiative($, name)
  if (!found) return { deny: `No UX prototype for "${name}" was found. list_walks lists the initiatives the desk can see.` }
  if (found.problem) return { deny: `${found.rel}: ${found.problem}` }
  const l = await readInitiative($, found.folder)
  if (!l) return { deny: `${found.rel}/prototype.js could not be read.` }
  const at = await nowIso($)
  const refs = (Array.isArray(input.cards) ? input.cards : [])
    .map(c => (c && typeof c === 'object' && (c as { evidence?: { ref?: unknown } }).evidence?.ref) || undefined)
    .filter((r): r is string => typeof r === 'string' && r.trim() !== '')
  const record: Record<string, string | null> = {}
  for (const ref of refs) record[ref] = await recordNote($, ref)
  const { walk, problems, notes } = cleanWalk(input, at, { loaded: l, vocab: cfg.vocab, files: await prototypeFiles($, l), record, hasRecord: !!cfg.vaultRoot })
  if (!walk) return { deny: `The walk was not published. Fix these and call publish_walk again:\n- ${problems.join('\n- ')}` }
  const { dir, kept } = await storeWalk($, { ...walk, sources: await sourcesFor($, l, walk.journeys) }, l, at)
  const byType = walk.cards.reduce<Record<string, number>>((m, c) => ({ ...m, [c.type]: (m[c.type] ?? 0) + 1 }), {})
  return {
    result: [
      `Published "${walk.title}" as ${walk.id} for ${walk.initiative.id}: ${walk.cards.length} cards (${Object.entries(byType).map(([t, n]) => `${n} ${t}`).join(', ')}), saved in ${dir}.`,
      kept ? `Kept ${kept} of the owner's earlier answers for cards with the same ids.` : '',
      notes.length ? `Note: ${notes.join('; ')}.` : '',
      walk.cards.some(c => c.type === 'finding' && c.isRecordUnchecked) ? 'The record quotes were not checked: the desk has no vaultRoot set.' : '',
      'The owner walks it in the discovery desk panel (/discovery). Do not repeat its questions in chat. When the owner submits, a prompt points you at the outcome; until then, carry on or end your turn.',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

/** Writes a walk to pending/, keeping the owner's answers for cards still there, and opens it unless another is open. */
async function storeWalk($: EngineInterface, walk: Walk, l: Loaded, at: string, isOpening = cfg.autoOpen): Promise<{ dir: string; kept: number }> {
  const root = await rootOf($)
  const readme = join(root, 'README.md')
  if (!(await $.fs.exists(readme))) await $.fs.write(readme, README)
  const dir = join(root, 'pending', walk.id)
  const old = readDraft(await readText($, join(dir, FILES.draft)))
  const ids = new Set(walk.cards.map(c => c.id))
  const responses = Object.fromEntries(Object.entries(old.responses).filter(([key]) => ids.has(key.split('/')[0] ?? '')))
  await $.fs.write(join(dir, FILES.walk), JSON.stringify(walk, null, 2))
  await $.fs.write(join(dir, FILES.draft), JSON.stringify({ ...old, responses, updatedAt: at }, null, 2))
  const kept = Object.keys(responses).length
  await safely(async () => {
    await update($, loaded, () => l)
    const n = await readNotesFor($, l.register.initiative.id || l.rel)
    await update($, notesAtom, () => n)
    await refresh($)
    if (!isOpening) return
    const v = viewOf(await read($, view))
    if (v.screen === 'walk' && v.openId && v.openId !== walk.id) return
    const keep = v.openId === walk.id
    await update($, open, () => ({ walk, draft: { ...old, responses, updatedAt: at }, status: 'pending' }))
    stopPlay()
    await update($, view, (x): DeskView => ({ ...viewOf(x), screen: 'walk', initiative: l.folder, openId: walk.id, openStatus: 'pending', isPlaying: false, isSummaryOpen: !!walk.summary && !keep, card: keep ? viewOf(x).card : 0, part: keep ? viewOf(x).part : {} }))
    await $.ui.open({ id: PANE, title: PANE_TITLE })
  })
  return { dir, kept }
}

// ---------- checks ----------

/**
 * Runs the desk's own checks and the project's validator on a prototype. What they find goes on the desk as
 * one walk of finding cards (`<initiative>-checks`, replaced on each run, answers kept); a clean run says so.
 */
async function runChecks($: EngineInterface, folder: string, options: { isOffline?: boolean; isQuiet?: boolean } = {}): Promise<CheckRun | undefined> {
  const l = await readInitiative($, folder)
  if (!l) return undefined
  const at = await nowIso($)
  const found: CheckFinding[] = deskChecks(l, { valueWords: cfg.valueWords, figurePattern: cfg.figurePattern })
  let ranValidator = false
  let problem: string | undefined
  if (cfg.validator) {
    const argv = [...argvOf(cfg.validator), folder, ...(options.isOffline ? argvOf(cfg.validatorOffline) : [])]
    const run = await $.process.run(argv, { cwd: await $.session.root(), timeoutMs: 120_000 }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }))
    const report = readReport(run.stdout)
    if (run.exitCode === 0 || run.exitCode === 1 || report.length) {
      ranValidator = true
      found.push(...report)
    } else problem = `the validator did not run (${(run.stderr || `exit ${run.exitCode}`).trim().split('\n')[0]?.slice(0, 120)})`
  }
  const result: CheckRun = { at, errors: found.filter(f => f.severity === 'high').length, warnings: found.filter(f => f.severity !== 'high').length, ranValidator, problem }
  await update($, checksAtom, c => ({ ...c, [folder]: result }))
  if (found.length) {
    const id = l.register.initiative.id || 'prototype'
    const { walk } = cleanWalk(
      {
        id: `${id}-checks`,
        title: `Checks for ${id} ${l.register.initiative.name}`,
        label: 'Checks',
        origin: ranValidator ? 'the desk and the project validator' : 'the desk',
        summary: `${result.errors} error${result.errors === 1 ? '' : 's'} and ${result.warnings} warning${result.warnings === 1 ? '' : 's'}${options.isOffline ? ', without the record' : ''}. Accept what should be fixed, reject what is fine as it is. Drift is fixed toward the record.`,
        cards: found.map(f => ({ type: 'finding', id: f.id, title: f.title, body: f.body, severity: f.severity, kind: 'check', where: f.where, quote: f.quote })),
      },
      at,
      { loaded: l, vocab: cfg.vocab },
    )
    if (walk) {
      const cards = walk.cards.map(c => (c.type === 'finding' ? { ...c, kind: found.find(f => f.id === c.id)?.isDrift ? ('drift' as const) : ('check' as const) } : c))
      await storeWalk($, { ...walk, cards, sources: await sourcesFor($, l, []) }, l, at, !options.isQuiet)
    }
  }
  await safely(() => refresh($))
  if (!options.isQuiet) $.ui.toast(problem ? `Checks: ${problem}` : found.length ? `Checks found ${result.errors} errors and ${result.warnings} warnings` : 'Every check passes')
  return result
}

/** The prototype folder a file belongs to, among the initiatives the desk knows, and whether it is the register or a page. */
async function prototypeOf($: EngineInterface, path: string): Promise<{ folder: string; isMirror: boolean } | undefined> {
  const p = path.replace(/\\/g, '/').toLowerCase()
  for (const i of await read($, initiatives)) {
    const f = i.folder.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
    if (!p.startsWith(`${f}/`)) continue
    const rest = p.slice(f.length + 1)
    return { folder: i.folder, isMirror: rest === 'prototype.js' || rest.startsWith('journeys/') }
  }
  return undefined
}

const isUnder = (path: string, root: string) => !!root && path.replace(/\\/g, '/').toLowerCase().startsWith(`${root.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')}/`)

const GUARD_TEXT =
  'The discovery desk\'s vault-first rule: the record is written before the prototype that mirrors it. This turn has written nothing to the record yet. If this change mirrors an answer, record the answer first; if it fixes drift toward the record, say so to the owner.'

async function answerQuestion($: EngineInterface, input: Record<string, unknown>) {
  const walkId = typeof input.walk === 'string' ? input.walk.trim() : ''
  const askId = typeof input.ask === 'string' ? input.ask.trim() : ''
  const answer = typeof input.answer === 'string' ? input.answer.trim() : ''
  if (!walkId || !askId || !answer) return { deny: 'answer_question needs "walk", "ask" and "answer", as given in the question prompt.' }
  const root = await rootOf($)
  let status: WalkStatus | undefined
  for (const s of ['pending', 'reviewed'] as WalkStatus[]) if (!status && (await $.fs.exists(join(root, s, walkId, FILES.walk)))) status = s
  if (!status) return { deny: `No walk "${walkId}" in ${root}. Use the id from the question prompt, or list_walks.` }
  const current = await read($, open)
  const v = viewOf(await read($, view))
  const isOnScreen = !!current && v.openId === walkId && current.status === status
  const draft = isOnScreen && current ? current.draft : readDraft(await readText($, join(root, status, walkId, FILES.draft)))
  const asked = draft.asks.find(a => a.id === askId)
  if (!asked) return { deny: `Walk "${walkId}" has no question "${askId}". Use the ask id from the question prompt.` }
  const sources = (Array.isArray(input.sources) ? input.sources : [])
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map(x => ({ title: String(x.title ?? x.url ?? '').trim(), url: typeof x.url === 'string' ? x.url.trim() : undefined }))
    .filter(x => x.title)
  const done: Ask = { ...asked, answer, answeredAt: await nowIso($), sources: sources.length ? sources : undefined }
  const next = { ...draft, asks: draft.asks.map(a => (a.id === askId ? done : a)) }
  await $.fs.write(join(root, status, walkId, FILES.draft), JSON.stringify(next, null, 2))
  if (isOnScreen) await update($, open, o => (o ? { ...o, draft: next } : o))
  $.ui.toast(`Claude answered on ${asked.about ?? 'the card'}`)
  return { result: `Answer saved on card ${asked.card ?? ''} of "${walkId}". The owner sees it in the discovery desk; there is no need to repeat it in full here.` }
}

async function listForClaude($: EngineInterface) {
  await refresh($)
  const root = await rootOf($)
  const ini = await read($, initiatives)
  const list = await read($, walks)
  const lines = [
    `Initiatives the desk can see (prototype root: ${cfg.prototypeRoot || 'the project root'}):`,
    ...(ini.length ? ini.map(i => `- ${i.id || '(no id)'} ${i.name} · ${i.rel}${i.problem ? ` · ${i.problem}` : ` · ${i.journeys} journeys, ${i.open} open, ${i.proposed} proposed, ${i.decided} decided`}`) : ['- none']),
    '',
    `Walks in ${root}:`,
    ...(list.length
      ? list.map(w => `- [${w.status}] ${w.id}: ${w.title} · ${w.initiative} ${w.journeys.join(', ')} · ${w.answered}/${w.cards} answered${w.submittedAt ? ` · submitted ${w.submittedAt} · ${join(root, 'reviewed', w.id, FILES.outcome)}` : ''}`)
      : ['- none']),
  ]
  return { result: lines.join('\n') }
}

async function setUp($: EngineInterface): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ['the publish_walk tool', () => $.tool.register({ name: 'publish_walk', description: PUBLISH_DESCRIPTION, inputSchema: PUBLISH_SCHEMA, isDeferred: false })],
    [
      'the list_walks tool',
      () =>
        $.tool.register({
          name: 'list_walks',
          description: "List the initiatives with a UX prototype the discovery desk can see (id, folder, counts) and its walks (pending and submitted), with the path of each outcome.",
          inputSchema: { type: 'object', properties: {} },
        }),
    ],
    ['the answer_question tool', () => $.tool.register({ name: 'answer_question', description: ANSWER_DESCRIPTION, inputSchema: ANSWER_SCHEMA })],
    ['the /discovery command', () => $.command.register({ name: 'discovery', description: 'Open the discovery desk: walk UX prototype journeys, answer their open questions and decisions, and hand the answers to Claude' })],
    [
      'the desk',
      async () => {
        stopPlay()
        await update($, rootRef, () => '')
        await update($, view, x => ({ ...viewOf(x), isPlaying: false }))
        await refresh($)
      },
    ],
  ]
  for (const [what, step] of steps) {
    try {
      await step()
    } catch (err) {
      $.ui.log(`discovery-desk could not set up ${what}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

const words = (v: unknown, fallback: string[]) => {
  const list = typeof v === 'string' ? v.split(',').map(x => x.trim()).filter(Boolean) : []
  return list.length >= 2 ? list : fallback
}
const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback)

export const register: RegisterHooks = (on, options) => {
  cfg.folder = text(options.folder, 'Discovery').replace(/[\\/]+$/, '')
  cfg.prototypeRoot = text(options.prototypeRoot, '').replace(/[\\/]+$/, '')
  cfg.vault = text(options.vault, '')
  cfg.defaultOs = options.defaultOs === 'android' ? 'android' : 'ios'
  cfg.autoOpen = options.autoOpen !== false
  cfg.handOff = options.handOff !== false
  cfg.selectableText = options.selectableText !== false
  cfg.validator = text(options.validator, '')
  cfg.validatorOffline = typeof options.validatorOffline === 'string' ? options.validatorOffline.trim() : '--no-vault'
  cfg.vaultRoot = text(options.vaultRoot, '').replace(/[\\/]+$/, '')
  cfg.autoValidate = options.autoValidate !== false
  cfg.guardMode = options.guardMode === 'off' || options.guardMode === 'block' ? options.guardMode : 'warn'
  try {
    cfg.vaultWriteTools = new RegExp(text(options.vaultWriteTools, VAULT_WRITES), 'i')
  } catch {
    cfg.vaultWriteTools = new RegExp(VAULT_WRITES, 'i')
  }
  cfg.valueWords = typeof options.valueWords === 'string' ? options.valueWords : VALUE_WORDS
  cfg.figurePattern = typeof options.figurePattern === 'string' ? options.figurePattern : FIGURES
  cfg.scaffold = text(options.scaffold, '')
  cfg.vocab = {
    q: text(options.questionPrefix, DEFAULT_VOCAB.q),
    d: text(options.decisionPrefix, DEFAULT_VOCAB.d),
    adr: text(options.adrPrefix, DEFAULT_VOCAB.adr),
    qStatuses: words(options.questionStatuses, DEFAULT_VOCAB.qStatuses),
    dStatuses: words(options.decisionStatuses, DEFAULT_VOCAB.dStatuses),
    adrStatuses: words(options.adrStatuses, DEFAULT_VOCAB.adrStatuses),
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await safely(() => setUp($))
    return started
  })

  on('command.run', { command: 'discovery' }, async $ => {
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) {
      stopPlay()
      await $.ui.close({ id: PANE })
      return { text: 'Discovery desk closed.' }
    }
    await refresh($)
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    const waiting = (await read($, walks)).filter(w => w.status === 'pending').length
    const count = (await read($, initiatives)).length
    return { text: `Discovery desk: ${waiting ? `${waiting} walk${waiting === 1 ? '' : 's'} waiting` : 'no walk waiting'} · ${count} initiative${count === 1 ? '' : 's'}.` }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, async ($, e) => publish($, e as unknown as Record<string, unknown>)).catch(($, e, next) => next(e))
  on('tool.call', { tool: LIST_TOOL }, async $ => listForClaude($)).catch(($, e, next) => next(e))
  on('tool.call', { tool: ANSWER_TOOL }, async ($, e) => answerQuestion($, e as unknown as Record<string, unknown>)).catch(($, e, next) => next(e))

  // Every tool call: notes a write to the record, guards the prototype (vault first), and marks it for checking.
  on('tool.call', async ($, e, next) => {
    const call = e as unknown as { tool?: string; file_path?: unknown; notebook_path?: unknown }
    const tool = String(call.tool ?? '')
    const path = typeof call.file_path === 'string' ? call.file_path : typeof call.notebook_path === 'string' ? call.notebook_path : ''
    const isEdit = EDIT_TOOLS.has(tool) && !!path
    const target = isEdit ? await safely(() => prototypeOf($, path)) : undefined
    if (cfg.vaultWriteTools.test(tool) || (isEdit && isUnder(path, cfg.vaultRoot))) await safely(() => update($, recordWritten, () => true))
    const isGuarded = !!target?.isMirror && cfg.guardMode !== 'off' && !(await safely(() => read($, recordWritten)))
    if (isGuarded && cfg.guardMode === 'block') return { deny: `${GUARD_TEXT} The desk's guard is set to block (setting guardMode); ask the owner to set it to warn for a change that only mirrors the record.` }
    const result = await next(e)
    if (target) await safely(() => update($, dirty, d => (d.includes(target.folder) ? d : [...d, target.folder])))
    if (isGuarded && 'result' in result && result.result !== undefined) return { ...result, context: [...(result.context ?? []), GUARD_TEXT] }
    return result
  }).catch(($, e, next) => next(e))

  // At the end of a turn: check the prototypes it edited, and start the next turn's record count afresh.
  // A subagent's turn ends inside the main one, so only the main turn's end counts.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if ((e as { agentId?: string }).agentId) return done
    await safely(async () => {
      const folders = await read($, dirty)
      await update($, dirty, () => [])
      await update($, recordWritten, () => false)
      if (cfg.autoValidate) for (const folder of folders) {
        const run = await runChecks($, folder, { isQuiet: true })
        if (run && (run.errors || run.problem)) $.ui.toast(`${run.problem ? `Checks could not run: ${run.problem}` : `${run.errors} error${run.errors === 1 ? '' : 's'} in the prototype after these edits`}: see /discovery`)
      }
    })
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const v = viewOf(await read($, view))
    const ctx = {
      ui,
      isDesktop: e.surface !== 'terminal' && 'Svg' in ui,
      width: Math.max(280, Math.min(920, (e.props.bodyColumns || 48) * 8 - 8)),
      view: v,
      initiatives: await read($, initiatives),
      walks: await read($, walks),
      loaded: await read($, loaded),
      notes: await read($, notesAtom),
      open: v.screen === 'walk' ? await read($, open) : null,
      act: actionsFor($),
      folder: cfg.folder,
      selectable: cfg.selectableText,
      vocab: cfg.vocab,
      checks: await read($, checksAtom),
      hasValidator: !!cfg.validator,
      hasOffline: !!cfg.validatorOffline,
      form: Object.fromEntries(Object.entries(await read($, typing)).filter(([k]) => k.startsWith('new:')).map(([k, v]) => [k.slice(4), v])),
    }
    try {
      if (v.screen === 'walk') return walkView(ctx)
      if (v.screen === 'journey') return journeyView(ctx)
      if (v.screen === 'initiative') return initiativeView(ctx)
      if (v.screen === 'new') return newView(ctx)
      return homeView(ctx)
    } catch (err) {
      const { Box, Text, Button } = ui
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>The discovery desk could not draw this view.</Text>
          <Text dimColor>{err instanceof Error ? err.message : String(err)}</Text>
          <Button key="recover" label="Back to the desk" onPress={() => void safely(() => closeWalk($))} />
        </Box>
      )
    }
  })
}
