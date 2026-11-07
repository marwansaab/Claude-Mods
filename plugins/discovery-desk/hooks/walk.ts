// Walks: the cards Claude publishes for one initiative (questions, decisions, ADRs, plans), their
// progress, the outcome handed back, and the prompts the desk sends to Claude.
// The card and outcome code is adapted from review-desk's pack.ts.
import type { Card, CardType, Draft, Journey, Loaded, Notes, Os, Raised, Register, RegisterItem, Response, Walk, WalkStatus, WalkSummary } from '../types'
import { OS_LABEL, appearsAt, htmlToMd, isUndecided, kindOf, nearestStep, pick, stepsOn } from './prototype'
import type { Vocab } from './prototype'

export const CARD_TYPES: readonly CardType[] = ['question', 'decision', 'adr', 'plan']
const MAX_CARDS = 80
const MAX_PARTS = 60

export const TYPE_LABEL: Record<CardType, string> = { question: 'Question', decision: 'Decision', adr: 'ADR', plan: 'Plan' }

export const emptyDraft = (at = ''): Draft => ({ responses: {}, asks: [], updatedAt: at })
export const emptyNotes = (at = ''): Notes => ({ steps: {}, raised: [], updatedAt: at })

/** A folder-safe id: letters, digits, `-` and `_`, at most 64. */
export function safeId(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

/** A card id keeps the record's own spelling (`ADR-v-056`), less anything unsafe. */
const cardId = (raw: string) => raw.trim().replace(/[^\w.-]+/g, '-').slice(0, 64)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

// ---------- validation ----------

/** What a walk is checked against: the initiative as read from disk. */
export type WalkContext = { loaded: Loaded; vocab: Vocab }

const itemOf = (register: Register, id: string) => register.items.find(i => i.id === id)

function cleanCard(raw: unknown, n: number, seen: Set<string>, ctx: WalkContext, problems: string[], notes: string[]): Card | undefined {
  const where = `cards[${n}]`
  if (!isObj(raw)) {
    problems.push(`${where}: must be an object`)
    return undefined
  }
  const type = raw.type as CardType
  if (!CARD_TYPES.includes(type)) {
    problems.push(`${where}: "type" must be one of ${CARD_TYPES.join(', ')}`)
    return undefined
  }
  const parts = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]).slice(0, MAX_PARTS) : [])
  const need = (key: string, at: string) => {
    const v = str(raw[key])
    if (v === undefined) problems.push(`${at}: "${key}" is required text`)
    return v ?? ''
  }

  if (type === 'plan') {
    let id = cardId(str(raw.id) ?? '') || `plan-${n + 1}`
    while (seen.has(id)) id = `${id}-${n + 1}`
    seen.add(id)
    const at = `${where} (${id})`
    const rows = parts('rows')
      .filter(isObj)
      .map((o, i) => ({ id: safeId(str(o.id) ?? '') || `r${i + 1}`, action: str(o.action) ?? 'change', target: str(o.target) ?? str(o.path) ?? '', summary: str(o.summary) }))
      .filter(r => r.target)
    if (!rows.length) problems.push(`${at}: a plan needs rows, each with a "target"`)
    return { type, id, title: need('title', at), intro: str(raw.intro), rows }
  }

  // A question, a decision or an ADR: framed from the register.
  const id = cardId(str(raw.id) ?? '')
  const at = `${where}${id ? ` (${id})` : ''}`
  if (!id) {
    problems.push(`${at}: "id" is required: the ${type === 'question' ? ctx.vocab.q : type === 'decision' ? ctx.vocab.d : ctx.vocab.adr}NN it is about`)
    return undefined
  }
  if (seen.has(id)) {
    problems.push(`${at}: ${id} has a card already`)
    return undefined
  }
  seen.add(id)
  const kind = kindOf(id, ctx.vocab)
  if (kind !== 'other' && kind !== type) problems.push(`${at}: a ${type} card, but ${id} reads as ${kind === 'adr' ? 'an ADR' : `a ${kind}`}`)
  const item = itemOf(ctx.loaded.register, id)
  if (!item) notes.push(`${id} is not in the register (prototype.js); its card says so`)
  const title = str(raw.title) ?? item?.title
  if (!title) problems.push(`${at}: "title" is required (${id} is not in the register to take it from)`)
  const osDiff = isObj(raw.osDiff) && (str(raw.osDiff.ios) || str(raw.osDiff.android)) ? { ios: str(raw.osDiff.ios), android: str(raw.osDiff.android) } : undefined
  const linked = parts('linked')
    .filter(isObj)
    .map(o => ({ id: str(o.id) ?? '', title: str(o.title), status: str(o.status), note: str(o.note) }))
    .filter(l => l.id)
  const alternatives = parts('alternatives')
    .filter(isObj)
    .map(o => ({ label: str(o.label) ?? '', reason: str(o.reason) }))
    .filter(o => o.label)
  const framed = {
    id,
    title: title ?? id,
    status: item?.status,
    registerTitle: item?.title,
    appearsAt: appearsAt(Object.values(ctx.loaded.journeys), id),
    isUnregistered: item ? undefined : true,
    osDiff,
    evidence: str(raw.evidence),
    linked: linked.length ? linked : undefined,
  }
  switch (type) {
    case 'question': {
      const options = parts('options')
        .filter(isObj)
        .map((o, i) => ({ id: safeId(str(o.id) ?? '') || `o${i + 1}`, label: str(o.label) ?? '', description: str(o.description) }))
        .filter(o => o.label)
      const recommended = str(raw.recommended)
      return {
        type,
        ...framed,
        prompt: need('prompt', at),
        context: str(raw.context),
        options: options.length ? options : undefined,
        recommended: options.some(o => o.id === recommended) ? recommended : undefined,
        allowOther: raw.allowOther !== false,
      }
    }
    case 'decision':
      return { type, ...framed, proposal: need('proposal', at), rationale: str(raw.rationale), alternatives, consequences: str(raw.consequences) }
    case 'adr':
      return { type, ...framed, proposal: need('proposal', at), clauses: str(raw.clauses), alternatives }
  }
}

