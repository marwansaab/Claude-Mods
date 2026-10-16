// Review packs: validation of what Claude publishes, progress, and the outcome handed back.
import type {
  Ask,
  Card,
  CardType,
  Claim,
  Draft,
  Pack,
  PackSummary,
  PackStatus,
  Response,
  Scene,
  Tone,
} from '../types'

export const CARD_TYPES: readonly CardType[] = ['question', 'decision', 'finding', 'plan', 'explainer', 'read']
const TONES: readonly Tone[] = ['subject', 'context', 'risk', 'question', 'decision', 'good']
const SCENES = ['cards', 'flow', 'list', 'timeline', 'funnel', 'bars', 'tiles', 'compare', 'matrix']
const MAX_CARDS = 80
const MAX_PARTS = 60

export const TYPE_LABEL: Record<CardType, string> = {
  question: 'Question',
  decision: 'Decision',
  finding: 'Finding',
  plan: 'Plan',
  explainer: 'Explainer',
  read: 'Read-through',
}

export const emptyDraft = (at = ''): Draft => ({ responses: {}, asks: [], updatedAt: at })

// ---------- ids ----------

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

/** The id Claude gave, or one made from the title and the date. */
export function packIdOf(id: unknown, title: string, isoNow: string): string {
  const given = typeof id === 'string' ? safeId(id) : ''
  if (given) return given
  const day = isoNow.slice(0, 10)
  return safeId(`${day}-${title}`) || `review-${day}`
}

// ---------- validation ----------

type Problems = string[]
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : undefined
const toneOf = (v: unknown): Tone | undefined => (TONES.includes(v as Tone) ? (v as Tone) : undefined)

function need(o: Record<string, unknown>, key: string, where: string, problems: Problems): string {
  const v = str(o[key])
  if (v === undefined) problems.push(`${where}: "${key}" is required text`)
  return v ?? ''
}

function cleanScene(raw: unknown, where: string, problems: Problems): Scene | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isObj(raw) || !SCENES.includes(String(raw.kind))) {
    problems.push(`${where}: scene.kind must be one of ${SCENES.join(', ')}`)
    return undefined
  }
  const kind = raw.kind as Scene['kind']
  const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter(isObj) : [])
  const item = (o: Record<string, unknown>) => ({
    title: str(o.title) ?? str(o.label) ?? '',
    text: str(o.text),
    tone: toneOf(o.tone),
    claim: str(o.claim),
  })
  switch (kind) {
    case 'cards':
    case 'flow':
    case 'list':
    case 'timeline': {
      const items = list('items').map(item).filter(i => i.title)
      if (!items.length) problems.push(`${where}: a ${kind} scene needs items with a title`)
      return { kind, items: items.slice(0, 12) }
    }
    case 'funnel': {
      const items = list('items').map(o => ({ label: str(o.label) ?? str(o.title) ?? '', value: str(o.value) ?? (typeof o.value === 'number' ? String(o.value) : undefined), tone: toneOf(o.tone), claim: str(o.claim) }))
      return { kind, items: items.filter(i => i.label).slice(0, 6) }
    }
    case 'bars': {
      const items = list('items')
        .map(o => ({ label: str(o.label) ?? '', value: Number(o.value), display: str(o.display), tone: toneOf(o.tone), claim: str(o.claim) }))
        .filter(i => i.label && Number.isFinite(i.value))
      if (!items.length) problems.push(`${where}: a bars scene needs items with a label and a numeric value`)
      const mark = isObj(raw.mark) && Number.isFinite(Number(raw.mark.value)) ? { value: Number(raw.mark.value), label: str(raw.mark.label) } : undefined
      const max = Number.isFinite(Number(raw.max)) && Number(raw.max) > 0 ? Number(raw.max) : undefined
      return { kind, items: items.slice(0, 10), max, mark }
    }
    case 'tiles': {
      const items = list('items').map(o => ({ value: str(o.value) ?? (typeof o.value === 'number' ? String(o.value) : ''), label: str(o.label) ?? '', tone: toneOf(o.tone), claim: str(o.claim) }))
      return { kind, items: items.filter(i => i.value || i.label).slice(0, 6) }
    }
    case 'compare': {
      const columns = strList(raw.columns) ?? []
      const rows = list('rows').map(o => ({ label: str(o.label) ?? '', cells: (Array.isArray(o.cells) ? o.cells : []).map(c => String(c ?? '')), tone: toneOf(o.tone) }))
      if (!columns.length) problems.push(`${where}: a compare scene needs columns`)
      return { kind, columns: columns.slice(0, 5), rows: rows.slice(0, 8) }
    }
    case 'matrix': {
      const dots = list('dots')
        .map(o => ({ label: str(o.label) ?? '', x: Number(o.x), y: Number(o.y), tone: toneOf(o.tone), claim: str(o.claim) }))
        .filter(d => d.label && Number.isFinite(d.x) && Number.isFinite(d.y))
        .map(d => ({ ...d, x: Math.min(1, Math.max(0, d.x)), y: Math.min(1, Math.max(0, d.y)) }))
      return { kind, x: str(raw.x) ?? '', y: str(raw.y) ?? '', quadrants: strList(raw.quadrants)?.slice(0, 4), dots: dots.slice(0, 16) }
    }
  }
}

