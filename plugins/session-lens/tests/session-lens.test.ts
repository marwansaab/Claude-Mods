import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { skillListSvg, stepSvg, toolListSvg } from '../hooks/art'
import { bandSvg, beachSvg, crewListSvg, legendSvg } from '../hooks/crabs'
import { BASE_MARK, characterKeyOf, crabMeta, crewNameOf, crewOrder, crewSummary, duration, legendOf, listTotals, modelName, outcomeOf, poseOf, progressOf, quipOf, tokensLabel, withChange } from '../hooks/crew'
import { DEFAULT_LAYOUT, DESKTOP_PLAN, contextPercent, contextSize, DESKTOP_WRAP_UP, EMPTY_PLAN, countTool, groupLabel, listOrders, markAlways, movesAfter, parseLayout, planAfter, skillOfPath, stampSteps, toolGroups, toolRows } from '../hooks/track'
import type { LensCrab, LensPlan, LensTool } from '../types'

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
    expect(markAlways({}, ['graphify']).graphify).toEqual({ name: 'graphify', count: 0, firstAt: 0, lastAt: 0, isAlways: true })
  })

  test('every picture settles when motion is reduced, and says what it shows', async () => {
    const step = stepSvg(300, { text: 'Write <the> fix', status: 'completed', changedAt: 1_000 }, 0, 1_000, 1_100)
    expect(step.svg).toContain('prefers-reduced-motion: reduce')
    expect(step.svg).toContain('Write &lt;the&gt; fix')
    expect(step.alt).toBe('Step 1, done: Write <the> fix')
    const tools = toolListSvg(300, [toolRow('Read', 1), toolRow('Bash', 2)], true, undefined, true, () => 1, 1)
    expect(tools.alt).toBe('Read (Built-in): 1 call; Bash (Built-in): 1 call')
    expect(tools.height).toBe(72)
  })
})

/** A built-in tool's row as the pane lists it, used once at `at`. */
const toolRow = (name: string, at: number) => ({ ...countTool({}, name, false, at)[name]!, label: name, group: 'builtin', groupLabel: 'Built-in' })

describe('redraws', () => {
  // The pane is redrawn on every event, and a redrawn picture starts its animations over:
  // so each animation is pinned to when its row changed, and is gone from drawings made after it ended.
  const done = { text: 'Ship it', status: 'completed' as const, addedAt: 1_000, changedAt: 5_000 }
  const working = { text: 'Ship it', status: 'in_progress' as const, addedAt: 1_000, changedAt: 1_000 }
  const animated = (svg: string) => / class="[^"]*\b(in|pop|draw|strk|bump|fade)\b/.test(svg) || /@keyframes sl(t|pb|f)\d*\{/.test(svg)

  test('a drawing made long after its row changed carries no animation, so a redraw shows it still', async () => {
    expect(animated(stepSvg(300, done, 0, 1_000, 60_000).svg)).toBe(false)
    const read = { ...countTool(countTool({}, 'Read', false, 1_000), 'Read', false, 2_000).Read!, label: 'Read', group: 'builtin', groupLabel: 'Built-in' }
    const move = { from: ['Bash'], to: ['Read', 'Bash'], at: 2_000 }
    expect(animated(toolListSvg(300, [read, toolRow('Bash', 1_000)], false, move, true, () => 1_000, 60_000).svg)).toBe(false)
  })

  test('a drawing made mid-animation picks it up where it is, not from the start', async () => {
    const svg = stepSvg(300, done, 0, 1_000, 5_200).svg
    // 0.2 s after the step was ticked off: the check's pop is 0.2 s in.
    expect(svg).toContain('class="pop" style="animation-delay:-0.200s;"')
  })

  test('the loops on the step in progress keep their phase from one drawing to the next', async () => {
    const at = (now: number) => /class="spin" style="animation-delay:(-[\d.]+)s;"/.exec(stepSvg(300, working, 0, 1_000, now).svg)?.[1]
    expect(at(10_000)).toBe((-((10_000 / 1000) % 1.1)).toFixed(3))
    expect(at(10_550)).toBe((-((10_550 / 1000) % 1.1)).toFixed(3))
  })

  test('a step keeps when it was added and changed until its text or status changes', async () => {
    const a = stampSteps([], [{ text: 'A', status: 'pending' }, { text: 'B', status: 'pending' }], 10)
    const b = stampSteps(a, [{ text: 'A', status: 'completed' }, { text: 'B', status: 'pending' }, { text: 'C', status: 'pending' }], 20)
    expect(b.map(s => [s.addedAt, s.changedAt])).toEqual([
      [10, 20],
      [10, 10],
      [20, 20],
    ])
  })
})

describe('settling', () => {
  // The app keeps the pane's last drawing and may show it again without asking the mod: so once a
  // change's animations are over, the mod asks for one more drawing, which has none left to replay.
  test('a tool call is followed, once its animations end, by one fresh drawing', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 })
    const asked: string[] = []
    on('ui.invalidate', (_, e) => {
      asked.push(e.event)
      return { value: undefined }
    })
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/b.ts' })
    await clock.advance(1_000)
    expect(asked).toEqual([])
    await clock.advance(700)
    // Two calls close together: one drawing, after the later one's animations.
    expect(asked).toEqual(['ui.render'])
  })
})

describe('rows that fly', () => {
  const rows = [toolRow('Bash', 1_000), toolRow('Read', 1_000), toolRow('Edit', 1_000)]

  test('a tool that moves up flies from its old slot, the one it passed shifts down, the one that stayed is still', async () => {
    // Bash was second and is now first; Read went from first to second; Edit stayed third.
    const move = { from: ['Read', 'Bash', 'Edit'], to: ['Bash', 'Read', 'Edit'], at: 5_000 }
    const svg = toolListSvg(300, rows, false, move, true, () => 0, 5_100).svg
    expect(svg).toContain('@keyframes slf0{from{transform:translateY(36px)}')
    expect(svg).toContain('@keyframes slf1{from{transform:translateY(-36px)}')
    expect(svg).not.toContain('slf2')
    // 0.1 s into the flight.
    expect(svg).toContain('-0.100s both}')
  })

  test('a tool that joins the list flies in from below its end, fading in', async () => {
    const move = { from: ['Bash', 'Edit'], to: ['Bash', 'Read', 'Edit'], at: 5_000 }
    const svg = toolListSvg(300, rows, false, move, true, () => 0, 5_100).svg
    // Read lands in the second slot, from below the third: two rows up.
    expect(svg).toContain('@keyframes slf1{from{transform:translateY(72px);opacity:0}')
    // Edit is pushed down one slot.
    expect(svg).toContain('@keyframes slf2{from{transform:translateY(-36px)}')
  })

  test('nothing flies while the filter is on, nor in a list seen for the first time, nor once the flight is over', async () => {
    const move = { from: ['Read', 'Bash', 'Edit'], to: ['Bash', 'Read', 'Edit'], at: 5_000 }
    expect(toolListSvg(300, rows, false, move, false, () => 0, 5_100).svg).not.toContain('slf')
    expect(toolListSvg(300, rows, false, { ...move, from: [] }, true, () => 0, 5_100).svg).not.toContain('slf')
    expect(toolListSvg(300, rows, false, move, true, () => 0, 7_000).svg).not.toContain('slf')
  })

  test('a skill that joins flies in too', async () => {
    const skills = [
      { name: 'graphify', count: 2, firstAt: 1_000, lastAt: 4_000, isAlways: false },
      { name: 'commit', count: 1, firstAt: 5_000, lastAt: 5_000, isAlways: false },
    ]
    const svg = skillListSvg(300, skills, { from: ['graphify'], to: ['graphify', 'commit'], at: 5_000 }, 0, 5_200).svg
    expect(svg).toContain('@keyframes slf1{from{transform:translateY(32px);opacity:0}')
  })

  test('only lists whose order changed get a new move', async () => {
    const first = movesAfter({}, { flat: ['Read'], skills: [] }, 1)!
    expect(first.flat).toEqual({ from: [], to: ['Read'], at: 1 })
    expect(first.skills).toBeUndefined()
    expect(movesAfter(first, { flat: ['Read'], skills: [] }, 2)).toBeNull()
    const second = movesAfter(first, { flat: ['Bash', 'Read'], skills: [] }, 3)!
    expect(second.flat).toEqual({ from: ['Read'], to: ['Bash', 'Read'], at: 3 })
  })

  test('the lists are ordered as the pane shows them, unfiltered', async () => {
    let t: Record<string, LensTool> = {}
    t = countTool(t, 'Read', false, 1)
    t = countTool(t, 'mcp__notion__search', false, 2)
    t = countTool(t, 'mcp__notion__search', false, 3)
    const orders = listOrders(t, {}, {}, 'count')
    expect(orders.flat).toEqual(['mcp__notion__search', 'Read'])
    expect(orders['g:notion']).toEqual(['mcp__notion__search'])
    expect(orders['g:builtin']).toEqual(['Read'])
  })
})

