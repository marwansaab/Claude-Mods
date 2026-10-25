import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { LensActivity, LensCaptain, LensCrab, LensSection, LensSort, LensView } from '../types'
import { LINGER_MS, activityOf, characterKeyOf, crewNameOf, detailOf, outcomeOf, todoPatch, withChange } from './crew'
import {
  DEFAULT_VIEW,
  EMPTY_PLAN,
  PLAN_TOOLS,
  countSkill,
  countTool,
  layoutOf,
  listOrders,
  markAlways,
  movesAfter,
  parseLayout,
  planAfter,
  skillOfPath,
  splitTool,
  viewOf,
} from './track'
import { bandView, paneView } from './view'

const PLUGIN = 'session-lens'
const PANE = PLUGIN
const TITLE = 'Session lens'
const COMMAND = 'lens'
/** Store keys: the layout kept across sessions, and whether the person closed the pane last. */
const LAYOUT_KEY = 'layout'
const CLOSED_KEY = 'paneClosed'

const plan = atom({ plugin: 'session-lens', key: 'plan' } as const, EMPTY_PLAN)
const tools = atom({ plugin: 'session-lens', key: 'tools' } as const, {})
const skills = atom({ plugin: 'session-lens', key: 'skills' } as const, {})
const servers = atom({ plugin: 'session-lens', key: 'servers' } as const, {})
const view = atom({ plugin: 'session-lens', key: 'view' } as const, DEFAULT_VIEW)
const isSeeded = atom({ plugin: 'session-lens', key: 'isSeeded' } as const, false)
const isAutoOpened = atom({ plugin: 'session-lens', key: 'isAutoOpened' } as const, false)
const isLayoutLoaded = atom({ plugin: 'session-lens', key: 'isLayoutLoaded' } as const, false)
const moves = atom({ plugin: 'session-lens', key: 'moves' } as const, {})
const crew = atom({ plugin: 'session-lens', key: 'crew' } as const, {} as Record<string, LensCrab>)
const crewTick = atom({ plugin: 'session-lens', key: 'crewTick' } as const, 0)
const crewBandSince = atom({ plugin: 'session-lens', key: 'crewBandSince' } as const, 0)
const IDLE: LensCaptain = { isBusy: false, activity: 'other', detail: '', lastActiveAt: 0 }
const captain = atom({ plugin: 'session-lens', key: 'captain' } as const, IDLE)
const raceSince = atom({ plugin: 'session-lens', key: 'raceSince' } as const, 0)

/** The captain is the main thread: what it is doing now, or that it is waiting for you. */
async function setCaptain($: EngineInterface, isBusy: boolean, activity: LensActivity, detail: string): Promise<void> {
  const at = await $.clock.now()
  await update($, captain, () => ({ isBusy, activity, detail, lastActiveAt: at }))
}

/** How often the pane is redrawn while a crab works, so one left without a call is drawn waiting. */
const CREW_TICK_MS = 5000
const MAX_CREW = 40

/** A little past the longest animation a change sets off: a staggered bar's growth, or a flight and its glow. */
const SETTLE_MS = 1600
let settleTimer: Timer | undefined

/**
 * Asks for one more drawing once the animations a change set off have ended. The app keeps the pane's
 * last drawing and may show it again (a new message, a re-layout) without asking the mod; were that
 * drawing made mid-animation, the animation would play again. The drawing made here has none left.
 */
function settle($: EngineInterface): void {
  settleTimer?.cancel()
  settleTimer = $.clock.after(SETTLE_MS, () => {
    settleTimer = undefined
    $.ui.invalidate('ui.render')
  })
}

/** The lens only watches: nothing it does may fail the call, the turn or the session. */
async function safely(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // Dropped: a missed update costs one count, never the call.
  }
}

/**
 * Notes every list whose order changed since it was last noted, and when: the pane flies those rows to
 * their new places for a moment after. Called after each change that can reorder a list.
 */
async function noteMoves($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  const v = viewOf(await read($, view))
  const orders = listOrders(await read($, tools), await read($, skills), await read($, servers), v.sort, await read($, crew), at, await read($, raceSince))
  await update($, moves, cur => movesAfter(cur, orders, at) ?? cur)
}

/** Changes one crab by its agent id; its progress bar then grows from where it was. */
async function touchCrab($: EngineInterface, agentId: string, patch: (m: LensCrab) => Partial<LensCrab>): Promise<boolean> {
  const at = await $.clock.now()
  let found = false
  await update($, crew, all => {
    const m = Object.values(all).find(c => c.agentId === agentId)
    if (!m) return all
    found = true
    return { ...all, [m.id]: withChange(m, patch(m), at) }
  })
  return found
}

