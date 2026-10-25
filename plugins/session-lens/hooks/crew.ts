// The crew: each subagent of the session is a crab, cast by its agent type. What it is doing, how far
// it has got, and the order the pane lists the crew in. Pure functions: no `$` here.
// Adapted from this repository's crab-crew mod.
import type { LensActivity, LensCaptain, LensCrab } from '../types'

/** What a crab wears: one small mark of its role, drawn on top of the crab. */
export type Accessory = 'bandana' | 'cap' | 'tricorn' | 'glasses' | 'antenna' | 'halo' | 'toque' | 'deerstalker' | 'wizard' | 'goggles' | 'captain'

export type Character = {
  key: string
  role: string
  names: readonly string[]
  /** The crab's shell. */
  color: string
  accessory: Accessory
  /** Tool calls in a typical job: sets how fast an estimated progress climbs. */
  pace: number
}

export const CHARACTERS: Record<string, Character> = {
  deckhand: { key: 'deckhand', role: 'Deckhand', names: ['Barnacle', 'Rusty', 'Sal', 'Dory', 'Mack'], color: '#E0574F', accessory: 'bandana', pace: 22 },
  scout: { key: 'scout', role: 'Scout', names: ['Pip', 'Wren', 'Kit', 'Marlo', 'Juno'], color: '#3FAE5F', accessory: 'cap', pace: 14 },
  navigator: { key: 'navigator', role: 'Navigator', names: ['Ada', 'Vela', 'Orion', 'Mags'], color: '#4C8DFF', accessory: 'tricorn', pace: 16 },
  professor: { key: 'professor', role: 'Professor', names: ['Kelp', 'Sage', 'Quill', 'Tomes'], color: '#8E6CF0', accessory: 'glasses', pace: 10 },
  signaller: { key: 'signaller', role: 'Signaller', names: ['Sparky', 'Dot', 'Morse'], color: '#D99A1E', accessory: 'antenna', pace: 8 },
  echo: { key: 'echo', role: 'Understudy', names: ['Echo', 'Mirror', 'Twin'], color: '#1EA7C5', accessory: 'halo', pace: 20 },
  // The pool: any other agent type is dealt one of these, the same one every time.
  cook: { key: 'cook', role: 'Cook', names: ['Cookie', 'Saffron', 'Basil'], color: '#E2775A', accessory: 'toque', pace: 20 },
  sleuth: { key: 'sleuth', role: 'Sleuth', names: ['Inky', 'Clue', 'Sherl'], color: '#B07A45', accessory: 'deerstalker', pace: 18 },
  wizard: { key: 'wizard', role: 'Wizard', names: ['Merla', 'Coral', 'Zap'], color: '#7B6BD8', accessory: 'wizard', pace: 20 },
  diver: { key: 'diver', role: 'Diver', names: ['Bubbles', 'Finn', 'Marina'], color: '#2E8BC0', accessory: 'goggles', pace: 20 },
  // The main thread: never cast for a subagent, always on the beach.
  captain: { key: 'captain', role: 'Captain', names: ['Clawd'], color: '#4A6FB5', accessory: 'captain', pace: 20 },
}

const POOL = ['cook', 'sleuth', 'wizard', 'diver'] as const

const BY_TYPE: Record<string, string> = {
  'general-purpose': 'deckhand',
  claude: 'deckhand',
  Explore: 'scout',
  Plan: 'navigator',
  'claude-code-guide': 'professor',
  'statusline-setup': 'signaller',
  fork: 'echo',
}

/** `some-plugin:helper` and `helper` name the same agent; the plugin prefix is dropped. */
const bareType = (type: string): string => type.replace(/^[^:]*:/, '')

/** FNV-1a: a stable pick from a name, the same on every load. */
const hash = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const characterKeyOf = (type: string): string => BY_TYPE[type] ?? BY_TYPE[bareType(type)] ?? POOL[hash(bareType(type)) % POOL.length] ?? 'deckhand'

