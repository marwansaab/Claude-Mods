// discovery-desk: what the mod reads from a UX prototype, the walk packs Claude publishes, and the pane's state.

export type Os = 'ios' | 'android'
/** Text that may differ by phone: a string, or one per OS. */
export type OsText = string | { ios?: string; android?: string }

// ---------- the prototype, as read from disk (never written) ----------

export type Persona = {
  id: string
  name?: string
  initials?: string
  role?: string
  /** Where they play: country, state, phone. */
  team?: string
  archetype?: string
  status?: string
  summary?: string
}

export type Surface = { key: string; name: string; owner?: string; module?: OsText; where?: string }

/** A journey's entry in the register: persona, surfaces and chips live here only. */
export type JourneyEntry = {
  code: string
  title: string
  file: string
  persona?: string
  status?: string
  summary?: string
  surfaces: string[]
  questions: string[]
}

export type ItemKind = 'question' | 'decision' | 'adr' | 'other'

/** One Q-NN, D-NN or ADR the register mirrors. */
export type RegisterItem = { id: string; kind: ItemKind; status: string; title: string; detail?: string }

/** `prototype.js`: a mirror of the record, read for display. */
export type Register = {
  initiative: { id: string; name: string; vault?: string; overview?: string; catalogue?: string; storyMap?: string; features?: string }
  personas: Persona[]
  surfaces: Surface[]
  journeys: JourneyEntry[]
  items: RegisterItem[]
}

export type Callout = { text: OsText; tone?: string }

export type Step = {
  /** Its place among all the journey's steps, from 0 (the same on both phones). */
  index: number
  title: OsText
  caption: OsText
  actor?: string
  /** Shown on one phone only. */
  os?: Os
  /** The screen it starts on, and that screen's label (`Game · board`). */
  screen?: string
  screenLabel?: string
  chips: string[]
  callouts: Callout[]
}

/** A journey page's `Kit.journey({...})`. */
export type Journey = {
  code: string
  title: string
  file: string
  useCase?: OsText
  trigger?: OsText
  preconditions: OsText[]
  outcome?: OsText
  osNotes?: { ios?: string; android?: string }
  storyMap: string[]
  alsoInvolved: string[]
  steps: Step[]
  /** Why the page could not be read, when it could not. */
  problem?: string
}

export type InitiativeSummary = {
  id: string
  name: string
  /** The `UX Prototype` folder, absolute. */
  folder: string
  /** The same, relative to the project root. */
  rel: string
  journeys: number
  open: number
  proposed: number
  decided: number
  problem?: string
}

/** One initiative, open in the pane. */
export type Loaded = { folder: string; rel: string; register: Register; journeys: Record<string, Journey> }

// ---------- the owner's own walk notes, per initiative ----------

export type StepNote = { text?: string; isWalked?: boolean; os?: Os }

/** A question raised while walking: numbered by the desk, recorded by Claude in the record first. */
export type Raised = { id: string; text: string; journey: string; step: number; os: Os; at: string; sentAt?: string }

/** `notes/<initiative>.json`: keyed `J02/3` (journey, step index). */
export type Notes = { steps: Record<string, StepNote>; raised: Raised[]; updatedAt: string }

// ---------- walks: what Claude publishes for the owner ----------

export type Option = { id: string; label: string; description?: string }
/** A note the item touches: a risk, an assumption, an experiment, an ADR. */
export type Linked = { id: string; title?: string; status?: string; note?: string }
/** Where a chip shows in the journeys: journey code and step index. */
export type Appears = { journey: string; step: number; os?: Os }

/** What the desk fills in from the register when a Q, D or ADR card is published. */
export type Framed = {
  /** The item's status in the register when published. */
  status?: string
  registerTitle?: string
  appearsAt: Appears[]
  /** The id is not in the register. */
  isUnregistered?: boolean
  osDiff?: { ios?: string; android?: string }
  /** Markdown: the platform reference, risk or competitor evidence it rests on. */
  evidence?: string
  linked?: Linked[]
}

export type QuestionCard = Framed & {
  type: 'question'
  id: string
  title: string
  prompt: string
  context?: string
  options?: Option[]
  recommended?: string
  allowOther?: boolean
}

export type DecisionCard = Framed & {
  type: 'decision'
  id: string
  title: string
  proposal: string
  rationale?: string
  alternatives?: { label: string; reason?: string }[]
  consequences?: string
}

export type AdrCard = Framed & {
  type: 'adr'
  id: string
  title: string
  proposal: string
  /** Markdown: the clauses at stake. */
  clauses?: string
  alternatives?: { label: string; reason?: string }[]
}

