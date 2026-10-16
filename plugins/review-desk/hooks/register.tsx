import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ask, Draft, DeskView, OpenPack, Pack, PackStatus, PackSummary, Response } from '../types'
import { FILES, README, join, moveArgv, submittedAtOf } from './disk'
import {
  ASK_SYSTEM,
  PUBLISH_DESCRIPTION,
  PUBLISH_SCHEMA,
  cleanPack,
  handOffPrompt,
  outcomeJson,
  outcomeMarkdown,
  packDigest,
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

const START_VIEW: DeskView = {
  tab: 'pending',
  card: 0,
  part: {},
  isSummaryOpen: false,
  isConfirming: false,
  isAsking: false,
  showAllAsks: false,
}

const packs = atom({ plugin: 'review-desk', key: 'packs' } as const, [] as PackSummary[])
const view = atom({ plugin: 'review-desk', key: 'view' } as const, START_VIEW)
const open = atom({ plugin: 'review-desk', key: 'open' } as const, null as OpenPack | null)
const typing = atom({ plugin: 'review-desk', key: 'typing' } as const, {} as Record<string, string>)
const rootRef = atom({ plugin: 'review-desk', key: 'root' } as const, '')

/** The person's settings: set by `register` on every load, read by the functions below. */
const cfg = { folder: 'Reviews', autoOpen: true, handOff: true, askModel: '' }

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

async function saveDraft($: EngineInterface, root: string, id: string, draft: Draft): Promise<void> {
  await $.fs.write(join(root, 'pending', id, FILES.draft), JSON.stringify(draft, null, 2))
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
  const v = await read($, view)
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

/** A question about the open review: answered in the pane from the review itself, or sent to the session. */
async function ask($: EngineInterface, question: string, via: 'quick' | 'session'): Promise<void> {
  const q = question.trim()
  const current = await read($, open)
  const v = await read($, view)
  if (!q || !current) return
  const card = current.pack.cards[Math.min(v.card, current.pack.cards.length - 1)]
  if (!card) return
  const part =
    card.type === 'explainer' ? card.steps[v.part[card.id] ?? 0]?.title : card.type === 'read' ? card.sections[v.part[card.id] ?? 0]?.title : undefined
  const about = [card.title, part].filter(Boolean).join(': ')
  const at = await $.clock.now()
  const entry: Ask = { id: `a${at.toString(36)}`, question: q, about, at: new Date(at).toISOString(), via }
  await recordAsk($, entry)

  if (via === 'session') {
    const root = await rootOf($)
    const where = join(root, current.status, v.openId ?? current.pack.id, 'pack.json')
    await $.prompt.submit({
      text: `A question from the review desk about "${current.pack.title}" (${where}), on ${card.type} ${card.id} "${about}":\n\n${q}\n\nAnswer it here; do not change any record unless I ask.`,
    })
    $.ui.toast('Sent to the session')
    return
  }

  await update($, view, x => ({ ...x, isAsking: true }))
  try {
    const model = cfg.askModel || (await $.session.model())
    const result = await $.model.complete({
      model,
      system: ASK_SYSTEM,
      prompt: `${packDigest(current.pack, card)}\n\nThe owner's question: ${q}`,
      maxTokens: 900,
      timeoutMs: 90_000,
    })
    await recordAsk(
      $,
      result.isAnswered
        ? { ...entry, answer: result.text.trim() }
        : { ...entry, answer: `No answer (${result.reason}). Try "Ask Claude in the session".`, isError: true },
    )
  } catch {
    await recordAsk($, { ...entry, answer: 'The quick answer failed. Try "Ask Claude in the session".', isError: true })
  } finally {
    await update($, view, x => ({ ...x, isAsking: false }))
  }
}

async function submit($: EngineInterface): Promise<void> {
  await flushTyping($)
  const current = await read($, open)
  const v = await read($, view)
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
  await update($, view, x => ({ ...START_VIEW, tab: x.tab, openId: id, openStatus: status, isSummaryOpen: !!loaded?.pack.summary }))
}

async function reloadOpen($: EngineInterface): Promise<void> {
  await refresh($)
  const v = await read($, view)
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

async function commitField($: EngineInterface, key: string, text: string): Promise<void> {
  await update($, typing, t => Object.fromEntries(Object.entries(t).filter(([k]) => k !== key)))
  if (key === 'ask') await ask($, text, 'quick')
  else if (key.startsWith('t:')) await respond($, key.slice(2), { text })
}

async function askTyped($: EngineInterface, via: 'quick' | 'session'): Promise<void> {
  const typed = (await read($, typing)).ask ?? ''
  await update($, typing, t => ({ ...t, ask: '' }))
  if (!typed.trim()) {
    $.ui.toast('Type a question first')
    return
  }
  await ask($, typed, via)
}

async function resend($: EngineInterface): Promise<void> {
  const current = await read($, open)
  const v = await read($, view)
  if (!current || !v.openId) return
  const root = await rootOf($)
  await $.prompt.submit({ text: handOffPrompt(current.pack, join(root, 'reviewed', v.openId, 'outcome.md')) })
  $.ui.toast('Outcome sent to Claude')
}

/** The pane's controls, each one saving what it changes. */
function actionsFor($: EngineInterface): Actions {
  const run = (work: () => Promise<unknown>) => void safely(work)
  return {
    tab: tab => run(() => update($, view, x => ({ ...x, tab }))),
    refresh: () => run(() => reloadOpen($)),
    openPack: (status, id) => run(() => openPack($, status, id)),
    closePack: () => run(() => closePack($)),
    goCard: n => run(() => moveTo($, x => ({ ...x, card: Math.max(0, n), isConfirming: false }))),
    goPart: (cardId, n) => run(() => moveTo($, x => ({ ...x, part: { ...x.part, [cardId]: Math.max(0, n) } }))),
    respond: (key, patch) => run(() => respond($, key, patch)),
    toggleRow: (cardId, rowId) => run(() => toggleRow($, cardId, rowId)),
    type: (key, text) => run(() => update($, typing, t => ({ ...t, [key]: text }))),
    commit: (key, text) => run(() => commitField($, key, text)),
    toggleSummary: () => run(() => update($, view, x => ({ ...x, isSummaryOpen: !x.isSummaryOpen }))),
    ask: (question, via) => run(() => ask($, question, via)),
    askTyped: via => run(() => askTyped($, via)),
    showAllAsks: () => run(() => update($, view, x => ({ ...x, showAllAsks: true }))),
    submit: () => run(() => submit($)),
    confirm: isOn => run(() => moveTo($, x => ({ ...x, isConfirming: isOn }))),
    resend: () => run(() => resend($)),
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
    const v = await read($, view)
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
  cfg.askModel = typeof options.askModel === 'string' ? options.askModel.trim() : ''

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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const v = await read($, view)
    const ctx = {
      ui,
      isDesktop: e.surface !== 'terminal' && 'Svg' in ui,
      width: Math.max(280, Math.min(920, (e.props.bodyColumns || 48) * 8 - 8)),
      packs: await read($, packs),
      view: v,
      open: v.openId ? await read($, open) : null,
      act: actionsFor($),
      folder: cfg.folder,
    }
    return v.openId ? packView(ctx) : homeView(ctx)
  })
}
