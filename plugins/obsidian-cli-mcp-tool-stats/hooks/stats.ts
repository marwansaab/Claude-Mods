import type { CallRecord, ErrorGroup, History, RepeatGroup, SchemaCost, StatsSort, ToolTotals } from '../types'

export const MAX_RECENT = 200
export const MAX_REPEATS = 400
export const MAX_ERROR_GROUPS = 60

/** Keys `tool.call` carries beside the tool's own arguments. */
const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'consent'])

export const emptyHistory = (): History => ({ sessions: 0, since: 0, tools: {}, errors: [] })

export const emptyTotals = (): ToolTotals => ({
  calls: 0,
  errors: 0,
  denied: 0,
  inTokens: 0,
  outTokens: 0,
  maxOutTokens: 0,
  runMs: 0,
  maxRunMs: 0,
  timedCalls: 0,
  subagentCalls: 0,
  lastAt: 0,
})

/** MCP tool names keep letters, digits, `_` and `-`; anything else in a server's name becomes `_`. */
export const normalizeServer = (server: string): string => server.trim().replace(/[^a-zA-Z0-9_-]/g, '_')

/**
 * The tool's short name when it belongs to the tracked server, else undefined.
 * Matches `mcp__<server>__<tool>` and a plugin-provided server's longer prefix (`mcp__plugin_x_<server>__<tool>`).
 */
export function shortNameOf(tool: string, server: string): string | undefined {
  if (!tool.startsWith('mcp__') || server === '') return undefined
  const marker = `${server}__`
  const at = tool.indexOf(marker, 5)
  if (at < 0) return undefined
  if (at !== 5 && tool[at - 1] !== '_') return undefined
  const name = tool.slice(at + marker.length)
  return name === '' ? undefined : name
}

/** A rough token count: about four characters a token, as English and JSON run. */
export const estTokens = (text: string): number => (text ? Math.ceil(text.length / 4) : 0)

/** JSON with sorted keys, so the same arguments always read the same. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** The tool's own arguments, without the keys the engine adds. */
export function argsOf(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(e)) if (!RESERVED.has(k)) out[k] = v
  return out
}

/** What the model read back from the call. */
export function resultText(ran: { deny?: string; text?: string; result?: unknown }): string {
  if (ran.deny !== undefined) return ran.deny
  if (typeof ran.text === 'string') return ran.text
  if (typeof ran.result === 'string') return ran.result
  try {
    return JSON.stringify(ran.result) ?? ''
  } catch {
    return ''
  }
}

export const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export const firstLine = (text: string): string => cut(text.trim().split(/\r?\n/)[0] ?? '', 200)

/** An error message with its particulars masked, so errors that differ only in a path or a number group together. */
export function maskError(message: string): string {
  return cut(
    firstLine(message)
      .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '"…"')
      .replace(/(?:[A-Za-z]:)?(?:[\w.-]*[\\/])+[\w.-]+/g, '<path>')
      .replace(/\b[\w-]+\.(?:md|canvas|base|json|png|jpe?g|pdf)\b/gi, '<file>')
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' '),
    120,
  )
}

export function addToTotals(t: ToolTotals | undefined, c: CallRecord): ToolTotals {
  const base = t ?? emptyTotals()
  const ms = c.runMs ?? c.wallMs
  return {
    calls: base.calls + 1,
    errors: base.errors + (c.isError ? 1 : 0),
    denied: base.denied + (c.isDenied ? 1 : 0),
    inTokens: base.inTokens + c.inTokens,
    outTokens: base.outTokens + c.outTokens,
    maxOutTokens: Math.max(base.maxOutTokens, c.outTokens),
    runMs: base.runMs + (c.isDenied ? 0 : ms),
    maxRunMs: Math.max(base.maxRunMs, c.isDenied ? 0 : ms),
    timedCalls: base.timedCalls + (c.isDenied ? 0 : 1),
    subagentCalls: base.subagentCalls + (c.isSubagent ? 1 : 0),
    lastAt: Math.max(base.lastAt, c.at),
  }
}

export function mergeTotals(a: ToolTotals | undefined, b: ToolTotals | undefined): ToolTotals {
  const x = a ?? emptyTotals()
  const y = b ?? emptyTotals()
  return {
    calls: x.calls + y.calls,
    errors: x.errors + y.errors,
    denied: x.denied + y.denied,
    inTokens: x.inTokens + y.inTokens,
    outTokens: x.outTokens + y.outTokens,
    maxOutTokens: Math.max(x.maxOutTokens, y.maxOutTokens),
    runMs: x.runMs + y.runMs,
    maxRunMs: Math.max(x.maxRunMs, y.maxRunMs),
    timedCalls: x.timedCalls + y.timedCalls,
    subagentCalls: x.subagentCalls + y.subagentCalls,
    lastAt: Math.max(x.lastAt, y.lastAt),
  }
}