/** A problem a check found, before it becomes a card. */
export type CheckFinding = {
  id: string
  source: 'desk' | 'validator'
  severity: 'high' | 'medium' | 'low'
  /** Where it is: a journey, a step, a surface. */
  where: string
  title: string
  body: string
  quote?: string
  /** The prototype differs from the record. */
  isDrift?: boolean
}

/** A drift or review finding: from the checks, or from Claude, with its quotes checked word for word. */
export type FindingCard = {
  type: 'finding'
  id: string
  title: string
  /** Markdown: what is wrong and why it matters. */
  body: string
  severity?: 'high' | 'medium' | 'low'
  /** `drift`: the prototype differs from the record; `review`: a judgement; `check`: a rule the checks enforce. */
  kind?: 'drift' | 'review' | 'check'
  /** A journey code, a step, or a file in the prototype folder. */
  where?: string
  /** Words from the prototype, found there when published. */
  quote?: string
  suggestion?: string
  /** Words from the record: a note's path and a quote found in it. */
  evidence?: { ref?: string; quote: string }
  /** The record could not be read, so `evidence.quote` was not checked. */
  isRecordUnchecked?: boolean
}

/** The last checks run on an initiative. */
export type CheckRun = { at: string; errors: number; warnings: number; ranValidator: boolean; problem?: string }

/** A file a walk was built from, and its fingerprint then. */
export type SourceMark = { path: string; label: string; hash: string }

export type PlanRow = { id: string; action: string; target: string; summary?: string }

/** A vault write plan or a closing checklist: the owner says yes or no per row. */
export type PlanCard = { type: 'plan'; id: string; title: string; intro?: string; rows: PlanRow[] }

export type Card = QuestionCard | DecisionCard | AdrCard | PlanCard | FindingCard
export type CardType = Card['type']

export type Walk = {
  schema: 1
  id: string
  title: string
  initiative: { id: string; name: string; rel: string }
  journeys: string[]
  summary?: string
  label?: string
  createdAt: string
  origin?: string
  /** The files it was built from, fingerprinted, so the desk can say when one changed. */
  sources?: SourceMark[]
  cards: Card[]
}

/** The owner's response to a card or a plan row (keyed `card` or `card/row`). */
export type Response = {
  /** An option id, `other`, or a verb: approve, amend, reject, decide, keep, go, cancel. */
  choice?: string
  /** A question's status word (decided, deferred, withdrawn…). */
  status?: string
  /** The answer has alternatives worth an ADR of its own. */
  toAdr?: boolean
  text?: string
  rows?: Record<string, boolean>
}

export type Ask = {
  id: string
  question: string
  answer?: string
  card?: string
  about?: string
  at: string
  answeredAt?: string
  sources?: { title: string; url?: string }[]
}

export type Draft = { responses: Record<string, Response>; asks: Ask[]; updatedAt: string }

export type WalkStatus = 'pending' | 'reviewed'

export type WalkSummary = {
  id: string
  title: string
  label?: string
  initiative: string
  journeys: string[]
  status: WalkStatus
  createdAt: string
  submittedAt?: string
  cards: number
  answered: number
  isBroken?: boolean
}

export type OpenWalk = {
  walk: Walk
  draft: Draft
  status: WalkStatus
  submittedAt?: string
  /** Sources that changed after the walk was published (their labels). */
  stale?: string[]
}

/** How a step is shown: everything, the captions alone, the chips alone, or all but the callouts. */
export type StepView = 'all' | 'captions' | 'chips' | 'no-notes'

export type DeskView = {
  screen: 'home' | 'initiative' | 'journey' | 'walk'
  tab: WalkStatus
  /** The initiative open (its `UX Prototype` folder). */
  initiative?: string
  journey?: string
  /** The step index shown, per journey. */
  step: Record<string, number>
  os: Os
  stepView: StepView
  isContextOpen: boolean
  isPlaying: boolean
  /** The walk open; a journey opened from it returns to it. */
  openId?: string
  openStatus?: WalkStatus
  card: number
  part: Record<string, number>
  planView?: Record<string, 'list' | 'one'>
  isSummaryOpen: boolean
  isConfirming: boolean
  showAllAsks: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'discovery-desk': {
      initiatives: InitiativeSummary[]
      walks: WalkSummary[]
      view: DeskView
      loaded: Loaded | null
      notes: Notes | null
      open: OpenWalk | null
      /** What is typed in the pane's fields, not yet committed; never drawn from. */
      typing: Record<string, string>
      root: string
      /** The last checks per initiative folder. */
      checks: Record<string, CheckRun>
      /** Prototype folders Claude edited this turn, to check when it ends. */
      dirty: string[]
      /** Whether the record was written this turn (the vault-first guard). */
      recordWritten: boolean
    }
  }
}