// What stands for the engine's session start beneath the mod.
const startSession = async ($: Engine, on: On) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'lens' } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

// A store in memory the test can read back: what stands for the engine's store beneath the mod.
const keptStore = (on: On) => {
  const kept: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value
    return { value: undefined }
  })
  return kept
}

describe('the pane', () => {
  test('starts with To-do and Skills open, Tools closed, and its server groups collapsed', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/b.ts' })
    await $.tool.call({ tool: 'mcp__obsidian-cli-mcp__search', query: 'x' } as never)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      // Closed: the header and its summary alone.
      expect(await shows(ui, /2 tools · 3 calls/)).toBe(true)
      expect(await ui.find({ key: 'grp-builtin' })).toBeUndefined()
      await ui.press({ key: 'sec-tools' })
      // Open: the groups, each collapsed to its header.
      expect(await ui.find({ key: 'grp-builtin' })).toBeDefined()
      expect(await shows(ui, /Obsidian CLI MCP/)).toBe(true)
      expect(await shows(ui, /search/)).toBe(false)
      await ui.press({ key: 'grp-obsidian-cli-mcp' })
      expect(await shows(ui, /search/)).toBe(true)
      await ui.press({ key: 'grp-obsidian-cli-mcp' })
      await ui.press({ key: 'sec-tools' })
      await ui.unmount()
    }
  })

  test('Expand all and Collapse all turn every group, and the flat list lists every tool', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
    await $.tool.call({ tool: 'mcp__obsidian-cli-mcp__search', query: 'x' } as never)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.press({ key: 'sec-tools' })
      expect((await ui.find({ key: 'groups-all' }))?.text).toMatch(/Expand all/)
      await ui.press({ key: 'groups-all' })
      expect(await shows(ui, /search/)).toBe(true)
      expect((await ui.find({ key: 'groups-all' }))?.text).toMatch(/Collapse all/)
      await ui.press({ key: 'groups-all' })
      expect(await shows(ui, /search/)).toBe(false)
      await ui.press({ key: 'group-off' })
      expect(await ui.find({ key: 'grp-builtin' })).toBeUndefined()
      expect(await ui.find({ key: 'groups-all' })).toBeUndefined()
      expect(await shows(ui, /search/)).toBe(true)
      await ui.press({ key: 'group-on' })
      await ui.press({ key: 'sec-tools' })
      await ui.unmount()
    }
  })

  test('the filter opens the groups that match, and Clear brings the rest back', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
    await $.tool.call({ tool: 'mcp__obsidian-cli-mcp__search', query: 'x' } as never)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.press({ key: 'sec-tools' })
      await ui.input({ key: 'filter', text: 'obsidian', kind: 'change' })
      expect(await ui.find({ key: 'grp-builtin' })).toBeUndefined()
      expect(await shows(ui, /search/)).toBe(true)
      await ui.press({ key: 'filter-clear' })
      expect(await ui.find({ key: 'grp-builtin' })).toBeDefined()
      expect(await shows(ui, /search/)).toBe(false)
      await ui.press({ key: 'sec-tools' })
      await ui.unmount()
    }
  })

  test('a TodoWrite call draws the list with its count, and To-do folds to its header', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    mock.store(on)
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
      expect(await shows(ui, /1 of 3/)).toBe(true)
      await ui.press({ key: 'sec-todo' })
      expect(await shows(ui, /Run the tests/)).toBe(true)
      await ui.unmount()
    }
  })

  test('with nothing used yet, each section is its header alone', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ key: 'sec-todo' })).toBeDefined()
      expect(await ui.find({ key: 'sec-skills' })).toBeDefined()
      expect(await ui.find({ key: 'sec-tools' })).toBeDefined()
      expect(await shows(ui, /No task list|No skills|No tools/)).toBe(false)
      expect(await ui.find({ key: 'filter' })).toBeUndefined()
      await ui.unmount()
    }
  })
})