function cleanCard(raw: unknown, n: number, seen: Set<string>, problems: Problems): Card | undefined {
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
  let id = safeId(str(raw.id) ?? '') || `${type[0]}${n + 1}`
  while (seen.has(id)) id = `${id}-${n + 1}`
  seen.add(id)
  const title = need(raw, 'title', `${where} (${id})`, problems)
  const claims = strList(raw.claims)
  const at = `${where} (${id})`
  const parts = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]).slice(0, MAX_PARTS) : [])

  switch (type) {
    case 'question': {
      const options = parts('options')
        .filter(isObj)
        .map((o, i) => ({ id: safeId(str(o.id) ?? '') || `o${i + 1}`, label: str(o.label) ?? '', description: str(o.description) }))
        .filter(o => o.label)
      const recommended = str(raw.recommended)
      return {
        type, id, title, claims,
        prompt: need(raw, 'prompt', at, problems),
        context: str(raw.context),
        options: options.length ? options : undefined,
        recommended: options.some(o => o.id === recommended) ? recommended : undefined,
        allowOther: raw.allowOther !== false,
      }
    }
    case 'decision':
      return {
        type, id, title, claims,
        proposal: need(raw, 'proposal', at, problems),
        rationale: str(raw.rationale),
        alternatives: parts('alternatives').filter(isObj).map(o => ({ label: str(o.label) ?? '', reason: str(o.reason) })).filter(o => o.label),
        consequences: str(raw.consequences),
      }
    case 'finding': {
      const evidence = isObj(raw.evidence) && str(raw.evidence.quote) ? { ref: str(raw.evidence.ref), quote: String(raw.evidence.quote) } : undefined
      const severity = ['high', 'medium', 'low'].includes(String(raw.severity)) ? (raw.severity as 'high' | 'medium' | 'low') : undefined
      const kind = raw.kind === 'drift' || raw.kind === 'review' ? raw.kind : undefined
      return {
        type, id, title, claims, severity, kind, evidence,
        body: need(raw, 'body', at, problems),
        where: str(raw.where),
        quote: str(raw.quote),
        suggestion: str(raw.suggestion),
      }
    }
    case 'plan': {
      const rows = parts('rows')
        .filter(isObj)
        .map((o, i) => ({ id: safeId(str(o.id) ?? '') || `r${i + 1}`, action: str(o.action) ?? 'change', target: str(o.target) ?? str(o.path) ?? '', summary: str(o.summary) }))
        .filter(r => r.target)
      if (!rows.length) problems.push(`${at}: a plan needs rows, each with a "target"`)
      return { type, id, title, intro: str(raw.intro), rows }
    }
    case 'explainer': {
      const steps = parts('steps')
        .filter(isObj)
        .map((o, i) => ({
          id: safeId(str(o.id) ?? '') || `step-${i + 1}`,
          title: str(o.title) ?? `Step ${i + 1}`,
          caption: str(o.caption) ?? '',
          scene: cleanScene(o.scene, `${at} step ${i + 1}`, problems),
          claims: strList(o.claims),
        }))
      if (!steps.length) problems.push(`${at}: an explainer needs steps`)
      return { type, id, title, intro: str(raw.intro), steps }
    }
    case 'read': {
      const sections = parts('sections')
        .filter(isObj)
        .map((o, i) => ({ id: safeId(str(o.id) ?? '') || `s${i + 1}`, title: str(o.title) ?? `Section ${i + 1}`, body: typeof o.body === 'string' ? o.body : '', flags: strList(o.flags) }))
      if (!sections.length) problems.push(`${at}: a read-through needs sections`)
      return { type, id, title, intro: str(raw.intro), sections }
    }
  }
}

