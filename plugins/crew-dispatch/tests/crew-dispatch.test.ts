import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentSpawnInput, On, TurnStepInput } from 'claude-code'

import { formatNamed, modelFor, parseNamed, rowFor, tableOf } from '../hooks/route'
import { dispatchLine } from '../hooks/view'

const PANE = {
  plugin: 'crew-dispatch',
  component: 'Pane',
  requestId: 'crew-dispatch',
  props: { title: 'Crew dispatch', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const
const SURFACES = ['terminal', 'desktop'] as const

describe('the table', () => {
  test('rows read from the settings; a missing or unknown pick is auto, and routing is on unless set off', async () => {
    const t = tableOf({ exploreModel: 'haiku', exploreEffort: 'low', planModel: 'sideways' })
    expect(t.isOn).toBe(true)
    expect(t.rows.Explore).toEqual({ model: 'haiku', effort: 'low' })
    expect(t.rows.Plan).toEqual({ model: 'auto', effort: 'auto' })
    expect(tableOf({ routing: false }).isOn).toBe(false)
  })

  test('named types parse and print back; a field left out follows the other row', async () => {
    const named = parseNamed('review-desk:reviewer=sonnet:high; helper=haiku, =opus:low, junk')
    expect(named).toEqual({ 'review-desk:reviewer': { model: 'sonnet', effort: 'high' }, helper: { model: 'haiku', effort: 'other' } })
    expect(formatNamed({ ...named, idle: { model: 'other', effort: 'other' } })).toBe('review-desk:reviewer=sonnet:high, helper=haiku:other')
  })

  test('a type finds its named row (with or without its plugin prefix), else its built-in row, else other', async () => {
    const t = tableOf({ otherModel: 'sonnet', otherEffort: 'medium', exploreModel: 'haiku', namedTypes: 'helper=opus' })
    expect(rowFor(t, 'Explore')).toEqual({ key: 'Explore', row: { model: 'haiku', effort: 'auto' } })
    expect(rowFor(t, 'some-plugin:helper')).toEqual({ key: 'helper', row: { model: 'opus', effort: 'medium' } })
    expect(rowFor(t, 'mystery')).toEqual({ key: 'other', row: { model: 'sonnet', effort: 'medium' } })
  })

  test("Claude's own model stands, then the row, then the default; inherit is the parent's; a failed row falls back", async () => {
    const row = { model: 'haiku', effort: 'auto' } as const
    expect(modelFor('opus', row, 'claude-opus-5-5', false)).toEqual({ model: 'opus', source: 'claude' })
    expect(modelFor(undefined, row, 'claude-opus-5-5', false)).toEqual({ model: 'haiku', source: 'row' })
    expect(modelFor(undefined, { model: 'inherit', effort: 'auto' }, 'claude-opus-5-5', false)).toEqual({ model: 'claude-opus-5-5', source: 'row' })
    expect(modelFor(undefined, { model: 'auto', effort: 'auto' }, 'claude-opus-5-5', false)).toEqual({ model: undefined, source: 'default' })
    expect(modelFor(undefined, row, 'claude-opus-5-5', true)).toEqual({ model: undefined, source: 'fallback' })
  })
})

// ---------- the engine beneath the mod ----------

/** Settings as /config holds them, answered to `$.config.list` and changed by `$.config.set`. */
const settingsOf = (on: On, initial: Record<string, string | boolean>) => {
  const values: Record<string, string | boolean> = { routing: true, ...initial }
  on('config.list', () => ({
    value: Object.entries(values).map(([field, value]) => ({
      key: `crew-dispatch.${field}`,
      label: field,
      kind: typeof value === 'boolean' ? 'boolean' : 'choice',
      value,
      provider: { plugin: 'crew-dispatch', tier: 'user' },
      isLocked: false,
    })),
  }))
  on('config.set', (_, e) => {
    values[e.key.replace(/^crew-dispatch\./, '')] = e.value as string | boolean
    return { value: e.value }
  })
  return values
}

/** Spawns as the engine would, noting the model each spawn reached it with; `refuse` names models it cannot start. */
const spawner = ($: Engine, on: On, refuse: string[] = []) => {
  const seen: (string | undefined)[] = []
  on('agent.spawn', (_, e) => {
    seen.push(e.model)
    if (e.model && refuse.includes(e.model)) return { deny: `model ${e.model} is not available` }
    return { model: e.model ?? 'claude-opus-5-5', agentId: `agent-${e.tool_use_id}` }
  })
  const spawn = (id: string, type: string, over: Partial<AgentSpawnInput> = {}) =>
    $.agent.spawn({
      tool_use_id: id,
      prompt: 'Do it',
      description: `Task ${id}`,
      subagentType: type,
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
      ...over,
    })
  return { seen, spawn }
}

/** Answers model requests, noting the effort each reached it with. */
const stepper = ($: Engine, on: On) => {
  const efforts: unknown[] = []
  on('turn.step', async function* (_, e) {
    efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  /** `null` stands for a model that takes no effort. */
  const step = async (agentId: string | undefined, effort: TurnStepInput['effort'] | null = 'high') => {
    const s = $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', ...(effort === null ? {} : { effort }), messageCount: 1, ...(agentId ? { agentId } : {}) })
    for await (const _ of s) void _
    return s.result
  }
  return { efforts, step }
}

describe('routing a spawn', () => {
  test("a row picks the model when Claude names none; Claude's own pick, a fork and routing off are left alone", async ($, on) => {
    mock.clock(on, { now: 1_000 })
    const values = settingsOf(on, { exploreModel: 'haiku', otherModel: 'sonnet' })
    const { seen, spawn } = spawner($, on)
    await spawn('t1', 'Explore')
    await spawn('t2', 'Explore', { model: 'opus' })
    await spawn('t3', 'fork', { fork: true })
    await spawn('t4', 'review-desk:reviewer')
    values.routing = false
    await spawn('t5', 'Explore')
    expect(seen).toEqual(['haiku', 'opus', undefined, 'sonnet', undefined])
  })

  test("a row's model that cannot start the agent falls back, says so once, and is skipped after", async ($, on) => {
    mock.clock(on, { now: 1_000 })
    const session = mock.session(on)
    settingsOf(on, { planModel: 'fable' })
    const { seen, spawn } = spawner($, on, ['fable'])
    const first = await spawn('t1', 'Plan')
    expect(first.deny).toBeUndefined()
    await spawn('t2', 'Plan')
    expect(seen).toEqual(['fable', undefined, undefined])
    const notes = session.appended().map(r => JSON.stringify(r.message.content))
    expect(notes.length).toBe(1)
    expect(notes[0]).toMatch(/fable did not start the Plan subagent/)
  })

  test('a spawn the engine refuses whatever the model stays refused, and the row is not blamed', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    const session = mock.session(on)
    settingsOf(on, { exploreModel: 'haiku' })
    on('agent.spawn', () => ({ deny: 'no subagents here' }))
    const r = await $.agent.spawn({
      tool_use_id: 't1', prompt: 'x', description: 'x', subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
    })
    expect(r.deny).toBe('no subagents here')
    expect(session.appended().length).toBe(0)
  })
})

describe('effort on each request', () => {
  test("a routed subagent's requests carry its row's effort, read live; main and a model without effort are left alone", async ($, on) => {
    mock.clock(on, { now: 1_000 })
    const values = settingsOf(on, { exploreEffort: 'low' })
    const { spawn } = spawner($, on)
    const { efforts, step } = stepper($, on)
    await spawn('t1', 'Explore')
    await step('agent-t1')
    await step(undefined)
    await step('agent-t1', null)
    values.exploreEffort = 'max'
    await step('agent-t1')
    expect(efforts).toEqual(['low', 'high', undefined, 'max'])
  })
})

describe('the board', () => {
  test('lists every row and this session’s subagents with what they ran on and why', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    settingsOf(on, { exploreModel: 'haiku', exploreEffort: 'low' })
    const { spawn } = spawner($, on)
    const { step } = stepper($, on)
    await spawn('t1', 'Explore')
    await step('agent-t1')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const text = (await ui.findAll({})).map(f => f.text).join('\n')
      expect(text).toMatch(/general-purpose/)
      expect(text).toMatch(/any other type/)
      expect(text).toMatch(/Haiku \(your row\) · low \(your row\)/)
      await ui.unmount()
    }
  })

  test('a pick on the board writes the setting, and an offered type gets a row that writes the named types', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    const values = settingsOf(on, {})
    on('agent.offer', () => ({ isOffered: true }))
    await $.agent.offer({ agent: 'review-desk:reviewer', description: 'Reviews', source: 'plugin', provider: { plugin: 'review-desk', tier: 'user' } })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.select({ key: 'model-Plan', value: 'opus' })
      await ui.select({ key: 'effort-review-desk:reviewer', value: 'high' })
      await ui.press({ key: 'routing' })
      await ui.unmount()
      expect(values.planModel).toBe('opus')
      expect(values.namedTypes).toBe('review-desk:reviewer=other:high')
      expect(values.routing).toBe(false)
      values.routing = true
    }
  })

  test('a dispatch line names each source', async () => {
    expect(
      dispatchLine({ agentId: 'a', type: 'Plan', description: 'x', row: 'Plan', model: 'claude-opus-5-5', modelSource: 'claude', effortSource: 'default', startedAt: 0 }),
    ).toBe("Opus 5.5 (Claude's call) · no effort (its default)")
  })
})