describe('the kept layout', () => {
  test('a change of layout is kept in the store, without the filter', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    const kept = keptStore(on)
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'sec-tools' })
    await ui.press({ key: 'sort-name' })
    await ui.input({ key: 'filter', text: 'rea', kind: 'change' })
    await ui.unmount()
    expect(kept.layout).toEqual({ folded: [], groupsOpen: false, groupExceptions: [], isGrouped: true, sort: 'name', isLegendOpen: false })
  })

  test('a new session starts from the kept layout', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    mock.store(on, { layout: { folded: ['todo'], groupsOpen: true, groupExceptions: ['builtin'], isGrouped: true, sort: 'recent' } })
    on('tool.call', () => ({ result: {} }))
    await startSession($, on)
    await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
    await $.tool.call({ tool: 'mcp__obsidian-cli-mcp__search', query: 'x' } as never)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    // Tools open, its groups open but for Built-in, which the person had closed.
    expect(await shows(ui, /search/)).toBe(true)
    expect(await shows(ui, /^Read$/)).toBe(false)
    expect((await ui.find({ key: 'sort-recent' }))?.text).toMatch(/●/)
    await ui.unmount()
  })

  test('a layout kept in a bad shape falls back to the defaults, field by field', async () => {
    expect(parseLayout({ folded: ['nope', 'skills'], sort: 'sideways', groupsOpen: 'yes' })).toEqual({
      folded: ['skills'],
      groupsOpen: false,
      groupExceptions: [],
      isGrouped: true,
      sort: 'count',
      isLegendOpen: false,
    })
    expect(parseLayout(undefined)).toEqual(DEFAULT_LAYOUT)
  })

  test('closing the pane with /lens is remembered; opening it again forgets it', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    const kept = keptStore(on)
    let isOpen = true
    on('ui.open', () => {
      isOpen = true
      return { value: { isPlaced: true } }
    })
    on('ui.close', () => {
      isOpen = false
      return { value: undefined }
    })
    on('ui.panes', () => ({ value: isOpen ? [{ id: 'session-lens', title: 'Session lens', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    await startSession($, on)
    await $.command.run({ command: 'lens', args: '' } as never)
    expect(kept.paneClosed).toBe(true)
    await $.command.run({ command: 'lens', args: '' } as never)
    expect(kept.paneClosed).toBe(false)
  })
})

// ---------- the crew ----------

/** A crab as the crew keeps one, at work unless told otherwise. */
const crabOf = (id: string, name: string, character: string, over: Partial<LensCrab> = {}): LensCrab => ({
  id,
  agentId: id,
  type: 'Explore',
  character,
  name,
  description: 'Find the config loader',
  status: 'running',
  startedAt: 1_000,
  lastActiveAt: 1_000,
  activity: 'read',
  detail: 'config.ts',
  toolCalls: 4,
  errors: 0,
  progressBefore: 0,
  progressAt: 1_000,
  ...over,
})

describe('the crew', () => {
  test('agent types are cast as characters, and crabs of one character take the next free name', async () => {
    expect(characterKeyOf('Explore')).toBe('scout')
    expect(characterKeyOf('general-purpose')).toBe('deckhand')
    expect(characterKeyOf('some-plugin:Plan')).toBe('navigator')
    expect(characterKeyOf('my-reviewer')).toBe(characterKeyOf('my-reviewer'))
    expect(crewNameOf('scout', [])).toBe('Pip')
    expect(crewNameOf('scout', [crabOf('a', 'Pip', 'scout')])).toBe('Wren')
  })

  test('progress comes from the crab’s own to-do list, else an estimate that only a finished crab completes', async () => {
    expect(progressOf(crabOf('a', 'Pip', 'scout', { todoTotal: 4, todoDone: 1.5 })).value).toBe(1.5 / 4)
    const guess = progressOf(crabOf('a', 'Pip', 'scout', { toolCalls: 500 }))
    expect(guess.isEstimate).toBe(true)
    expect(guess.value).toBeLessThan(0.93)
    expect(progressOf(crabOf('a', 'Pip', 'scout', { status: 'done' })).value).toBe(1)
  })

  test('a change that moves the progress makes the bar grow from where it was', async () => {
    const m = crabOf('a', 'Pip', 'scout', { toolCalls: 2 })
    const next = withChange(m, { toolCalls: 3 }, 9_000)
    expect(next.progressAt).toBe(9_000)
    expect(Math.abs(next.progressBefore - progressOf(m).value) < 1e-9).toBe(true)
    expect(withChange(m, { detail: 'x.ts' }, 9_500).progressAt).toBe(1_000)
  })

  test('crabs at work keep the order they set out in; one done stays on the beach 3 s; the latest back is first', async () => {
    // Ada set out first, then Pip, then Barnacle; Pip is far ahead of Ada, but the order is theirs to keep.
    const crew = {
      a: crabOf('a', 'Pip', 'scout', { toolCalls: 30, startedAt: 2_000 }),
      b: crabOf('b', 'Ada', 'navigator', { toolCalls: 2, startedAt: 1_000 }),
      c: crabOf('c', 'Barnacle', 'deckhand', { status: 'done', endedAt: 5_000, progressBefore: 0.05, startedAt: 3_000 }),
      d: crabOf('d', 'Merla', 'wizard', { status: 'failed', endedAt: 4_000 }),
      e: crabOf('e', 'Cookie', 'cook', { status: 'stopped', endedAt: 6_000 }),
    }
    // A second after Barnacle finished he is still past his flag, in his own place.
    expect(crewOrder(crew, 6_000)).toEqual(['b', 'a', 'c', BASE_MARK, 'e', 'd'])
    // Three seconds on he has reported back: the latest of those back goes first.
    expect(crewOrder(crew, 9_000)).toEqual(['b', 'a', BASE_MARK, 'e', 'c', 'd'])
    expect(crewSummary(crew)).toBe('2 at work · 3 back')
    expect(outcomeOf('answer')).toBe('done')
    expect(outcomeOf('aborted')).toBe('stopped')
  })

  test('a crab drawn long after it changed carries no animation but its loops', async () => {
    // Pip made a call a second ago, so he is drawn working: legs scuttling, a loop that stays.
    const working = [crabOf('a', 'Pip', 'scout', { lastActiveAt: 89_000 })]
    const base = [crabOf('c', 'Barnacle', 'deckhand', { status: 'done', endedAt: 5_000 })]
    const move = { from: ['c', 'a', BASE_MARK], to: ['a', BASE_MARK, 'c'], at: 5_000 }
    const svg = beachSvg(360, working, move, 0, 90_000).svg + crewListSvg(360, 'work', working, move, 0, 90_000).svg + crewListSvg(360, 'base', base, move, 0, 90_000).svg
    expect(svg).not.toMatch(/@keyframes c[fhlw]\d/)
    expect(svg).not.toMatch(/class="[^"]*\b(c-hop|c-raise|c-spark)\b/)
    expect(svg).toContain('class="c-legA"')
  })

  test('a crab that reports back flies into the top of the list, lit; the one that closes the gap at work is not', async () => {
    const working = [crabOf('a', 'Pip', 'scout')]
    const base = [crabOf('c', 'Barnacle', 'deckhand', { status: 'done', endedAt: 5_000 })]
    // Barnacle was first at work; now Pip is alone at work and Barnacle has reported back.
    const move = { from: ['c', 'a', BASE_MARK], to: ['a', BASE_MARK, 'c'], at: 5_000 }
    const work = crewListSvg(360, 'work', working, move, 0, 5_100).svg
    const back = crewListSvg(360, 'base', base, move, 0, 5_100).svg
    // Pip rises one row into the gap, unlit.
    expect(work).toContain('@keyframes cf0{0%{transform:translateY(42px)}')
    expect(work).not.toContain('.cf0h{')
    // Barnacle comes in from just under the list's title, fading in, lit, cheering.
    expect(back).toContain('@keyframes cf0{0%{transform:translateY(-60px);opacity:0}')
    expect(back).toContain('.cf0h{')
    expect(back).toContain('class="c-hop"')
    // On the beach his lane is gone; Pip's glides up into it.
    expect(beachSvg(360, working, move, 0, 5_100).svg).toMatch(/@keyframes cl1\{from\{transform:translateY\(38px\)\}/)
  })

  test('a new crab flies in at the foot of the working list, fading in', async () => {
    const working = [crabOf('a', 'Pip', 'scout', { toolCalls: 9 }), crabOf('b', 'Ada', 'navigator', { toolCalls: 0 })]
    const move = { from: ['a', BASE_MARK], to: ['a', 'b', BASE_MARK], at: 5_000 }
    // Ada's row comes up from below the last working row, lit.
    const work = crewListSvg(360, 'work', working, move, 0, 5_100).svg
    expect(work).toContain('@keyframes cf1{0%{transform:translateY(42px);opacity:0}')
    expect(work).toContain('.cf1h{')
    // Her lane on the beach (lane 2, under the captain's and Pip's) fades in.
    expect(beachSvg(360, working, move, 0, 5_100).svg).toContain('.cl2{animation:sl-fade')
  })

  test('on the beach, a crab walks from where its progress was, says its line, and thinks in a dashed bubble', async () => {
    // Pip's last call, just now, moved his progress on: he is a moment into his walk.
    const pip = crabOf('a', 'Pip', 'scout', { toolCalls: 5, progressBefore: 0.1, progressAt: 5_000, lastActiveAt: 5_000 })
    const ada = crabOf('b', 'Ada', 'navigator', { activity: 'think', lastActiveAt: 5_000 })
    const svg = beachSvg(360, [pip, ada], undefined, 0, 5_200).svg
    // Lane 0 is the captain's; Pip walks lane 1.
    expect(svg).toMatch(/@keyframes cw1\{from\{transform:translateX\(-\d+(\.\d)?px\)\}/)
    expect(svg).toContain('-0.200s both}')
    // One of the Scout's own lines about what he is reading, the same one on every drawing.
    expect(quipOf(pip, 5_200)).toMatch(/config\.ts/)
    expect(svg).toContain(quipOf(pip, 5_200))
    expect(svg).toContain('stroke-dasharray="3 2"')
    // Long after, the walk is over and the beach is still but for its loops.
    expect(beachSvg(360, [pip, ada], undefined, 0, 60_000).svg).not.toContain('@keyframes cw1')
  })

  test('a crab’s sparkles burst while it cheers and are gone after', async () => {
    const done = crabOf('c', 'Barnacle', 'deckhand', { status: 'done', endedAt: 5_000 })
    expect(crewListSvg(360, 'base', [done], undefined, 0, 5_300).svg).toContain('c-spark')
    expect(crewListSvg(360, 'base', [done], undefined, 0, 9_000).svg).not.toMatch(/<path[^>]*fill="#ffd54a"/)
  })

  test('no drawing gives an element the same attribute twice, which would break the whole picture', async () => {
    // A picture whose XML does not parse is drawn as a broken image: one doubled `class` hides a whole list.
    const doubled = (svg: string) => [...svg.matchAll(/<[a-zA-Z]+((?:\s+[a-zA-Z:-]+="[^"]*")*)\s*\/?>/g)].some(m => {
      const names = [...(m[1] ?? '').matchAll(/\s([a-zA-Z:-]+)="/g)].map(n => n[1])
      return new Set(names).size !== names.length
    })
    const now = 5_200
    const working = [
      crabOf('a', 'Pip', 'scout', { progressBefore: 0.1, progressAt: 5_000, lastActiveAt: 5_000 }),
      crabOf('b', 'Ada', 'navigator', { activity: 'think', lastActiveAt: 5_000 }),
      crabOf('w', 'Rusty', 'deckhand', { lastActiveAt: 1 }),
    ]
    const base = [
      crabOf('c', 'Barnacle', 'deckhand', { status: 'done', endedAt: 5_000 }),
      crabOf('d', 'Merla', 'wizard', { status: 'failed', endedAt: 4_000 }),
      crabOf('e', 'Cookie', 'cook', { status: 'stopped', endedAt: 4_000 }),
    ]
    const move = { from: ['c', 'b', 'a', BASE_MARK, 'd'], to: ['a', 'b', 'w', BASE_MARK, 'c', 'd', 'e'], at: 5_100 }
    for (const at of [now, 60_000]) {
      expect(doubled(beachSvg(360, working, move, 5_000, at).svg)).toBe(false)
      expect(doubled(crewListSvg(360, 'work', working, move, 5_000, at).svg)).toBe(false)
      expect(doubled(crewListSvg(360, 'base', base, move, 5_000, at).svg)).toBe(false)
    }
    expect(doubled(bandSvg(600, [...working, ...base], now).svg)).toBe(false)
    expect(doubled(stepSvg(300, { text: 'x', status: 'in_progress', changedAt: 5_000 }, 0, 5_000, now).svg)).toBe(false)
    expect(doubled(toolListSvg(300, [toolRow('Read', 5_000)], true, { from: ['Bash'], to: ['Read', 'Bash'], at: 5_000 }, true, () => 5_000, now).svg)).toBe(false)
  })

  test('the captain walks his lane as Claude’s to-do list moves, and a crab that is done stands past its flag', async () => {
    const skipper = { captain: { isBusy: true, activity: 'edit' as const, detail: 'art.ts', lastActiveAt: 5_000 }, done: 2, total: 4, doneBefore: 1, changedAt: 5_000 }
    const pip = crabOf('a', 'Pip', 'scout', { status: 'done', endedAt: 5_000, progressBefore: 0.4, progressAt: 5_000 })
    const d = beachSvg(360, [pip], undefined, 0, 5_200, skipper)
    const svg = d.svg
    // Lane 0 is the captain's: he is walking from a quarter of the way to half, saying what he does.
    expect(svg).toMatch(/@keyframes cw0\{from\{transform:translateX\(-\d+(\.\d)?px\)\}/)
    expect(d.alt).toContain('Captain Clawd: Taking the wheel: art.ts')
    expect(svg).toContain('Taking the wheel')
    // Lane 1 is Pip's: past his flag (at w − 50), at w − 42.
    expect(svg).toContain('translate(318.0 64)')
    expect(svg).toContain('class="c-hop"')
  })

  test('crab-crew’s details: the model by name, tokens short, time as a clock, and a crab’s line', async () => {
    expect(modelName('claude-haiku-4-5')).toBe('Haiku 4.5')
    expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(modelName('claude-sonnet-5')).toBe('Sonnet 5')
    expect(modelName(undefined)).toBe('')
    expect([tokensLabel(940), tokensLabel(61_400), tokensLabel(1_240_000)]).toEqual(['940', '61k', '1.2M'])
    expect([duration(31_000), duration(140_000), duration(3_849_000)]).toEqual(['0:31', '2:20', '1:04:09'])
    const pip = crabOf('a', 'Pip', 'scout', { model: 'claude-haiku-4-5', toolCalls: 4, tokens: 61_000, activity: 'search', detail: 'loadConfig', lastActiveAt: 4_000 })
    expect(crabMeta(pip, 5_000)).toBe('Haiku 4.5 · searching loadConfig · 4 calls · 61k tok')
    // Left without a call for a while: how long it has waited.
    expect(crabMeta(pip, 35_000)).toBe('Haiku 4.5 · searching loadConfig · waiting 0:31 · 4 calls · 61k tok')
    const wren = crabOf('b', 'Wren', 'scout', { status: 'done', startedAt: 1_000, endedAt: 89_000, model: 'claude-haiku-4-5', toolCalls: 11, tokens: 140_000 })
    expect(crabMeta(wren, 100_000)).toBe('1:28 · Haiku 4.5 · 11 calls · 140k tok')
  })

  test('the race’s totals beside each list’s title: how many, how the runs ended, calls, tokens and time', async () => {
    const working = [
      crabOf('a', 'Pip', 'scout', { startedAt: 1_000, toolCalls: 4, tokens: 61_000 }),
      crabOf('b', 'Ada', 'navigator', { startedAt: 3_000, toolCalls: 9, tokens: 212_000 }),
    ]
    expect(listTotals('work', working, 141_000)).toEqual(['2', '13 calls', '273k tok', '2:20'])
    const base = [
      crabOf('c', 'Wren', 'scout', { status: 'done', startedAt: 2_000, endedAt: 90_000, toolCalls: 11, tokens: 140_000 }),
      crabOf('d', 'Zap', 'wizard', { status: 'failed', startedAt: 4_000, endedAt: 74_000, toolCalls: 6, tokens: 77_000 }),
    ]
    expect(listTotals('base', base, 141_000)).toEqual(['2', '1 overboard', '17 calls', '217k tok', '1:28'])
    expect(listTotals('base', [], 141_000)).toEqual([])
  })

  test('a crab scurries for 3 s after each call, at twice its pace, then walks', async () => {
    const pip = crabOf('a', 'Pip', 'scout', { lastActiveAt: 5_000 })
    expect(poseOf(pip, 6_000)).toBe('scurry')
    expect(poseOf(pip, 9_000)).toBe('work')
    expect(poseOf(pip, 30_000)).toBe('wait')
    // The legs keep their class, run at half the period, and keep their phase.
    expect(beachSvg(360, [pip], undefined, 0, 6_000).svg).toContain('animation-duration:0.225s;')
    expect(beachSvg(360, [pip], undefined, 0, 9_000).svg).not.toContain('animation-duration:0.225s;')
  })

  test('who’s who: the captain, then each kind of crab in the race, with the agent types it stands for', async () => {
    const crew = [
      crabOf('a', 'Pip', 'scout', { type: 'Explore', startedAt: 1_000 }),
      crabOf('b', 'Barnacle', 'deckhand', { type: 'general-purpose', startedAt: 2_000 }),
      crabOf('c', 'Rusty', 'deckhand', { type: 'claude', startedAt: 3_000 }),
      crabOf('d', 'Wren', 'scout', { type: 'Explore', startedAt: 4_000 }),
    ]
    const entries = legendOf(crew)
    // Agent types as Claude Code spells them; the captain, who stands for no type, gets a plain label.
    expect(entries.map(e => [e.role, e.note ?? e.types.join(', ')])).toEqual([
      ['Captain', 'Main thread'],
      ['Scout', 'Explore'],
      ['Deckhand', 'general-purpose, claude'],
    ])
    const d = legendSvg(360, entries, 5_000, 5_100)
    expect(d.alt).toBe("Who's who: Captain = Main thread; Scout = Explore; Deckhand = general-purpose, claude")
    // The types are drawn as code; the captain's label is not.
    expect(d.svg).toMatch(/font-family="ui-monospace[^"]*">Explore</)
    expect(d.svg).toMatch(/font-size="10.5">Main thread</)
    // The legend's crabs stand still; the cards pop in as it opens.
    expect(d.svg).not.toMatch(/class="c-(legA|legB|snip|bob|blink)"/)
    expect(d.svg).toContain('class="pop"')
  })

  test('with the crabs quiet, the beach has no bubbles and the crabs back have no last line', async () => {
    const pip = crabOf('a', 'Pip', 'scout', { toolCalls: 4 })
    const wren = crabOf('b', 'Wren', 'scout', { status: 'done', startedAt: 1_000, endedAt: 9_000 })
    const talking = beachSvg(360, [pip], undefined, 0, 10_000)
    const quiet = beachSvg(360, [pip], undefined, 0, 10_000, undefined, false)
    expect(talking.svg).toContain('class="bub"')
    expect(quiet.svg).not.toContain('class="bub"')
    // The description says who is on the beach and how far each has got, not their lines.
    expect(quiet.alt).toBe('Captain Clawd, off watch. Pip, ≈25%')
    const said = crewListSvg(360, 'base', [wren], undefined, 0, 10_000)
    const unsaid = crewListSvg(360, 'base', [wren], undefined, 0, 10_000, false)
    expect(said.svg).toContain('“')
    expect(unsaid.svg).not.toContain('“')
    // A row with no line under it is shorter.
    expect(unsaid.height).toBeLessThan(said.height)
  })

  test('a crab in its section opens comes in once, and says what it shows', async () => {
    const pip = crabOf('a', 'Pip', 'scout')
    const d = crewListSvg(360, 'work', [pip], undefined, 5_000, 5_100)
    expect(d.svg).toMatch(/class="in" style="animation-delay:-0\.100s;"/)
    expect(d.alt).toBe('At work: Pip the Scout, ≈25%, reading config.ts · 4 calls')
    expect(beachSvg(360, [pip], undefined, 0, 5_100).alt).toBe(`Captain Clawd: Off watch, awaiting orders. Pip: ${quipOf(pip, 5_100)}`)
  })
})

describe('the crew in the pane', () => {
  test('a spawned subagent joins the crew; its calls move its progress; the sort buttons reorder it', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    mock.store(on)
    on('agent.spawn', (_, e) => ({ model: 'claude-haiku-4-5', agentId: e.tool_use_id === 't1' ? 'agent-1' : 'agent-2' }))
    on('tool.call', () => ({ result: {} }))
    const spawn = (id: string, type: string, description: string) =>
      $.agent.spawn({
        tool_use_id: id,
        prompt: description,
        description,
        subagentType: type,
        provider: { plugin: 'engine', tier: 'core' },
        parentModel: 'claude-opus-5-5',
        background: false,
        fork: false,
      })
    await spawn('t1', 'Explore', 'Find the config loader')
    await spawn('t2', 'Plan', 'Plan the migration')
    for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Read', file_path: `/f${i}.ts`, agentId: 'agent-2' } as never)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await shows(ui, /2 at work/)).toBe(true)
      expect(await shows(ui, /Ada the Navigator/)).toBe(true)
      expect(await shows(ui, /Pip the Scout/)).toBe(true)
      // The desktop's alt says what the crab is doing; the terminal gives its line, in character, about the same file.
      expect(await shows(ui, /f5\.ts/)).toBe(true)
      // No sort to choose: the order is the crew's own.
      expect(await ui.find({ key: 'crew-sort-progress' })).toBeUndefined()
      await ui.unmount()
    }
    // In the order they set out: Pip first, though Ada with six calls is further along.
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const alt = async () => String((await ui.findAll({})).map(f => f.props.alt ?? '').find(a => /At work/.test(String(a))) ?? '')
    expect((await alt()).indexOf('Pip')).toBeLessThan((await alt()).indexOf('Ada'))
    await ui.unmount()
  })
})

// ---------- the session's own events ----------

/** Stands for the engine beneath the mod when a subagent sets out: each spawn answers with its own agent id. */
const spawner = ($: Engine, on: On) => {
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku-4-5', agentId: `agent-${e.tool_use_id}` }))
  return (id: string, type: string, description: string) =>
    $.agent.spawn({
      tool_use_id: id,
      prompt: description,
      description,
      subagentType: type,
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })
}

describe('the session’s own events', () => {
  test('a /clear starts the counts and the crew over, and keeps the layout', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    on('session.end', () => ({ sessionId: 's1' }))
    // Every hook beneath the mod is registered before the test's first call on `$`.
    const spawn = spawner($, on)
    await startSession($, on)
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
        { content: 'Write the fix', status: 'in_progress', activeForm: 'Writing the fix' },
        { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' },
      ],
    })
    await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
    await spawn('t1', 'Explore', 'Find the config loader')

    let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await shows(ui, /1 of 3/)).toBe(true)
    expect(await shows(ui, /1 at work/)).toBe(true)
    expect(await shows(ui, /2 tools · 2 calls/)).toBe(true)
    await ui.press({ key: 'sec-tools' })
    await ui.press({ key: 'sort-name' })
    await ui.unmount()

    await $.session.end({ reason: 'clear' } as never)

    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await shows(ui, /1 of 3|Writing the fix/)).toBe(false)
    expect(await shows(ui, /at work|Pip the Scout/)).toBe(false)
    expect(await shows(ui, /tools · /)).toBe(false)
    await ui.unmount()

    // The layout outlives the clear: Tools is still open, and sorted by name.
    await spawn('t2', 'Plan', 'Plan the migration')
    await $.tool.call({ tool: 'Read', file_path: '/b.ts' })
    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await shows(ui, /Ada the Navigator/)).toBe(true)
    expect((await ui.find({ key: 'sort-name' }))?.text).toMatch(/●/)
    await ui.unmount()
  })

  test('a session that ends for another reason keeps its counts', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    on('session.end', () => ({ sessionId: 's1' }))
    await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
    await $.session.end({ reason: 'other' } as never)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await shows(ui, /1 tool · 1 call/)).toBe(true)
    await ui.unmount()
  })

  test('a subagent’s run ending sends its crab back to base: done, failed or stopped', async ($, on) => {
    const clock = mock.clock(on, { now: 10_000 })
    mock.store(on)
    on('turn.complete', () => ({ text: '' }))
    const spawn = spawner($, on)
    await spawn('t1', 'Explore', 'Find the config loader')
    await spawn('t2', 'Plan', 'Plan the migration')
    await spawn('t3', 'general-purpose', 'Count the lines')
    await clock.advance(65_000)

    await $.turn.complete({ reason: 'answer', answer: '', text: 'Found it.', agentId: 'agent-t1' } as never)
    await $.turn.complete({ reason: 'error', answer: '', text: '', agentId: 'agent-t2' } as never)
    await $.turn.complete({ reason: 'aborted', answer: '', text: '', agentId: 'agent-t3' } as never)
    // The main conversation's own turn ending is no crab's.
    await $.turn.complete({ reason: 'answer', answer: '', text: 'All done.' } as never)
    // Pip, done, stands past his flag for 3 s before he reports back.
    await clock.advance(3_100)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await shows(ui, /3 back/)).toBe(true)
      expect(await shows(ui, /at work/i)).toBe(false)
      if (surface === 'terminal') {
        expect(await shows(ui, /done · 1:05/)).toBe(true)
        expect(await shows(ui, /failed · /)).toBe(true)
        expect(await shows(ui, /stopped · /)).toBe(true)
      } else {
        expect(await shows(ui, /Reported back: .*Pip the Scout, done/)).toBe(true)
        expect(await shows(ui, /Ada the Navigator, failed/)).toBe(true)
        expect(await shows(ui, /Barnacle the Deckhand, stopped/)).toBe(true)
      }
      await ui.unmount()
    }
  })

  test('a crab that is done stands past its flag, cheering, then 3 s later flies to the top of those reported back', async ($, on) => {
    const clock = mock.clock(on, { now: 10_000 })
    mock.store(on)
    on('turn.complete', () => ({ text: '' }))
    const spawn = spawner($, on)
    await spawn('t1', 'Explore', 'Find the config loader')
    await spawn('t2', 'Plan', 'Plan the migration')
    // Past the crabs' own arrival on the beach, which flies too.
    await clock.advance(2_000)
    await $.turn.complete({ reason: 'answer', answer: '', text: '', agentId: 'agent-t1' } as never)
    const crewPicture = async (ui: { findAll: (q: object) => Promise<{ props: Record<string, unknown> }[]> }, list: RegExp) =>
      (await ui.findAll({})).find(f => list.test(String(f.props.alt ?? '')))
    // Just done: still on the beach, cheering, walked past his flag; nothing has flown yet.
    let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    let crew = await crewPicture(ui, /^At work/)
    expect(String(crew?.props.alt)).toMatch(/At work: .*Pip the Scout, done/)
    expect(String(crew?.props.source)).not.toMatch(/@keyframes cf\d/)
    // He cheers on the beach, past his flag.
    const beach = await crewPicture(ui, /^Captain Clawd/)
    expect(String(beach?.props.source)).toContain('class="c-hop"')
    await ui.unmount()
    // Three seconds on he reports back: drawn at that moment, he is flying down to the top of the list.
    // (The timer's work is asynchronous; a moment more lets it note the move, as the app's redraw would.)
    await clock.advance(3_100)
    await clock.advance(20)
    ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    crew = await crewPicture(ui, /^Reported back/)
    expect(String(crew?.props.alt)).toMatch(/Reported back: Pip the Scout, done/)
    expect(String(crew?.props.source)).toMatch(/@keyframes cf\d\{0%\{transform:translateY\(-\d+px\);opacity:0\}/)
    await ui.unmount()
  })

  test('the ? by the crew opens who’s who, and the choice is kept', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    const kept = keptStore(on)
    const spawn = spawner($, on)
    await spawn('t1', 'Explore', 'Find the config loader')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await shows(ui, /Who's who|Main thread/)).toBe(false)
      await ui.press({ key: 'crew-legend' })
      expect(await shows(ui, /Explore/)).toBe(true)
      expect(await shows(ui, /Main thread/)).toBe(true)
      expect((kept.layout as { isLegendOpen: boolean }).isLegendOpen).toBe(true)
      await ui.press({ key: 'crew-legend' })
      expect(await shows(ui, /Main thread/)).toBe(false)
      await ui.unmount()
    }
  })

  test('At work and Reported back each fold on their own; the beach stays', async ($, on) => {
    const clock = mock.clock(on, { now: 10_000 })
    mock.store(on)
    on('turn.complete', () => ({ text: '' }))
    const spawn = spawner($, on)
    await spawn('t1', 'Explore', 'Find the config loader')
    await spawn('t2', 'Plan', 'Plan the migration')
    await clock.advance(2_000)
    await $.turn.complete({ reason: 'error', answer: '', text: '', agentId: 'agent-t1' } as never)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await shows(ui, /Ada the Navigator/)).toBe(true)
      await ui.press({ key: 'sec-crewWork' })
      expect(await shows(ui, /Ada the Navigator/)).toBe(false)
      expect(await shows(ui, /Pip the Scout/)).toBe(true)
      await ui.press({ key: 'sec-crewBase' })
      expect(await shows(ui, /Pip the Scout/)).toBe(false)
      // The titles stay, and so does the captain.
      expect(await ui.find({ key: 'sec-crewWork' })).toBeDefined()
      expect(await shows(ui, /Captain Clawd/)).toBe(true)
      // Titles read like the other sections', not in capitals.
      expect(await shows(ui, /Reported back/)).toBe(true)
      expect(await shows(ui, /REPORTED BACK/)).toBe(false)
      await ui.press({ key: 'sec-crewWork' })
      await ui.press({ key: 'sec-crewBase' })
      expect(await shows(ui, /Ada the Navigator/)).toBe(true)
      await ui.unmount()
    }
  })

  test('a new race starts with Reported back empty: the last race’s crabs leave the lists', async ($, on) => {
    const clock = mock.clock(on, { now: 10_000 })
    mock.store(on)
    on('turn.complete', () => ({ text: '' }))
    const spawn = spawner($, on)
    await spawn('t1', 'Explore', 'Find the config loader')
    await clock.advance(2_000)
    await $.turn.complete({ reason: 'answer', answer: '', text: '', agentId: 'agent-t1' } as never)
    await clock.advance(4_000)
    let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await shows(ui, /1 back/)).toBe(true)
    expect(await ui.find({ key: 'sec-crewBase' })).toBeDefined()
    await ui.unmount()
    // The next crab sets out with no one at work: a new race.
    await spawn('t2', 'Plan', 'Plan the migration')
    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await shows(ui, /1 at work/)).toBe(true)
    expect(await shows(ui, /back/)).toBe(false)
    expect(await ui.find({ key: 'sec-crewBase' })).toBeUndefined()
    expect(await shows(ui, /Pip the Scout/)).toBe(false)
    await ui.unmount()
    // A crab sent while one is still out joins the same race.
    await spawn('t3', 'general-purpose', 'Count the lines')
    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await shows(ui, /2 at work/)).toBe(true)
    await ui.unmount()
  })

  test('Captain Clawd is always on the beach: off watch while Claude waits, else saying what it does', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    on('turn.complete', () => ({ text: '' }))
    let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await shows(ui, /Captain Clawd: Off watch, awaiting orders/)).toBe(true)
    await ui.unmount()
    await $.tool.call({ tool: 'Read', file_path: '/src/config.ts' })
    const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await shows(term, /Captain Clawd/)).toBe(true)
    expect(await shows(term, /Reviewing config\.ts/)).toBe(true)
    await term.unmount()
    // The main conversation's turn ending puts him off watch again.
    await $.turn.complete({ reason: 'answer', answer: '', text: 'Done.' } as never)
    ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await shows(ui, /Captain Clawd: Off watch/)).toBe(true)
    await ui.unmount()
  })

  test('each request of a subagent adds its tokens to its crab, and names its model', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    on('turn.step', async function* (_, e) {
      const usage = { model: 'claude-sonnet-5-5', input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2_000 }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage } as never
    })
    const spawn = spawner($, on)
    await spawn('t1', 'Explore', 'Find the config loader')
    for (let i = 1; i <= 2; i++) {
      const stream = $.turn.step({ turnId: 'turn-1', index: i, model: 'claude-haiku-4-5', messageCount: 3, agentId: 'agent-t1' } as never)
      for await (const _ of stream) {
        // Nothing streams beneath the test.
      }
      await stream.result
    }
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      // The model the requests ran on, and the two requests' tokens added up.
      expect(await shows(ui, /Sonnet 5\.5/)).toBe(true)
      expect(await shows(ui, /87k tok/)).toBe(true)
      // The race's totals beside the list's title, a · between each.
      expect((await ui.find({ key: 'sec-crewWork' }))?.text).toMatch(/At work · 1 · 0 calls · 87k tok · 0:00/)
      await ui.unmount()
    }
  })

  test('a subagent’s model request sets its crab thinking; the main conversation’s makes no crab', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    on('turn.step', async function* (_, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
    })
    const spawn = spawner($, on)
    await spawn('t1', 'Explore', 'Find the config loader')
    await $.tool.call({ tool: 'Read', file_path: '/src/config.ts', agentId: 'agent-t1' } as never)

    // The desktop's alt says plainly what the crab is doing.
    let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await shows(ui, /reading config\.ts/)).toBe(true)
    await ui.unmount()

    const step = (agentId?: string) =>
      $.turn.step({ turnId: 'turn-1', index: 1, model: 'claude-haiku-4-5', messageCount: 3, ...(agentId ? { agentId } : {}) } as never)
    for (const id of ['agent-t1', undefined]) {
      const stream = step(id)
      for await (const _ of stream) {
        // Nothing streams beneath the test; reading to the end settles the step.
      }
      await stream.result
    }

    ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await shows(ui, /thinking/)).toBe(true)
    expect(await shows(ui, /reading config\.ts/)).toBe(false)
    expect(await shows(ui, /1 at work/)).toBe(true)
    await ui.unmount()
  })
})

