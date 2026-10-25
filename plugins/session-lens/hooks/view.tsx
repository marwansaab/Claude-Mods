// The pane's drawing: three sections that open and close on their own (To-do, Skills, Tools).
// The desktop draws each row as an animated SVG; the terminal draws the same rows in text.
import type { Elements, RenderElement } from 'claude-code'

import type { LensPlan, LensSection, LensSkill, LensSort, LensTool, LensView } from '../types'
import { ACCENT, barShare, chevronSvg, groupTileSvg, groupTotalSvg, hueOf, skillSvg, stepSvg, todoProgressSvg, toolSvg } from './art'
import { doneOf, plural, toolGroups, toolRows } from './track'
import type { ToolGroup, ToolRow } from './track'

type UI = Elements['terminal'] | Elements['desktop'] | Elements['vscode'] | Elements['mobile']

export type Actions = {
  toggleSection: (id: LensSection) => void
  toggleGroup: (key: string) => void
  setGrouped: (isGrouped: boolean) => void
  setSort: (sort: LensSort) => void
  setFilter: (text: string) => void
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

function picture(ctx: Ctx, key: string, d: { svg: string; height: number; alt: string }, width?: number): RenderElement | null {
  if (!('Svg' in ctx.ui)) return null
  const { Svg } = ctx.ui
  return <Svg key={key} source={d.svg} alt={d.alt} width={width} height={d.height} />
}

/** A section: a header that opens and closes it, a summary on the right, and its body while open. */
function section(ctx: Ctx, id: LensSection, title: string, right: RenderElement | string | null, body: () => RenderElement[]): RenderElement {
  const { Box, Text, Button } = ctx.ui
  const isOpen = !ctx.view.folded.includes(id)
  const chevron = ctx.isPictured ? picture(ctx, `chev-${id}-${isOpen ? 'open' : 'shut'}`, chevronSvg(isOpen), 20) : null
  return (
    <Box key={`sec-${id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap={isOpen ? 1 : 0} flexShrink={0}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Box flexDirection="row" alignItems="center" gap={1} flexShrink={1}>
          {chevron}
          <Button key={`sec-${id}`} plain onPress={() => ctx.act.toggleSection(id)}>
            {chevron ? null : <Text color={ACCENT}>{isOpen ? '▾ ' : '▸ '}</Text>}
            <Text bold>{title}</Text>
          </Button>
        </Box>
        {typeof right === 'string' ? <Text dimColor>{right}</Text> : right}
      </Box>
      {isOpen ? body() : null}
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
    if (!steps.length) return [<Text key="todo-none" dimColor wrap="wrap">No task list yet. Claude makes one for jobs with a few steps.</Text>]
    if (ctx.isPictured) {
      const w = rowPixels(ctx.columns)
      return [
        picture(ctx, `todo-bar-${done}-${steps.length}`, todoProgressSvg(w, done, steps.length, doneBefore), w)!,
        <Box key="todo-steps" flexDirection="column">
          {steps.map((st, i) => picture(ctx, `step-${i}-${st.status}-${st.text}`, stepSvg(w, st, i), w))}
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

// ---------- skills ----------

function skillsSection(ctx: Ctx): RenderElement {
  const { Box, Text } = ctx.ui
  const list = Object.values(ctx.skills).sort((a, b) => b.count - a.count || Number(b.isAlways) - Number(a.isAlways) || a.name.localeCompare(b.name))
  const uses = list.reduce((n, s) => n + s.count, 0)
  const right = list.length ? plural(uses, 'use') : null
  return section(ctx, 'skills', 'Skills', right, () => {
    if (!list.length) return [<Text key="skills-none" dimColor>No skills used yet.</Text>]
    if (ctx.isPictured) {
      const w = rowPixels(ctx.columns)
      return [
        <Box key="skill-rows" flexDirection="column">
          {list.map((s, i) => picture(ctx, `skill-${s.name}-${s.count}-${s.isAlways}`, skillSvg(w, s, i), w))}
        </Box>,
      ]
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

function controls(ctx: Ctx): RenderElement {
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
      </Box>
    </Box>
  )
}

function toolRow(ctx: Ctx, r: ToolRow, index: number, showGroup: boolean): RenderElement | null {
  const { Box, Text } = ctx.ui
  if (ctx.isPictured) {
    const w = rowPixels(ctx.columns) - (showGroup ? 0 : 24)
    return picture(ctx, `tool-${r.name}-${r.count}-${r.errors}-${showGroup}`, toolSvg(w, r, index, showGroup), w)
  }
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
  const isOpen = !ctx.view.foldedGroups.includes(g.key) || ctx.view.filter.trim() !== ''
  const tile = ctx.isPictured ? picture(ctx, `tile-${g.key}`, groupTileSvg(g.key, g.label), 26) : null
  const total = ctx.isPictured ? picture(ctx, `total-${g.key}-${g.count}-${g.errors}-${g.rows.length}`, groupTotalSvg(g.key, g.count, g.errors, g.rows.length)) : null
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
          {g.rows.map((r, i) => toolRow(ctx, r, i, false))}
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
    if (!all.length) return [<Text key="tools-none" dimColor>No tools called yet.</Text>]
    const rows = toolRows(ctx.tools, ctx.servers, ctx.view.sort, ctx.view.filter)
    const list = !rows.length ? (
      <Text key="tools-nomatch" dimColor wrap="wrap">{`No tool matches “${ctx.view.filter.trim()}”.`}</Text>
    ) : ctx.view.isGrouped ? (
      <Box key="tool-groups" flexDirection="column" gap={1}>
        {toolGroups(rows, ctx.view.sort).map(g => groupBlock(ctx, g))}
      </Box>
    ) : (
      <Box key="tool-flat" flexDirection="column">
        {rows.map((r, i) => toolRow(ctx, r, i, true))}
      </Box>
    )
    return [controls(ctx), list]
  })
}

export function paneView(ctx: Ctx): RenderElement {
  const { Box } = ctx.ui
  return (
    <Box flexDirection="column" gap={1}>
      {todoSection(ctx)}
      {skillsSection(ctx)}
      {toolsSection(ctx)}
    </Box>
  )
}
