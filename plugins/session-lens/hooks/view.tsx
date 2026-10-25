// The pane's drawing: three sections that open and close on their own (To-do, Skills, Tools).
// The desktop draws each row as an animated SVG; the terminal draws the same rows in text.
import type { Elements, RenderElement } from 'claude-code'

import type { LensCrab, LensCrewSort, LensMove, LensPlan, LensSection, LensSkill, LensSort, LensTool, LensView } from '../types'
import { ACCENT, barShare, groupTileSvg, groupTotalSvg, hueOf, skillListSvg, stepSvg, todoProgressSvg, toolListSvg } from './art'
import { crewSvg } from './crabs'
import { actionOf, characterOf, crewLists, crewSummary, duration, progressLabel, progressOf } from './crew'
import { doneOf, isGroupOpen, plural, skillList, toolGroups, toolRows } from './track'
import type { ToolGroup, ToolRow } from './track'

type UI = Elements['terminal'] | Elements['desktop'] | Elements['vscode'] | Elements['mobile']

export type Actions = {
  toggleSection: (id: LensSection) => void
  toggleGroup: (key: string) => void
  /** Opens or closes every tool group, and sets how groups seen later start. */
  setAllGroups: (isOpen: boolean) => void
  setGrouped: (isGrouped: boolean) => void
  setSort: (sort: LensSort) => void
  setFilter: (text: string) => void
  setCrewSort: (sort: LensCrewSort) => void
}

export type Ctx = {
  ui: UI
  /** Draws pictures: the desktop, the editor and the phone. */
  isPictured: boolean
  /** The pane's body, in character columns. */
  columns: number
  plan: LensPlan
  tools: Record<string, LensTool>
  skills: Record<string, LensSkill>
  servers: Record<string, string>
  view: LensView
  /** Each list's last change of order, so its rows fly to their new places once. */
  moves: Record<string, LensMove>
  /** This session's subagents, each played by a crab. */
  crew: Record<string, LensCrab>
  /** When this drawing is made: each animation is drawn as it stands at this moment. */
  now: number
  act: Actions
}

const GOOD = '#22a06b'
const SORTS: { sort: LensSort; label: string }[] = [
  { sort: 'count', label: 'Most used' },
  { sort: 'recent', label: 'Recent' },
  { sort: 'name', label: 'A–Z' },
]

/** CSS pixels for a pane this many columns wide, and for a row inside a section's frame. */
const pixels = (columns: number) => Math.max(240, Math.min(900, columns * 8 - 8))
const rowPixels = (columns: number) => pixels(columns) - 40

/** Text cells a terminal bar takes for a share, as filled and empty blocks. */
const cells = (share: number, width: number) => {
  const n = Math.max(share > 0 ? 1 : 0, Math.round(share * width))
  return { on: '━'.repeat(n), off: '─'.repeat(Math.max(0, width - n)) }
}

/** When something comes into view: the latest of the moments given (0 for one not known). */
const latest = (...at: (number | undefined)[]) => Math.max(0, ...at.map(t => t ?? 0))

/** When a section's rows come in: when the pane opened or the section did. */
const sectionAt = (ctx: Ctx, id: LensSection) => latest(ctx.view.toggledAt.pane, ctx.view.toggledAt[id])

function picture(ctx: Ctx, key: string, d: { svg: string; height: number; alt: string }, width?: number): RenderElement | null {
  if (!('Svg' in ctx.ui)) return null
  const { Svg } = ctx.ui
  return <Svg key={key} source={d.svg} alt={d.alt} width={width} height={d.height} />
}

/**
 * A section: a header that opens and closes it, a summary on the right, and its body while open.
 * A section with nothing in it yet is its header alone.
 */
