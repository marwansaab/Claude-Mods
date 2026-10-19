import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ask, Draft, DeskView, OpenPack, Pack, PackStatus, PackSummary, Response } from '../types'
import { FILES, README, isWindowsPath, join, moveArgv, submittedAtOf } from './disk'
import {
  ANSWER_DESCRIPTION,
  ANSWER_SCHEMA,
  PUBLISH_DESCRIPTION,
  PUBLISH_SCHEMA,
  cleanPack,
  handOffPrompt,
  outcomeJson,
  outcomeMarkdown,
  readDraft,
  readPack,
  summaryOf,
} from './pack'
import { homeView, packView } from './view'
import type { Actions } from './view'

const PANE = 'review-desk'
const PANE_TITLE = 'Review desk'
const TOOL = 'mcp__review-desk__publish_review'
const LIST_TOOL = 'mcp__review-desk__list_reviews'
const ANSWER_TOOL = 'mcp__review-desk__answer_question'

const START_VIEW: DeskView = {
  tab: 'pending',
  card: 0,
  part: {},
  isSummaryOpen: false,
  isConfirming: false,
  askOpen: {},
  showAllAsks: false,
}

const packs = atom({ plugin: 'review-desk', key: 'packs' } as const, [] as PackSummary[])
const view = atom({ plugin: 'review-desk', key: 'view' } as const, START_VIEW)
const open = atom({ plugin: 'review-desk', key: 'open' } as const, null as OpenPack | null)
const typing = atom({ plugin: 'review-desk', key: 'typing' } as const, {} as Record<string, string>)
const rootRef = atom({ plugin: 'review-desk', key: 'root' } as const, '')