/** Checks and tidies what Claude sent against the initiative; problems are returned to fix, never guessed past. */
export function cleanWalk(raw: unknown, isoNow: string, ctx: WalkContext): { walk?: Walk; problems: string[]; notes: string[] } {
  const problems: string[] = []
  const notes: string[] = []
  if (!isObj(raw)) return { problems: ['the input must be an object'], notes }
  const title = str(raw.title)
  if (!title) problems.push('walk: "title" is required text')
  const rawCards = Array.isArray(raw.cards) ? raw.cards : []
  if (!rawCards.length) problems.push('walk: "cards" must list at least one card')
  if (rawCards.length > MAX_CARDS) problems.push(`walk: at most ${MAX_CARDS} cards (split it into several walks)`)
  const register = ctx.loaded.register
  const journeys = (Array.isArray(raw.journeys) ? raw.journeys : []).filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim())
  const unknown = journeys.filter(code => !register.journeys.some(j => j.code === code))
  if (unknown.length) problems.push(`walk: no journey ${unknown.join(', ')} in the register (it has ${register.journeys.map(j => j.code).join(', ') || 'none'})`)
  const seen = new Set<string>()
  const cards = rawCards
    .slice(0, MAX_CARDS)
    .map((c, i) => cleanCard(c, i, seen, ctx, problems, notes))
    .filter((c): c is Card => !!c)
  if (problems.length) return { problems, notes }
  const day = isoNow.slice(0, 10)
  const given = typeof raw.id === 'string' ? safeId(raw.id) : ''
  return {
    problems,
    notes,
    walk: {
      schema: 1,
      id: given || safeId(`${register.initiative.id}-${day}-${title}`) || `walk-${day}`,
      title: title!,
      initiative: { id: register.initiative.id, name: register.initiative.name, rel: ctx.loaded.rel },
      journeys,
      summary: str(raw.summary),
      label: str(raw.label),
      createdAt: isoNow,
      origin: str(raw.origin),
      cards,
    },
  }
}

