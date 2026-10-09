/** One finished call to a tracked tool. */
export type CallRecord = {
  id: string
  /** The tool's short name, without the `mcp__<server>__` prefix. */
  tool: string
  at: number
  /** Wall time around the call, permission prompt included. */
  wallMs: number
  /** Execution time as the engine measured it, permission prompt excluded; absent when it did not say. */
  runMs?: number
  /** Estimated tokens of the arguments the model wrote. */
  inTokens: number
  /** Estimated tokens of the result the model read. */
  outTokens: number
  isError: boolean
  isDenied: boolean
  /** True when a subagent made the call. */
  isSubagent: boolean
  /** The arguments, cut short, for the recent list and the repeat hints. */
  args: string
  /** The error's first line, cut short. */
  error?: string
}

/** Totals for one tool. */
export type ToolTotals = {
  calls: number
  errors: number
  denied: number
  inTokens: number
  outTokens: number
  maxOutTokens: number
  /** Summed execution time over the calls that reported one (`timedCalls`). */
  runMs: number
  maxRunMs: number
  timedCalls: number
  subagentCalls: number
  lastAt: number
}

/** Errors of one tool that read alike, once numbers, paths and quoted values are masked. */
export type ErrorGroup = {
  tool: string
  /** The masked message. */
  pattern: string
  /** The latest message as it was. */
  sample: string
  count: number
  lastAt: number
}

/** Calls of one tool with the very same arguments. */
export type RepeatGroup = {
  tool: string
  args: string
  count: number
  /** Result tokens of every call after the first: what a cache would have saved. */
  wastedTokens: number
}

/** One tool's schema as the context carries it. */
export type SchemaCost = {
  tool: string
  tokens: number
  /** False while tool schemas load on demand and this one has not been searched for. */
  isLoaded: boolean
}

/** What `$.store` keeps across sessions. */
export type History = {
  /** Sessions that called at least one tracked tool. */
  sessions: number
  since: number
  tools: Record<string, ToolTotals>
  errors: ErrorGroup[]
}

export type StatsTab = 'tools' | 'errors' | 'hints' | 'history'
export type StatsSort = 'calls' | 'tokens' | 'errors' | 'time'

export type StatsView = {
  tab: StatsTab
  sort: StatsSort
  /** Set by the copy button; drawn as a short note until the next press. */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'obsidian-cli-mcp-tool-stats': {
      tools: Record<string, ToolTotals>
      recent: CallRecord[]
      errors: ErrorGroup[]
      /** Keyed by tool and arguments. */
      repeats: Record<string, RepeatGroup>
      /** Execution times the engine reported before the call's own hook finished, by tool_use_id. */
      pendingRunMs: Record<string, number>
      schemas: SchemaCost[]
      schemasAt: number
      /** Every session before this one, as read from the store when this one started. */
      baseline: History
      isBaselineLoaded: boolean
      view: StatsView
    }
  }
}