export function addError(groups: readonly ErrorGroup[], c: CallRecord): ErrorGroup[] {
  if (!c.isError || c.error === undefined) return [...groups]
  const pattern = maskError(c.error)
  const found = groups.find(g => g.tool === c.tool && g.pattern === pattern)
  const next = found
    ? groups.map(g => (g === found ? { ...g, count: g.count + 1, sample: c.error ?? g.sample, lastAt: c.at } : g))
    : [...groups, { tool: c.tool, pattern, sample: c.error, count: 1, lastAt: c.at }]
  return trimErrors(next)
}

const trimErrors = (groups: ErrorGroup[]): ErrorGroup[] =>
  groups.length <= MAX_ERROR_GROUPS ? groups : [...groups].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, MAX_ERROR_GROUPS)

export function mergeErrors(a: readonly ErrorGroup[], b: readonly ErrorGroup[]): ErrorGroup[] {
  const out = a.map(g => ({ ...g }))
  for (const g of b) {
    const found = out.find(o => o.tool === g.tool && o.pattern === g.pattern)
    if (found) {
      found.count += g.count
      if (g.lastAt >= found.lastAt) {
        found.lastAt = g.lastAt
        found.sample = g.sample
      }
    } else out.push({ ...g })
  }
  return trimErrors(out)
}

export const repeatKey = (tool: string, args: string): string => `${tool} ${cut(args, 400)}`

export function addRepeat(groups: Readonly<Record<string, RepeatGroup>>, c: CallRecord, argsFull: string): Record<string, RepeatGroup> {
  if (c.isDenied) return { ...groups }
  const key = repeatKey(c.tool, argsFull)
  const found = groups[key]
  const next: Record<string, RepeatGroup> = {
    ...groups,
    [key]: found
      ? { ...found, count: found.count + 1, wastedTokens: found.wastedTokens + c.outTokens }
      : { tool: c.tool, args: c.args, count: 1, wastedTokens: 0 },
  }
  const keys = Object.keys(next)
  if (keys.length <= MAX_REPEATS) return next
  // Over the bound: forget the oldest calls that never repeated.
  for (const k of keys) {
    if (Object.keys(next).length <= MAX_REPEATS) break
    if (next[k]?.count === 1 && k !== key) delete next[k]
  }
  return next
}

/** Every session before this one plus this one, as the store keeps it. */
export function mergeHistory(
  baseline: History,
  tools: Readonly<Record<string, ToolTotals>>,
  errors: readonly ErrorGroup[],
  firstAt: number,
): History {
  const hasCalls = Object.values(tools).some(t => t.calls > 0)
  if (!hasCalls) return baseline
  const merged: Record<string, ToolTotals> = { ...baseline.tools }
  for (const [name, t] of Object.entries(tools)) merged[name] = mergeTotals(merged[name], t)
  return {
    sessions: baseline.sessions + 1,
    since: baseline.since || firstAt,
    tools: merged,
    errors: mergeErrors(baseline.errors, errors),
  }
}

/** Reads what the store held, tolerating anything an older version or a hand edit left there. */
export function parseHistory(raw: unknown): History {
  if (raw === null || typeof raw !== 'object') return emptyHistory()
  const h = raw as Partial<History>
  const tools: Record<string, ToolTotals> = {}
  if (h.tools && typeof h.tools === 'object')
    for (const [name, t] of Object.entries(h.tools)) if (t && typeof t === 'object') tools[name] = mergeTotals(emptyTotals(), t)
  return {
    sessions: Number(h.sessions) || 0,
    since: Number(h.since) || 0,
    tools,
    errors: Array.isArray(h.errors) ? h.errors.filter(g => g && typeof g.tool === 'string' && typeof g.pattern === 'string') : [],
  }
}

// ---------------------------------------------------------------- figures

export const avg = (sum: number, n: number): number => (n > 0 ? sum / n : 0)

