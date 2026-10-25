import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { skillListSvg, stepSvg, toolListSvg } from '../hooks/art'
import { DEFAULT_LAYOUT, DESKTOP_PLAN, DESKTOP_WRAP_UP, EMPTY_PLAN, countTool, groupLabel, listOrders, markAlways, movesAfter, parseLayout, planAfter, skillOfPath, stampSteps, toolGroups, toolRows } from '../hooks/track'
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
    expect(kept.layout).toEqual({ folded: [], groupsOpen: false, groupExceptions: [], isGrouped: true, sort: 'name' })
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
