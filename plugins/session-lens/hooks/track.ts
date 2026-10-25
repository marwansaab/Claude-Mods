// What the lens keeps count of: the task list after each plan tool call, each tool's uses, each skill's,
// and how the tools are grouped, sorted and filtered for drawing. Pure functions: no `$` here.
import type { LensPlan, LensSkill, LensSort, LensStep, LensTool } from '../types'

export const EMPTY_PLAN: LensPlan = { steps: [], doneBefore: 0, updatedAt: 0 }

/** The desktop app's own task list and its closing call, which ticks every step off. */
export const DESKTOP_PLAN = 'mcp__ccd_turn__update_plan'
export const DESKTOP_WRAP_UP = 'mcp__ccd_turn__wrap_up'
export const PLAN_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', DESKTOP_PLAN, DESKTOP_WRAP_UP])

const STATUSES = new Set(['pending', 'in_progress', 'completed'])
const statusOf = (v: unknown): LensStep['status'] => (typeof v === 'string' && STATUSES.has(v) ? (v as LensStep['status']) : 'pending')
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export const doneOf = (steps: LensStep[]) => steps.filter(s => s.status === 'completed').length

/** Steps from a list of objects, the text read from the first key that has one. */
function stepsOf(raw: unknown, textKey: string): LensStep[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const o = item as Record<string, unknown>
    const text = str(o[textKey])
    if (!text) return []
    const active = str(o.activeForm)
    return [{ text, status: statusOf(o.status), ...(active ? { active } : {}) }]
  })
}

/** 1-based step numbers from a field that holds one or a list. */
const numbersOf = (v: unknown): number[] => (Array.isArray(v) ? v : [v]).filter((n): n is number => typeof n === 'number' && Number.isInteger(n))

/** The desktop app's plan call: a whole new list, or `advance`, `done` and `start` on the one there is. */
function desktopPlan(steps: LensStep[], input: Record<string, unknown>): LensStep[] | null {
  if (Array.isArray(input.items)) return stepsOf(input.items, 'content')
  let next = steps.map(s => ({ ...s }))
  let changed = false
  if (input.advance === true) {
    const at = next.findIndex(s => s.status === 'in_progress')
    if (at >= 0) next[at]!.status = 'completed'
    const following = next.findIndex((s, i) => i > at && s.status === 'pending')
    if (following >= 0) next[following]!.status = 'in_progress'
    changed = at >= 0 || following >= 0
  }
  for (const n of numbersOf(input.done)) {
    const step = next[n - 1]
    if (step) {
      step.status = 'completed'
      changed = true
    }
  }
  for (const n of numbersOf(input.start)) {
    const step = next[n - 1]
    if (step) {
      next = next.map(s => (s.status === 'in_progress' ? { ...s, status: 'pending' } : s))
      next[n - 1] = { ...step, status: 'in_progress' }
      changed = true
    }
  }
  return changed ? next : null
}

/** The plan after one main-conversation call to a plan tool, or null when the call changes nothing. */
export function planAfter(cur: LensPlan, tool: string, input: Record<string, unknown>, result: unknown, at: number): LensPlan | null {
  const make = (steps: LensStep[]): LensPlan => ({ steps, doneBefore: doneOf(cur.steps), updatedAt: at })
  if (tool === 'TodoWrite') return make(stepsOf(input.todos, 'content'))
  if (tool === DESKTOP_PLAN) {
    const steps = desktopPlan(cur.steps, input)
    return steps ? make(steps) : null
  }
  if (tool === DESKTOP_WRAP_UP) {
    if (!cur.steps.some(s => s.status !== 'completed')) return null
    return make(cur.steps.map(s => ({ ...s, status: 'completed' })))
  }
  if (tool === 'TaskCreate') {
    const text = str(input.subject)
    if (!text) return null
    const made = (result as { task?: { id?: unknown } } | undefined)?.task?.id
    const id = typeof made === 'string' || typeof made === 'number' ? String(made) : String(cur.steps.length + 1)
    const active = str(input.activeForm)
    return make([...cur.steps, { text, status: 'pending', id, ...(active ? { active } : {}) }])
  }
  if (tool === 'TaskUpdate') {
    const id = typeof input.taskId === 'number' ? String(input.taskId) : str(input.taskId)
    let at2 = cur.steps.findIndex(s => s.id === id)
    if (at2 < 0 && /^\d+$/.test(id) && !cur.steps.some(s => s.id)) at2 = Number(id) - 1
    const old = cur.steps[at2]
    if (!old) return null
    if (input.status === 'deleted') return make(cur.steps.filter((_, i) => i !== at2))
    const text = str(input.subject) || old.text
    const active = str(input.activeForm) || old.active
    const status = input.status === undefined ? old.status : statusOf(input.status)
    return make(cur.steps.map((s, i) => (i === at2 ? { ...s, text, status, ...(active ? { active } : {}) } : s)))
  }
  return null
}