// ---------- the crew band above the prompt ----------

const BAND = {
  plugin: 'session-lens',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

describe('the crew band', () => {
  // What the engine draws above the prompt when the mod passes: a stand-in to tell the two apart.
  const engineBand = (on: On) =>
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'engine band') as RenderElement
    })

  test('a crew out shows its band; with no crew, the band is the engine’s', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    mock.store(on)
    engineBand(on)
    const spawn = spawner($, on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ text: 'engine band' })).toBeDefined()
      await ui.unmount()
    }
    await spawn('t1', 'Explore', 'Find the config loader')
    await spawn('t2', 'Plan', 'Plan the migration')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      // The desktop names the crabs out; the terminal, short of room, the first and how many more.
      expect(await shows(ui, /Pip, Ada at work|Pip \+1 at work/)).toBe(true)
      expect((await ui.find({ key: 'lens-crew-open' }))?.text).toMatch(/Crew ×2/)
      // The band is shared: what other mods draw there stays, under the crew's.
      expect(await ui.find({ text: 'engine band' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('Crew opens the lens; ✕ hides the band until the next crew sets out', async ($, on) => {
    const clock = mock.clock(on, { now: 10_000 })
    mock.store(on)
    engineBand(on)
    const opened: string[] = []
    on('ui.open', (_, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    const spawn = spawner($, on)
    await spawn('t1', 'Explore', 'Find the config loader')
    const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await desk.press({ key: 'lens-crew-open' })
    expect(opened).toContain('session-lens')
    await desk.press({ key: 'lens-crew-dismiss' })
    expect(await desk.find({ key: 'lens-crew-open' })).toBeUndefined()
    expect(await desk.find({ text: 'engine band' })).toBeDefined()
    await desk.unmount()
    // The next crab to set out, later, brings the band back with only the new crew in it.
    await clock.advance(2_000)
    await $.agent.spawn({
      tool_use_id: 't2',
      prompt: 'Plan',
      description: 'Plan the migration',
      subagentType: 'Plan',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })
    const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await term.find({ key: 'lens-crew-open' }))?.text).toMatch(/Crew ×1/)
    await term.unmount()
  })

  test('a new prompt with everyone back clears the band; one sent while a crab works keeps it', async ($, on) => {
    const clock = mock.clock(on, { now: 10_000 })
    mock.store(on)
    engineBand(on)
    on('prompt.submit', (_, e) => ({ text: e.text }))
    on('turn.complete', () => ({ text: '' }))
    const spawn = spawner($, on)
    await spawn('t1', 'Explore', 'Find the config loader')
    await clock.advance(1_000)
    await $.prompt.submit({ text: 'How is it going?' } as never)
    let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ key: 'lens-crew-open' })).toBeDefined()
    await ui.unmount()
    await $.turn.complete({ reason: 'answer', answer: '', text: '', agentId: 'agent-t1' } as never)
    ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await shows(ui, /All back at base/)).toBe(true)
    await ui.unmount()
    await clock.advance(1_000)
    await $.prompt.submit({ text: 'Thanks' } as never)
    ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    await ui.unmount()
  })

  test('the crewBand setting turns the band off', { options: { crewBand: false } }, async ($, on) => {
    mock.clock(on, { now: 10_000 })
    mock.store(on)
    engineBand(on)
    const spawn = spawner($, on)
    await spawn('t1', 'Explore', 'Find the config loader')
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    expect(await ui.find({ key: 'lens-crew-open' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('the showQuips setting', () => {
  test('off, the crabs say nothing in the pane, in pictures or in text', { options: { showQuips: false } }, async ($, on) => {
    mock.clock(on, { now: 10_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    const spawn = spawner($, on)
    await spawn('t1', 'Explore', 'Find the config loader')
    await $.tool.call({ tool: 'Read', file_path: '/src/config.ts', agentId: 'agent-t1' } as never)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      // The crab and its work are there; no line of its, and no quote.
      expect(await shows(ui, /Pip/)).toBe(true)
      expect(await shows(ui, /“/)).toBe(false)
      expect(await shows(ui, /Pip: /)).toBe(false)
      await ui.unmount()
    }
  })
})

// ---------- the context window ----------

describe('the context window', () => {
  test('sizes read like the status line’s: 167.9k, 1M, 200k; the share as a whole percentage', async () => {
    expect([contextSize(167_900), contextSize(1_000_000), contextSize(200_000), contextSize(940)]).toEqual(['167.9k', '1M', '200k', '940'])
    expect(contextPercent(167_900, 1_000_000)).toBe(17)
  })

  test('a section above To-do: tokens of the window by its title, a bar of the share used; it folds', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    mock.store(on)
    let tokens: number | undefined
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [] } }) as never)
    on('turn.step', async function* (_, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
    })
    const step = async () => {
      const stream = $.turn.step({ turnId: 'turn-1', index: 1, model: 'claude-opus-5-5', messageCount: 3 } as never)
      for await (const _ of stream) {
        // Nothing streams beneath the test.
      }
      await stream.result
    }
    // No reading yet: the title alone.
    await step()
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ key: 'sec-context' })).toBeDefined()
      expect(await shows(ui, /% used/)).toBe(false)
      await ui.unmount()
    }
    // A request of the main conversation answered: the meter reads the window.
    tokens = 167_900
    await step()
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await shows(ui, /167\.9k \/ 1M/)).toBe(true)
      expect(await shows(ui, /17% used/)).toBe(true)
      // Above To-do.
      const keys = (await ui.findAll({})).map(f => (f as { key?: string }).key).filter(k => k === 'sec-context' || k === 'sec-todo')
      expect(keys[0]).toBe('sec-context')
      await ui.press({ key: 'sec-context' })
      expect(await shows(ui, /17% used/)).toBe(false)
      await ui.press({ key: 'sec-context' })
      await ui.unmount()
    }
  })
})