/** Checks and tidies what Claude sent; problems are returned for Claude to fix, never guessed past. */
export function cleanPack(raw: unknown, isoNow: string): { pack?: Pack; problems: string[] } {
  const problems: Problems = []
  if (!isObj(raw)) return { problems: ['the input must be an object'] }
  const title = need(raw, 'title', 'pack', problems)
  const rawCards = Array.isArray(raw.cards) ? raw.cards : []
  if (!rawCards.length) problems.push('pack: "cards" must list at least one card')
  if (rawCards.length > MAX_CARDS) problems.push(`pack: at most ${MAX_CARDS} cards (split it into several reviews)`)
  const seen = new Set<string>()
  const cards = rawCards.slice(0, MAX_CARDS).map((c, i) => cleanCard(c, i, seen, problems)).filter((c): c is Card => !!c)
  const claims: Claim[] = (Array.isArray(raw.claims) ? raw.claims : [])
    .filter(isObj)
    .map(o => ({
      id: str(o.id) ?? '',
      text: str(o.text) ?? '',
      grade: ['A', 'B', 'C', 'D'].includes(String(o.grade)) ? (o.grade as Claim['grade']) : undefined,
      source: str(o.source),
      url: str(o.url),
      checked: str(o.checked),
    }))
    .filter(c => c.id && c.text)
  const known = new Set(claims.map(c => c.id))
  const cited = cards.flatMap(c => [
    ...('claims' in c ? c.claims ?? [] : []),
    ...(c.type === 'explainer' ? c.steps.flatMap(s => [...(s.claims ?? []), ...sceneClaims(s.scene)]) : []),
  ])
  const missing = [...new Set(cited.filter(id => !known.has(id)))]
  if (missing.length) problems.push(`claims cited but not listed in "claims": ${missing.join(', ')}`)
  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .filter(isObj)
    .map(o => ({ id: str(o.id), title: str(o.title), path: str(o.path), updated: str(o.updated) }))
    .filter(s => s.id || s.title || s.path)
  if (problems.length) return { problems }
  return {
    problems,
    pack: {
      schema: 1,
      id: packIdOf(raw.id, title, isoNow),
      title,
      summary: str(raw.summary),
      label: str(raw.label),
      createdAt: isoNow,
      origin: str(raw.origin),
      sources: sources.length ? sources : undefined,
      claims: claims.length ? claims : undefined,
      cards,
    },
  }
}

export function sceneClaims(scene: Scene | undefined): string[] {
  if (!scene) return []
  const items: { claim?: string }[] =
    scene.kind === 'compare' ? [] : scene.kind === 'matrix' ? scene.dots : (scene.items as { claim?: string }[])
  return items.map(i => i.claim).filter((c): c is string => !!c)
}

/** A pack read back from disk: trusted to the extent that it parses into the shape. */
export function readPack(text: string): Pack | undefined {
  try {
    const raw = JSON.parse(text)
    if (!isObj(raw) || !Array.isArray(raw.cards) || typeof raw.title !== 'string') return undefined
    const { pack } = cleanPack({ ...raw, id: raw.id }, typeof raw.createdAt === 'string' ? raw.createdAt : '')
    return pack ? { ...pack, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : pack.createdAt } : undefined
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
      asks: Array.isArray(raw.asks) ? (raw.asks as Ask[]) : [],
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    }
  } catch {
    return emptyDraft()
  }
}