/** A field's address less its redraw counter (`ask:Q-1#2` is the question field of card Q-1). */
const fieldKey = (key: string) => key.replace(/#\d+$/, '')

/** The view as stored, with any field an older version of the mod did not keep filled in. */
function viewOf(v: Partial<DeskView> | undefined): DeskView {
  return { ...START_VIEW, ...v, part: v?.part ?? {}, askOpen: v?.askOpen ?? {}, planView: v?.planView ?? {} }
}

/** The person's settings: set by `register` on every load, read by the functions below. */
const cfg = { folder: 'Reviews', autoOpen: true, handOff: true, selectableText: true }

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

// ---------- the Reviews folder ----------

/** The Reviews folder of the session's project. */
async function rootOf($: EngineInterface): Promise<string> {
  const known = await read($, rootRef)
  if (known) return known
  const root = join(await $.session.root(), cfg.folder)
  await update($, rootRef, () => root)
  return root
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

/** Every pack, newest first: pending ones not yet submitted, then the reviewed ones. */
async function listPacks($: EngineInterface, root: string): Promise<PackSummary[]> {
  const out: PackSummary[] = []
  for (const status of ['pending', 'reviewed'] as PackStatus[]) {
    for (const name of await dirsOf($, join(root, status))) {
      const dir = join(root, status, name)
      const packText = await readText($, join(dir, FILES.pack))
      if (packText === undefined) continue
      const pack = readPack(packText)
      if (!pack) {
        out.push({ id: name, title: `${name} (pack.json does not parse)`, status, createdAt: '', cards: 0, answered: 0, types: [], isBroken: true })
        continue
      }
      const draft = readDraft(await readText($, join(dir, FILES.draft)))
      const submittedAt = submittedAtOf(await readText($, join(dir, FILES.outcomeJson)))
      // A pending folder left behind by a submit whose move failed: its copy is in reviewed/.
      if (status === 'pending' && submittedAt && submittedAt >= pack.createdAt) continue
      out.push({ ...summaryOf(pack, draft, status, submittedAt), id: name })
    }
  }
  const at = (p: PackSummary) => p.submittedAt ?? p.createdAt
  return out.sort((a, b) => (a.status === b.status ? at(b).localeCompare(at(a)) : a.status === 'pending' ? -1 : 1))
}

async function loadPack($: EngineInterface, root: string, status: PackStatus, id: string): Promise<OpenPack | undefined> {
  const dir = join(root, status, id)
  const text = await readText($, join(dir, FILES.pack))
  const pack = text === undefined ? undefined : readPack(text)
  if (!pack) return undefined
  const draft = readDraft(await readText($, join(dir, FILES.draft)))
  const submittedAt = submittedAtOf(await readText($, join(dir, FILES.outcomeJson)))
  return { pack, draft, status, submittedAt }
}

async function saveDraft($: EngineInterface, root: string, id: string, draft: Draft, status: PackStatus = 'pending'): Promise<void> {
  await $.fs.write(join(root, status, id, FILES.draft), JSON.stringify(draft, null, 2))
}

/**
 * Writes a pack to pending/<id>/. A pack published again under its id keeps the owner's answers
 * for the cards (and their steps and sections) that are still there.
 */
async function publishPack($: EngineInterface, root: string, pack: Pack): Promise<{ path: string; kept: number }> {
  const readme = join(root, 'README.md')
  if (!(await $.fs.exists(readme))) await $.fs.write(readme, README)
  const dir = join(root, 'pending', pack.id)
  const old = readDraft(await readText($, join(dir, FILES.draft)))
  const ids = new Set(pack.cards.map(c => c.id))
  const responses = Object.fromEntries(Object.entries(old.responses).filter(([key]) => ids.has(key.split('/')[0] ?? '')))
  await $.fs.write(join(dir, FILES.pack), JSON.stringify(pack, null, 2))
  await $.fs.write(join(dir, FILES.draft), JSON.stringify({ ...old, responses, updatedAt: pack.createdAt }, null, 2))
  return { path: dir, kept: Object.keys(responses).length }
}

/** A free folder name under reviewed/: the id, or the id with a counter when it was reviewed before. */
async function reviewedSlot($: EngineInterface, root: string, id: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? id : `${id}--${n}`
    if (!(await $.fs.exists(join(root, 'reviewed', name)))) return name
  }
  return `${id}--${await $.clock.now()}`
}

async function moveDir($: EngineInterface, from: string, to: string): Promise<boolean> {
  try {
    const run = await $.process.run(moveArgv(from, to), { timeoutMs: 20_000 })
    return run.exitCode === 0 && (await $.fs.exists(join(to, FILES.pack)))
  } catch {
    return false
  }
}

/**
 * Submits a pending pack: writes the outcome beside it, then moves the folder to reviewed/.
 * Where the move fails the files are copied instead, and the pending folder is hidden by its outcome.
 */
async function submitPack($: EngineInterface, root: string, id: string, current: OpenPack, submittedAt: string): Promise<{ outcomePath: string; slot: string; isMoved: boolean }> {
  const from = join(root, 'pending', id)
  const md = outcomeMarkdown(current.pack, current.draft, submittedAt)
  const json = JSON.stringify(outcomeJson(current.pack, current.draft, submittedAt), null, 2)
  const draft = JSON.stringify(current.draft, null, 2)
  await $.fs.write(join(from, FILES.draft), draft)
  await $.fs.write(join(from, FILES.outcome), md)
  await $.fs.write(join(from, FILES.outcomeJson), json)

  const slot = await reviewedSlot($, root, id)
  const to = join(root, 'reviewed', slot)
  await $.fs.write(join(root, 'reviewed', '.keep'), '')
  const isMoved = await moveDir($, from, to)
  if (!isMoved) {
    await $.fs.write(join(to, FILES.pack), JSON.stringify(current.pack, null, 2))
    await $.fs.write(join(to, FILES.draft), draft)
    await $.fs.write(join(to, FILES.outcome), md)
    await $.fs.write(join(to, FILES.outcomeJson), json)
  }
  return { outcomePath: join(to, FILES.outcome), slot, isMoved }
}

// ---------- the open review ----------

async function refresh($: EngineInterface): Promise<PackSummary[]> {
  const root = await rootOf($)
  const list = await listPacks($, root)
  await update($, packs, () => list)
  const waiting = list.filter(p => p.status === 'pending').length
  $.ui.status(waiting ? `${waiting} to review · /reviews` : undefined)
  return list
}

async function changeDraft($: EngineInterface, fn: (d: OpenPack['draft']) => OpenPack['draft']): Promise<void> {
  const at = await nowIso($)
  const current = await read($, open)
  if (!current || current.status !== 'pending') return
  const draft = { ...fn(current.draft), updatedAt: at }
  await update($, open, o => (o ? { ...o, draft } : o))
  const v = viewOf(await read($, view))
  if (!v.openId) return
  const root = await rootOf($)
  await safely(() => saveDraft($, root, v.openId!, draft))
  const answered = summaryOf(current.pack, draft, 'pending').answered
  await update($, packs, list => list.map(p => (p.status === 'pending' && p.id === v.openId ? { ...p, answered } : p)))
}

/** Writes what the person typed without pressing Enter into the draft, before anything else moves. */
async function flushTyping($: EngineInterface): Promise<void> {
  const typed = await read($, typing)
  const keys = Object.keys(typed).filter(k => k.startsWith('t:'))
  if (!keys.length) return
  await update($, typing, t => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith('t:'))))
  await changeDraft($, d => {
    const responses = { ...d.responses }
    for (const k of keys) responses[k.slice(2)] = { ...responses[k.slice(2)], text: typed[k] }
    return { ...d, responses }
  })
}

