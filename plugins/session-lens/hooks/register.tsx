import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LensSection, LensSort, LensView } from '../types'
import { EMPTY_PLAN, PLAN_TOOLS, countSkill, countTool, markAlways, planAfter, skillOfPath, splitTool } from './track'
import { paneView } from './view'

const PLUGIN = 'session-lens'
const PANE = PLUGIN
const TITLE = 'Session lens'
const COMMAND = 'lens'

const VIEW: LensView = { folded: [], foldedGroups: [], isGrouped: true, sort: 'count', filter: '' }

const plan = atom({ plugin: 'session-lens', key: 'plan' } as const, EMPTY_PLAN)
const tools = atom({ plugin: 'session-lens', key: 'tools' } as const, {})
const skills = atom({ plugin: 'session-lens', key: 'skills' } as const, {})
const servers = atom({ plugin: 'session-lens', key: 'servers' } as const, {})
const view = atom({ plugin: 'session-lens', key: 'view' } as const, VIEW)
const isSeeded = atom({ plugin: 'session-lens', key: 'isSeeded' } as const, false)
const isAutoOpened = atom({ plugin: 'session-lens', key: 'isAutoOpened' } as const, false)

/** The lens only watches: nothing it does may fail the call, the turn or the session. */
async function safely(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // Dropped: a missed update costs one count, never the call.
  }
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
}

/** Opens the pane the first time the session uses something, where it would sit beside the chat. */
async function autoOpen($: EngineInterface, isOn: boolean): Promise<void> {
  if (!isOn || (await read($, isAutoOpened))) return
  const inApp = (await $.session.surfaces()).some(s => s !== 'terminal')
  if (!inApp) return
  await update($, isAutoOpened, () => true)
  await $.ui.open({ id: PANE, title: TITLE })
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
  }
}

/** A /clear starts a new conversation: its counts start over, the layout stays. */
async function startOver($: EngineInterface): Promise<void> {
  await update($, plan, () => EMPTY_PLAN)
  await update($, tools, () => ({}))
  await update($, skills, () => ({}))
  await update($, isSeeded, () => true)
  await readContext($)
}

export const register: Register = (on, options) => {
  const isAutoOpenOn = options.autoOpen !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await safely(() =>
      $.command.register({
        name: COMMAND,
        description: 'Show or hide the session lens: the to-do list, skills and tools this session used',
      }),
    )
    void safely(() => seed($))
    void safely(() => readContext($))
    return started
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await safely(() => startOver($))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async $ => {
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Session lens closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    void safely(() => readContext($))
    return { text: 'Session lens opened.' }
  }).catch(() => ({ text: 'The session lens could not open just now.' }))

  // Every tool call, the main conversation's and each subagent's: the call runs first, then it is counted.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    await safely(async () => {
      if (ran.deny !== undefined) return
      const at = await $.clock.now()
      const name = String(e.tool)
      const isNew = !(name in (await read($, tools)))
      await update($, tools, cur => countTool(cur, name, ran.isError === true, at))
      // The task list is the main conversation's; a subagent's own list is its business.
      if (PLAN_TOOLS.has(name) && e.agentId === undefined && ran.isError !== true) {
        const input = e as unknown as Record<string, unknown>
        await update($, plan, cur => planAfter(cur, name, input, ran.result, Math.max(at, cur.updatedAt + 1)) ?? cur)
      }
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
      await autoOpen($, isAutoOpenOn)
    })
    return out
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const setView = (patch: (v: LensView) => Partial<LensView>) => update($, view, v => ({ ...v, ...patch(v) }))
    const flip = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter(x => x !== item) : [...list, item])
    return paneView({
      ui,
      isPictured: e.surface !== 'terminal' && 'Svg' in ui,
      columns: Math.max(24, e.props.bodyColumns || 48),
      plan: await read($, plan),
      tools: await read($, tools),
      skills: await read($, skills),
      servers: await read($, servers),
      view: await read($, view),
      act: {
        toggleSection: (id: LensSection) => void setView(v => ({ folded: flip(v.folded, id) })),
        toggleGroup: (key: string) => void setView(v => ({ foldedGroups: flip(v.foldedGroups, key) })),
        setGrouped: (isGrouped: boolean) => void setView(() => ({ isGrouped })),
        setSort: (sort: LensSort) => void setView(() => ({ sort })),
        setFilter: (filter: string) => void setView(() => ({ filter })),
      },
    })
  })
}