/** A walk read back from disk: trusted to the extent that it has the shape. */
export function readWalk(text: string): Walk | undefined {
  try {
    const raw = JSON.parse(text)
    if (!isObj(raw) || raw.schema !== 1 || !Array.isArray(raw.cards) || typeof raw.title !== 'string' || !isObj(raw.initiative)) return undefined
    const cards = (raw.cards as unknown[]).filter((c): c is Card => isObj(c) && CARD_TYPES.includes(c.type as CardType) && typeof c.id === 'string')
    return { ...(raw as unknown as Walk), journeys: Array.isArray(raw.journeys) ? (raw.journeys as string[]) : [], cards }
  } catch {
    return undefined
  }
}

export function readDraft(text: string | undefined): Draft {
  if (!text) return emptyDraft()
  try {
    const raw = JSON.parse(text)
    return {
      responses: isObj(raw.responses) ? (raw.responses as Record<string, Response>) : {},
      asks: Array.isArray(raw.asks) ? raw.asks : [],
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    }
  } catch {
    return emptyDraft()
  }
}

export function readNotes(text: string | undefined): Notes {
  if (!text) return emptyNotes()
  try {
    const raw = JSON.parse(text)
    return {
      steps: isObj(raw.steps) ? (raw.steps as Notes['steps']) : {},
      raised: Array.isArray(raw.raised) ? raw.raised : [],
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    }
  } catch {
    return emptyNotes()
  }
}

// ---------- progress ----------

export type CardState = 'open' | 'partial' | 'done'

const hasText = (r: Response | undefined) => !!r?.text?.trim()
export const partKey = (cardId: string, partId: string) => `${cardId}/${partId}`
/** A plan row goes ahead unless the owner unticked it. */
export const rowIsOn = (r: Response | undefined, rowId: string) => r?.rows?.[rowId] ?? true

/** Whether the owner has answered a card: wholly, in part, or not yet. */
export function cardState(card: Card, draft: Draft, vocab: Vocab): CardState {
  const r = draft.responses[card.id]
  switch (card.type) {
    case 'question': {
      const hasAnswer = (!!r?.choice && r.choice !== 'other') || hasText(r)
      if (r?.status) return r.status === vocab.qStatuses[1] && !hasAnswer ? 'partial' : 'done'
      return hasAnswer || r?.choice ? 'partial' : 'open'
    }
    case 'decision':
    case 'adr':
      return r?.choice === 'amend' ? (hasText(r) ? 'done' : 'partial') : r?.choice ? 'done' : hasText(r) ? 'partial' : 'open'
    case 'plan':
      return r?.choice ? 'done' : (r?.rows && Object.keys(r.rows).length) || hasText(r) ? 'partial' : 'open'
  }
}

export const answeredCount = (walk: Walk, draft: Draft, vocab: Vocab) => walk.cards.filter(c => cardState(c, draft, vocab) === 'done').length

export function summaryOf(walk: Walk, draft: Draft, status: WalkStatus, vocab: Vocab, submittedAt?: string): WalkSummary {
  return {
    id: walk.id,
    title: walk.title,
    label: walk.label,
    initiative: walk.initiative.id,
    journeys: walk.journeys,
    status,
    createdAt: walk.createdAt,
    submittedAt,
    cards: walk.cards.length,
    answered: answeredCount(walk, draft, vocab),
  }
}

// ---------- the outcome ----------

const VERB: Record<string, string> = {
  approve: 'Approved',
  amend: 'Approved with changes',
  reject: 'Rejected',
  decide: 'Decided in place',
  keep: 'Kept proposed',
  go: 'Go ahead',
  cancel: 'Cancelled',
}

/** The status a decision or ADR verb leaves the item in, in the project's own words. */
export function statusAfter(card: Card, choice: string | undefined, vocab: Vocab): string | undefined {
  if (card.type === 'decision') return choice === 'approve' || choice === 'amend' ? vocab.dStatuses[1] : choice === 'reject' ? vocab.dStatuses[2] : undefined
  if (card.type === 'adr') return choice === 'decide' || choice === 'amend' ? vocab.adrStatuses[1] : choice === 'keep' ? vocab.adrStatuses[0] : undefined
  return undefined
}

