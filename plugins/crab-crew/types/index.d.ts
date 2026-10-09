export type CrewStatus = 'running' | 'done' | 'failed' | 'stopped'

/** What a crab is doing right now, from the tool it last called. */
export type Activity = 'start' | 'think' | 'read' | 'search' | 'edit' | 'shell' | 'web' | 'delegate' | 'plan' | 'other'

export type CrewMember = {
  id: string
  agentId?: string
  /** The agent type as spawned: `general-purpose`, `Explore`, `Plan`, a plugin's agent. */
  type: string
  /** Key into the character roster. */
  character: string
  /** The crab's given name, e.g. `Pip`. */
  name: string
  description: string
  model: string
  effort?: string
  status: CrewStatus
  startedAt: number
  endedAt?: number
  lastActiveAt: number
  activity: Activity
  /** The target of the last call: a file name, a pattern, a command. */
  detail: string
  toolCalls: number
  errors: number
  steps: number
  contextTokens: number
  tokens: number
  /** From the agent's own TodoWrite / TaskCreate / TaskUpdate calls, when it makes any. */
  todoDone?: number
  todoTotal?: number
  todoNote?: string
}

/** The main thread, drawn as the captain at the top of the panel. */
export type Captain = {
  isBusy: boolean
  activity: Activity
  detail: string
  lastActiveAt: number
}

export type CrewPanel = {
  isDoneCollapsed: boolean
  isRosterOpen: boolean
  hasAutoOpened: boolean
  /** The band above the prompt shows crew started or ended after this time. */
  bandSince: number
}

declare module 'claude-code' {
  interface PluginState {
    'crab-crew': {
      crew: CrewMember[]
      captain: Captain
      panel: CrewPanel
      now: number
    }
  }
}