// ---------- tools ----------

/** The server and tool parts of `mcp__<server>__<tool>`; no server for a built-in tool. */
export function splitTool(name: string): { server: string; tool: string } {
  if (!name.startsWith('mcp__')) return { server: '', tool: name }
  const [, server = '', ...rest] = name.split('__')
  return { server, tool: rest.join('__') || name }
}

const UUID_ISH = /^[0-9a-f]{8}-[0-9a-f-]{4,}$/i

const titleCase = (s: string) =>
  s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => (w.length <= 3 && /^(mcp|cli|api|ai)$/i.test(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ')

/** The name a tool group is shown under: the name /mcp lists, else the server's own name tidied. */
export function groupLabel(server: string, known: Record<string, string>): string {
  if (!server) return 'Built-in'
  const listed = known[server]
  if (listed) return listed.replace(/^claude\.ai\s+/i, '')
  if (server.startsWith('ccd_')) return `Desktop app · ${titleCase(server.slice(4))}`
  if (UUID_ISH.test(server)) return `Connector ${server.slice(0, 4)}`
  return titleCase(server.replace(/^plugin_[^_]+_/, '').replace(/^claude_ai_/i, '')) || server
}

/** A tool's own name, tidied for reading: `get_file_contents` reads `get file contents`. */
export const toolLabel = (name: string) => {
  const { server, tool } = splitTool(name)
  return server ? tool.replace(/[-_]+/g, ' ') : tool
}

export function countTool(tools: Record<string, LensTool>, name: string, isError: boolean, at: number): Record<string, LensTool> {
  const old = tools[name]
  return {
    ...tools,
    [name]: {
      name,
      count: (old?.count ?? 0) + 1,
      countBefore: old?.count ?? 0,
      errors: (old?.errors ?? 0) + (isError ? 1 : 0),
      firstAt: old?.firstAt ?? at,
      lastAt: at,
    },
  }
}

export function countSkill(skills: Record<string, LensSkill>, name: string, at: number): Record<string, LensSkill> {
  const old = skills[name]
  return { ...skills, [name]: { name, count: (old?.count ?? 0) + 1, lastAt: at, isAlways: old?.isAlways ?? false } }
}

/** The skill folder a SKILL.md path names, either slash. */
export const skillOfPath = (path: string) => /[\\/]([^\\/]+)[\\/]SKILL\.md$/i.exec(path)?.[1] ?? ''

export function markAlways(skills: Record<string, LensSkill>, names: string[]): Record<string, LensSkill> {
  const out = { ...skills }
  for (const name of names) out[name] = { name, count: out[name]?.count ?? 0, lastAt: out[name]?.lastAt ?? 0, isAlways: true }
  return out
}

export type ToolRow = LensTool & { label: string; group: string; groupLabel: string }
export type ToolGroup = { key: string; label: string; count: number; errors: number; lastAt: number; rows: ToolRow[] }

const bySort = (sort: LensSort) => (a: { label: string; count: number; lastAt: number }, b: { label: string; count: number; lastAt: number }) => {
  if (sort === 'name') return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  if (sort === 'recent') return b.lastAt - a.lastAt || b.count - a.count
  return b.count - a.count || b.lastAt - a.lastAt || a.label.localeCompare(b.label)
}

/** Every tool used, labelled, filtered and sorted. */
export function toolRows(tools: Record<string, LensTool>, servers: Record<string, string>, sort: LensSort, filter: string): ToolRow[] {
  const needle = filter.trim().toLowerCase()
  return Object.values(tools)
    .map(t => {
      const { server } = splitTool(t.name)
      return { ...t, label: toolLabel(t.name), group: server || 'builtin', groupLabel: groupLabel(server, servers) }
    })
    .filter(r => !needle || [r.label, r.name, r.groupLabel].some(s => s.toLowerCase().includes(needle)))
    .sort(bySort(sort))
}

/** The rows in groups by server, built-ins last when sorted by name, the groups in the same order as their rows. */
export function toolGroups(rows: ToolRow[], sort: LensSort): ToolGroup[] {
  const groups = new Map<string, ToolGroup>()
  for (const r of rows) {
    const g = groups.get(r.group) ?? { key: r.group, label: r.groupLabel, count: 0, errors: 0, lastAt: 0, rows: [] }
    g.count += r.count
    g.errors += r.errors
    g.lastAt = Math.max(g.lastAt, r.lastAt)
    g.rows.push(r)
    groups.set(r.group, g)
  }
  return [...groups.values()].sort(bySort(sort))
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