export const characterOf = (key: string): Character => CHARACTERS[key] ?? (CHARACTERS.deckhand as Character)

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/** The next free name for a character: Pip, Wren, ..., then Pip II. */
export function crewNameOf(key: string, crew: readonly LensCrab[]): string {
  const { names } = characterOf(key)
  const taken = crew.filter(m => m.character === key).length
  const base = names[taken % names.length] ?? 'Crab'
  const round = Math.floor(taken / names.length) + 1
  return round > 1 ? `${base} ${ROMAN[round] ?? round}` : base
}

export const titleOf = (m: Pick<LensCrab, 'name' | 'character'>): string => `${m.name} the ${characterOf(m.character).role}`

// ---------- what a crab is doing ----------

export function activityOf(tool: string): LensActivity {
  if (/^(Read|NotebookRead)$/.test(tool)) return 'read'
  if (/^(Grep|Glob|LS|ToolSearch)$/.test(tool)) return 'search'
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return 'edit'
  if (/^(Bash|PowerShell|Monitor|BashOutput)$/.test(tool)) return 'shell'
  if (/^(WebFetch|WebSearch)$/.test(tool) || (tool.startsWith('mcp__') && /browser|chrome|fetch|web/i.test(tool))) return 'web'
  if (/^(Agent|Task|SendMessage|Workflow)$/.test(tool)) return 'delegate'
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet|EnterPlanMode|ExitPlanMode)$/.test(tool)) return 'plan'
  return 'other'
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)

