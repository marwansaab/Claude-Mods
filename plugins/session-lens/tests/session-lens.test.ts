import { describe, expect, mock, test } from 'claude-code/testing'

import { stepSvg, toolSvg } from '../hooks/art'
import { DESKTOP_PLAN, DESKTOP_WRAP_UP, EMPTY_PLAN, countTool, groupLabel, markAlways, planAfter, skillOfPath, toolGroups, toolRows } from '../hooks/track'
import type { LensPlan, LensTool } from '../types'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: {
    title: 'Session lens',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

// Text, or on the desktop an Svg's alt: the desktop draws the rows as pictures.
const shows = async (ui: { findAll: (q: object) => Promise<{ text: string; props: Record<string, unknown> }[]> }, re: RegExp) =>
  (await ui.findAll({})).some(f => re.test(f.text) || re.test(String(f.props.alt ?? '')))

const statuses = (p: LensPlan | null) => p?.steps.map(s => s.status)

describe('the task list', () => {
  test('TodoWrite replaces the list, keeping the doing-now wording', async () => {
    const p = planAfter(
      EMPTY_PLAN,
      'TodoWrite',
      {
        todos: [
          { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
          { content: 'Write the fix', status: 'in_progress', activeForm: 'Writing the fix' },
          { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' },
        ],
      },
      undefined,
      10,
    )
    expect(statuses(p)).toEqual(['completed', 'in_progress', 'pending'])
    expect(p?.steps[1]?.active).toBe('Writing the fix')
  })

  test('TaskCreate adds steps that TaskUpdate finds by id, and a deleted one goes', async () => {
    let p = planAfter(EMPTY_PLAN, 'TaskCreate', { subject: 'One', description: '' }, { task: { id: '7' } }, 1)!
    p = planAfter(p, 'TaskCreate', { subject: 'Two', description: '' }, { task: { id: '8' } }, 2)!
    p = planAfter(p, 'TaskUpdate', { taskId: '7', status: 'completed' }, undefined, 3)!
    expect(statuses(p)).toEqual(['completed', 'pending'])
    expect(p.doneBefore).toBe(0)
    p = planAfter(p, 'TaskUpdate', { taskId: '8', status: 'deleted' }, undefined, 4)!
    expect(p.steps.map(s => s.text)).toEqual(['One'])
    expect(planAfter(p, 'TaskUpdate', { taskId: '99', status: 'completed' }, undefined, 5)).toBeNull()
  })

  test("the desktop app's plan: a new list, advance, done, start, and wrap-up ticking all off", async () => {
    let p = planAfter(
      EMPTY_PLAN,
      DESKTOP_PLAN,
      {
        items: [
          { content: 'Look around', status: 'in_progress' },
          { content: 'Change it', status: 'pending' },
          { content: 'Check it', status: 'pending' },
        ],
      },
      undefined,
      1,
    )!
    p = planAfter(p, DESKTOP_PLAN, { advance: true }, undefined, 2)!
    expect(statuses(p)).toEqual(['completed', 'in_progress', 'pending'])
    expect(p.doneBefore).toBe(0)
    p = planAfter(p, DESKTOP_PLAN, { done: [2], start: 3 }, undefined, 3)!
    expect(statuses(p)).toEqual(['completed', 'completed', 'in_progress'])
    expect(p.doneBefore).toBe(1)
    p = planAfter(p, DESKTOP_WRAP_UP, { recap: 'Done.' }, undefined, 4)!
    expect(statuses(p)).toEqual(['completed', 'completed', 'completed'])
    expect(planAfter(p, DESKTOP_WRAP_UP, { recap: 'Again.' }, undefined, 5)).toBeNull()
  })
})

describe('tools', () => {
  const used = (): Record<string, LensTool> => {
    let t: Record<string, LensTool> = {}
    t = countTool(t, 'Read', false, 1)
    t = countTool(t, 'Read', false, 5)
    t = countTool(t, 'Read', false, 6)
    t = countTool(t, 'mcp__obsidian-cli-mcp__search', false, 2)
    t = countTool(t, 'mcp__obsidian-cli-mcp__read_note', true, 9)
    t = countTool(t, 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__create', false, 3)
    return t
  }

  test('counts calls and failures, and remembers the count before', async () => {
    const t = used()
    expect(t.Read?.count).toBe(3)
    expect(t.Read?.countBefore).toBe(2)
    expect(t['mcp__obsidian-cli-mcp__read_note']?.errors).toBe(1)
  })

  test('groups are named as /mcp lists them, else tidied; a connector id is never shown whole', async () => {
    expect(groupLabel('', {})).toBe('Built-in')
    expect(groupLabel('obsidian-cli-mcp', {})).toBe('Obsidian CLI MCP')
    expect(groupLabel('plugin_review-desk_review-desk', {})).toBe('Review Desk')
    expect(groupLabel('ccd_session', {})).toBe('Desktop app · Session')
    expect(groupLabel('1a59c906-04da-521d-bda7-7f71b9f9e01c', {})).toBe('Connector 1a59')
    expect(groupLabel('1a59c906-04da-521d-bda7-7f71b9f9e01c', { '1a59c906-04da-521d-bda7-7f71b9f9e01c': 'claude.ai Docs' })).toBe('Docs')
  })

  test('sorted by use, by name or by recency, and grouped by server', async () => {
    const t = used()
    expect(toolRows(t, {}, 'count', '').map(r => r.label)[0]).toBe('Read')
    expect(toolRows(t, {}, 'recent', '').map(r => r.label)[0]).toBe('read note')
    expect(toolRows(t, {}, 'name', '').map(r => r.label)).toEqual(['create', 'Read', 'read note', 'search'])
    const groups = toolGroups(toolRows(t, {}, 'count', ''), 'count')
    expect(groups.map(g => [g.label, g.count])).toEqual([
      ['Built-in', 3],
      ['Obsidian CLI MCP', 2],
      ['Connector 1a59', 1],
    ])
  })

  test('the filter matches a tool or its group', async () => {
    const t = used()
    expect(toolRows(t, {}, 'count', 'obsidian').map(r => r.label).sort()).toEqual(['read note', 'search'])
    expect(toolRows(t, {}, 'count', 'READ').map(r => r.label).sort()).toEqual(['Read', 'read note'])
    expect(toolRows(t, {}, 'count', 'nothing like it')).toEqual([])
  })
})

describe('skills and pictures', () => {
  test('a SKILL.md path names its skill on either slash, and marks it always loaded', async () => {
    expect(skillOfPath('C:\\Users\\me\\.claude\\skills\\graphify\\SKILL.md')).toBe('graphify')
    expect(skillOfPath('/home/me/.claude/skills/commit/SKILL.md')).toBe('commit')
    expect(skillOfPath('/home/me/CLAUDE.md')).toBe('')
    expect(markAlways({}, ['graphify']).graphify).toEqual({ name: 'graphify', count: 0, lastAt: 0, isAlways: true })
  })

  test('every picture settles when motion is reduced, and says what it shows', async () => {
    const step = stepSvg(300, { text: 'Write <the> fix', status: 'completed' }, 0)
    expect(step.svg).toContain('prefers-reduced-motion: reduce')
    expect(step.svg).toContain('Write &lt;the&gt; fix')
    expect(step.alt).toBe('Step 1, done: Write <the> fix')
    const tool = toolSvg(300, { ...countTool({}, 'Read', false, 1).Read!, label: 'Read', group: 'builtin', groupLabel: 'Built-in' }, 0, true)
    expect(tool.alt).toBe('Read (Built-in): 1 call')
  })
})

describe('the pane', () => {
  test('lists the tools this session called, grouped, and flat on request', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/b.ts' })
    await $.tool.call({ tool: 'mcp__obsidian-cli-mcp__search', query: 'x' } as never)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await shows(ui, /Built-in/)).toBe(true)
      expect(await shows(ui, /Obsidian CLI MCP/)).toBe(true)
      expect(await shows(ui, /2 tools · 3 calls/)).toBe(true)
      await ui.press({ key: 'group-off' })
      expect(await ui.find({ key: 'grp-builtin' })).toBeUndefined()
      expect(await shows(ui, /search/)).toBe(true)
      await ui.press({ key: 'group-on' })
      expect(await ui.find({ key: 'grp-builtin' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('the filter narrows the tools, and Clear brings them back', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
    await $.tool.call({ tool: 'mcp__obsidian-cli-mcp__search', query: 'x' } as never)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.input({ key: 'filter', text: 'obsidian', kind: 'change' })
      expect(await ui.find({ key: 'grp-builtin' })).toBeUndefined()
      expect(await ui.find({ key: 'grp-obsidian-cli-mcp' })).toBeDefined()
      await ui.press({ key: 'filter-clear' })
      expect(await ui.find({ key: 'grp-builtin' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a TodoWrite call draws the list with its count, and each section folds on its own', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
        { content: 'Write the fix', status: 'in_progress', activeForm: 'Writing the fix' },
        { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' },
      ],
    })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await shows(ui, /1 of 3/)).toBe(true)
      expect(await shows(ui, /Writing the fix/)).toBe(true)
      expect(await shows(ui, /Run the tests/)).toBe(true)
      await ui.press({ key: 'sec-todo' })
      expect(await shows(ui, /Run the tests/)).toBe(false)
      expect(await shows(ui, /TodoWrite/)).toBe(true)
      await ui.press({ key: 'sec-todo' })
      expect(await shows(ui, /Run the tests/)).toBe(true)
      await ui.unmount()
    }
  })

  test('with nothing used yet, each section says so', async $ => {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await shows(ui, /No task list yet/)).toBe(true)
      expect(await shows(ui, /No skills used yet/)).toBe(true)
      expect(await shows(ui, /No tools called yet/)).toBe(true)
      await ui.unmount()
    }
  })
})
