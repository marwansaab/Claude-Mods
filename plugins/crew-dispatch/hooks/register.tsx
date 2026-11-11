import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Dispatch, RouteSource } from '../types'
import { BUILT_IN_ROWS, NAMED_FIELD, OTHER, OTHER_FIELD, PLUGIN, ROUTING_FIELD, formatNamed, isRouted, modelFor, rowFor, tableOf } from './route'
import type { NamedRow, Table } from './route'
import { boardView } from './view'

const PANE = PLUGIN
const TITLE = 'Crew dispatch'
const COMMAND = 'ms-crew-dispatch'
/** The board keeps the latest subagents only. */
const MAX_DISPATCHES = 60

const dispatches = atom({ plugin: 'crew-dispatch', key: 'dispatches' } as const, {} as Record<string, Dispatch>)
const offered = atom({ plugin: 'crew-dispatch', key: 'offered' } as const, [] as string[])
const failed = atom({ plugin: 'crew-dispatch', key: 'failed' } as const, {} as Record<string, string>)

/** The board's own bookkeeping may fail; the spawn, the request and the session never do because of it. */
async function safely(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // Dropped: a missed record costs a line on the board, never the call.
  }
}

/**
 * The settings as they stand now, by field name: read live from /config, so a change there or on the
 * board applies to the next spawn or request; the options the module loaded with if the list fails.
 */
async function settingsOf($: EngineInterface, options: PluginOptions): Promise<Record<string, unknown>> {
  try {
    const mine = (await $.config.list()).filter(r => r.key.startsWith(`${PLUGIN}.`))
    if (mine.length) return Object.fromEntries(mine.map(r => [r.key.slice(PLUGIN.length + 1), r.value]))
  } catch {
    // Fall back to the options below.
  }
  return { ...options }
}

const tableNow = async ($: EngineInterface, options: PluginOptions): Promise<Table> => tableOf(await settingsOf($, options))

/** The settings field a built-in row or `other` keeps one of its picks in. */
const fieldOf = (rowKey: string, pick: 'model' | 'effort'): string | undefined => {
  const field = rowKey === OTHER ? OTHER_FIELD : BUILT_IN_ROWS.find(r => r.key === rowKey)?.field
  return field && `${field}${pick === 'model' ? 'Model' : 'Effort'}`
}

/** A line in the transcript that the model never reads. */
async function announce($: EngineInterface, text: string): Promise<void> {
  await $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } })
}