/** A call's target in a few characters: a file's name, a pattern, a command's head, a host. */
export function detailOf(input: Record<string, unknown>): string {
  const file = str(input.file_path) || str(input.notebook_path)
  if (file) return baseName(file)
  if (str(input.pattern)) return clip(str(input.pattern), 28)
  const command = str(input.command).trim().split('\n')[0] ?? ''
  if (command) return clip(command, 28)
  const url = str(input.url)
  if (url) return /^[a-z]+:\/\/([^/?#]+)/i.exec(url)?.[1] ?? clip(url, 28)
  if (str(input.query)) return clip(str(input.query), 28)
  if (str(input.description)) return clip(str(input.description), 28)
  if (str(input.skill)) return str(input.skill)
  if (str(input.path)) return baseName(str(input.path))
  return ''
}

type Todo = { status?: unknown; activeForm?: unknown; content?: unknown }

/** Progress an agent reports without knowing it: its own to-do list. */
export function todoPatch(tool: string, input: Record<string, unknown>, m: LensCrab): Partial<LensCrab> {
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    const todos = input.todos as Todo[]
    const done = todos.filter(t => t.status === 'completed').length
    const active = todos.find(t => t.status === 'in_progress')
    return {
      todoTotal: todos.length,
      todoDone: done + (active ? 0.5 : 0),
      todoNote: active ? str(active.activeForm) || str(active.content) || undefined : undefined,
    }
  }
  if (tool === 'TaskCreate') return { todoTotal: (m.todoTotal ?? 0) + 1, todoDone: m.todoDone ?? 0 }
  if (tool === 'TaskUpdate') {
    const total = m.todoTotal ?? 0
    const done = Math.floor(m.todoDone ?? 0)
    if (input.status === 'completed') return { todoDone: Math.min(total, done + 1), todoNote: undefined }
    if (input.status === 'deleted') return { todoTotal: Math.max(0, total - 1), todoDone: Math.min(done, Math.max(0, total - 1)) }
    if (input.status === 'in_progress') return { todoDone: done + 0.5, todoNote: str(input.activeForm) || str(input.subject) || undefined }
  }
  return {}
}

/** How a run ended, from `turn.complete`'s reason. */
export const outcomeOf = (reason: string): LensCrab['status'] => (reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'failed')

// ---------- progress and pose ----------

/** No call for this long while running: the crab is drawn waiting. */
export const STALL_MS = 20_000

/**
 * How far along a crab is, 0 to 1. Its own to-do list when it keeps one; otherwise an estimate that
 * climbs with its calls toward 92% at its character's pace, and reaches 100% only when it is done.
 */
export function progressOf(m: Pick<LensCrab, 'status' | 'todoTotal' | 'todoDone' | 'toolCalls' | 'character'>): { value: number; isEstimate: boolean } {
  if (m.status === 'done') return { value: 1, isEstimate: false }
  if (m.todoTotal) return { value: Math.min(1, (m.todoDone ?? 0) / m.todoTotal), isEstimate: false }
  return { value: 0.92 * (1 - Math.exp(-(m.toolCalls + 0.5) / characterOf(m.character).pace)), isEstimate: true }
}

export function progressLabel(m: LensCrab): string {
  if (m.status === 'done') return '100%'
  if (m.todoTotal) return `${Math.floor(m.todoDone ?? 0)}/${m.todoTotal}`
  return `≈${Math.round(progressOf(m).value * 100)}%`
}

/** A crab with a change applied, its progress bar set to grow from where it was when it moves. */
export function withChange(m: LensCrab, patch: Partial<LensCrab>, at: number): LensCrab {
  const next = { ...m, ...patch }
  const was = progressOf(m).value
  const now = progressOf(next).value
  return Math.abs(now - was) > 0.001 ? { ...next, progressBefore: was, progressAt: at } : next
}

export type Pose = 'work' | 'scurry' | 'think' | 'wait' | 'done' | 'failed' | 'stopped'

/** A call this recent: the crab scurries, at twice its pace. */
export const SCURRY_MS = 3_000

export function poseOf(m: LensCrab, now: number): Pose {
  if (m.status !== 'running') return m.status
  if (m.activity === 'think' || m.activity === 'start') return 'think'
  const quiet = now - m.lastActiveAt
  return quiet > STALL_MS ? 'wait' : quiet < SCURRY_MS ? 'scurry' : 'work'
}

const VERB: Record<LensActivity, string> = {
  start: 'setting out',
  think: 'thinking',
  read: 'reading',
  search: 'searching',
  edit: 'editing',
  shell: 'running',
  web: 'browsing',
  delegate: 'delegating',
  plan: 'planning',
  other: 'working',
}

/** What the crab is doing, plainly: its to-do in progress, or the verb and target of its last call. */
export function actionOf(m: LensCrab, now: number): string {
  if (m.status === 'done') return 'back at base'
  if (m.status === 'failed') return 'went overboard'
  if (m.status === 'stopped') return 'called back'
  if (m.todoNote) return m.todoNote
  const waited = now - m.lastActiveAt > STALL_MS ? ` · waiting ${duration(now - m.lastActiveAt)}` : ''
  if (m.activity === 'think' || m.activity === 'start') return `${VERB[m.activity]}${waited}`
  return `${VERB[m.activity]}${m.detail ? ` ${m.detail}` : ''}${waited}`
}

/** A span of time, coarse: the pane is drawn now and then, not every second. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

// ---------- the crew's order ----------

/** Splits the crew list: the crabs still out, before it; the ones back at base, after it. */
export const BASE_MARK = '|'

const byName = (a: LensCrab, b: LensCrab) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.startedAt - b.startedAt

/** How long a crab that reached its flag stands there, past it, before it flies to the list of those back. */
export const LINGER_MS = 3000

/** Whether a crab is on the beach: still at work, or done and standing past its flag for a moment. */
export const isOnBeach = (m: LensCrab, now: number): boolean => m.status === 'running' || (m.status === 'done' && now - (m.endedAt ?? 0) < LINGER_MS)

/** The crabs of the race that began at `since`: those still out, and those that came back since. */
export const raceCrew = (crew: Record<string, LensCrab>, since: number): LensCrab[] =>
  Object.values(crew).filter(m => m.status === 'running' || (m.endedAt ?? 0) >= since)

/**
 * The race's crabs on the beach, in the order they set out: each keeps its lane and its row while it
 * works (the race is in how far each has walked), and the ones that reported back, the latest first.
 */
export function crewLists(crew: Record<string, LensCrab>, now: number, since = 0): { working: LensCrab[]; base: LensCrab[] } {
  const all = raceCrew(crew, since)
  // A stable sort: crabs that set out at the same moment keep the order they were spawned in.
  const working = all.filter(m => isOnBeach(m, now)).sort((a, b) => a.startedAt - b.startedAt)
  const base = all.filter(m => !isOnBeach(m, now)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0) || byName(a, b))
  return { working, base }
}