// ---------- progress ----------

export type CardState = 'open' | 'partial' | 'done'

const hasText = (r: Response | undefined) => !!r?.text?.trim()
export const partKey = (cardId: string, partId: string) => `${cardId}/${partId}`

/** Whether the owner has responded to a card: wholly, in part, or not yet. */
export function cardState(card: Card, draft: Draft): CardState {
  const r = draft.responses[card.id]
  switch (card.type) {
    case 'question':
      return r?.choice && (r.choice !== 'other' || hasText(r)) ? 'done' : hasText(r) ? 'done' : 'open'
    case 'decision':
      return r?.choice === 'amend' ? (hasText(r) ? 'done' : 'partial') : r?.choice ? 'done' : hasText(r) ? 'partial' : 'open'
    case 'finding':
      return r?.choice ? 'done' : hasText(r) ? 'partial' : 'open'
    case 'plan':
      return r?.choice ? 'done' : (r?.rows && Object.keys(r.rows).length) || hasText(r) ? 'partial' : 'open'
    case 'explainer':
    case 'read': {
      const ids = card.type === 'explainer' ? card.steps.map((s, i) => s.id ?? `step-${i + 1}`) : card.sections.map(s => s.id)
      const done = ids.filter(id => draft.responses[partKey(card.id, id)]?.isDone).length
      const touched = ids.some(id => hasText(draft.responses[partKey(card.id, id)]))
      return done === ids.length ? 'done' : done || touched ? 'partial' : 'open'
    }
  }
}

export const answeredCount = (pack: Pack, draft: Draft) => pack.cards.filter(c => cardState(c, draft) === 'done').length

export function summaryOf(pack: Pack, draft: Draft, status: PackStatus, submittedAt?: string): PackSummary {
  return {
    id: pack.id,
    title: pack.title,
    label: pack.label,
    status,
    createdAt: pack.createdAt,
    submittedAt,
    cards: pack.cards.length,
    answered: answeredCount(pack, draft),
    types: [...new Set(pack.cards.map(c => c.type))],
  }
}

// ---------- the outcome ----------

const VERB: Record<string, string> = {
  approve: 'Approved',
  reject: 'Rejected',
  amend: 'Approved with changes',
  accept: 'Accepted',
  discuss: 'Discuss',
  go: 'Go ahead',
  cancel: 'Cancelled',
  other: 'Other answer',
}

const quoteBlock = (text: string) => text.trim().split('\n').map(l => `> ${l}`).join('\n')

/** A plan row goes ahead unless the owner unticked it. */
export const rowIsOn = (r: Response | undefined, rowId: string) => r?.rows?.[rowId] ?? true