function section(ctx: Ctx, id: LensSection, title: string, right: RenderElement | string | null, body: () => RenderElement[]): RenderElement {
  const { Box, Text, Button } = ctx.ui
  const isFolded = ctx.view.folded.includes(id)
  const rows = isFolded ? [] : body()
  const isOpen = !isFolded
  return (
    <Box key={`sec-${id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap={rows.length ? 1 : 0} flexShrink={0}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
        {/* The arrow is part of the button: a picture beside it could not be pressed. */}
        <Button key={`sec-${id}`} plain onPress={() => ctx.act.toggleSection(id)}>
          <Text color={ACCENT}>{isOpen ? '▾ ' : '▸ '}</Text>
          <Text bold>{title}</Text>
        </Button>
        {typeof right === 'string' ? <Text dimColor>{right}</Text> : right}
      </Box>
      {rows.length ? rows : null}
    </Box>
  )
}

// ---------- to-do ----------

function todoSection(ctx: Ctx): RenderElement {
  const { Box, Text } = ctx.ui
  const { steps, doneBefore } = ctx.plan
  const done = doneOf(steps)
  const right = steps.length ? `${done} of ${steps.length}` : null
  return section(ctx, 'todo', 'To-do', right, () => {
    if (!steps.length) return []
    if (ctx.isPictured) {
      const w = rowPixels(ctx.columns)
      const opened = sectionAt(ctx, 'todo')
      return [
        picture(ctx, 'todo-bar', todoProgressSvg(w, done, steps.length, doneBefore, latest(ctx.plan.updatedAt, opened), ctx.now), w)!,
        <Box key="todo-steps" flexDirection="column">
          {steps.map((st, i) => picture(ctx, `step-${i}`, stepSvg(w, st, i, latest(st.addedAt, opened), ctx.now), w))}
        </Box>,
      ]
    }
    const width = Math.max(8, ctx.columns - 12)
    const bar = cells(done / steps.length, width)
    return [
      <Box key="todo-bar" flexDirection="row" gap={1}>
        <Text>
          <Text color={done === steps.length ? GOOD : ACCENT}>{bar.on}</Text>
          <Text dimColor>{bar.off}</Text>
        </Text>
        <Text dimColor>{`${Math.round((done / steps.length) * 100)}%`}</Text>
      </Box>,
      <Box key="todo-steps" flexDirection="column">
        {steps.map((st, i) => {
          const isDone = st.status === 'completed'
          const isNow = st.status === 'in_progress'
          return (
            <Box key={`step-${i}`} flexDirection="row">
              <Box width={2} flexShrink={0}>
                {isDone ? <Text color={GOOD}>✓</Text> : isNow ? <Text color={ACCENT}>●</Text> : <Text dimColor>○</Text>}
              </Box>
              <Text wrap="wrap" dimColor={isDone} strikethrough={isDone} bold={isNow}>
                {isNow && st.active ? st.active : st.text}
              </Text>
            </Box>
          )
        })}
      </Box>,
    ]
  })
}

// ---------- crew ----------

const CREW_SORTS: { sort: LensCrewSort; label: string }[] = [
  { sort: 'progress', label: 'Progress' },
  { sort: 'name', label: 'A–Z' },
]
const OUTCOME: Record<LensCrab['status'], { glyph: string; color: string }> = {
  running: { glyph: '●', color: ACCENT },
  done: { glyph: '✓', color: GOOD },
  failed: { glyph: '✗', color: '#e5484d' },
  stopped: { glyph: '■', color: '#8a8984' },
}

/** One crab in the terminal: its mark, name and role, then progress and doing, or how its run ended. */
function crabLine(ctx: Ctx, m: LensCrab): RenderElement {
  const { Box, Text } = ctx.ui
  const c = characterOf(m.character)
  const o = OUTCOME[m.status]
  const bar = cells(progressOf(m).value, 8)
  return (
    <Box key={`crab-${m.id}`} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Text wrap="truncate-end">
          <Text color={o.color}>{`${o.glyph} `}</Text>
          <Text bold>{m.name}</Text>
          <Text dimColor>{` the ${c.role}`}</Text>
        </Text>
        {m.status === 'running' ? (
          <Text>
            <Text color={c.color}>{bar.on}</Text>
            <Text dimColor>{bar.off}</Text>
            <Text bold>{` ${progressLabel(m)}`}</Text>
          </Text>
        ) : (
          <Text dimColor>{`${m.status} · ${duration((m.endedAt ?? ctx.now) - m.startedAt)}`}</Text>
        )}
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor wrap="truncate-end">
          {m.status === 'running' ? actionOf(m, ctx.now) : m.description}
        </Text>
      </Box>
    </Box>
  )
}

/** The crew: who is out at work and who is back at base, in the order chosen. */
function crewSection(ctx: Ctx): RenderElement {
  const { Box, Text, Button } = ctx.ui
  const { working, base } = crewLists(ctx.crew, ctx.view.crewSort)
  const right = working.length + base.length ? crewSummary(ctx.crew) : null
  return section(ctx, 'crew', 'Crew', right, () => {
    if (!working.length && !base.length) return []
    const sorts = (
      <Box key="crew-sorts" flexDirection="row" gap={1} alignItems="center">
        {CREW_SORTS.map(s => (
          <Button
            key={`crew-sort-${s.sort}`}
            plain
            dimColor={ctx.view.crewSort !== s.sort}
            label={`${ctx.view.crewSort === s.sort ? '● ' : ''}${s.label}`}
            onPress={() => ctx.act.setCrewSort(s.sort)}
          />
        ))}
      </Box>
    )
    if (ctx.isPictured) {
      const w = rowPixels(ctx.columns)
      return [sorts, picture(ctx, 'crew-list', crewSvg(w, working, base, ctx.moves.crew, sectionAt(ctx, 'crew'), ctx.now), w)!]
    }
    const group = (key: string, label: string, list: LensCrab[]) =>
      list.length ? (
        <Box key={key} flexDirection="column">
          <Text dimColor bold>{`${label} · ${list.length}`}</Text>
          {list.map(m => crabLine(ctx, m))}
        </Box>
      ) : null
    return [sorts, group('crew-work', 'At work', working), group('crew-base', 'Back at base', base)].filter((x): x is RenderElement => x !== null)
  })
}

// ---------- skills ----------

function skillsSection(ctx: Ctx): RenderElement {
  const { Box, Text } = ctx.ui
  const list = skillList(ctx.skills)
  const uses = list.reduce((n, s) => n + s.count, 0)
  const right = list.length ? plural(uses, 'use') : null
  return section(ctx, 'skills', 'Skills', right, () => {
    if (!list.length) return []
    if (ctx.isPictured) {
      const w = rowPixels(ctx.columns)
      return [picture(ctx, 'skill-list', skillListSvg(w, list, ctx.moves.skills, sectionAt(ctx, 'skills'), ctx.now), w)!]
    }
    return list.map(s => (
      <Box key={`skill-${s.name}`} flexDirection="row" justifyContent="space-between" gap={1}>
        <Text wrap="truncate-end">
          <Text color={ACCENT}>/</Text>
          {s.name}
        </Text>
        <Text>
          {s.isAlways ? <Text color="#4c8dff">always loaded</Text> : null}
          {s.isAlways && s.count ? '  ' : null}
          {s.count ? <Text dimColor>{plural(s.count, 'use')}</Text> : null}
        </Text>
      </Box>
    ))
  })
}

// ---------- tools ----------

function controls(ctx: Ctx, groups: ToolGroup[]): RenderElement {
  const { Box, Button } = ctx.ui
  const { view, act } = ctx
  const filter =
    'Input' in ctx.ui ? (
      <ctx.ui.Input key="filter" placeholder="Filter tools" value={view.filter} submitLabel="filter" onInput={v => act.setFilter(v)} onSubmit={v => act.setFilter(v)} />
    ) : null
  return (
    <Box key="tool-controls" flexDirection="column" gap={1}>
      {filter || view.filter ? (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Box flexGrow={1} flexShrink={1}>
            {filter}
          </Box>
          {view.filter ? <Button key="filter-clear" plain dimColor label="✕ Clear" onPress={() => act.setFilter('')} /> : null}
        </Box>
      ) : null}
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <Button key="group-on" variant={view.isGrouped ? 'primary' : 'secondary'} label="By server" onPress={() => act.setGrouped(true)} />
        <Button key="group-off" variant={view.isGrouped ? 'secondary' : 'primary'} label="All tools" onPress={() => act.setGrouped(false)} />
        {SORTS.map(s => (
          <Button key={`sort-${s.sort}`} plain dimColor={view.sort !== s.sort} label={`${view.sort === s.sort ? '● ' : ''}${s.label}`} onPress={() => act.setSort(s.sort)} />
        ))}
        {view.isGrouped && groups.length ? (
          groups.some(g => isGroupOpen(view, g.key)) ? (
            <Button key="groups-all" plain dimColor label="⊟ Collapse all" onPress={() => act.setAllGroups(false)} />
          ) : (
            <Button key="groups-all" plain dimColor label="⊞ Expand all" onPress={() => act.setAllGroups(true)} />
          )
        ) : null}
      </Box>
    </Box>
  )
}

/**
 * A list of tools: one server's, or every tool when the list is flat (`listKey` `flat`). The desktop draws
 * it as one picture, so a tool that changes place can fly there; the terminal draws a row per tool.
 */
function toolList(ctx: Ctx, rows: ToolRow[], showGroup: boolean, listKey: string): RenderElement[] {
  if (ctx.isPictured) {
    const w = rowPixels(ctx.columns) - (showGroup ? 0 : 24)
    const enterAt = (r: ToolRow) => latest(r.firstAt, sectionAt(ctx, 'tools'), ctx.view.layoutAt, showGroup ? 0 : ctx.view.toggledAt[`g:${r.group}`])
    // While the filter narrows the list, rows come and go with each key: that is no change of order.
    const canFly = ctx.view.filter.trim() === ''
    return [picture(ctx, `tools-${listKey}`, toolListSvg(w, rows, showGroup, ctx.moves[listKey], canFly, enterAt, ctx.now), w)!]
  }
  return rows.map(r => toolRow(ctx, r, showGroup))
}

/** One tool in the terminal: its name, its server when the list is flat, a bar and its count. */
function toolRow(ctx: Ctx, r: ToolRow, showGroup: boolean): RenderElement {
  const { Box, Text } = ctx.ui
  const bar = cells(barShare(r.count), 6)
  return (
    <Box key={`tool-${r.name}`} flexDirection="row" justifyContent="space-between" gap={1} paddingLeft={showGroup ? 0 : 2}>
      <Box flexShrink={1} flexGrow={1} overflow="hidden">
        <Text wrap="truncate-end">
          {r.label}
          {showGroup ? <Text dimColor>{`  ${r.groupLabel}`}</Text> : null}
        </Text>
      </Box>
      <Box flexShrink={0} flexDirection="row" gap={1}>
        {r.errors ? <Text color="#e5484d">{`${r.errors}✕`}</Text> : null}
        <Text>
          <Text color={hueOf(r.group)}>{bar.on}</Text>
          <Text dimColor>{bar.off}</Text>
        </Text>
        <Text bold>{String(r.count).padStart(3)}</Text>
      </Box>
    </Box>
  )
}

function groupBlock(ctx: Ctx, g: ToolGroup): RenderElement {
  const { Box, Text, Button } = ctx.ui
  const isOpen = isGroupOpen(ctx.view, g.key) || ctx.view.filter.trim() !== ''
  const enterAt = latest(g.firstAt, sectionAt(ctx, 'tools'), ctx.view.layoutAt)
  const tile = ctx.isPictured ? picture(ctx, `tile-${g.key}`, groupTileSvg(g.key, g.label, enterAt, ctx.now), 26) : null
  const total = ctx.isPictured ? picture(ctx, `total-${g.key}`, groupTotalSvg(g.key, g.count, g.errors, g.rows.length, g.count > 1 ? g.lastAt : 0, ctx.now)) : null
  return (
    <Box key={`group-${g.key}`} flexDirection="column" gap={ctx.isPictured && isOpen ? 1 : 0}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Box flexDirection="row" alignItems="center" gap={1} flexShrink={1}>
          {tile}
          <Button key={`grp-${g.key}`} plain onPress={() => ctx.act.toggleGroup(g.key)}>
            <Text color={hueOf(g.key)}>{isOpen ? '▾ ' : '▸ '}</Text>
            <Text bold>{g.label}</Text>
            <Text dimColor>{`  ${plural(g.rows.length, 'tool')}`}</Text>
          </Button>
        </Box>
        {total ?? (
          <Text>
            {g.errors ? <Text color="#e5484d">{`${g.errors}✕ `}</Text> : null}
            <Text dimColor>{plural(g.count, 'call')}</Text>
          </Text>
        )}
      </Box>
      {isOpen ? (
        <Box flexDirection="column" paddingLeft={ctx.isPictured ? 3 : 0}>
          {toolList(ctx, g.rows, false, `g:${g.key}`)}
        </Box>
      ) : null}
    </Box>
  )
}

function toolsSection(ctx: Ctx): RenderElement {
  const { Box, Text } = ctx.ui
  const all = Object.values(ctx.tools)
  const calls = all.reduce((n, t) => n + t.count, 0)
  const right = all.length ? `${plural(all.length, 'tool')} · ${plural(calls, 'call')}` : null
  return section(ctx, 'tools', 'Tools', right, () => {
    if (!all.length) return []
    const rows = toolRows(ctx.tools, ctx.servers, ctx.view.sort, ctx.view.filter)
    const groups = ctx.view.isGrouped ? toolGroups(rows, ctx.view.sort) : []
    const list = !rows.length ? (
      <Text key="tools-nomatch" dimColor wrap="wrap">{`No tool matches “${ctx.view.filter.trim()}”.`}</Text>
    ) : ctx.view.isGrouped ? (
      <Box key="tool-groups" flexDirection="column" gap={1}>
        {groups.map(g => groupBlock(ctx, g))}
      </Box>
    ) : (
      <Box key="tool-flat" flexDirection="column">
        {toolList(ctx, rows, true, 'flat')}
      </Box>
    )
    return [controls(ctx, groups), list]
  })
}

export function paneView(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  return (
    <Box flexDirection="column" gap={1}>
      {todoSection(ctx)}
      {crewSection(ctx)}
      {skillsSection(ctx)}
      {toolsSection(ctx)}
    </Box>
  )
}
