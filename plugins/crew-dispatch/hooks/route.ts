// The routing table and how a subagent's row is found and applied. Pure functions: no `$` here.
import type { DispatchRow, EffortPick, ModelPick, RouteSource } from '../types'

export const PLUGIN = 'crew-dispatch'

export const MODELS = ['auto', 'inherit', 'haiku', 'sonnet', 'opus', 'fable'] as const
export const EFFORTS = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const
/** A named type's field may also follow the `other` row. */
export const OTHER = 'other'

/** The built-in types with a row of their own, each with its two settings, then the catch-all. */
export const BUILT_IN_ROWS = [
  { key: 'general-purpose', field: 'generalPurpose' },
  { key: 'claude', field: 'claude' },
  { key: 'Explore', field: 'explore' },
  { key: 'Plan', field: 'plan' },
  { key: 'claude-code-guide', field: 'guide' },
  { key: 'statusline-setup', field: 'statusline' },
] as const
export const OTHER_FIELD = 'other'
export const NAMED_FIELD = 'namedTypes'
export const ROUTING_FIELD = 'routing'

/** Types the table never routes: forks inherit everything, the rest are left alone by design. */
const SKIPPED_TYPES = new Set(['fork', 'teammate'])

/** `some-plugin:helper` and `helper` name the same agent, as session-lens reads them. */
export const bareType = (type: string): string => type.slice(type.lastIndexOf(':') + 1)

const isModel = (v: unknown): v is ModelPick => typeof v === 'string' && (MODELS as readonly string[]).includes(v)
const isEffort = (v: unknown): v is EffortPick => typeof v === 'string' && (EFFORTS as readonly string[]).includes(v)

/** The settings as one table: each row's picks, the named types' rows, and whether routing is on. */
export type Table = {
  isOn: boolean
  rows: Record<string, DispatchRow>
  named: Record<string, NamedRow>
}
export type NamedRow = { model: ModelPick | typeof OTHER; effort: EffortPick | typeof OTHER }

const pickRow = (s: Record<string, unknown>, field: string): DispatchRow => ({
  model: isModel(s[`${field}Model`]) ? (s[`${field}Model`] as ModelPick) : 'auto',
  effort: isEffort(s[`${field}Effort`]) ? (s[`${field}Effort`] as EffortPick) : 'auto',
})

/**
 * The named types' text setting: `type=model:effort` entries split by commas or semicolons. A field left
 * out, or not one of the picks, follows the `other` row. The type keeps any plugin prefix it was given.
 */
export function parseNamed(text: unknown): Record<string, NamedRow> {
  const out: Record<string, NamedRow> = {}
  if (typeof text !== 'string') return out
  for (const entry of text.split(/[,;]/)) {
    const at = entry.lastIndexOf('=')
    if (at <= 0) continue
    const type = entry.slice(0, at).trim()
    const [model = '', effort = ''] = entry.slice(at + 1).split(':').map(s => s.trim())
    if (!type) continue
    out[type] = { model: isModel(model) ? model : OTHER, effort: isEffort(effort) ? effort : OTHER }
  }
  return out
}

/** The named rows back as the text setting, dropping a row that follows `other` in both fields. */
export const formatNamed = (named: Record<string, NamedRow>): string =>
  Object.entries(named)
    .filter(([, r]) => r.model !== OTHER || r.effort !== OTHER)
    .map(([type, r]) => `${type}=${r.model}:${r.effort}`)
    .join(', ')

/** The table from the settings, by field name (`exploreModel`, `namedTypes`, `routing`). */
export function tableOf(settings: Record<string, unknown>): Table {
  const rows: Record<string, DispatchRow> = {}
  for (const r of BUILT_IN_ROWS) rows[r.key] = pickRow(settings, r.field)
  rows[OTHER] = pickRow(settings, OTHER_FIELD)
  return { isOn: settings[ROUTING_FIELD] !== false, rows, named: parseNamed(settings[NAMED_FIELD]) }
}

/** The row a type is routed by, and that row's key: a named row, else its built-in row, else `other`. */
export function rowFor(table: Table, type: string): { key: string; row: DispatchRow } {
  const bare = bareType(type)
  const namedKey = type in table.named ? type : Object.keys(table.named).find(k => bareType(k) === bare)
  const other = table.rows[OTHER]!
  if (namedKey) {
    const n = table.named[namedKey]!
    return { key: namedKey, row: { model: n.model === OTHER ? other.model : n.model, effort: n.effort === OTHER ? other.effort : n.effort } }
  }
  const builtIn = table.rows[type] ? type : undefined
  return builtIn ? { key: builtIn, row: table.rows[builtIn]! } : { key: OTHER, row: other }
}

/** Whether a spawn is one the table covers: an ordinary subagent, not a fork, teammate, workflow agent or resume. */
export const isRouted = (e: { fork: boolean; isTeammate?: true; workflow?: unknown; resume?: unknown; subagentType: string }): boolean =>
  !e.fork && !e.isTeammate && !e.workflow && !e.resume && !SKIPPED_TYPES.has(e.subagentType)

/**
 * The model a spawn should run on, and why: Claude's own choice stands, then the row's pick (a row whose
 * model failed this session is skipped), then the agent's definition or the session's default.
 */
export function modelFor(
  callerModel: string | undefined,
  row: DispatchRow,
  parentModel: string,
  isFailed: boolean,
): { model: string | undefined; source: RouteSource } {
  if (callerModel !== undefined) return { model: callerModel, source: 'claude' }
  if (row.model === 'auto') return { model: undefined, source: 'default' }
  if (isFailed) return { model: undefined, source: 'fallback' }
  return { model: row.model === 'inherit' ? parentModel : row.model, source: 'row' }
}

/** A model id as people say it: `claude-haiku-5-5` is Haiku 5.5; an alias is capitalised. */
export function modelName(id: string | undefined): string {
  if (!id) return ''
  const [, family = '', major = '', minor] = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id) ?? []
  if (family) return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? `.${minor}` : ''}`
  const alias = id.replace(/^claude-/, '').replace(/\[.*\]$/, '')
  return /^[a-z]+$/.test(alias) ? alias.charAt(0).toUpperCase() + alias.slice(1) : alias
}

export const SOURCE_LABEL: Record<RouteSource, string> = {
  claude: "Claude's call",
  row: 'your row',
  default: 'its default',
  fallback: 'fallback',
  off: 'routing off',
}