export function fmtTok(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`
}

export const fmtPct = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%')

export function fmtAgo(at: number, now: number): string {
  if (!at) return '—'
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

export const fmtDate = (at: number): string => (at ? new Date(at).toISOString().slice(0, 10) : '—')

export function sumTotals(tools: Readonly<Record<string, ToolTotals>>): ToolTotals {
  return Object.values(tools).reduce<ToolTotals>((acc, t) => mergeTotals(acc, t), emptyTotals())
}

const sortValue = (t: ToolTotals, sort: StatsSort): number =>
  sort === 'calls' ? t.calls : sort === 'tokens' ? t.inTokens + t.outTokens : sort === 'errors' ? t.errors + t.denied : t.runMs

export function sortedTools(tools: Readonly<Record<string, ToolTotals>>, sort: StatsSort): [string, ToolTotals][] {
  return Object.entries(tools).sort(([an, a], [bn, b]) => sortValue(b, sort) - sortValue(a, sort) || b.calls - a.calls || an.localeCompare(bn))
}

/** One line for the pane's head and the report's. */
export function summaryLine(tools: Readonly<Record<string, ToolTotals>>): string {
  const t = sumTotals(tools)
  if (t.calls === 0) return 'No calls yet this session.'
  const used = Object.values(tools).filter(x => x.calls > 0).length
  return [
    `${t.calls} call${t.calls === 1 ? '' : 's'}`,
    `${used} tool${used === 1 ? '' : 's'}`,
    `≈${fmtTok(t.outTokens)} tok read`,
    `≈${fmtTok(t.inTokens)} tok sent`,
    `${t.errors} error${t.errors === 1 ? '' : 's'} (${fmtPct(t.errors, t.calls)})`,
    t.denied ? `${t.denied} denied` : '',
    `avg ${fmtMs(avg(t.runMs, t.timedCalls))}`,
    t.subagentCalls ? `${fmtPct(t.subagentCalls, t.calls)} from subagents` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

// ---------------------------------------------------------------- hints

export type HintKind = 'heavy' | 'schema' | 'errors' | 'repeat' | 'slow' | 'denied'

export type Hint = {
  kind: HintKind
  /** 3 is the most worth acting on. */
  weight: 1 | 2 | 3
  tool?: string
  text: string
}

export type HintInput = {
  tools: Readonly<Record<string, ToolTotals>>
  errors: readonly ErrorGroup[]
  repeats: Readonly<Record<string, RepeatGroup>>
  schemas: readonly SchemaCost[]
  history: History
  heavyTokens: number
  slowMs: number
}

/** What to ask for instead when a tool's results run large; the obsidian-cli-mcp tools by name, a general line otherwise. */
export function lighterAlternative(tool: string): string {
  if (tool === 'read') return 'call `outline` first, then `read_heading` for just the section needed'
  if (/search|query|similar/.test(tool)) return 'narrow it to a folder or ask for fewer results, if the tool takes a limit'
  if (tool === 'files' || tool === 'paths' || tool === 'tag' || tool === 'properties') return 'filter it to a folder or a pattern'
  if (/base/.test(tool)) return 'query fewer rows or properties'
  if (tool === 'backlinks' || tool === 'links') return 'ask about one note at a time'
  return 'ask for less: a narrower scope, a limit, or a summary'
}

export const HINT_TITLES: Record<HintKind, string> = {
  heavy: 'Heavy results',
  repeat: 'Repeat calls',
  errors: 'Error patterns',
  schema: 'Unused schemas',
  slow: 'Slow calls',
  denied: 'Permission denials',
}

export function hintsOf(input: HintInput): Hint[] {
  const { tools, errors, repeats, schemas, history, heavyTokens, slowMs } = input
  const hints: Hint[] = []

  for (const [tool, t] of Object.entries(tools)) {
    if (t.calls === 0) continue
    const avgOut = avg(t.outTokens, t.calls)

    if ((t.calls >= 2 && avgOut >= heavyTokens) || t.maxOutTokens >= heavyTokens * 4) {
      hints.push({
        kind: 'heavy',
        weight: t.outTokens >= heavyTokens * 10 ? 3 : 2,
        tool,
        text: `\`${tool}\` results average ≈${fmtTok(avgOut)} tok (largest ≈${fmtTok(t.maxOutTokens)}, ≈${fmtTok(t.outTokens)} in all). To read less, ${lighterAlternative(tool)}.`,
      })
    }

    if (t.calls >= 3 && t.errors / t.calls >= 0.2) {
      const top = errors.filter(g => g.tool === tool).sort((a, b) => b.count - a.count)[0]
      hints.push({
        kind: 'errors',
        weight: t.errors / t.calls >= 0.5 ? 3 : 2,
        tool,
        text: `\`${tool}\` fails ${fmtPct(t.errors, t.calls)} of the time (${t.errors} of ${t.calls})${top ? `, mostly: “${top.pattern}” ×${top.count}` : ''}. Worth a fix in the server or a clearer description of its arguments.`,
      })
    } else if (t.errors > 0) {
      const top = errors.filter(g => g.tool === tool && g.count >= 2).sort((a, b) => b.count - a.count)[0]
      if (top)
        hints.push({
          kind: 'errors',
          weight: 1,
          tool,
          text: `\`${tool}\` hit the same error ${top.count} times: “${top.pattern}”.`,
        })
    }

    if (t.timedCalls >= 2 && avg(t.runMs, t.timedCalls) >= slowMs) {
      hints.push({
        kind: 'slow',
        weight: avg(t.runMs, t.timedCalls) >= slowMs * 3 ? 2 : 1,
        tool,
        text: `\`${tool}\` takes ${fmtMs(avg(t.runMs, t.timedCalls))} on average (slowest ${fmtMs(t.maxRunMs)}). Check whether the Obsidian CLI starts cold on each call, or cache in the server.`,
      })
    }

    if (t.denied > 0) {
      hints.push({
        kind: 'denied',
        weight: 1,
        tool,
        text: `\`${tool}\` was denied ${t.denied} time${t.denied === 1 ? '' : 's'}. If it is safe, an allow rule saves the prompts; if not, a deny rule saves the attempts.`,
      })
    }
  }

  const repeated = Object.values(repeats)
    .filter(r => r.count >= 2)
    .sort((a, b) => b.wastedTokens - a.wastedTokens || b.count - a.count)
  for (const r of repeated.slice(0, 5)) {
    hints.push({
      kind: 'repeat',
      weight: r.wastedTokens >= heavyTokens * 2 || r.count >= 4 ? 3 : 2,
      tool: r.tool,
      text: `\`${r.tool}\` ran ${r.count}× with the same arguments ${cut(r.args, 80)}, re-reading ≈${fmtTok(r.wastedTokens)} tok. The answer was already in context; a note in CLAUDE.md or a cache in the server would save it.`,
    })
  }
  if (repeated.length > 5)
    hints.push({ kind: 'repeat', weight: 1, text: `${repeated.length - 5} more argument sets were repeated; see the copied report for all of them.` })

  const loadedUnused = schemas.filter(s => s.isLoaded && !(tools[s.tool]?.calls ?? 0))
  if (loadedUnused.length > 0) {
    const tokens = loadedUnused.reduce((n, s) => n + s.tokens, 0)
    hints.push({
      kind: 'schema',
      weight: tokens >= 2000 ? 2 : 1,
      text: `${loadedUnused.length} tool schema${loadedUnused.length === 1 ? ' is' : 's are'} in context but not called this session, costing ≈${fmtTok(tokens)} tok on every request: ${loadedUnused
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 6)
        .map(s => `\`${s.tool}\` (${fmtTok(s.tokens)})`)
        .join(', ')}${loadedUnused.length > 6 ? ', …' : ''}.`,
    })
  }

  const allTime = mergeHistory(history, tools, [], 0).tools
  const sessions = history.sessions + (Object.values(tools).some(t => t.calls > 0) ? 1 : 0)
  const neverCalled = schemas.filter(s => !(allTime[s.tool]?.calls ?? 0))
  if (neverCalled.length > 0 && sessions >= 3) {
    const tokens = neverCalled.reduce((n, s) => n + s.tokens, 0)
    hints.push({
      kind: 'schema',
      weight: neverCalled.length >= 5 ? 2 : 1,
      text: `${neverCalled.length} tool${neverCalled.length === 1 ? ' has' : 's have'} never been called in ${sessions} sessions (schemas ≈${fmtTok(tokens)} tok): ${neverCalled
        .map(s => `\`${s.tool}\``)
        .slice(0, 10)
        .join(', ')}${neverCalled.length > 10 ? ', …' : ''}. Candidates to merge, hide, or describe better.`,
    })
  }

  return hints.sort((a, b) => b.weight - a.weight)
}

// ---------------------------------------------------------------- markdown

const esc = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export function toolsTable(tools: Readonly<Record<string, ToolTotals>>, sort: StatsSort, isCompact: boolean, now: number): string {
  const rows = sortedTools(tools, sort).filter(([, t]) => t.calls > 0)
  if (rows.length === 0) return '_No obsidian-cli-mcp calls yet this session._'
  if (isCompact) {
    return [
      '| Tool | Calls | Err | ≈Tok read | Avg time |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...rows.map(([n, t]) => `| \`${esc(n)}\` | ${t.calls} | ${t.errors || ''} | ${fmtTok(t.outTokens)} | ${fmtMs(avg(t.runMs, t.timedCalls))} |`),
    ].join('\n')
  }
  return [
    '| Tool | Calls | Err | ≈Tok sent | ≈Tok read | Avg read | Largest | Avg time | Slowest | Last |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(
      ([n, t]) =>
        `| \`${esc(n)}\` | ${t.calls}${t.subagentCalls ? ` (${t.subagentCalls} sub)` : ''} | ${t.errors || ''}${t.denied ? ` +${t.denied} denied` : ''} | ${fmtTok(t.inTokens)} | ${fmtTok(t.outTokens)} | ${fmtTok(avg(t.outTokens, t.calls))} | ${fmtTok(t.maxOutTokens)} | ${fmtMs(avg(t.runMs, t.timedCalls))} | ${fmtMs(t.maxRunMs)} | ${fmtAgo(t.lastAt, now)} |`,
    ),
  ].join('\n')
}

