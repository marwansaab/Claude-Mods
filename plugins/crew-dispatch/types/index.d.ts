/** What a row's model field holds: leave it (`auto`), the parent's model (`inherit`), or an alias. */
export type ModelPick = 'auto' | 'inherit' | 'haiku' | 'sonnet' | 'opus' | 'fable'
/** What a row's effort field holds: leave it (`auto`), or a level. */
export type EffortPick = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** One row of the routing table, as the settings hold it. */
export type DispatchRow = { model: ModelPick; effort: EffortPick }

/**
 * Where a subagent's model or effort came from: Claude's Agent call, your row, the agent's definition or
 * the session's default (`default`), a fallback after the row's model failed, or routing switched off.
 */
export type RouteSource = 'claude' | 'row' | 'default' | 'fallback' | 'off'

/** One subagent of this session, as the board lists it. */
export type Dispatch = {
  agentId: string
  type: string
  description: string
  /** The row it was routed by: a built-in type, a named type, or `other`. */
  row: string
  /** What it runs on, as the engine names it; each answered request may update it. */
  model?: string
  modelSource: RouteSource
  /** The effort its last request was sent with; absent for a model without effort. */
  effort?: string
  effortSource: RouteSource
  startedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'crew-dispatch': {
      /** This session's subagents, by agent id. */
      dispatches: Record<string, Dispatch>
      /** Agent types the session offered the model that have no built-in row, in the order first seen. */
      offered: string[]
      /** Rows whose model failed to start a subagent this session, by row key, with the model that failed. */
      failed: Record<string, string>
    }
  }
}