/** The owner's response to one card, as Markdown bullet lines. */
export function cardOutcome(card: Card, draft: Draft): string[] {
  const r = draft.responses[card.id]
  const lines: string[] = []
  const note = (label: string, t?: string) => t?.trim() && lines.push(`- **${label}:** ${t.trim().replace(/\n+/g, ' ')}`)
  switch (card.type) {
    case 'question': {
      const picked = card.options?.find(o => o.id === r?.choice)
      if (picked) lines.push(`- **Answer:** ${picked.label}${picked.id === card.recommended ? ' (the recommended option)' : ''}`)
      else if (r?.choice === 'other' || hasText(r)) lines.push(`- **Answer:** ${r?.text?.trim() ?? ''}`)
      else lines.push('- **Answer:** _none given_')
      if (picked) note('Comment', r?.text)
      break
    }
    case 'decision':
    case 'finding':
      lines.push(`- **${card.type === 'decision' ? 'Decision' : 'Response'}:** ${r?.choice ? VERB[r.choice] ?? r.choice : '_undecided_'}`)
      note(card.type === 'decision' ? (r?.choice === 'amend' ? 'Changes' : 'Comment') : 'Reply', r?.text)
      break
    case 'plan': {
      const rows = card.rows.map(row => ({ row, isOn: rowIsOn(r, row.id) }))
      const on = rows.filter(x => x.isOn)
      const verdict = r?.choice === 'cancel' ? 'Cancelled: write nothing' : !r?.choice ? '_undecided_' : on.length === rows.length ? 'Go ahead with every row' : `Go ahead with ${on.length} of ${rows.length} rows`
      lines.push(`- **Plan:** ${verdict}`)
      if (r?.choice && r.choice !== 'cancel') for (const { row, isOn } of rows) lines.push(`  - [${isOn ? 'x' : ' '}] ${row.action} \`${row.target}\`${row.summary ? ` — ${row.summary}` : ''}`)
      note('Comment', r?.text)
      break
    }
    case 'explainer': {
      const steps = card.steps.map((s, i) => ({ s, r: draft.responses[partKey(card.id, s.id ?? `step-${i + 1}`)] }))
      lines.push(`- **Understood:** ${steps.filter(x => x.r?.isDone).length} of ${steps.length} steps`)
      for (const { s, r: sr } of steps) if (hasText(sr)) lines.push(`  - ${s.title}: ${sr!.text!.trim().replace(/\n+/g, ' ')}`)
      break
    }
    case 'read': {
      const parts = card.sections.map(s => ({ s, r: draft.responses[partKey(card.id, s.id)] }))
      lines.push(`- **Reviewed:** ${parts.filter(x => x.r?.isDone).length} of ${parts.length} sections`)
      for (const { s, r: sr } of parts) if (hasText(sr)) lines.push(`  - ${s.title}: ${sr!.text!.trim().replace(/\n+/g, ' ')}`)
      const notTicked = parts.filter(x => !x.r?.isDone).map(x => x.s.title)
      if (notTicked.length && notTicked.length < parts.length) lines.push(`  - Not ticked: ${notTicked.join(', ')}`)
      break
    }
  }
  return lines
}

/** The outcome as Markdown: what the owner decided, for Claude to apply in the record's real home. */
export function outcomeMarkdown(pack: Pack, draft: Draft, submittedAt: string): string {
  const out = [
    `# Review outcome: ${pack.title}`,
    '',
    `- Review: \`${pack.id}\`${pack.label ? ` (${pack.label})` : ''}`,
    `- Published: ${pack.createdAt}${pack.origin ? ` by ${pack.origin}` : ''}`,
    `- Submitted: ${submittedAt}`,
    `- Responded to: ${answeredCount(pack, draft)} of ${pack.cards.length} cards`,
  ]
  if (pack.sources?.length)
    out.push(`- Mirrors: ${pack.sources.map(s => [s.id, s.title, s.path ? `\`${s.path}\`` : '', s.updated ? `(updated ${s.updated})` : ''].filter(Boolean).join(' ')).join('; ')}`)
  out.push('', 'The source notes and files stay the record. Apply each response there, following the project\'s own rules.', '')
  for (const card of pack.cards) {
    out.push(`## ${card.id}: ${card.title} (${TYPE_LABEL[card.type].toLowerCase()})`, '')
    if (card.type === 'finding' && card.quote) out.push(quoteBlock(card.quote), '')
    out.push(...cardOutcome(card, draft), '')
  }
  const asks = draft.asks.filter(a => a.answer || a.via === 'session')
  if (asks.length) {
    out.push('## Questions asked during the review', '')
    for (const a of asks) {
      out.push(`- **Q${a.about ? ` (${a.about})` : ''}:** ${a.question.replace(/\n+/g, ' ')}`)
      out.push(a.via === 'session' ? '  - Asked in the session.' : `  - A: ${(a.answer ?? '').replace(/\n+/g, ' ')}`)
    }
    out.push('')
  }
  return out.join('\n')
}

export function outcomeJson(pack: Pack, draft: Draft, submittedAt: string) {
  return {
    schema: 1,
    review: pack.id,
    title: pack.title,
    submittedAt,
    cards: pack.cards.map(c => ({ id: c.id, type: c.type, title: c.title, state: cardState(c, draft) })),
    responses: draft.responses,
    asks: draft.asks,
  }
}

