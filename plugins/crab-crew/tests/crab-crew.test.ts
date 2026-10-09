import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import type { CrewMember } from '../types'
import { characterKeyOf, crewNameOf, poseOf, progressOf, quipOf, todoPatch } from '../hooks/crew'

const member = (over: Partial<CrewMember> = {}): CrewMember => ({
  id: 'a1',
  agentId: 'a1',
  type: 'Explore',
  character: 'scout',
  name: 'Pip',
  description: 'Find the config loader',
  model: 'claude-haiku-4-5',
  status: 'running',
  startedAt: 0,
  lastActiveAt: 0,
  activity: 'read',
  detail: 'config.ts',
  toolCalls: 3,
  errors: 0,
  steps: 2,
  contextTokens: 0,
  tokens: 0,
  ...over,
})

const PANE_PROPS = {
  title: 'Crab Crew',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 6,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 5 },
  view: {},
}

describe('casting', () => {
  test('standard agent types get their own characters', async () => {
    expect(characterKeyOf('general-purpose')).toBe('deckhand')
    expect(characterKeyOf('Explore')).toBe('scout')
    expect(characterKeyOf('Plan')).toBe('navigator')
    expect(characterKeyOf('claude-code-guide')).toBe('professor')
    expect(characterKeyOf('some-plugin:Explore')).toBe('scout')
  })

  test('other agent types are dealt a pool character, the same one every time', async () => {
    const first = characterKeyOf('my-reviewer')
    expect(['cook', 'sleuth', 'wizard', 'diver']).toContain(first)
    expect(characterKeyOf('my-reviewer')).toBe(first)
  })

  test('crabs of one character take the next free name', async () => {
    expect(crewNameOf('scout', [])).toBe('Pip')
    expect(crewNameOf('scout', [member()])).toBe('Wren')
    const five = ['a', 'b', 'c', 'd', 'e'].map(id => member({ id }))
    expect(crewNameOf('scout', five)).toBe('Pip II')
  })
})

describe('progress and poses', () => {
  test('an estimate never reaches the flag before the agent is done', async () => {
    const p = progressOf(member({ toolCalls: 500 }))
    expect(p.isEstimate).toBe(true)
    expect(p.value).toBeLessThan(0.93)
    expect(progressOf(member({ status: 'done' })).value).toBe(1)
  })

  test('a todo list gives real progress', async () => {
    const patch = todoPatch(
      'TodoWrite',
      {
        todos: [
          { content: 'a', status: 'completed', activeForm: 'Doing a' },
          { content: 'b', status: 'in_progress', activeForm: 'Doing b' },
          { content: 'c', status: 'pending', activeForm: 'Doing c' },
          { content: 'd', status: 'pending', activeForm: 'Doing d' },
        ],
      },
      member(),
    )
    expect(patch.todoTotal).toBe(4)
    expect(patch.todoNote).toBe('Doing b')
    const p = progressOf(member(patch))
    expect(p.isEstimate).toBe(false)
    expect(p.value).toBe(1.5 / 4)
  })

  test('status and recency choose the pose', async () => {
    expect(poseOf(member({ lastActiveAt: 9_000 }), 10_000)).toBe('fast')
    expect(poseOf(member({ lastActiveAt: 0 }), 10_000)).toBe('walk')
    expect(poseOf(member({ lastActiveAt: 0 }), 30_000)).toBe('wait')
    expect(poseOf(member({ activity: 'think' }), 30_000)).toBe('think')
    expect(poseOf(member({ status: 'done', endedAt: 10_000 }), 12_000)).toBe('cheer')
    expect(poseOf(member({ status: 'done', endedAt: 10_000 }), 60_000)).toBe('rest')
    expect(poseOf(member({ status: 'failed' }), 0)).toBe('dizzy')
    expect(poseOf(member({ status: 'stopped' }), 0)).toBe('sleep')
  })

  test('lines are in character and name the target', async () => {
    expect(quipOf(member(), 1_000)).toMatch(/config\.ts/)
    expect(quipOf(member({ status: 'done', endedAt: 1 }), 2)).not.toBe('')
  })
})

// Text or, on the desktop, an Svg's alt: the desktop draws the crew as pictures.
const shows = async (ui: { findAll: (q: object) => Promise<{ text: string; props: Record<string, unknown> }[]> }, re: RegExp) =>
  (await ui.findAll({})).some(f => re.test(f.text) || re.test(String(f.props.alt ?? '')))

// What the engine draws in the band when the mod passes: a stand-in to tell the two apart.
const engineBand = (on: On) =>
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine band') as RenderElement
  })

describe('the crew on screen', () => {
  test('a spawned Explore agent joins as a scout, in the pane and the band', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    engineBand(on)
    on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'agent-1' }))
    await $.agent.spawn({
      tool_use_id: 'toolu_test',
      prompt: 'Find the config loader',
      description: 'Find the config loader',
      subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'crab-crew', surface, component: 'Pane', requestId: 'crab-crew', props: PANE_PROPS })
      expect(await shows(pane, /Pip the Scout/)).toBe(true)
      await pane.unmount()

      const band = await $.ui.mount({ plugin: 'crab-crew', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await band.find({ key: 'crab-crew-open' })).toBeDefined()
      await band.unmount()
    }

    // Dismissed, the band goes back to the engine until someone else sets out.
    const band = await $.ui.mount({ plugin: 'crab-crew', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    await band.press({ key: 'crab-crew-dismiss' })
    expect(await band.find({ key: 'crab-crew-open' })).toBeUndefined()
    expect(await band.find({ text: 'engine band' })).toBeDefined()
    await band.unmount()
  })

  test('with nobody dispatched, the pane shows the roster and the band is left to the engine', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    engineBand(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'crab-crew', surface, component: 'Pane', requestId: 'crab-crew', props: PANE_PROPS })
      expect(await shows(pane, /Navigator/)).toBe(true)
      await pane.unmount()

      const band = await $.ui.mount({ plugin: 'crab-crew', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await band.find({ key: 'crab-crew-open' })).toBeUndefined()
      expect(await band.find({ text: 'engine band' })).toBeDefined()
      await band.unmount()
    }
  })
})