export function errorsMarkdown(errors: readonly ErrorGroup[], recent: readonly CallRecord[], now: number): string {
  if (errors.length === 0 && !recent.some(c => c.isDenied)) return '_No errors this session._'
  const groups = [...errors].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
  const denied = recent.filter(c => c.isDenied).slice(-5).reverse()
  const failed = recent.filter(c => c.isError).slice(-5).reverse()
  return [
    groups.length ? '**By pattern**' : '',
    groups.length ? '| Tool | × | Error (masked) | Last |\n| --- | ---: | --- | ---: |' : '',
    ...groups.map(g => `| \`${esc(g.tool)}\` | ${g.count} | ${esc(g.pattern)} | ${fmtAgo(g.lastAt, now)} |`),
    failed.length ? '\n**Latest failures**' : '',
    ...failed.map(c => `- \`${c.tool}\` ${esc(cut(c.args, 80))}\n  → ${esc(c.error ?? 'error')}`),
    denied.length ? '\n**Latest denials**' : '',
    ...denied.map(c => `- \`${c.tool}\` ${esc(cut(c.args, 80))}: ${esc(c.error ?? 'denied')}`),
  ]
    .filter(Boolean)
    .join('\n')
}

export function hintsMarkdown(hints: readonly Hint[], schemasAt: number): string {
  const lines: string[] = []
  if (hints.length === 0) lines.push('_Nothing to tune yet: hints appear as calls come in._')
  for (const kind of ['heavy', 'repeat', 'errors', 'schema', 'slow', 'denied'] as const) {
    const of = hints.filter(h => h.kind === kind)
    if (of.length === 0) continue
    lines.push(`**${HINT_TITLES[kind]}**`)
    for (const h of of) lines.push(`- ${'●'.repeat(h.weight)}${'○'.repeat(3 - h.weight)} ${h.text}`)
    lines.push('')
  }
  if (!schemasAt) lines.push('_Schema costs not read yet: press Refresh._')
  return lines.join('\n').trim()
}

