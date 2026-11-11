// The dispatch board: the routing switch, a row per agent type with its model and effort pickers, and
// this session's subagents with what each ran on and why. Text and controls alone, on every surface.
import type { Elements, RenderElement } from 'claude-code'

import type { Dispatch } from '../types'
import { BUILT_IN_ROWS, EFFORTS, MODELS, OTHER, SOURCE_LABEL, modelName } from './route'
import type { Table } from './route'

type UI = Elements['terminal'] | Elements['desktop'] | Elements['vscode'] | Elements['mobile']

export type BoardActions = {
  setRouting: (isOn: boolean) => void
  /** Sets one field of a row, by the row's key (a built-in type, `other`, or a named type). */
  setPick: (rowKey: string, field: 'model' | 'effort', value: string) => void
}

export type BoardCtx = {
  ui: UI
  table: Table
  /** Agent types the session offered, beyond the built-in rows. */
  offered: string[]
  /** Rows whose model failed this session, by row key. */
  failed: Record<string, string>
  dispatches: Record<string, Dispatch>
  act: BoardActions
}

const ACCENT = '#d97757'
const WARN = '#c9372c'

const options = (values: readonly string[], withOther: boolean) =>
  [...(withOther ? [OTHER] : []), ...values].map(value => ({ value, label: value === OTHER ? 'as other' : value }))

/** Every row the board lists: the built-in types, `other`, then the named and offered types. */
export function boardRows(table: Table, offered: string[]): { key: string; label: string; isNamed: boolean }[] {
  const named = [...new Set([...Object.keys(table.named), ...offered])]
  return [
    ...BUILT_IN_ROWS.map(r => ({ key: r.key, label: r.key, isNamed: false })),
    { key: OTHER, label: 'any other type', isNamed: false },
    ...named.map(key => ({ key, label: key, isNamed: true })),
  ]
}

/** What one subagent ran on, and why: `Haiku 5.5 (your row) · low (your row)`. */
export function dispatchLine(d: Dispatch): string {
  const model = `${modelName(d.model) || 'model unknown'} (${SOURCE_LABEL[d.modelSource]})`
  const effort = `${d.effort ?? 'no effort'} (${SOURCE_LABEL[d.effortSource]})`
  return `${model} · ${effort}`
}

export function boardView(ctx: BoardCtx): RenderElement {
  const { Box, Text, Button, Select } = ctx.ui
  const { table } = ctx
  const rows = boardRows(table, ctx.offered).map(r => {
    const named = table.named[r.key]
    const pick = r.isNamed ? (named ?? { model: OTHER, effort: OTHER }) : table.rows[r.key]!
    const failed = ctx.failed[r.key]
    return (
      <Box key={`row-${r.key}`} flexDirection="column">
        <Text bold wrap="truncate-end">
          {r.label}
        </Text>
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          <Select key={`model-${r.key}`} label="model " options={options(MODELS, r.isNamed)} value={pick.model} onSelect={v => ctx.act.setPick(r.key, 'model', v)} />
          <Select key={`effort-${r.key}`} label="effort " options={options(EFFORTS, r.isNamed)} value={pick.effort} onSelect={v => ctx.act.setPick(r.key, 'effort', v)} />
        </Box>
        {failed ? (
          <Text color={WARN} wrap="wrap">
            {`${failed} did not start a subagent: skipped for this session`}
          </Text>
        ) : null}
      </Box>
    )
  })
  const list = Object.values(ctx.dispatches).sort((a, b) => b.startedAt - a.startedAt)
  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text bold>Routing</Text>
        <Button key="routing" plain label={table.isOn ? '● on' : '○ off'} onPress={() => ctx.act.setRouting(!table.isOn)} />
        <Text dimColor wrap="wrap">
          {table.isOn ? 'new subagents follow the rows below' : 'subagents run as without the mod'}
        </Text>
      </Box>
      <Box key="rows" flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
        <Text color={ACCENT} bold>
          Rows
        </Text>
        {rows}
      </Box>
      <Box key="dispatches" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        <Text color={ACCENT} bold>
          {`This session · ${list.length}`}
        </Text>
        {list.length ? (
          list.map(d => (
            <Box key={`d-${d.agentId}`} flexDirection="column">
              <Text wrap="truncate-end">
                <Text bold>{d.type}</Text>
                <Text dimColor>{` · ${d.description}`}</Text>
              </Text>
              <Text dimColor wrap="wrap">
                {`${dispatchLine(d)} · row: ${d.row === OTHER ? 'any other type' : d.row}`}
              </Text>
            </Box>
          ))
        ) : (
          <Text dimColor>No subagents yet.</Text>
        )}
      </Box>
    </Box>
  )
}
