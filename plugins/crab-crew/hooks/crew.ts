import type { Activity, Captain, CrewMember, CrewStatus } from '../types'

// ---------------------------------------------------------------------------
// The roster: one crab character per standard agent type, and a pool that
// any other agent type (a plugin's, a project's own) is dealt from by name.

/** What a crab says depends on its mood: its activity, or how its run ended. */
export type Mood = Activity | 'wait' | 'done' | 'failed' | 'stopped'

/** How a crab is drawn: each pose is a body, a face and a motion. */
export type Pose = 'walk' | 'fast' | 'think' | 'wait' | 'cheer' | 'rest' | 'dizzy' | 'sleep'

export type Character = {
  key: string
  role: string
  names: readonly string[]
  color: string
  trait: string
  /** Tool calls in a typical job: sets the estimated-progress curve. */
  pace: number
  quips: Partial<Record<Mood, readonly string[]>>
}

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
  wait: ['Still waiting on {x}', 'Tap, tap, tap'],
  done: ['Back aboard!', 'Job done.', 'Nailed it.'],
  failed: ['Man overboard!', 'That went sideways.'],
  stopped: ['Called back to the ship.', 'Standing down.'],
}

export const CHARACTERS: Record<string, Character> = {
  deckhand: {
    key: 'deckhand',
    role: 'Deckhand',
    names: ['Barnacle', 'Rusty', 'Sal', 'Dory', 'Mack'],
    color: '#D0453F',
    trait: 'Can-do all-rounder: mops, fixes, hauls.',
    pace: 22,
    quips: {
      start: ["Aye, I'll handle it!", 'Rolling up me claws.'],
      edit: ['Hammering {x} into shape', 'Swabbing {x}'],
      shell: ['Hauling on {x}'],
      wait: ['Leaning on the mop'],
      done: ['Shipshape and done!', "Deck's clean, Cap'n."],
      failed: ['Slipped on the deck!'],
    },
  },
  scout: {
    key: 'scout',
    role: 'Scout',
    names: ['Pip', 'Wren', 'Kit', 'Marlo', 'Juno'],
    color: '#4E9A3A',
    trait: 'Curious and quick; looks, never touches.',
    pace: 14,
    quips: {
      start: ['Off to explore!', 'Spyglass ready.'],
      read: ['Spyglass on {x}', 'Ooh, what is {x}?'],
      search: ['Land ho? Hunting {x}', 'Scanning for {x}'],
      think: ['Mapping what I saw'],
      done: ['Scouting report ready!', 'Charted it all!'],
      failed: ['Lost in the fog!'],
    },
  },
  navigator: {
    key: 'navigator',
    role: 'Navigator',
    names: ['Ada', 'Vela', 'Orion', 'Mags'],
    color: '#378ADD',
    trait: 'Measures twice, plots the course.',
    pace: 16,
    quips: {
      start: ['Unrolling the charts.'],
      think: ['Plotting a course', 'Weighing the winds'],
      read: ['Studying {x}'],
      search: ['Taking soundings: {x}'],
      plan: ['Marking waypoints'],
      done: ['Course plotted!', 'Heading set, Captain.'],
      failed: ['Off the edge of the map!'],
    },
  },
  professor: {
    key: 'professor',
    role: 'Professor',
    names: ['Kelp', 'Sage', 'Quill', 'Tomes'],
    color: '#7F77DD',
    trait: 'Has read every manual twice.',
    pace: 10,
    quips: {
      start: ['Ahem. To the library!'],
      read: ['Consulting {x}'],
      web: ['Looking it up: {x}'],
      think: ['Fascinating, one moment'],
      done: ['Footnotes included.'],
      failed: ['The page is missing!'],
    },
  },
  signaller: {
    key: 'signaller',
    role: 'Signaller',
    names: ['Sparky', 'Dot', 'Morse'],
    color: '#BA7517',
    trait: 'Tinkers with the lights and signals.',
    pace: 8,
    quips: {
      start: ['Signals up!'],
      edit: ['Rewiring {x}'],
      shell: ['Testing the lamp: {x}'],
      done: ["Signal's lit!"],
    },
  },
  echo: {
    key: 'echo',
    role: 'Understudy',
    names: ['Echo', 'Mirror', 'Twin'],
    color: '#8F7CEC',
    trait: 'Knows everything the Captain knows.',
    pace: 20,
    quips: {
      start: ['Same brain, new claws.'],
      think: ['As the Captain would'],
      done: ['Echo complete.'],
    },
  },
  // The pool: other agent types are dealt one of these by name.
  cook: {
    key: 'cook',
    role: 'Cook',
    names: ['Cookie', 'Saffron', 'Basil'],
    color: '#D85A30',
    trait: 'Throws it all in the pan and flips.',
    pace: 20,
    quips: {
      start: ['Firing up the galley!'],
      edit: ['Stirring {x}', 'A pinch of {x}'],
      shell: ['Turning up the heat'],
      done: ['Order up!'],
      failed: ['Burnt the omelette!'],
    },
  },
  sleuth: {
    key: 'sleuth',
    role: 'Sleuth',
    names: ['Inky', 'Clue', 'Sherl'],
    color: '#A0703F',
    trait: 'Follows every clue to the end.',
    pace: 18,
    quips: {
      start: ['The game is afoot!'],
      search: ['Following the trail: {x}'],
      read: ['Examining {x}'],
      think: ['Connecting the dots'],
      done: ['Case closed.'],
      failed: ['The trail went cold.'],
    },
  },
  wizard: {
    key: 'wizard',
    role: 'Wizard',
    names: ['Merla', 'Coral', 'Zap'],
    color: '#7B6BD8',
    trait: 'Mutters spells at the code.',
    pace: 20,
    quips: {
      start: ['By my shell!'],
      edit: ['Enchanting {x}'],
      shell: ['Casting {x}'],
      think: ['Consulting the stars'],
      done: ['Ta-da!'],
      failed: ['The spell fizzled!'],
    },
  },
  diver: {
    key: 'diver',
    role: 'Diver',
    names: ['Bubbles', 'Finn', 'Marina'],
    color: '#2E8BC0',
    trait: 'Goes deep, comes up with treasure.',
    pace: 20,
    quips: {
      start: ['Taking the plunge!'],
      search: ['Diving for {x}'],
      read: ['Deep in {x}'],
      done: ['Surfaced with treasure!'],
      failed: ['Out of air!'],
    },
  },
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

/** The roster as the panel shows it: the standard crew first, then the pool. */
export const ROSTER: readonly { character: Character; types: string }[] = [
  { character: CHARACTERS.deckhand as Character, types: 'general-purpose' },
  { character: CHARACTERS.scout as Character, types: 'Explore' },
  { character: CHARACTERS.navigator as Character, types: 'Plan' },
  { character: CHARACTERS.professor as Character, types: 'claude-code-guide' },
  { character: CHARACTERS.signaller as Character, types: 'statusline-setup' },
  { character: CHARACTERS.echo as Character, types: 'fork' },
  ...POOL.map(k => ({ character: CHARACTERS[k] as Character, types: 'other agent types' })),
]

export const CAPTAIN = {
  name: 'Captain Clawd',
  role: 'main thread',
  color: '#4A6FB5',
  quips: {
    start: ['All hands!'],
    think: ['Charting the course'],
    read: ['Reviewing {x}'],
    search: ['Scanning the horizon: {x}'],
    edit: ['Taking the wheel: {x}'],
    shell: ['Full steam: {x}'],
    web: ['Signalling ashore: {x}'],
    delegate: ['Dispatching the crew: {x}'],
    plan: ['Updating the log'],
    other: ['At the helm'],
  } as Record<Activity, readonly string[]>,
  idle: 'Off watch, awaiting orders',
}

/** `savvy:helper` and `helper` name the same agent; the plugin prefix is dropped. */
export const bareType = (type: string): string => type.replace(/^[^:]*:/, '')

/** FNV-1a: a stable pick from a name, the same on every load. */
export const hash = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const characterKeyOf = (type: string): string => {
  const known = BY_TYPE[type] ?? BY_TYPE[bareType(type)]
  return known ?? POOL[hash(bareType(type)) % POOL.length] ?? 'deckhand'
}

export const characterOf = (key: string): Character => CHARACTERS[key] ?? (CHARACTERS.deckhand as Character)

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/** The next free name for this character: Pip, Wren, ..., then Pip II. */
export const crewNameOf = (key: string, crew: readonly CrewMember[]): string => {
  const { names } = characterOf(key)
  const taken = crew.filter(m => m.character === key).length
  const base = names[taken % names.length] ?? 'Crab'
  const round = Math.floor(taken / names.length) + 1
  return round > 1 ? `${base} ${ROMAN[round] ?? round}` : base
}

export const titleOf = (m: Pick<CrewMember, 'name' | 'character'>): string => `${m.name} the ${characterOf(m.character).role}`

// ---------------------------------------------------------------------------
// What a tool call says about a crab's activity.

export const activityOf = (tool: string): Activity => {
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

export const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s)

/** The call's target in a few characters: a file's name, a pattern, a command's head, a host. */
export const detailOf = (input: Record<string, unknown>): string => {
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

/**
 * Progress a standard agent reports without knowing it: its own todo list.
 * TodoWrite carries the whole list; TaskCreate and TaskUpdate are counted.
 */
export const todoPatch = (tool: string, input: Record<string, unknown>, m: CrewMember): Partial<CrewMember> => {
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

export const statusOf = (reason: string): CrewStatus =>
  reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'failed'

// ---------------------------------------------------------------------------
// Progress, pose and lines.

/** No call for this long while running: the crab waits, tapping a foot. */
export const STALL_MS = 20_000
/** A call this recent: the crab scurries. */
export const BURST_MS = 3_000
/** How long a crab that just finished celebrates. */
export const CHEER_MS = 6_000

export type Progress = { value: number; isEstimate: boolean }

/**
 * Real progress when the agent keeps a todo list; otherwise an estimate that
 * climbs with its tool calls toward 92% at the character's usual pace and
 * only reaches the flag when the agent is done.
 */
export const progressOf = (m: CrewMember): Progress => {
  if (m.status === 'done') return { value: 1, isEstimate: false }
  if (m.todoTotal) return { value: Math.min(1, (m.todoDone ?? 0) / m.todoTotal), isEstimate: false }
  const pace = characterOf(m.character).pace
  return { value: 0.92 * (1 - Math.exp(-(m.toolCalls + 0.5) / pace)), isEstimate: true }
}

export const progressLabel = (m: CrewMember): string => {
  if (m.status === 'done') return '100%'
  if (m.todoTotal) return `${Math.floor(m.todoDone ?? 0)}/${m.todoTotal} todos`
  return `≈${Math.round(progressOf(m).value * 100)}%`
}

export const poseOf = (m: CrewMember, at: number): Pose => {
  if (m.status === 'done') return at - (m.endedAt ?? 0) < CHEER_MS ? 'cheer' : 'rest'
  if (m.status === 'failed') return 'dizzy'
  if (m.status === 'stopped') return 'sleep'
  if (m.activity === 'think') return 'think'
  if (at - m.lastActiveAt > STALL_MS) return 'wait'
  return at - m.lastActiveAt < BURST_MS ? 'fast' : 'walk'
}

export const moodOf = (m: CrewMember, at: number): Mood => {
  if (m.status !== 'running') return m.status
  return poseOf(m, at) === 'wait' ? 'wait' : m.activity
}

const fill = (template: string, detail: string): string => template.replace('{x}', clip(detail, 24) || 'the code')

/** The crab's line: in character, and stable until it does something new. */
export const quipOf = (m: CrewMember, at: number): string => {
  const mood = moodOf(m, at)
  const list = characterOf(m.character).quips[mood] ?? GENERIC[mood]
  const i = hash(m.id + mood) + (m.status === 'running' ? m.toolCalls : 0)
  return fill(list[i % list.length] ?? '', m.detail)
}

export const captainQuip = (c: Captain): string => {
  if (!c.isBusy) return CAPTAIN.idle
  const list = CAPTAIN.quips[c.activity] ?? CAPTAIN.quips.other
  return fill(list[0] ?? '', c.detail)
}

/** What the crab is doing, plainly: the tool's target, or its todo in progress. */
export const actionOf = (m: CrewMember, at: number): string => {
  if (m.status === 'done') return 'back aboard'
  if (m.status === 'failed') return 'went overboard'
  if (m.status === 'stopped') return 'called back'
  if (m.todoNote) return m.todoNote
  if (m.activity === 'think') return 'thinking'
  if (m.activity === 'start') return 'setting out'
  const verb = { read: 'reading', search: 'searching', edit: 'editing', shell: 'running', web: 'browsing', delegate: 'delegating', plan: 'planning', other: 'working' }[m.activity]
  const waited = at - m.lastActiveAt > STALL_MS ? ` · waiting ${fmtTime(at - m.lastActiveAt)}` : ''
  return `${verb}${m.detail ? ' ' + m.detail : ''}${waited}`
}

// ---------------------------------------------------------------------------
// Formatting.

export const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '')
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

export const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

export const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const elapsed = (m: CrewMember, at: number): number => (m.endedAt ?? Math.max(at, m.startedAt)) - m.startedAt

export const crewTotals = (crew: readonly CrewMember[], at: number) => {
  const tokens = crew.reduce((s, m) => s + m.tokens, 0)
  const start = Math.min(...crew.map(m => m.startedAt))
  const end = Math.max(...crew.map(m => m.endedAt ?? Math.max(at, m.startedAt)))
  return {
    running: crew.filter(m => m.status === 'running').length,
    done: crew.filter(m => m.status === 'done').length,
    failed: crew.filter(m => m.status === 'failed').length,
    stopped: crew.filter(m => m.status === 'stopped').length,
    tokens,
    time: crew.length ? end - start : 0,
  }
}

export const crewSummary = (crew: readonly CrewMember[], at: number): string => {
  const t = crewTotals(crew, at)
  const parts = [
    t.running ? `${t.running} at work` : '',
    t.done ? `${t.done} back aboard` : '',
    t.failed ? `${t.failed} overboard` : '',
    t.stopped ? `${t.stopped} called back` : '',
  ].filter(Boolean)
  return parts.join(' · ') || 'no crew out'
}

/** Mean progress of the given crew, 0 to 1. */
export const crewProgress = (crew: readonly CrewMember[]): number =>
  crew.length ? crew.reduce((s, m) => s + (m.status === 'running' ? progressOf(m).value : 1), 0) / crew.length : 0