// ---------- the plan's rows in the transcript ----------

describe('the plan’s rows in the transcript', () => {
  // A TodoWrite row as the transcript asks for it, and its result block under it.
  const rowOf = (component: 'ToolUse' | 'ToolResult', id: string, over: Record<string, unknown> = {}) =>
    ({
      plugin: 'session-lens',
      component,
      requestId: id,
      props: { tool_use_id: id, tool: 'TodoWrite', input: {}, output: {}, isRunning: false, isErrored: false, isInterrupted: false, isExpanded: false, view: {}, ...over },
    }) as never
  // What the engine draws for the rows when the mod passes: stand-ins to tell them from nothing.
  const engineRows = (on: On) => {
    on('ui.render', { component: 'ToolUse' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'engine ToolUse') as RenderElement
    })
    on('ui.render', { component: 'ToolResult' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'engine ToolResult') as RenderElement
    })
  }
  // The lens pane, open in front or not, as `$.ui.panes()` answers.
  const lensPane = (on: On) => {
    const pane = { isOpen: true, isShown: true }
    on('ui.panes', () => ({ value: pane.isOpen ? [{ id: 'session-lens', title: 'Session lens', isShown: pane.isShown, isFocused: false, isPlaced: true }] : [] }))
    return pane
  }
  const todos = { todos: [{ content: 'Write the fix', status: 'in_progress', activeForm: 'Writing the fix' }] }
  const drawn = async ($: Engine, component: 'ToolUse' | 'ToolResult', id: string, surface: 'terminal' | 'desktop', over: Record<string, unknown> = {}) => {
    const ui = await $.ui.mount({ ...(rowOf(component, id, over) as object), surface } as never)
    const has = (await ui.find({ text: `engine ${component}` })) !== undefined
    await ui.unmount()
    return has
  }

  test('hidden while the lens shows the To-do in front; back when it folds, closes or goes behind a tab', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    engineRows(on)
    const pane = lensPane(on)
    await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'tw1', ...todos } as never)
    for (const surface of SURFACES) {
      expect(await drawn($, 'ToolUse', 'tw1', surface)).toBe(false)
      expect(await drawn($, 'ToolResult', 'tw1', surface)).toBe(false)
    }
    // To-do folded: the lens no longer shows the list, so the transcript does.
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'sec-todo' })
    await ui.unmount()
    expect(await drawn($, 'ToolUse', 'tw1', 'terminal')).toBe(true)
    const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await again.press({ key: 'sec-todo' })
    await again.unmount()
    expect(await drawn($, 'ToolUse', 'tw1', 'terminal')).toBe(false)
    pane.isShown = false
    expect(await drawn($, 'ToolUse', 'tw1', 'desktop')).toBe(true)
    pane.isShown = true
    pane.isOpen = false
    expect(await drawn($, 'ToolUse', 'tw1', 'desktop')).toBe(true)
  })

  test('an errored row, the ctrl+o transcript and a subagent’s own list are drawn as ever', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    engineRows(on)
    lensPane(on)
    await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'tw1', ...todos } as never)
    await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'sub1', agentId: 'agent-2', ...todos } as never)
    await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/a.ts' } as never)
    expect(await drawn($, 'ToolUse', 'tw1', 'terminal', { isErrored: true })).toBe(true)
    expect(await drawn($, 'ToolUse', 'tw1', 'terminal', { isExpanded: true })).toBe(true)
    expect(await drawn($, 'ToolUse', 'sub1', 'terminal')).toBe(true)
    expect(await drawn($, 'ToolUse', 'r1', 'terminal', { tool: 'Read' })).toBe(true)
  })

  test('the setting off leaves every row as it is', { options: { hidePlanRows: false } }, async ($, on) => {
    mock.clock(on, { now: 1_000 })
    mock.store(on)
    on('tool.call', () => ({ result: {} }))
    engineRows(on)
    lensPane(on)
    await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'tw1', ...todos } as never)
    for (const surface of SURFACES) {
      expect(await drawn($, 'ToolUse', 'tw1', surface)).toBe(true)
      expect(await drawn($, 'ToolResult', 'tw1', surface)).toBe(true)
    }
  })
})