/** The owner's response to one card, as Markdown bullet lines. */
export function cardOutcome(card: Card, draft: Draft, vocab: Vocab): string[] {
  const r = draft.responses[card.id]
  const lines: string[] = []
  const note = (label: string, t?: string) => t?.trim() && lines.push(`- **${label}:** ${t.trim().replace(/\n+/g, ' ')}`)
  switch (card.type) {
    case 'question': {
      const picked = card.options?.find(o => o.id === r?.choice)
      if (picked) lines.push(`- **Answer:** ${picked.label}${picked.id === card.recommended ? ' (the recommended option)' : ''}`)
      else if (hasText(r)) lines.push(`- **Answer:** ${r!.text!.trim().replace(/\n+/g, ' ')}`)
      else lines.push('- **Answer:** _none given_')
      lines.push(`- **Status:** ${r?.status ? `\`${r.status}\`` : `_unchanged_ (\`${card.status ?? 'not in the register'}\`)`}`)
      if (r?.toAdr) lines.push('- **Becomes an ADR:** yes. The answer has alternatives worth recording: write a new ADR and link it from the row.')
      if (picked) note('Comment', r?.text)
      break
    }
    case 'decision':
    case 'adr': {
      const after = statusAfter(card, r?.choice, vocab)
      lines.push(`- **${card.type === 'adr' ? 'ADR' : 'Decision'}:** ${r?.choice ? `${VERB[r.choice] ?? r.choice}${after ? ` → \`${after}\`` : ''}` : '_undecided_'}`)
      note(r?.choice === 'amend' ? 'Changes' : card.type === 'decision' ? "Owner's call" : 'Comment', r?.text)
      break
    }
    case 'plan': {
      const rows = card.rows.map(row => ({ row, isOn: rowIsOn(r, row.id) }))
      const on = rows.filter(x => x.isOn)
      const verdict = r?.choice === 'cancel' ? 'Cancelled: write nothing' : !r?.choice ? '_undecided_' : on.length === rows.length ? 'Go ahead with every row' : `Go ahead with ${on.length} of ${rows.length} rows`
      lines.push(`- **Plan:** ${verdict}`)
      if (r?.choice && r.choice !== 'cancel')
        for (const { row, isOn } of rows) {
          lines.push(`  - [${isOn ? 'x' : ' '}] ${row.action} \`${row.target}\`${row.summary ? ` — ${row.summary}` : ''}`)
          const c = draft.responses[partKey(card.id, row.id)]?.text?.trim()
          if (c) lines.push(`    - Comment: ${c.replace(/\n+/g, ' ')}`)
        }
      note('Comment', r?.text)
      break
    }
  }
  return lines
}

/** One card as Markdown for the clipboard. */
export function cardText(walk: Walk, card: Card, draft: Draft, vocab: Vocab): string {
  const out = [`## ${card.id}: ${card.title}`, '', `_${TYPE_LABEL[card.type]} · ${walk.initiative.id} · ${walk.title}_`, '']
  const add = (...parts: (string | undefined | false)[]) => parts.forEach(x => x && out.push(x, ''))
  if (card.type !== 'plan') {
    if (card.type === 'question') add(card.prompt, card.context, ...(card.options ?? []).map(o => `- ${o.label}${o.description ? ` (${o.description})` : ''}${o.id === card.recommended ? ' (recommended)' : ''}`))
    else add(card.proposal, card.type === 'decision' && card.rationale && `**Why:** ${card.rationale}`, card.type === 'adr' && card.clauses, ...(card.alternatives ?? []).map(a => `- Not chosen: ${a.label}${a.reason ? ` (${a.reason})` : ''}`))
    add(osDiffText(card.osDiff), card.evidence && `**Evidence:** ${card.evidence}`, !!card.linked?.length && `**Linked:** ${card.linked.map(l => `${l.id}${l.title ? ` ${l.title}` : ''}${l.status ? ` (${l.status})` : ''}`).join('; ')}`)
  } else add(card.intro, card.rows.map(r => `- [${rowIsOn(draft.responses[card.id], r.id) ? 'x' : ' '}] ${r.action} \`${r.target}\`${r.summary ? `: ${r.summary}` : ''}`).join('\n'))
  const response = cardOutcome(card, draft, vocab)
  if (response.length) add('**Response**', response.join('\n'))
  return out.join('\n').trim()
}