/**
 * Reads what the context says about this session: the names /mcp lists each server under
 * (a claude.ai connector's wire name is an id), and the skills a memory file pulls in at start.
 */
async function readContext($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (!b) return
  const names: Record<string, string> = {}
  for (const t of b.mcpTools ?? []) {
    const { server } = splitTool(t.name)
    if (server && t.serverName) names[server] = t.serverName
  }
  if (Object.keys(names).length) await update($, servers, cur => ({ ...cur, ...names }))
  const always = (b.memoryFiles ?? []).map(m => skillOfPath(m.path)).filter(Boolean)
  if (always.length) await update($, skills, cur => markAlways(cur, always))
  await noteMoves($)
}

/** Opens the pane, its rows coming in once as it does. */
async function openPane($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  await update($, view, v => {
    const full = viewOf(v)
    return { ...full, toggledAt: { ...full.toggledAt, pane: at } }
  })
  await $.ui.open({ id: PANE, title: TITLE })
  settle($)
  await safely(() => $.store.set(CLOSED_KEY, false))
}

/**
 * Opens the pane the first time the session uses something, where it would sit beside the chat,
 * unless the person closed it last time.
 */
async function autoOpen($: EngineInterface, isOn: boolean): Promise<void> {
  if (!isOn || (await read($, isAutoOpened))) return
  const inApp = (await $.session.surfaces()).some(s => s !== 'terminal')
  if (!inApp) return
  await update($, isAutoOpened, () => true)
  if ((await $.store.get(CLOSED_KEY)) === true) return
  await openPane($)
}

/** Reads the kept layout into this session's view, once: a reload keeps what the person changed since. */
async function loadLayout($: EngineInterface): Promise<void> {
  if (await read($, isLayoutLoaded)) return
  const kept = await $.store.get(LAYOUT_KEY)
  await update($, view, v => (kept === undefined ? viewOf(v) : { ...viewOf(v), ...parseLayout(kept) }))
  await update($, isLayoutLoaded, () => true)
}