async function record($: EngineInterface, d: Dispatch): Promise<void> {
  await update($, dispatches, all => {
    const kept = Object.values(all)
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(-(MAX_DISPATCHES - 1))
    return Object.fromEntries([...kept, d].map(x => [x.agentId, x]))
  })
  $.ui.invalidate('ui.render')
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await safely(() =>
      $.command.register({ name: COMMAND, description: 'Show or hide the crew dispatch board: the model and effort each agent type gets' }),
    )
    return started
  })

  // Each agent type the model is offered: a type with no built-in row gets one on the board.
  on('agent.offer', async ($, e, next) => {
    const out = await next(e)
    await safely(async () => {
      if (e.agent === 'fork' || BUILT_IN_ROWS.some(r => r.key === e.agent)) return
      if ((await read($, offered)).includes(e.agent)) return
      await update($, offered, cur => (cur.includes(e.agent) ? cur : [...cur, e.agent]))
      $.ui.invalidate('ui.render')
    })
    return out
  }).catch(($, e, next) => next(e))

  // A subagent sets out: its row picks its model, unless Claude named one. A row's model that fails to
  // start it is tried once more as if unrouted, then skipped for the rest of the session.
  on('agent.spawn', async ($, e, next) => {
    if (!isRouted(e)) return next(e)
    let table: Table
    try {
      table = await tableNow($, options)
    } catch {
      return next(e)
    }
    const { key, row } = rowFor(table, e.subagentType)
    const isFailed = key in (await read($, failed))
    const pick = table.isOn ? modelFor(e.model, row, e.parentModel, isFailed) : { model: e.model, source: (e.model !== undefined ? 'claude' : 'off') as RouteSource }
    let modelSource = pick.source
    let started
    if (pick.source === 'row') {
      const routed = await next({ ...e, model: pick.model }).catch((err: unknown) => ({ deny: err instanceof Error ? err.message : String(err) }))
      if (routed.deny === undefined) started = routed
      else {
        // Unrouted, it starts or is refused on its own: only a start says the row's model was the cause.
        const plain = await next(e)
        if (plain.deny !== undefined) return plain
        started = plain
        modelSource = 'fallback'
        const model = pick.model ?? ''
        await safely(() => update($, failed, cur => ({ ...cur, [key]: model })))
        await safely(() =>
          announce($, `crew-dispatch: ${model} did not start the ${e.subagentType} subagent, so it ran on its usual model. Its row's model is skipped for the rest of this session.`),
        )
      }
    } else started = await next(e)
    const agentId = started.agentId
    if (started.deny === undefined && agentId) {
      const at = await $.clock.now()
      await safely(() =>
        record($, {
          agentId,
          type: e.subagentType,
          description: e.description,
          row: key,
          model: started.model,
          modelSource,
          effortSource: !table.isOn ? 'off' : row.effort === 'auto' ? 'default' : 'row',
          startedAt: at,
        }),
      )
    }
    return started
  }).catch(($, e, next) => next(e))

  // Each model request of a routed subagent: its row's effort, read now, so a change on the board reaches
  // agents already at work. A model that takes no effort is sent none.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    let sent = e
    if (agentId)
      await safely(async () => {
        const d = (await read($, dispatches))[agentId]
        if (!d) return
        const table = await tableNow($, options)
        const { row } = rowFor(table, d.type)
        const level = row.effort === 'auto' ? undefined : row.effort
        const isRow = table.isOn && level !== undefined && e.effort !== undefined
        if (isRow) sent = { ...e, effort: level }
        const effortSource: RouteSource = !table.isOn ? 'off' : isRow ? 'row' : 'default'
        const effort = sent.effort === undefined ? undefined : String(sent.effort)
        if (d.effort !== effort || d.effortSource !== effortSource) {
          await update($, dispatches, all => (all[agentId] ? { ...all, [agentId]: { ...all[agentId]!, effort, effortSource } } : all))
          $.ui.invalidate('ui.render')
        }
      })
    const result = yield* next(sent)
    const model = result.usage?.model
    if (agentId && model)
      await safely(async () => {
        const d = (await read($, dispatches))[agentId]
        if (!d || d.model === model) return
        await update($, dispatches, all => (all[agentId] ? { ...all, [agentId]: { ...all[agentId]!, model } } : all))
        $.ui.invalidate('ui.render')
      })
    return result
  })

  on('command.run', { command: COMMAND }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Crew dispatch closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Crew dispatch opened.' }
  }).catch(() => ({ text: 'The crew dispatch board could not open just now.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = await tableNow($, options)
    const set = (field: string, value: string | boolean) =>
      void safely(async () => {
        await $.config.set({ key: `${PLUGIN}.${field}`, value })
        $.ui.invalidate('ui.render')
      })
    return boardView({
      ui: $.ui.resolve(e),
      table,
      offered: await read($, offered),
      failed: await read($, failed),
      dispatches: await read($, dispatches),
      act: {
        setRouting: isOn => set(ROUTING_FIELD, isOn),
        setPick: (rowKey, pick, value) => {
          const field = fieldOf(rowKey, pick)
          if (field) return set(field, value)
          const was: NamedRow = table.named[rowKey] ?? { model: OTHER, effort: OTHER }
          set(NAMED_FIELD, formatNamed({ ...table.named, [rowKey]: { ...was, [pick]: value } as NamedRow }))
        },
      },
    })
  })
}