export function osDiffText(d: { ios?: string; android?: string } | undefined): string | undefined {
  if (!d || (!d.ios && !d.android)) return undefined
  return `**On iOS:** ${d.ios ?? 'the same'}\n\n**On Android:** ${d.android ?? 'the same'}`
}

/** Where a step sits on a phone: `step 4 of 12 on iOS`. */
export function stepPlace(j: Journey | undefined, index: number, os: Os): string {
  if (!j) return `step ${index + 1}`
  const on = stepsOn(j, os)
  const at = on.findIndex(st => st.index === index)
  return at >= 0 ? `step ${at + 1} of ${on.length} on ${OS_LABEL[os]}` : `step ${index + 1} (not shown on ${OS_LABEL[os]})`
}

/** The polishing-log line, drafted from the walk: journeys walked (on which phones), and what was settled. */
export function polishingLine(walk: Walk, draft: Draft, notes: Notes, vocab: Vocab, submittedAt: string): string {
  const walked = walk.journeys.map(code => {
    const oses = [...new Set(Object.entries(notes.steps).filter(([k, n]) => k.startsWith(`${code}/`) && n.isWalked && n.os).map(([, n]) => n.os as Os))]
    return `${code}${oses.length ? ` (${oses.map(o => OS_LABEL[o]).join(', ')})` : ''}`
  })
  const ids = (pred: (c: Card, r: Response | undefined) => boolean) => walk.cards.filter(c => pred(c, draft.responses[c.id])).map(c => c.id)
  const decided = ids((c, r) => c.type === 'question' && r?.status === vocab.qStatuses[1])
  const toAdr = ids((c, r) => c.type === 'question' && !!r?.toAdr)
  // Questions set aside, each with its own status word (deferred, withdrawn…).
  const setAside = walk.cards
    .filter(c => c.type === 'question')
    .map(c => ({ id: c.id, status: draft.responses[c.id]?.status }))
    .filter(x => x.status && x.status !== vocab.qStatuses[0] && x.status !== vocab.qStatuses[1])
    .map(x => `${x.id} ${x.status}`)
  const accepted = ids((c, r) => c.type === 'decision' && (r?.choice === 'approve' || r?.choice === 'amend'))
  const rejected = ids((c, r) => c.type === 'decision' && r?.choice === 'reject')
  const adrs = ids((c, r) => c.type === 'adr' && (r?.choice === 'decide' || r?.choice === 'amend'))
  const parts = [
    walked.length ? `${walked.join(', ')} walked` : '',
    decided.length ? `${decided.join(', ')} decided${toAdr.length ? ` (new ADR for ${toAdr.join(', ')})` : ''}` : '',
    setAside.join(', '),
    accepted.length ? `${accepted.join(', ')} accepted` : '',
    rejected.length ? `${rejected.join(', ')} rejected` : '',
    adrs.length ? `${adrs.join(', ')} decided` : '',
  ].filter(Boolean)
  return `- **${submittedAt.slice(0, 10)}** — ${parts.join(' · ') || 'walked, nothing settled'}`
}

/** The order an outcome is applied in: the record first, then the prototype that mirrors it. */
export function applyOrder(vault: string | undefined): string[] {
  const record = vault ? `the vault \`${vault}\`` : 'the record'
  return [
    `1. **The record first,** in ${record}: each question's catalogue row (the answer in a sentence, with the date, and its status); each proposed decision's status and the owner's call.`,
    '2. **ADRs:** an answer marked "becomes an ADR" gets a new ADR with its alternatives, linked from its row. A proposed ADR the owner decides flips in place: its status, the date decided, the changed clauses, and the old text under *History*.',
    '3. **The feature set and the story map:** the rows, slices or steps the answers change. A row that hung on a now-decided ADR stops being proposed.',
    '4. **Risks, assumptions and experiments** the answers verify, falsify, raise or retire: status, body and *History*, now rather than at the end. Never change an agreed experiment threshold.',
    '5. **Questions raised while walking** become new rows, numbered after the last. The desk\'s numbers are proposals: check the record\'s highest first, and never reuse a number.',
    '6. **Only then mirror** into the prototype: `prototype.js` statuses and details, then the journeys\' screens and captions on both phones, and any other journey the decisions change.',
    '7. **Add the polishing-log line** below to the catalogue, and run the project\'s prototype checks.',
    '',
    "Never change an initiative's score or verdict: they are the owner's. If an answer bears on them, say so in the handover.",
  ]
}