export function historyMarkdown(history: History, tools: Readonly<Record<string, ToolTotals>>, schemas: readonly SchemaCost[], firstAt: number, now: number): string {
  const all = mergeHistory(history, tools, [], firstAt || now)
  const rows = sortedTools(all.tools, 'calls').filter(([, t]) => t.calls > 0)
  const total = sumTotals(all.tools)
  const lines = [
    all.sessions
      ? `${all.sessions} session${all.sessions === 1 ? '' : 's'} since ${fmtDate(all.since)} · ${total.calls} calls · ≈${fmtTok(total.outTokens)} tok read · ${total.errors} errors (${fmtPct(total.errors, total.calls)})`
      : '_No history yet: it builds up as sessions call the server._',
  ]
  if (rows.length) {
    lines.push(
      '',
      '| Tool | Calls | Share | Err % | Avg read | Avg time | Last used |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...rows.map(
        ([n, t]) =>
          `| \`${esc(n)}\` | ${t.calls} | ${fmtPct(t.calls, total.calls)} | ${fmtPct(t.errors, t.calls)} | ${fmtTok(avg(t.outTokens, t.calls))} | ${fmtMs(avg(t.runMs, t.timedCalls))} | ${fmtDate(t.lastAt)} |`,
      ),
    )
  }
  const never = schemas.filter(s => !(all.tools[s.tool]?.calls ?? 0)).map(s => `\`${s.tool}\``)
  if (never.length) lines.push('', `**Never called:** ${never.join(', ')}`)
  return lines.join('\n')
}