/** The crew's order as one list, the base mark between the two halves: what the flights compare. */
export function crewOrder(crew: Record<string, LensCrab>, now: number, since = 0): string[] {
  const { working, base } = crewLists(crew, now, since)
  return [...working.map(m => m.id), BASE_MARK, ...base.map(m => m.id)]
}

export function crewSummary(crew: Record<string, LensCrab>, since = 0): string {
  const all = raceCrew(crew, since)
  const out = all.filter(m => m.status === 'running').length
  const back = all.length - out
  return [out ? `${out} at work` : '', back ? `${back} back` : ''].filter(Boolean).join(' · ')
}

// ---------- what a crab says ----------

/** What a crab says depends on its mood: what it is doing, or how its run ended. */
type Mood = LensActivity | 'wait' | 'done' | 'failed' | 'stopped'

const GENERIC: Record<Mood, readonly string[]> = {
  start: ['Reporting for duty!', 'Aye aye!', 'Claws ready.'],
  think: ['Hmm, let me think', 'Pondering', 'Mulling it over'],
  read: ['Reading {x}', 'Peeking at {x}'],
  search: ['Searching for {x}', 'Combing the sand'],
  edit: ['Tweaking {x}', 'Patching {x}'],
  shell: ['Running {x}', 'Cranking the engine'],
  web: ['Checking {x}', 'Asking the wider sea'],
  delegate: ['Calling in help: {x}', 'Need a hand here!'],
  plan: ['Making a list', 'Checking it twice'],
  other: ['On it', 'Busy, busy'],
  wait: ['Still waiting…', 'Tap, tap, tap'],
  done: ['Back at base!', 'Job done.', 'Nailed it.'],
  failed: ['Man overboard!', 'That went sideways.'],
  stopped: ['Called back to base.', 'Standing down.'],
}

/** Each character's own lines, by mood; a mood with none falls back to the generic ones. */
const QUIPS: Record<string, Partial<Record<Mood, readonly string[]>>> = {
  deckhand: {
    start: ["Aye, I'll handle it!", 'Rolling up me claws.'],
    edit: ['Hammering {x} into shape', 'Swabbing {x}'],
    shell: ['Hauling on {x}'],
    wait: ['Leaning on the mop'],
    done: ['Shipshape and done!', "Deck's clean, Cap'n."],
    failed: ['Slipped on the deck!'],
  },
  scout: {
    start: ['Off to explore!', 'Spyglass ready.'],
    read: ['Spyglass on {x}', 'Ooh, what is {x}?'],
    search: ['Land ho? Hunting {x}', 'Scanning for {x}'],
    think: ['Mapping what I saw'],
    done: ['Scouting report ready!', 'Charted it all!'],
    failed: ['Lost in the fog!'],
  },
  navigator: {
    start: ['Unrolling the charts.'],
    think: ['Plotting a course', 'Weighing the winds'],
    read: ['Studying {x}'],
    search: ['Taking soundings: {x}'],
    plan: ['Marking waypoints'],
    done: ['Course plotted!', 'Heading set, Captain.'],
    failed: ['Off the edge of the map!'],
  },
  professor: {
    start: ['Ahem. To the library!'],
    read: ['Consulting {x}'],
    web: ['Looking it up: {x}'],
    think: ['Fascinating, one moment'],
    done: ['Footnotes included.'],
    failed: ['The page is missing!'],
  },
  signaller: { start: ['Signals up!'], edit: ['Rewiring {x}'], shell: ['Testing the lamp: {x}'], done: ["Signal's lit!"] },
  echo: { start: ['Same brain, new claws.'], think: ['As the Captain would'], done: ['Echo complete.'] },
  cook: {
    start: ['Firing up the galley!'],
    edit: ['Stirring {x}', 'A pinch of {x}'],
    shell: ['Turning up the heat'],
    done: ['Order up!'],
    failed: ['Burnt the omelette!'],
  },
  sleuth: {
    start: ['The game is afoot!'],
    search: ['Following the trail: {x}'],
    read: ['Examining {x}'],
    think: ['Connecting the dots'],
    done: ['Case closed.'],
    failed: ['The trail went cold.'],
  },
  wizard: {
    start: ['By my shell!'],
    edit: ['Enchanting {x}'],
    shell: ['Casting {x}'],
    think: ['Consulting the stars'],
    done: ['Ta-da!'],
    failed: ['The spell fizzled!'],
  },
  diver: { start: ['Taking the plunge!'], search: ['Diving for {x}'], read: ['Deep in {x}'], done: ['Surfaced with treasure!'], failed: ['Out of air!'] },
}