/** A resumed session's earlier calls, counted once; a reload keeps what was counted. */
async function seed($: EngineInterface): Promise<void> {
  if (await read($, isSeeded)) return
  await update($, isSeeded, () => true)
  const messages = await $.session.messages()
  let at = 1
  for (const m of messages) {
    for (const u of m.toolUses) {
      at += 1
      const stamp = at
      await update($, tools, cur => countTool(cur, u.tool, u.isError === true, stamp))
      if (u.tool === 'Skill' && typeof u.input.skill === 'string' && u.input.skill)
        await update($, skills, cur => countSkill(cur, String(u.input.skill).replace(/^\//, ''), stamp))
      if (PLAN_TOOLS.has(u.tool) && u.isError !== true) await update($, plan, cur => planAfter(cur, u.tool, u.input, u.result, stamp) ?? cur)
    }
  }  // The order the history left, noted so the next change flies from it.
  await noteMoves($)
}

/** A /clear starts a new conversation: its counts start over, the layout stays. */
async function startOver($: EngineInterface): Promise<void> {
  await update($, plan, () => EMPTY_PLAN)
  await update($, tools, () => ({}))
  await update($, skills, () => ({}))
  await update($, crew, () => ({}))
  await update($, isSeeded, () => true)
  await readContext($)
}

/** Opens the lens at its crew: the pane, with the Crew section unfolded if it was folded. */
async function openCrew($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  await update($, view, v => {
    const full = viewOf(v)
    return full.folded.includes('crew') ? { ...full, folded: full.folded.filter(s => s !== 'crew'), toggledAt: { ...full.toggledAt, crew: at } } : full
  })
  await openPane($)
}

export const register: Register = (on, options) => {
  const isAutoOpenOn = options.autoOpen !== false
  const isBandOn = options.crewBand !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await safely(() =>
      $.command.register({
        name: COMMAND,
        description: 'Show or hide the session lens: the to-do list, skills and tools this session used',
      }),
    )
    await safely(() => loadLayout($))
    void safely(() => seed($))
    void safely(() => readContext($))
    // While a crab works, a redraw now and then: one left without a call for a while is drawn waiting.
    $.clock.every(CREW_TICK_MS, () => {
      void safely(async () => {
        if (!Object.values(await read($, crew)).some(m => m.status === 'running')) return
        const at = await $.clock.now()
        await update($, crewTick, () => at)
      })
    })
    return started
  })

  // A subagent sets out: a crab joins the crew, cast by its agent type, and flies in at the foot of the working list.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    await safely(async () => {
      if (started.deny !== undefined) return
      const at = await $.clock.now()
      const character = characterKeyOf(e.subagentType)
      // No one at work: this crab starts a new race, and the crabs of the last one leave the lists.
      if (!Object.values(await read($, crew)).some(m => m.status === 'running')) await update($, raceSince, () => at)
      await update($, crew, all => {
        const list = Object.values(all)
        const m: LensCrab = {
          id: started.agentId ?? e.tool_use_id,
          agentId: started.agentId,
          type: e.subagentType,
          character,
          name: crewNameOf(character, list),
          description: e.description,
          status: 'running',
          startedAt: at,
          lastActiveAt: at,
          activity: 'start',
          detail: '',
          toolCalls: 0,
          errors: 0,
          progressBefore: 0,
          progressAt: at,
        }
        // The oldest crab back at base leaves first once the crew is full.
        const kept = list.length < MAX_CREW ? list : list.filter(c => c !== list.filter(o => o.status !== 'running').sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))[0])
        return Object.fromEntries([...kept, m].map(c => [c.id, c]))
      })
      await noteMoves($)
      settle($)
      await autoOpen($, isAutoOpenOn)
    })
    return started
  }).catch(($, e, next) => next(e))

  // Each model request of a subagent: its crab is thinking.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    await safely(async () => {
      if (!agentId) return setCaptain($, true, 'think', '')
      const at = await $.clock.now()
      await touchCrab($, agentId, () => ({ activity: 'think', detail: '', lastActiveAt: at }))
    })
    return yield* next(e)
  })

  // A subagent's run ends: its crab is done, failed or stopped. One that is done walks past its flag and
  // stands there a moment, then flies to the top of the crabs that reported back; the others fly there now.
  // The main conversation's turn ending puts the captain off watch until your next prompt.
  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    await safely(async () => {
      if (!agentId) return setCaptain($, false, 'other', '')
      const at = await $.clock.now()
      const status = outcomeOf(e.reason)
      if (!(await touchCrab($, agentId, () => ({ status, endedAt: at, lastActiveAt: at })))) return
      await noteMoves($)
      settle($)
      if (status === 'done')
        $.clock.after(LINGER_MS + 50, () => {
          void safely(async () => {
            await noteMoves($)
            settle($)
          })
        })
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  // A new prompt with no one out: the band clears, and comes back with the next crew to set out.
  on('prompt.submit', async ($, e, next) => {
    await safely(async () => {
      if (Object.values(await read($, crew)).some(m => m.status === 'running')) return
      const at = await $.clock.now()
      await update($, crewBandSince, () => at)
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  // The crew band above the prompt: the crabs out since the last prompt, and how far along they are,
  // drawn above whatever other mods put there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isBandOn || e.props.hasSurvey) return next(e)
    const since = await read($, crewBandSince)
    const all = Object.values(await read($, crew))
    const shown = all.filter(m => m.startedAt > since || (m.endedAt ?? -1) > since).sort((a, b) => a.startedAt - b.startedAt)
    if (!shown.length) return next(e)
    const ui = $.ui.resolve(e)
    const ours = bandView({
      ui,
      isPictured: e.surface !== 'terminal' && 'Svg' in ui,
      columns: Math.max(40, e.props.bodyColumns || 100),
      shown,
      now: Math.max(await $.clock.now(), await read($, crewTick)),
      openCrew: () => void safely(() => openCrew($)),
      dismiss: () =>
        void safely(async () => {
          const at = await $.clock.now()
          await update($, crewBandSince, () => at)
        }),
    })
    // The band is shared by every mod: ours goes first, and what the others draw stays under it.
    const { Box } = ui
    const others = await next(e)
    return (
      <Box flexDirection="column">
        {ours}
        {others}
      </Box>
    )
  })

  // The person's own close is remembered, so the next session does not open the pane by itself.
  on('ui.close', async ($, e, next) => {
    const out = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') await safely(() => $.store.set(CLOSED_KEY, true))
    return out
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await safely(() => startOver($))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async $ => {
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      await safely(() => $.store.set(CLOSED_KEY, true))
      return { text: 'Session lens closed.' }
    }
    await openPane($)
    void safely(() => readContext($))
    return { text: 'Session lens opened.' }
  }).catch(() => ({ text: 'The session lens could not open just now.' }))

  // Every tool call, the main conversation's and each subagent's: the call runs first, then it is counted.
  on('tool.call', async ($, e, next) => {
    // A subagent's call: its crab is doing this now, and its own to-do list may move its progress.
    const agentId = e.agentId
    if (!agentId) await safely(() => setCaptain($, true, activityOf(String(e.tool)), detailOf(e as unknown as Record<string, unknown>)))
    if (agentId)
      await safely(async () => {
        const tool = String(e.tool)
        const input = e as unknown as Record<string, unknown>
        const at = await $.clock.now()
        const moved = await touchCrab($, agentId, m => ({
          activity: activityOf(tool),
          detail: detailOf(input),
          lastActiveAt: at,
          toolCalls: m.toolCalls + 1,
          ...todoPatch(tool, input, m),
        }))
        if (moved) await noteMoves($)
      })
    const ran = await next(e)
    await safely(async () => {
      if (agentId && ran.isError === true) await touchCrab($, agentId, m => ({ errors: m.errors + 1 }))
      if (ran.deny !== undefined) return
      const at = await $.clock.now()
      const name = String(e.tool)
      const isNew = !(name in (await read($, tools)))
      await update($, tools, cur => countTool(cur, name, ran.isError === true, at))
      await noteMoves($)
      // The task list is the main conversation's; a subagent's own list is its business.
      if (PLAN_TOOLS.has(name) && e.agentId === undefined && ran.isError !== true) {
        const input = e as unknown as Record<string, unknown>
        await update($, plan, cur => planAfter(cur, name, input, ran.result, Math.max(at, cur.updatedAt + 1)) ?? cur)
      }
      settle($)
      // A server not seen before may be a connector whose wire name is an id: ask for its listed name.
      const { server } = splitTool(name)
      if (isNew && server && !(server in (await read($, servers)))) void safely(() => readContext($))
      await autoOpen($, isAutoOpenOn)
    })
    return ran
  }).catch(($, e, next) => next(e))

  // A skill expanded for the model: typed as /name, called through the Skill tool, or preloaded.
  on('skill.prompt', async ($, e, next) => {
    const out = await next(e)
    await safely(async () => {
      const at = await $.clock.now()
      await update($, skills, cur => countSkill(cur, e.skill, at))
      await noteMoves($)
      settle($)
      await autoOpen($, isAutoOpenOn)
    })
    return out
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    // Each change is stamped, so what it sets moving moves once, from then, and not on later redraws,
    // and the layout is kept for the next session.
    const setView = (patch: (v: LensView, at: number) => Partial<LensView>) =>
      void safely(async () => {
        const at = await $.clock.now()
        let changed: LensView | undefined
        await update($, view, v => {
          const full = viewOf(v)
          changed = { ...full, ...patch(full, at) }
          return changed
        })
        await noteMoves($)
        settle($)
        if (changed) await $.store.set(LAYOUT_KEY, layoutOf(changed))
      })
    const flip = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter(x => x !== item) : [...list, item])
    return paneView({
      ui,
      isPictured: e.surface !== 'terminal' && 'Svg' in ui,
      columns: Math.max(24, e.props.bodyColumns || 48),
      plan: await read($, plan),
      tools: await read($, tools),
      skills: await read($, skills),
      servers: await read($, servers),
      view: viewOf(await read($, view)),
      moves: await read($, moves),
      crew: await read($, crew),
      captain: await read($, captain),
      raceSince: await read($, raceSince),
      // Read so the timer's tick redraws the pane; the drawing itself goes by the clock.
      now: Math.max(await $.clock.now(), await read($, crewTick)),
      act: {
        toggleSection: (id: LensSection) => setView((v, at) => ({ folded: flip(v.folded, id), toggledAt: { ...v.toggledAt, [id]: at } })),
        toggleGroup: (key: string) => setView((v, at) => ({ groupExceptions: flip(v.groupExceptions, key), toggledAt: { ...v.toggledAt, [`g:${key}`]: at } })),
        setAllGroups: (isOpen: boolean) => setView((_, at) => ({ groupsOpen: isOpen, groupExceptions: [], layoutAt: at })),
        setGrouped: (isGrouped: boolean) => setView((v, at) => (v.isGrouped === isGrouped ? {} : { isGrouped, layoutAt: at })),
        // A new sort is a change of order: the rows fly to their new places (noted by setView).
        setSort: (sort: LensSort) => setView(v => (v.sort === sort ? {} : { sort })),
        setFilter: (filter: string) => setView(() => ({ filter })),
        toggleLegend: () => setView((v, at) => ({ isLegendOpen: !v.isLegendOpen, toggledAt: { ...v.toggledAt, legend: at } })),
      },
    })
  })
}