export type OutcomeExtras = { notes: Notes; raised: Raised[]; loaded: Loaded | null; vault?: string }

/** The outcome as Markdown, for Claude to apply in the record first. */
export function outcomeMarkdown(walk: Walk, draft: Draft, submittedAt: string, vocab: Vocab, extras: OutcomeExtras): string {
  const j = (code: string) => extras.loaded?.journeys[code]
  const out = [
    `# Walk outcome: ${walk.title}`,
    '',
    `- Walk: \`${walk.id}\`${walk.label ? ` (${walk.label})` : ''}`,
    `- Initiative: ${walk.initiative.id} ${walk.initiative.name} (\`${walk.initiative.rel}\`)`,
    ...(walk.journeys.length ? [`- Journeys: ${walk.journeys.map(c => `${c}${j(c) ? ` ${j(c)!.title}` : ''}`).join('; ')}`] : []),
    `- Published: ${walk.createdAt}${walk.origin ? ` by ${walk.origin}` : ''}`,
    `- Submitted: ${submittedAt}`,
    `- Responded to: ${answeredCount(walk, draft, vocab)} of ${walk.cards.length} cards`,
    '',
  ]
  for (const card of walk.cards) {
    out.push(`## ${card.id}: ${card.title} (${TYPE_LABEL[card.type].toLowerCase()})`, '')
    out.push(...cardOutcome(card, draft, vocab), '')
  }
  if (extras.raised.length) {
    out.push('## Questions raised while walking', '')
    for (const q of extras.raised) out.push(`- **${q.id}** (proposed number) · ${q.journey}, ${stepPlace(j(q.journey), q.step, q.os)}: ${q.text.replace(/\n+/g, ' ')}`)
    out.push('')
  }
  const stepNotes = Object.entries(extras.notes.steps)
    .filter(([k, n]) => walk.journeys.includes(k.split('/')[0] ?? '') && n.text?.trim())
    .map(([k, n]) => {
      const [code, idx] = k.split('/')
      const journey = j(code ?? '')
      const step = journey?.steps[Number(idx)]
      return `- ${code}, ${stepPlace(journey, Number(idx), n.os ?? 'ios')}${step ? ` (${htmlToMd(pick(step.title, n.os ?? 'ios'))})` : ''}: ${n.text!.trim().replace(/\n+/g, ' ')}`
    })
  if (stepNotes.length) out.push('## Notes on steps', '', ...stepNotes, '')
  const asks = draft.asks.filter(a => a.question)
  if (asks.length) {
    out.push('## Questions asked during the walk', '')
    for (const a of asks) {
      out.push(`- **Q${a.about ? ` (${a.about})` : ''}:** ${a.question.replace(/\n+/g, ' ')}`)
      out.push(a.answer ? `  - A: ${a.answer.replace(/\n+/g, ' ')}` : '  - No answer was put on the card.')
      for (const s of a.sources ?? []) out.push(`    - Source: ${s.url ? `[${s.title}](${s.url})` : s.title}`)
    }
    out.push('')
  }
  out.push('## Polishing log (draft)', '', polishingLine(walk, draft, extras.notes, vocab, submittedAt), '')
  out.push('## How to apply, in this order', '', ...applyOrder(extras.vault), '')
  return out.join('\n')
}

export function outcomeJson(walk: Walk, draft: Draft, submittedAt: string, vocab: Vocab, extras: OutcomeExtras) {
  return {
    schema: 1,
    walk: walk.id,
    title: walk.title,
    initiative: walk.initiative,
    journeys: walk.journeys,
    submittedAt,
    cards: walk.cards.map(c => ({ id: c.id, type: c.type, title: c.title, state: cardState(c, draft, vocab), statusAfter: c.type === 'question' ? draft.responses[c.id]?.status : statusAfter(c, draft.responses[c.id]?.choice, vocab) })),
    responses: draft.responses,
    raised: extras.raised,
    asks: draft.asks,
    polishingLog: polishingLine(walk, draft, extras.notes, vocab, submittedAt),
  }
}