export type ReportInput = HintInput & { recent: readonly CallRecord[]; schemasAt: number; firstAt: number; now: number; server: string }

/** The whole picture as Markdown, for the clipboard: paste it into a session to have Claude act on it. */
export function reportMarkdown(r: ReportInput): string {
  const hints = hintsOf(r)
  const schemaTokens = r.schemas.reduce((n, s) => n + s.tokens, 0)
  const loaded = r.schemas.filter(s => s.isLoaded)
  return [
    `# ${r.server} tool usage report`,
    '',
    summaryLine(r.tools),
    r.schemas.length
      ? `Schemas: ${r.schemas.length} tools, ≈${fmtTok(schemaTokens)} tok in all; ${loaded.length} loaded now (≈${fmtTok(loaded.reduce((n, s) => n + s.tokens, 0))} tok).`
      : '',
    '',
    '## This session',
    '',
    toolsTable(r.tools, 'tokens', false, r.now),
    '',
    '## Optimisation hints',
    '',
    hintsMarkdown(hints, r.schemasAt),
    '',
    '## Errors',
    '',
    errorsMarkdown(r.errors, r.recent, r.now),
    '',
    '## All sessions',
    '',
    historyMarkdown(r.history, r.tools, r.schemas, r.firstAt, r.now),
    '',
    '_Token counts are estimates (about four characters a token) of the arguments sent and the results read._',
  ]
    .filter(line => line !== undefined)
    .join('\n')
}

// ---------------------------------------------------------------- desktop chart

const metricOf = (t: ToolTotals, sort: StatsSort): number =>
  sort === 'calls' ? t.calls : sort === 'tokens' ? t.outTokens + t.inTokens : sort === 'errors' ? t.errors + t.denied : avg(t.runMs, t.timedCalls)

const labelOf = (t: ToolTotals, sort: StatsSort): string =>
  sort === 'calls' ? String(t.calls) : sort === 'tokens' ? `≈${fmtTok(t.outTokens + t.inTokens)}` : sort === 'errors' ? String(t.errors + t.denied) : fmtMs(avg(t.runMs, t.timedCalls))

export const CHART_BAR_H = 18

const xmlEsc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A static bar chart of the top tools by the sort in force; no animation, so it reads the same under reduced motion. */
export function chartSvg(tools: Readonly<Record<string, ToolTotals>>, sort: StatsSort, width: number, rows = 8): { svg: string; height: number; alt: string } {
  const top = sortedTools(tools, sort)
    .filter(([, t]) => t.calls > 0)
    .slice(0, rows)
  const max = Math.max(1, ...top.map(([, t]) => metricOf(t, sort)))
  const labelW = 150
  const valueW = 70
  const barMax = Math.max(40, width - labelW - valueW)
  const height = Math.max(CHART_BAR_H, top.length * CHART_BAR_H) + 4
  const bars = top
    .map(([name, t], i) => {
      const y = 2 + i * CHART_BAR_H
      const w = Math.max(2, Math.round((metricOf(t, sort) / max) * barMax))
      const errW = sort === 'calls' && t.calls ? Math.round((t.errors / t.calls) * w) : 0
      return [
        `<text x="${labelW - 8}" y="${y + 13}" text-anchor="end" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="12" fill="#8a8a8a">${xmlEsc(cut(name, 20))}</text>`,
        `<rect x="${labelW}" y="${y + 3}" width="${w}" height="${CHART_BAR_H - 6}" rx="3" fill="#8b5cf6"/>`,
        errW ? `<rect x="${labelW + w - errW}" y="${y + 3}" width="${errW}" height="${CHART_BAR_H - 6}" rx="3" fill="#e5484d"/>` : '',
        `<text x="${labelW + w + 6}" y="${y + 13}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" fill="#8a8a8a">${xmlEsc(labelOf(t, sort))}</text>`,
      ].join('')
    })
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}</svg>`
  const alt = top.length
    ? `Top obsidian-cli-mcp tools by ${sort}: ${top.map(([n, t]) => `${n} ${labelOf(t, sort)}`).join(', ')}`
    : 'No obsidian-cli-mcp calls yet'
  return { svg, height, alt }
}