/** The prompt that hands a submitted review back to the session. */
export function handOffPrompt(pack: Pack, outcomePath: string): string {
  return [
    `I submitted the review "${pack.title}" (\`${pack.id}\`) in the review desk.`,
    `The outcome is in \`${outcomePath}\`. Read it, then apply each response in its real home (the vault note or file it came from), following this project's own rules.`,
    'Propose the changes and confirm with me before writing anything. Drop rejected and cancelled items; treat "Discuss" items, amendments and comments as questions to settle first.',
  ].join('\n')
}

// ---------- asking ----------

const clip = (t: string | undefined, n: number) => (!t ? '' : t.length > n ? `${t.slice(0, n)}…` : t)

/** The pack in plain text, as context for a quick question about it. */
export function packDigest(pack: Pack, focus?: Card): string {
  const lines = [`Review: ${pack.title}`, clip(pack.summary, 1200)]
  const claimText = (ids?: string[]) =>
    (ids ?? [])
      .map(id => pack.claims?.find(c => c.id === id))
      .filter((c): c is Claim => !!c)
      .map(c => `  ${c.id} [${c.grade ?? '?'}] ${c.text}${c.source ? ` (${c.source})` : ''}`)
  const cardText = (c: Card, n: number): string[] => {
    const head = `${c.type} ${c.id}: ${c.title}`
    switch (c.type) {
      case 'question':
        return [head, clip(c.prompt, n), clip(c.context, n), ...(c.options ?? []).map(o => `  option ${o.id}: ${o.label}${o.description ? ` (${o.description})` : ''}`), ...claimText(c.claims)]
      case 'decision':
        return [head, clip(c.proposal, n), clip(c.rationale, n), ...(c.alternatives ?? []).map(a => `  alternative: ${a.label}${a.reason ? ` (${a.reason})` : ''}`), clip(c.consequences, n), ...claimText(c.claims)]
      case 'finding':
        return [head, c.quote ? `  quote: ${c.quote}` : '', clip(c.body, n), c.suggestion ? `  suggestion: ${c.suggestion}` : '', ...claimText(c.claims)]
      case 'plan':
        return [head, clip(c.intro, n), ...c.rows.map(r => `  ${r.action} ${r.target}${r.summary ? `: ${r.summary}` : ''}`)]
      case 'explainer':
        return [head, clip(c.intro, n), ...c.steps.flatMap(s => [`  step: ${s.title}: ${clip(s.caption, n)}`, ...claimText([...(s.claims ?? []), ...sceneClaims(s.scene)])])]
      case 'read':
        return [head, clip(c.intro, n), ...c.sections.map(s => `  section ${s.title}: ${clip(s.body, n)}`)]
    }
  }
  if (focus) lines.push('', 'The card being read now:', ...cardText(focus, 6000))
  lines.push('', 'All cards:')
  for (const c of pack.cards) if (c !== focus) lines.push(...cardText(c, 400))
  return lines.filter(l => l !== '').join('\n').slice(0, 60_000)
}

export const ASK_SYSTEM = [
  'You answer the owner\'s question about a review they are working through in a side panel.',
  'Answer from the review below. When it does not hold the answer, say so plainly and suggest asking in the session, where Claude can read the project and its notes.',
  'Be brief: a few short sentences or bullets. Plain words, no preamble. Never invent a fact, figure or source.',
].join(' ')

// ---------- the tool Claude publishes with ----------

const tone = { type: 'string', enum: TONES as unknown as string[] }
const sceneItem = { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, tone, claim: { type: 'string' } }, required: ['title'] }