// ---------- prompts to Claude ----------

export function handOffPrompt(walk: Walk, outcomePath: string): string {
  return [
    `I submitted the walk "${walk.title}" (\`${walk.id}\`, ${walk.initiative.id}) in the discovery desk.`,
    `The outcome is in \`${outcomePath}\`. Read it and apply it in the order it gives: the record first, then the prototype that mirrors it, following this project's own rules.`,
    'Before the first write, put the write plan on the discovery desk with publish_walk as a plan card: one row per note or file, with its path, its id and the evidence for that id, and its purpose. Write only the rows I approve.',
    'When it is applied, put the closing checklist on the desk as a plan card: the handover names the initiative, the gate position is stated, the architecture is checked, every new id is verified, the prototype checks pass, and every changed journey was stepped through on iOS and Android.',
    'Drop rejected and cancelled items; treat amendments, comments and set-aside questions as things to settle with me first.',
  ].join('\n')
}

/** Asks Claude to put a journey's undecided chips up for the owner, as one walk. */
export function polishPrompt(loaded: Loaded, code: string, vocab: Vocab): string {
  const entry = loaded.register.journeys.find(j => j.code === code)
  const journey = loaded.journeys[code]
  const ids = [...new Set([...(entry?.questions ?? []), ...(journey?.steps.flatMap(st => st.chips) ?? [])])]
  const items = ids.map(id => loaded.register.items.find(i => i.id === id)).filter((i): i is RegisterItem => isUndecided(i, vocab))
  const r = loaded.register.initiative
  return [
    `Put ${r.id} journey ${code}${journey ? ` "${journey.title}"` : ''} up on the discovery desk for a polishing walk (publish_walk, initiative "${r.id}", journeys ["${code}"]).`,
    `The page is \`${loaded.rel}/${entry?.file ?? ''}\`. The register mirrors these as undecided:`,
    ...(items.length ? items.map(i => `- ${i.id} (${i.status}): ${i.title}`) : ['- none: say so, and ask me what to look at instead']),
    '',
    `Read each one's row in the record first${r.catalogue ? ` (${r.catalogue})` : ''}: the record wins where the register differs. One card each: question cards for questions, decision cards for proposed decisions, adr cards for proposed ADRs, ordered by how much design each one decides. Give each the options and their trade-offs, your recommendation, what differs on iOS and Android (osDiff), the evidence it rests on (a platform reference, a risk, a competitor), and the risks, assumptions, experiments and ADRs it touches (linked).`,
    'Write nothing to the record or the prototype until I submit.',
  ].join('\n')
}

/** Asks Claude to open a journey on a phone in the browser pane. */
export function phonePrompt(loaded: Loaded, code: string, index: number, os: Os): string {
  const entry = loaded.register.journeys.find(j => j.code === code)
  const journey = loaded.journeys[code]
  const step = journey ? nearestStep(journey, os, index) : undefined
  const at = journey && step ? stepsOn(journey, os).indexOf(step) : 0
  return [
    `Open ${loaded.register.initiative.id} journey ${code} on ${OS_LABEL[os]} in the browser pane, at ${stepPlace(journey, step?.index ?? index, os)}.`,
    `The page is \`${loaded.rel}/${entry?.file ?? ''}\`, served by the project's prototype server (start it first if it is not running; this project's launch configuration names it). Open it with \`?os=${os}\`, then run \`kitPlayer.goto(${Math.max(0, at)})\` (it counts from 0).`,
    'Only open it: change nothing.',
  ].join('\n')
}

/** Hands the questions raised while walking to Claude, to record in the record first. */
export function raisedPrompt(loaded: Loaded, raised: Raised[], notesPath: string): string {
  return [
    `While walking ${loaded.register.initiative.id} on the discovery desk I raised ${raised.length === 1 ? 'a new question' : `${raised.length} new questions`} (saved in \`${notesPath}\`):`,
    ...raised.map(q => `- **${q.id}** (proposed number) · ${q.journey}, ${stepPlace(loaded.journeys[q.journey], q.step, q.os)}: ${q.text.replace(/\n+/g, ' ')}`),
    '',
    'Record each one in the record first, as a new open question row numbered after the last (check the record\'s highest number; never reuse one), then mirror it into `prototype.js` and the journey step\'s chips.',
    'Show me what you will write and confirm with me before writing.',
  ].join('\n')
}