async function respond($: EngineInterface, key: string, patch: Partial<Response>): Promise<void> {
  await flushTyping($)
  await changeDraft($, d => ({ ...d, responses: { ...d.responses, [key]: { ...d.responses[key], ...patch } } }))
}

async function recordAsk($: EngineInterface, a: Ask): Promise<void> {
  const current = await read($, open)
  if (!current) return
  if (current.status === 'pending') await changeDraft($, d => ({ ...d, asks: [...d.asks.filter(x => x.id !== a.id), a] }))
  else await update($, open, o => (o ? { ...o, draft: { ...o.draft, asks: [...o.draft.asks.filter(x => x.id !== a.id), a] } } : o))
}

/** A question about the open card: sent to Claude in the session, whose answer comes back onto the card. */
async function ask($: EngineInterface, question: string): Promise<void> {
  const q = question.trim()
  const current = await read($, open)
  const v = viewOf(await read($, view))
  if (!q || !current) return
  const card = current.pack.cards[Math.min(v.card, current.pack.cards.length - 1)]
  if (!card) return
  const part =
    card.type === 'explainer' ? card.steps[v.part[card.id] ?? 0]?.title : card.type === 'read' ? card.sections[v.part[card.id] ?? 0]?.title : undefined
  const about = [card.title, part].filter(Boolean).join(': ')
  const at = await $.clock.now()
  const entry: Ask = { id: `a${at.toString(36)}`, question: q, card: card.id, about, at: new Date(at).toISOString(), via: 'session' }
  await recordAsk($, entry)
  const root = await rootOf($)
  const folder = v.openId ?? current.pack.id
  const where = join(root, current.status, folder, 'pack.json')
  await $.prompt.submit({
    text: [
      `A question from the review desk, on ${card.type} card ${card.id} "${about}" of the review "${current.pack.title}" (${where}):`,
      '',
      q,
      '',
      `Research it with whatever you need: the web, this project, its notes. Then put your answer on the card with answer_question (review "${folder}", ask "${entry.id}"), in Markdown short enough for a side panel, and list what you drew on as sources with their URLs. Do not change any record unless I ask.`,
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
  const done = await safely(() => submitPack($, root, v.openId!, current, at))
  if (!done) {
    $.ui.toast('Could not save the outcome. Nothing was submitted.')
    return
  }
  await update($, open, () => null)
  await update($, view, x => ({ ...START_VIEW, tab: x.tab }))
  await refresh($)
  $.ui.toast(cfg.handOff ? 'Review submitted and handed to Claude' : 'Review submitted')
  if (cfg.handOff) await safely(() => $.prompt.submit({ text: handOffPrompt(current.pack, done.outcomePath) }))
}

async function openPack($: EngineInterface, status: DeskView['tab'], id: string): Promise<void> {
  const loaded = await loadPack($, await rootOf($), status, id)
  await update($, open, () => loaded ?? null)
  // The summary opens on a review not yet started; after that it stays out of the way.
  const isFresh = !!loaded && Object.keys(loaded.draft.responses).length === 0 && status === 'pending'
  await update($, view, x => ({ ...START_VIEW, tab: x.tab, openId: id, openStatus: status, isSummaryOpen: isFresh && !!loaded?.pack.summary }))
}

async function reloadOpen($: EngineInterface): Promise<void> {
  await refresh($)
  const v = viewOf(await read($, view))
  if (!v.openId || !v.openStatus) return
  const loaded = await loadPack($, await rootOf($), v.openStatus, v.openId)
  if (loaded) await update($, open, () => loaded)
}

async function closePack($: EngineInterface): Promise<void> {
  await flushTyping($)
  await update($, open, () => null)
  await update($, view, x => ({ ...START_VIEW, tab: x.tab }))
  await refresh($)
}

async function moveTo($: EngineInterface, patch: (v: DeskView) => DeskView): Promise<void> {
  await flushTyping($)
  await update($, view, patch)
}

async function toggleRow($: EngineInterface, cardId: string, rowId: string): Promise<void> {
  await flushTyping($)
  await changeDraft($, d => {
    const r = d.responses[cardId] ?? {}
    const rows = { ...r.rows, [rowId]: !(r.rows?.[rowId] ?? true) }
    return { ...d, responses: { ...d.responses, [cardId]: { ...r, rows } } }
  })
}

async function decideRow($: EngineInterface, cardId: string, rowId: string, isOn: boolean): Promise<void> {
  await flushTyping($)
  await changeDraft($, d => {
    const r = d.responses[cardId] ?? {}
    return { ...d, responses: { ...d.responses, [cardId]: { ...r, rows: { ...r.rows, [rowId]: isOn } } } }
  })
}

async function commitField($: EngineInterface, key: string, text: string): Promise<void> {
  await update($, typing, t => Object.fromEntries(Object.entries(t).filter(([k]) => k !== key)))
  if (key.startsWith('ask:')) await ask($, text)
  else if (key.startsWith('t:')) await respond($, key.slice(2), { text })
}

async function resend($: EngineInterface): Promise<void> {
  const current = await read($, open)
  const v = viewOf(await read($, view))
  if (!current || !v.openId) return
  const root = await rootOf($)
  await $.prompt.submit({ text: handOffPrompt(current.pack, join(root, 'reviewed', v.openId, 'outcome.md')) })
  $.ui.toast('Outcome sent to Claude')
}

/**
 * Puts text on the clipboard: the surface's own first; where it has no path (a remote surface such as
 * the desktop app), the system's clipboard command on this machine.
 */
async function copyText($: EngineInterface, text: string, surface: string): Promise<void> {
  const viaSurface = await $.ui.copy({ text, surface: surface as never }).catch(() => ({ isCopied: false as const }))
  if (viaSurface.isCopied) {
    $.ui.toast('Copied')
    return
  }
  const root = await rootOf($)
  const tries: string[][] = isWindowsPath(root)
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

/** The pane's controls, each one saving what it changes. */
function actionsFor($: EngineInterface): Actions {
  const run = (work: () => Promise<unknown>) => void safely(work)
  return {
    tab: tab => run(() => update($, view, x => ({ ...x, tab }))),
    refresh: () => run(() => reloadOpen($)),
    openPack: (status, id) => run(() => openPack($, status, id)),
    closePack: () => run(() => closePack($)),
    goCard: n => run(() => moveTo($, x => ({ ...x, card: Math.max(0, n), isConfirming: false, showAllAsks: false }))),
    goPart: (cardId, n) => run(() => moveTo($, x => ({ ...x, part: { ...x.part, [cardId]: Math.max(0, n) } }))),
    respond: (key, patch) => run(() => respond($, key, patch)),
    toggleRow: (cardId, rowId) => run(() => toggleRow($, cardId, rowId)),
    decideRow: (cardId, rowId, isOn) => run(() => decideRow($, cardId, rowId, isOn)),
    setPlanView: (cardId, mode) => run(() => moveTo($, x => ({ ...x, planView: { ...(x.planView ?? {}), [cardId]: mode } }))),
    type: (key, text) => run(() => update($, typing, t => ({ ...t, [fieldKey(key)]: text }))),
    commit: (key, text) => run(() => commitField($, fieldKey(key), text)),
    toggleSummary: () => run(() => update($, view, x => ({ ...x, isSummaryOpen: !x.isSummaryOpen }))),
    showAllAsks: () => run(() => update($, view, x => ({ ...x, showAllAsks: true }))),
    submit: () => run(() => submit($)),
    confirm: isOn => run(() => moveTo($, x => ({ ...x, isConfirming: isOn }))),
    resend: () => run(() => resend($)),
    copy: (text, surface) => run(() => copyText($, text, surface)),
  }
}

async function openPane($: EngineInterface): Promise<void> {
  await refresh($)
  await $.ui.open({ id: PANE, title: PANE_TITLE })
}

async function setUp($: EngineInterface): Promise<void> {
  // Each piece on its own: a refused command must not keep the tools from Claude, nor the other way round.
  const steps: [string, () => Promise<unknown>][] = [
    ['the publish_review tool', () => $.tool.register({ name: 'publish_review', description: PUBLISH_DESCRIPTION, inputSchema: PUBLISH_SCHEMA, isDeferred: false })],
    [
      'the list_reviews tool',
      () =>
        $.tool.register({
          name: 'list_reviews',
          description:
            "List the review desk's reviews (pending and submitted) with their folders and how many cards the owner has answered. Outcomes are in <folder>/reviewed/<id>/outcome.md.",
          inputSchema: { type: 'object', properties: {} },
        }),
    ],
    [
      'the answer_question tool',
      () =>
        $.tool.register({
          name: 'answer_question',
          description: ANSWER_DESCRIPTION,
          inputSchema: ANSWER_SCHEMA,
        }),
    ],
    [
      'the /reviews command',
      () =>
        $.command.register({
          name: 'reviews',
          description: 'Open the review desk: reviews waiting for you (questions, decisions, findings, plans, explainers, read-throughs) and the ones you submitted',
        }),
    ],
    ['the reviews list', async () => {
      await update($, rootRef, () => '')
      await refresh($)
    }],
  ]
  for (const [what, step] of steps) {
    try {
      await step()
    } catch (err) {
      $.ui.log(`review-desk could not set up ${what}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function publish($: EngineInterface, input: Record<string, unknown>) {
  const at = await nowIso($)
  const { pack, problems } = cleanPack(input, at)
  if (!pack) return { deny: `The review was not published. Fix these and call publish_review again:\n- ${problems.join('\n- ')}` }
  const root = await rootOf($)
  const { path, kept } = await publishPack($, root, pack)
  await safely(async () => {
    await refresh($)
    if (!cfg.autoOpen) return
    const v = viewOf(await read($, view))
    if (!v.openId || v.openId === pack.id) {
      const loaded = await loadPack($, root, 'pending', pack.id)
      await update($, open, () => loaded ?? null)
      await update($, view, x => ({
        ...START_VIEW,
        tab: 'pending' as const,
        openId: pack.id,
        openStatus: 'pending' as const,
        isSummaryOpen: !!pack.summary,
        card: x.openId === pack.id ? x.card : 0,
        part: x.openId === pack.id ? x.part : {},
      }))
    }
    await $.ui.open({ id: PANE, title: PANE_TITLE })
  })
  const byType = pack.cards.reduce<Record<string, number>>((m, c) => ({ ...m, [c.type]: (m[c.type] ?? 0) + 1 }), {})
  const counts = Object.entries(byType)
    .map(([t, n]) => `${n} ${t}`)
    .join(', ')
  return {
    result: [
      `Published "${pack.title}" as ${pack.id}: ${pack.cards.length} cards (${counts}), saved in ${path}.`,
      kept ? `Kept ${kept} of the owner's earlier answers for cards with the same ids.` : '',
      'The owner reviews it in the review desk panel (/reviews). Do not also build an HTML page for it, and do not repeat its questions in chat. When the owner submits, a prompt points you at the outcome; until then, carry on or end your turn.',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

/** Claude's answer to a question the owner sent from a card: written into that card's thread, on disk and on screen. */
async function answerQuestion($: EngineInterface, input: Record<string, unknown>) {
  const review = typeof input.review === 'string' ? input.review.trim() : ''
  const askId = typeof input.ask === 'string' ? input.ask.trim() : ''
  const answer = typeof input.answer === 'string' ? input.answer.trim() : ''
  if (!review || !askId || !answer) return { deny: 'answer_question needs "review", "ask" and "answer", as given in the question prompt.' }
  const root = await rootOf($)
  let status: PackStatus | undefined
  for (const s of ['pending', 'reviewed'] as PackStatus[]) if (!status && (await $.fs.exists(join(root, s, review, FILES.pack)))) status = s
  if (!status) return { deny: `No review "${review}" in ${root}. Use the folder name from the question prompt, or list_reviews.` }

  const current = await read($, open)
  const v = viewOf(await read($, view))
  const isOnScreen = !!current && v.openId === review && current.status === status
  const draft = isOnScreen && current ? current.draft : readDraft(await readText($, join(root, status, review, FILES.draft)))
  const asked = draft.asks.find(a => a.id === askId)
  if (!asked) return { deny: `Review "${review}" has no question "${askId}". Use the ask id from the question prompt.` }

  const sources = (Array.isArray(input.sources) ? input.sources : [])
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map(x => ({ title: String(x.title ?? x.url ?? '').trim(), url: typeof x.url === 'string' ? x.url.trim() : undefined }))
    .filter(x => x.title)
  const done: Ask = { ...asked, via: 'session', answer, answeredAt: await nowIso($), isError: false, sources: sources.length ? sources : undefined }
  const next = { ...draft, asks: draft.asks.map(a => (a.id === askId ? done : a)) }
  await saveDraft($, root, review, next, status)
  if (isOnScreen) {
    await update($, open, o => (o ? { ...o, draft: next } : o))
    const cardId = asked.card
    if (cardId) await update($, view, x => ({ ...viewOf(x), askOpen: { ...(x.askOpen ?? {}), [cardId]: true } }))
  }
  $.ui.toast(`Claude answered on ${asked.about ?? 'the card'}`)
  return { result: `Answer saved on ${asked.card ? `card ${asked.card}` : 'the card'} of "${review}". The owner sees it in the review desk; there is no need to repeat it in full here.` }
}

async function listForClaude($: EngineInterface) {
  const list = await refresh($)
  const root = await rootOf($)
  if (!list.length) return { result: `No reviews yet in ${root}.` }
  const lines = list.map(
    p =>
      `- [${p.status}] ${p.id}: ${p.title} · ${p.answered}/${p.cards} answered${p.submittedAt ? ` · submitted ${p.submittedAt} · ${join(root, 'reviewed', p.id, 'outcome.md')}` : ''}`,
  )
  return { result: `Reviews in ${root}:\n${lines.join('\n')}` }
}

export const register: Register = (on, options) => {
  cfg.folder = typeof options.folder === 'string' && options.folder.trim() ? options.folder.trim().replace(/[\\/]+$/, '') : 'Reviews'
  cfg.autoOpen = options.autoOpen !== false
  cfg.handOff = options.handOff !== false
  cfg.selectableText = options.selectableText !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await safely(() => setUp($))
    return started
  })

  on('command.run', { command: 'reviews' }, async $ => {
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Review desk closed.' }
    }
    await openPane($)
    const waiting = (await read($, packs)).filter(p => p.status === 'pending').length
    return { text: waiting ? `Review desk: ${waiting} waiting for you.` : 'Review desk: nothing waiting.' }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, async ($, e) => publish($, e as unknown as Record<string, unknown>)).catch(($, e, next) => next(e))

  on('tool.call', { tool: LIST_TOOL }, async $ => listForClaude($)).catch(($, e, next) => next(e))

  on('tool.call', { tool: ANSWER_TOOL }, async ($, e) => answerQuestion($, e as unknown as Record<string, unknown>)).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const v = viewOf(await read($, view))
    const ctx = {
      ui,
      isDesktop: e.surface !== 'terminal' && 'Svg' in ui,
      width: Math.max(280, Math.min(920, (e.props.bodyColumns || 48) * 8 - 8)),
      packs: await read($, packs),
      view: v,
      open: v.openId ? await read($, open) : null,
      act: actionsFor($),
      folder: cfg.folder,
      selectable: cfg.selectableText,
    }
    try {
      return v.openId ? packView(ctx) : homeView(ctx)
    } catch (err) {
      // Never leave the pane blank: say what failed and offer the way back to the list.
      const { Box, Text, Button } = ui
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>The review desk could not draw this view.</Text>
          <Text dimColor>{err instanceof Error ? err.message : String(err)}</Text>
          <Button key="recover" label="Back to all reviews" onPress={() => void safely(() => closePack($))} />
        </Box>
      )
    }
  })
}