export const PUBLISH_DESCRIPTION = [
  'Put work in front of the owner for review in the review desk, a side panel in Claude Code: open questions to answer, proposed decisions to approve, findings to accept or reject, a write plan to approve row by row, an animated explainer to walk through, or a long text to read section by section.',
  'Use it instead of building an HTML review or explainer page and instead of asking several questions in chat. The pack is saved under Reviews/pending/<id>/ in the project; the owner answers in the panel, can ask questions there, and submits. You then receive a prompt pointing at Reviews/reviewed/<id>/outcome.md.',
  'The source notes stay the record: mirror them, cite their ids, never put a fact here that is not in the record. Grade claims A–D with a source; list every claim a card or scene cites in "claims".',
  'Card types: question (prompt, options[], recommended), decision (proposal, rationale, alternatives[]), finding (body, severity, kind drift|review, quote, suggestion, evidence), plan (rows[] of action + target + summary), explainer (steps[] of title, caption, scene), read (sections[] of title + body, flags[]).',
  'Scenes animate in the panel: cards, flow, list, timeline (items[] of title, text, tone, claim); funnel (items[] of label, value); bars (items[] of label, value, display; max; mark); tiles (items[] of value, label); compare (columns[], rows[] of label + cells[]); matrix (x, y, quadrants[4], dots[] of label, x 0–1, y 0–1). Tones: subject, context, risk, question, decision, good.',
  'Publishing the same id again replaces the pack and keeps the owner\'s answers for cards whose ids stay the same.',
].join('\n')

export const PUBLISH_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Folder-safe id, e.g. "INIT-002-open-questions". Reuse it to update a pending review. Default: date + title.' },
    title: { type: 'string', description: 'What is being reviewed, in plain words.' },
    label: { type: 'string', description: 'A short label for the list: "Open questions", "Write plan", "Deck review".' },
    summary: { type: 'string', description: 'Markdown: what this review is for and what the owner is asked to do.' },
    origin: { type: 'string', description: 'The skill or task publishing it.' },
    sources: {
      type: 'array',
      description: 'The notes or files this pack mirrors.',
      items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, path: { type: 'string' }, updated: { type: 'string' } } },
    },
    claims: {
      type: 'array',
      description: 'Every claim a card or scene cites, graded.',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, text: { type: 'string' }, grade: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, source: { type: 'string' }, url: { type: 'string' }, checked: { type: 'string' } },
        required: ['id', 'text'],
      },
    },
    cards: {
      type: 'array',
      description: 'The cards, in the order the owner should meet them.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: CARD_TYPES as unknown as string[] },
          id: { type: 'string', description: 'Stable id, e.g. the vault id "Q-13" or "ADR-v-041".' },
          title: { type: 'string' },
          prompt: { type: 'string' },
          context: { type: 'string' },
          options: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' } }, required: ['label'] } },
          recommended: { type: 'string' },
          allowOther: { type: 'boolean' },
          proposal: { type: 'string' },
          rationale: { type: 'string' },
          alternatives: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, reason: { type: 'string' } }, required: ['label'] } },
          consequences: { type: 'string' },
          body: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          kind: { type: 'string', enum: ['drift', 'review'] },
          where: { type: 'string' },
          quote: { type: 'string' },
          suggestion: { type: 'string' },
          evidence: { type: 'object', properties: { ref: { type: 'string' }, quote: { type: 'string' } } },
          intro: { type: 'string' },
          rows: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, action: { type: 'string' }, target: { type: 'string' }, summary: { type: 'string' } }, required: ['target'] } },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                caption: { type: 'string' },
                claims: { type: 'array', items: { type: 'string' } },
                scene: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: SCENES },
                    items: { type: 'array', items: { ...sceneItem, properties: { ...sceneItem.properties, label: { type: 'string' }, value: {}, display: { type: 'string' } }, required: [] } },
                    max: { type: 'number' },
                    mark: { type: 'object', properties: { value: { type: 'number' }, label: { type: 'string' } } },
                    columns: { type: 'array', items: { type: 'string' } },
                    rows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, cells: { type: 'array', items: { type: 'string' } }, tone } } },
                    x: { type: 'string' },
                    y: { type: 'string' },
                    quadrants: { type: 'array', items: { type: 'string' } },
                    dots: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, tone, claim: { type: 'string' } } } },
                  },
                  required: ['kind'],
                },
              },
              required: ['title', 'caption'],
            },
          },
          sections: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, flags: { type: 'array', items: { type: 'string' } } }, required: ['title', 'body'] } },
          claims: { type: 'array', items: { type: 'string' }, description: 'Claim ids this card rests on.' },
        },
        required: ['type', 'title'],
      },
    },
  },
  required: ['title', 'cards'],
}