const moodOf = (m: LensCrab, now: number): Mood => (m.status !== 'running' ? m.status : poseOf(m, now) === 'wait' ? 'wait' : m.activity)

/** The crab's line, in character: stable until it does something new, then a new one. */
export function quipOf(m: LensCrab, now: number): string {
  const mood = moodOf(m, now)
  const list = QUIPS[m.character]?.[mood] ?? GENERIC[mood]
  const i = hash(m.id + mood) + (m.status === 'running' ? m.toolCalls : 0)
  return (list[i % list.length] ?? '').replace('{x}', clip(m.detail, 22) || 'the code')
}

// ---------- the captain ----------

export const CAPTAIN_NAME = 'Captain Clawd'

const CAPTAIN_LINES: Record<LensActivity, readonly string[]> = {
  start: ['All hands!'],
  think: ['Charting the course', 'Reading the stars'],
  read: ['Reviewing {x}'],
  search: ['Scanning the horizon: {x}'],
  edit: ['Taking the wheel: {x}'],
  shell: ['Full steam: {x}'],
  web: ['Signalling ashore: {x}'],
  delegate: ['Dispatching the crew', 'All hands to {x}'],
  plan: ['Updating the log'],
  other: ['At the helm'],
}

/** The captain asleep while Claude waits for you, thinking while it waits on the model, else at work. */
export const captainPose = (c: LensCaptain): Pose => (!c.isBusy ? 'stopped' : c.activity === 'think' || c.activity === 'start' ? 'think' : 'work')

/** What the captain says: what the main conversation is doing, or that it awaits your orders. */
export function captainQuip(c: LensCaptain): string {
  if (!c.isBusy) return 'Off watch, awaiting orders'
  const list = CAPTAIN_LINES[c.activity]
  return (list[hash(c.activity + c.detail) % list.length] ?? '').replace('{x}', clip(c.detail, 22) || 'the code')
}

// ---------- who's who ----------

/**
 * One character on duty: who it is, and the agent types it stands for in this race, spelled as Claude Code
 * names them (`Explore`, `general-purpose`). The captain stands for no type: `note` says what he is instead.
 */
export type LegendEntry = { character: string; role: string; color: string; types: string[]; note?: string }

/** The characters on duty: the captain, then each kind of crab in the race, in the order they first set out. */
export function legendOf(crew: readonly LensCrab[]): LegendEntry[] {
  const out: LegendEntry[] = [{ character: 'captain', role: 'Captain', color: characterOf('captain').color, types: [], note: 'Main thread' }]
  for (const m of [...crew].sort((a, b) => a.startedAt - b.startedAt)) {
    const c = characterOf(m.character)
    const type = bareType(m.type)
    const have = out.find(e => e.character === c.key)
    if (!have) out.push({ character: c.key, role: c.role, color: c.color, types: [type] })
    else if (!have.types.includes(type)) have.types.push(type)
  }
  return out
}
