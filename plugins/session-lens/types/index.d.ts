/** One step of Claude's task list. */
export type LensStep = {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
  /** The "doing now" wording, shown while the step is in progress. */
  active?: string
  /** TaskCreate's id, so TaskUpdate finds the step again. */
  id?: string
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
  lastAt: number
  /** Pulled in at start through a memory file (a CLAUDE.md import). */
  isAlways: boolean
}

export type LensSection = 'todo' | 'skills' | 'tools'
export type LensSort = 'count' | 'name' | 'recent'

/** How the person has the pane laid out. */
export type LensView = {
  /** Sections closed with their header. */
  folded: LensSection[]
  /** Tool groups closed with their header, by group key. */
  foldedGroups: string[]
  /** Tools grouped by their MCP server or connector, or one flat list. */
  isGrouped: boolean
  sort: LensSort
  /** Narrows the tools to those whose name or group holds it. */
  filter: string
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
      /** True once a resumed session's earlier calls were counted, so a reload does not count them twice. */
      isSeeded: boolean
      /** True once the pane opened by itself this session. */
      isAutoOpened: boolean
    }
  }
}