// ---------- the tools ----------

export const PUBLISH_DESCRIPTION = [
  'Put a polishing walk in front of the owner in the discovery desk, a side panel in Claude Code: the open questions, proposed decisions and proposed ADRs of a UX prototype journey, or a write plan or closing checklist to approve row by row.',
  'Use it instead of asking several questions in chat. The walk is saved under the desk folder (pending/<id>/); the owner answers in the panel, can step through the journey and ask questions there, and submits. You then receive a prompt pointing at the outcome.',
  'The record (the vault, the catalogue, the ADR notes) stays the record: read it first, mirror it, cite its ids. "initiative" is the register\'s initiative id (prototype.js) or its folder name. Question, decision and adr cards take the id of the item in the register (Q-NN, D-NN, ADR-…); the desk fills in its status and the journey steps that show it.',
  'Card types: question (prompt, options[] with trade-offs in description, recommended, context), decision (proposal, rationale, alternatives[], consequences), adr (proposal, clauses, alternatives[]), plan (rows[] of action + target + summary; intro). Question, decision and adr cards also take osDiff {ios, android}, evidence (Markdown) and linked[] (id, title, status, note) for the risks, assumptions, experiments and ADRs they touch.',
  'Order cards by how much design each decides. Publishing the same id again replaces the walk and keeps the owner\'s answers for cards whose ids stay the same.',
].join('\n')

const linkedItem = { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' } }, required: ['id'] }

export const PUBLISH_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Folder-safe id, e.g. "INIT-005-J02-walk". Reuse it to update a pending walk.' },
    title: { type: 'string', description: 'What is being walked, in plain words.' },
    initiative: { type: 'string', description: "The register's initiative id (e.g. INIT-005) or the initiative's folder name." },
    journeys: { type: 'array', items: { type: 'string' }, description: 'The journey codes this walk is about (e.g. ["J02"]).' },
    label: { type: 'string', description: 'A short label: "Polishing walk", "Write plan", "Closing checklist".' },
    summary: { type: 'string', description: 'Markdown: what this walk is for and what the owner is asked to do.' },
    origin: { type: 'string', description: 'The skill or task publishing it.' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: CARD_TYPES as unknown as string[] },
          id: { type: 'string', description: 'For question, decision and adr cards: the item id in the register (Q-34, D-24, ADR-v-056).' },
          title: { type: 'string', description: "Defaults to the register's title for the id." },
          prompt: { type: 'string' },
          context: { type: 'string' },
          options: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' } }, required: ['label'] } },
          recommended: { type: 'string' },
          allowOther: { type: 'boolean' },
          proposal: { type: 'string' },
          rationale: { type: 'string' },
          clauses: { type: 'string' },
          alternatives: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, reason: { type: 'string' } }, required: ['label'] } },
          consequences: { type: 'string' },
          osDiff: { type: 'object', properties: { ios: { type: 'string' }, android: { type: 'string' } } },
          evidence: { type: 'string' },
          linked: { type: 'array', items: linkedItem },
          intro: { type: 'string' },
          rows: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, action: { type: 'string' }, target: { type: 'string' }, summary: { type: 'string' } }, required: ['target'] } },
        },
        required: ['type'],
      },
    },
  },
  required: ['title', 'initiative', 'cards'],
}

export const ANSWER_DESCRIPTION = [
  'Put your answer to a question the owner asked from a discovery desk card onto that card.',
  'Use it after a prompt that says "A question from the discovery desk": research first with whatever you need, then call this with the walk and ask ids from that prompt.',
  'Write the answer in Markdown short enough for a side panel; list what you drew on in "sources" with URLs. Never invent a source.',
].join('\n')

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    walk: { type: 'string', description: 'The walk id from the question prompt.' },
    ask: { type: 'string', description: 'The ask id from the question prompt.' },
    answer: { type: 'string', description: 'The answer, in Markdown.' },
    sources: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['title'] } },
  },
  required: ['walk', 'ask', 'answer'],
}
