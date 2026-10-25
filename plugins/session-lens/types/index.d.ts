/** One step of Claude's task list. */
export type LensStep = {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
  /** The "doing now" wording, shown while the step is in progress. */
  active?: string
  /** TaskCreate's id, so TaskUpdate finds the step again. */
  id?: string
  /** When the step joined the list, and when its text or status last changed: its animations are pinned to these. */
  addedAt?: number
  changedAt?: number
}

/** The task list, as the last plan tool call in the main conversation left it. */
export type LensPlan = {
  steps: LensStep[]
  /** Steps done before the last change, so the progress bar grows from there. */
  doneBefore: number
  updatedAt: number
}

/** One tool this session called, with how often. */
export type LensTool = {
  /** The wire name: `Read`, `mcp__notion__search`. */
  name: string
  count: number
  /** The count before the last call, so its bar grows from there. */
  countBefore: number
  /** Calls that came back as errors or were denied. */
  errors: number
  firstAt: number
  lastAt: number
}

/** One skill this session used. */
export type LensSkill = {
  name: string
  count: number
  /** First and last use; 0 for an always-loaded skill not used yet. */
  firstAt: number
  lastAt: number
  /** Pulled in at start through a memory file (a CLAUDE.md import). */
  isAlways: boolean
}

/**
 * The last change of order of one list (`skills`, `flat`, or `g:<group>` for a server's tools): the names
 * in their order before and after, and when. Rows fly from their old place to their new one for a moment
 * after it; a name not in `from` joined the list and flies in from the bottom.
 */
export type LensMove = { from: string[]; to: string[]; at: number }

/** The pane's sections, and the two lists inside the crew (`crewWork`, `crewBase`), each folding on its own. */
export type LensSection = 'todo' | 'crew' | 'crewWork' | 'crewBase' | 'skills' | 'tools'
export type LensSort = 'count' | 'name' | 'recent'

/** What a crab was last seen doing, from its last call or model request. */
export type LensActivity = 'start' | 'think' | 'read' | 'search' | 'edit' | 'shell' | 'web' | 'delegate' | 'plan' | 'other'

/** The main thread, played by Captain Clawd: what it is doing, from its own calls and model requests. */
export type LensCaptain = {
  /** Claude is working on a turn; false while it waits for you. */
  isBusy: boolean
  activity: LensActivity
  detail: string
  lastActiveAt: number
}

/** One subagent of this session, played by a crab. */
export type LensCrab = {
  /** The agent's id; the spawn's tool_use_id when the engine gave none. */
  id: string
  agentId?: string
  /** The agent type as spawned: `Explore`, `general-purpose`, a plugin's own. */
  type: string
  /** Key into the cast of characters. */
  character: string
  /** Its given name: `Pip`, then `Pip II` for a second scout of that name. */
  name: string
  description: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  startedAt: number
  endedAt?: number
  lastActiveAt: number
  activity: LensActivity
  /** The last call's target, short: a file name, a pattern, a command's head. */
  detail: string
  toolCalls: number
  errors: number
  /** From the agent's own to-do list, when it keeps one. */
  todoDone?: number
  todoTotal?: number
  todoNote?: string
  /** Progress before its last change, and when that was: the bar grows from there. */
  progressBefore: number
  progressAt: number
}

/** The part of the layout kept across sessions, in the mod's store. */
export type LensLayout = {
  /** Sections closed with their header. */
  folded: LensSection[]
  /** Whether tool groups start open; a group in `groupExceptions` is the other way. */
  groupsOpen: boolean
  /** Groups, by key, the person opened or closed against `groupsOpen`. */
  groupExceptions: string[]
  /** Tools grouped by their MCP server or connector, or one flat list. */
  isGrouped: boolean
  sort: LensSort
  /** The crew's who's-who legend is open. */
  isLegendOpen: boolean
}

/** How the person has the pane laid out: the kept layout, and what lasts only for the session. */
export type LensView = LensLayout & {
  /** Narrows the tools to those whose name or group holds it. */
  filter: string
  /**
   * When each section (by id) or tool group (`g:<key>`) was last opened or closed, and when the pane
   * opened (`pane`), so rows come in and chevrons turn once then, not on every redraw.
   */
  toggledAt: Record<string, number>
  /** When the tools were last regrouped or resorted: their rows come in again then. */
  layoutAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-lens': {
      plan: LensPlan
      tools: Record<string, LensTool>
      skills: Record<string, LensSkill>
      /** MCP server ids to the names /mcp lists them by. */
      servers: Record<string, string>
      view: LensView
      /** Each list's last change of order, by list key. */
      moves: Record<string, LensMove>
      /** This session's subagents, by id. */
      crew: Record<string, LensCrab>
      /** The main thread, always on the beach. */
      captain: LensCaptain
      /**
       * When the current race began: a crab set out with no one at work. The crew lists show the crabs of
       * this race alone, so the list of those back starts empty with each race.
       */
      raceSince: number
      /** Moved on a timer while a crab works, so a crab left waiting is drawn waiting. */
      crewTick: number
      /** The band above the prompt shows crabs that set out or came back after this moment. */
      crewBandSince: number
      /** True once a resumed session's earlier calls were counted, so a reload does not count them twice. */
      isSeeded: boolean
      /** True once the kept layout was read into `view` this session, so a reload does not read it over the person's changes. */
      isLayoutLoaded: boolean
      /** True once the pane opened by itself this session. */
      isAutoOpened: boolean
      /** The main conversation's TodoWrite, TaskCreate and TaskUpdate calls, by tool_use_id: the rows the lens may hide. */
      planRows: string[]
    }
  }
}
