// review-desk: the review pack format and the pane's state contract.

/** Evidence grade: A primary or official … D inferred or unsourced. */
export type Grade = 'A' | 'B' | 'C' | 'D'

/** Colour meaning on a card or a scene element (the explainer engine's palette). */
export type Tone = 'subject' | 'context' | 'risk' | 'question' | 'decision' | 'good'

/** A graded claim a card or a scene element points at by id (`C3`). */
export type Claim = {
  id: string
  text: string
  grade?: Grade
  /** Publisher and title, or the id of the note or file that holds the claim. */
  source?: string
  url?: string
  /** ISO date the source was checked. */
  checked?: string
}

/** A note or file the pack mirrors: the record, never the pack. */
export type SourceRef = {
  id?: string
  title?: string
  path?: string
  /** The note's `updated` date when the pack was built. */
  updated?: string
}

export type Option = { id: string; label: string; description?: string }

export type QuestionCard = {
  type: 'question'
  id: string
  title: string
  /** Markdown: the question, in plain words. */
  prompt: string
  /** Markdown: why it matters, what is known. */
  context?: string
  options?: Option[]
  /** The option id Claude recommends, if any. */
  recommended?: string
  /** A free-text answer besides the options (default true). */
  allowOther?: boolean
  claims?: string[]
}

export type DecisionCard = {
  type: 'decision'
  id: string
  title: string
  /** Markdown: what is proposed. */
  proposal: string
  rationale?: string
  alternatives?: { label: string; reason?: string }[]
  consequences?: string
  claims?: string[]
}

export type FindingCard = {
  type: 'finding'
  id: string
  title: string
  /** Markdown: what is wrong and why it matters. */
  body: string
  severity?: 'high' | 'medium' | 'low'
  /** `drift`: differs from the record; `review`: reviewer judgement. */
  kind?: 'drift' | 'review'
  /** Where it is: a slide, a section, a file. */
  where?: string
  quote?: string
  suggestion?: string
  evidence?: { ref?: string; quote: string }
  claims?: string[]
}

export type PlanRow = { id: string; action: string; target: string; summary?: string }

/** A write plan or change list: the owner picks the rows to go ahead with. */
export type PlanCard = {
  type: 'plan'
  id: string
  title: string
  intro?: string
  rows: PlanRow[]
}

export type SceneItem = { title: string; text?: string; tone?: Tone; claim?: string }

/** An animated diagram, drawn by the mod from data. */
export type Scene =
  | { kind: 'cards'; items: SceneItem[] }
  | { kind: 'flow'; items: SceneItem[] }
  | { kind: 'list'; items: SceneItem[] }
  | { kind: 'timeline'; items: SceneItem[] }
  | { kind: 'funnel'; items: { label: string; value?: string; tone?: Tone; claim?: string }[] }
  | {
      kind: 'bars'
      items: { label: string; value: number; display?: string; tone?: Tone; claim?: string }[]
      max?: number
      mark?: { value: number; label?: string }
    }
  | { kind: 'tiles'; items: { value: string; label: string; tone?: Tone; claim?: string }[] }
  | { kind: 'compare'; columns: string[]; rows: { label: string; cells: string[]; tone?: Tone }[] }
  | {
      kind: 'matrix'
      x: string
      y: string
      quadrants?: string[]
      dots: { label: string; x: number; y: number; tone?: Tone; claim?: string }[]
    }

export type ExplainerStep = {
  id?: string
  title: string
  /** Markdown: why this step matters, not only what it shows. */
  caption: string
  scene?: Scene
  claims?: string[]
}

export type ExplainerCard = {
  type: 'explainer'
  id: string
  title: string
  intro?: string
  steps: ExplainerStep[]
}

export type ReadSection = {
  id: string
  title: string
  /** Markdown, shown exactly as given. */
  body: string
  /** Lines only the owner can confirm ("Your call"). */
  flags?: string[]
}

/** A long text read section by section, with a note and a tick per section. */
export type ReadCard = {
  type: 'read'
  id: string
  title: string
  intro?: string
  sections: ReadSection[]
}

export type Card = QuestionCard | DecisionCard | FindingCard | PlanCard | ExplainerCard | ReadCard
export type CardType = Card['type']

/** What Claude publishes: one review for the owner, saved as `pack.json`. */
export type Pack = {
  schema: 1
  id: string
  title: string
  /** Markdown: what this review is for and what is being asked. */
  summary?: string
  /** A short label: "Open questions", "Write plan", "Deck review". */
  label?: string
  createdAt: string
  /** The skill or task that published it. */
  origin?: string
  sources?: SourceRef[]
  claims?: Claim[]
  cards: Card[]
}

/** The owner's response to a card, a step or a section (keyed `card` or `card/part`). */
export type Response = {
  /** An option id, `other`, or the card's verb: approve, reject, amend, accept, discuss, go, cancel. */
  choice?: string
  /** A free answer, an amendment, a reply or a note. */
  text?: string
  /** A step understood, a section reviewed. */
  isDone?: boolean
  /** Plan rows to go ahead with. */
  rows?: Record<string, boolean>
}

/** A question asked from the pane, and its answer. */
export type Ask = {
  id: string
  question: string
  answer?: string
  /** The card it was asked about (absent on questions asked before cards kept their own threads). */
  card?: string
  /** What it was asked about: a card title and part. */
  about?: string
  at: string
  /** `quick`: answered in the panel by older versions; every question now goes to the session. */
  via: 'quick' | 'session'
  isError?: boolean
  /** When Claude in the session put its answer on the card. */
  answeredAt?: string
  /** What a session answer drew on. */
  sources?: { title: string; url?: string }[]
}

/** The owner's work on a pack so far, saved as `draft.json` beside it. */
export type Draft = {
  responses: Record<string, Response>
  asks: Ask[]
  updatedAt: string
}

export type PackStatus = 'pending' | 'reviewed'

/** One row of the pane's list. */
export type PackSummary = {
  id: string
  title: string
  label?: string
  status: PackStatus
  createdAt: string
  submittedAt?: string
  cards: number
  answered: number
  types: CardType[]
  isBroken?: boolean
}

export type DeskView = {
  tab: PackStatus
  /** The pack open in the pane; none shows the list. */
  openId?: string
  openStatus?: PackStatus
  card: number
  /** The step or section shown, per explainer or read card. */
  part: Record<string, number>
  isSummaryOpen: boolean
  isConfirming: boolean
  /** Cards whose "Ask about this card" section is open. */
  askOpen: Record<string, boolean>
  showAllAsks: boolean
  message?: string
}

/** The pack open in the pane, as loaded from disk. */
export type OpenPack = {
  pack: Pack
  draft: Draft
  status: PackStatus
  submittedAt?: string
}

declare module 'claude-code' {
  interface PluginState {
    'review-desk': {
      packs: PackSummary[]
      view: DeskView
      open: OpenPack | null
      /** What is typed in the pane's fields, not yet committed; never drawn from. */
      typing: Record<string, string>
      root: string
    }
  }
}
