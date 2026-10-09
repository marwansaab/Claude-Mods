import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CallRecord, StatsSort, StatsTab, StatsView } from '../types'
import {
  MAX_RECENT,
  addError,
  addRepeat,
  addToTotals,
  argsOf,
  chartSvg,
  cut,
  emptyHistory,
  errorsMarkdown,
  estTokens,
  firstLine,
  hintsMarkdown,
  hintsOf,
  historyMarkdown,
  mergeHistory,
  normalizeServer,
  parseHistory,
  reportMarkdown,
  resultText,
  shortNameOf,
  stableStringify,
  summaryLine,
  toolsTable,
} from './stats'

const PLUGIN = 'obsidian-cli-mcp-tool-stats'
const COMMAND = 'cli-mcp-tool-stats'
const PANE = PLUGIN
const STORE_KEY = 'history'

const tools = atom({ plugin: 'obsidian-cli-mcp-tool-stats', key: 'tools' } as const, {})
const recent = atom({ plugin: 'obsidian-cli-mcp-tool-stats', key: 'recent' } as const, [])
const errors = atom({ plugin: 'obsidian-cli-mcp-tool-stats', key: 'errors' } as const, [])
const repeats = atom({ plugin: 'obsidian-cli-mcp-tool-stats', key: 'repeats' } as const, {})
const pendingRunMs = atom({ plugin: 'obsidian-cli-mcp-tool-stats', key: 'pendingRunMs' } as const, {})
const schemas = atom({ plugin: 'obsidian-cli-mcp-tool-stats', key: 'schemas' } as const, [])
const schemasAt = atom({ plugin: 'obsidian-cli-mcp-tool-stats', key: 'schemasAt' } as const, 0)
const baseline = atom({ plugin: 'obsidian-cli-mcp-tool-stats', key: 'baseline' } as const, emptyHistory())
const isBaselineLoaded = atom({ plugin: 'obsidian-cli-mcp-tool-stats', key: 'isBaselineLoaded' } as const, false)
const view = atom({ plugin: 'obsidian-cli-mcp-tool-stats', key: 'view' } as const, { tab: 'tools', sort: 'tokens', note: '' } as StatsView)

const TABS: { tab: StatsTab; label: string; hotkey: string }[] = [
  { tab: 'tools', label: 'Tools', hotkey: '1' },
  { tab: 'errors', label: 'Errors', hotkey: '2' },
  { tab: 'hints', label: 'Hints', hotkey: '3' },
  { tab: 'history', label: 'History', hotkey: '4' },
]

const SORTS: { sort: StatsSort; label: string; hotkey: string }[] = [
  { sort: 'tokens', label: 'Tokens', hotkey: 't' },
  { sort: 'calls', label: 'Calls', hotkey: 'c' },
  { sort: 'errors', label: 'Errors', hotkey: 'e' },
  { sort: 'time', label: 'Time', hotkey: 'm' },
]

/** The stats are an observer: nothing they do may fail the call, the turn or the session they watch. */
async function safely(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // Dropped: a missed update costs one call's figures, never the call.
  }
}

type Settings = { server: string; heavyTokens: number; slowMs: number; keepHistory: boolean }

async function firstAtOf($: EngineInterface): Promise<number> {
  return (await read($, recent))[0]?.at ?? (await $.clock.now())
}

/** Every session before this one plus this one, as the store should hold it now. */
async function mergedHistory($: EngineInterface) {
  return mergeHistory(await read($, baseline), await read($, tools), await read($, errors), await firstAtOf($))
}

// Writes the whole merged picture, so a write repeated after a reload never counts a call twice.
async function flush($: EngineInterface, cfg: Settings): Promise<void> {
  if (!cfg.keepHistory) return
  const merged = await mergedHistory($)
  if (merged.sessions > 0) await $.store.set(STORE_KEY, merged)
}

// Folds this session into the baseline and starts its figures over: a /clear, or the reset command.
async function startOver($: EngineInterface, cfg: Settings): Promise<void> {
  await flush($, cfg)
  const merged = await mergedHistory($)
  await update($, baseline, () => merged)
  await update($, tools, () => ({}))
  await update($, recent, () => [])
  await update($, errors, () => [])
  await update($, repeats, () => ({}))
  await update($, pendingRunMs, () => ({}))
}

async function refreshSchemas($: EngineInterface, cfg: Settings): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const list = (usage.context.breakdown?.mcpTools ?? []).flatMap(t => {
    const tool = shortNameOf(t.name, cfg.server)
    return tool === undefined ? [] : [{ tool, tokens: t.tokens, isLoaded: t.isLoaded }]
  })
  const at = await $.clock.now()
  await update($, schemas, () => list)
  await update($, schemasAt, () => at)
}

async function openPane($: EngineInterface, cfg: Settings): Promise<void> {
  await $.ui.open({ id: PANE, title: 'obsidian-cli-mcp tool stats' })
  await safely(() => refreshSchemas($, cfg))
}

async function reportOf($: EngineInterface, cfg: Settings): Promise<string> {
  return reportMarkdown({
    server: cfg.server,
    tools: await read($, tools),
    errors: await read($, errors),
    repeats: await read($, repeats),
    schemas: await read($, schemas),
    schemasAt: await read($, schemasAt),
    history: await read($, baseline),
    recent: await read($, recent),
    firstAt: await firstAtOf($),
    now: await $.clock.now(),
    heavyTokens: cfg.heavyTokens,
    slowMs: cfg.slowMs,
  })
}

// The engine's own execution time, permission prompt excluded; it lands before the call's hook finishes.
async function noteRunMs(
  $: EngineInterface,
  cfg: Settings,
  e: { tool_name: string; tool_use_id: string; duration_ms?: number },
): Promise<void> {
  if (e.duration_ms === undefined || shortNameOf(e.tool_name, cfg.server) === undefined) return
  const ms = e.duration_ms
  await update($, pendingRunMs, p => ({ ...p, [e.tool_use_id]: ms }))
}

export const register: Register = (on, options) => {
  const server = normalizeServer(String(options.server ?? '') || 'obsidian-cli-mcp')
  const heavyTokens = Number(options.heavyResultTokens) > 0 ? Number(options.heavyResultTokens) : 2000
  const slowMs = Number(options.slowCallMs) > 0 ? Number(options.slowCallMs) : 3000
  const keepHistory = options.keepHistory !== false

  const cfg: Settings = { server, heavyTokens, slowMs, keepHistory }
  const toolOf = (name: string) => shortNameOf(name, server)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await safely(async () => {
      await $.command.register({
        name: COMMAND,
        description: 'Show or hide obsidian-cli-mcp tool stats: calls, tokens, errors, latency and optimisation hints',
        argumentHint: '[reset | forget | report]',
      })
      // A reload fires session.start again: read the store once, or this session's own flushes would count twice.
      if (keepHistory && !(await read($, isBaselineLoaded))) {
        const stored = parseHistory(await $.store.get(STORE_KEY))
        await update($, baseline, () => stored)
        await update($, isBaselineLoaded, () => true)
      }
      $.clock.every(60_000, () => void safely(() => flush($, cfg)))
    })
    return started
  })

  on('session.end', async ($, e, next) => {
    await safely(() => (e.reason === 'clear' ? startOver($, cfg) : flush($, cfg)))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'reset') {
      await startOver($, cfg)
      return { text: 'obsidian-cli-mcp tool stats: this session starts over (its figures so far are kept in the history).' }
    }
    if (arg === 'forget') {
      await update($, baseline, () => emptyHistory())
      await $.store.delete(STORE_KEY)
      return { text: 'obsidian-cli-mcp tool stats: the history of earlier sessions is forgotten. This session is still counted.' }
    }
    if (arg === 'report') {
      await safely(() => refreshSchemas($, cfg))
      return { text: await reportOf($, cfg) }
    }
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'obsidian-cli-mcp tool stats closed.' }
    }
    await openPane($, cfg)
    return { text: 'obsidian-cli-mcp tool stats opened.' }
  }).catch(() => ({ text: 'obsidian-cli-mcp tool stats could not do that just now.' }))

  on('classic.PostToolUse', async ($, e, next) => {
    await safely(() => noteRunMs($, cfg, e))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUseFailure', async ($, e, next) => {
    await safely(() => noteRunMs($, cfg, e))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = toolOf(e.tool)
    if (tool === undefined) return next(e)

    const startedAt = await $.clock.now()
    const ran = await next(e)

    await safely(async () => {
      const at = await $.clock.now()
      const id = e.tool_use_id ?? `${tool}-${at}`
      const argsFull = stableStringify(argsOf(e as Record<string, unknown>))
      const pending = await read($, pendingRunMs)
      const isDenied = ran.deny !== undefined
      const isError = ran.isError === true
      const text = resultText(ran)
      const call: CallRecord = {
        id,
        tool,
        at,
        wallMs: Math.max(0, at - startedAt),
        runMs: pending[id],
        inTokens: estTokens(argsFull),
        outTokens: estTokens(text),
        isError,
        isDenied,
        isSubagent: e.agentId !== undefined,
        args: cut(argsFull, 160),
        error: isDenied || isError ? firstLine(text) || (isDenied ? 'denied' : 'error') : undefined,
      }
      if (call.runMs !== undefined)
        await update($, pendingRunMs, p => {
          const rest = { ...p }
          delete rest[id]
          return rest
        })
      await update($, tools, all => ({ ...all, [tool]: addToTotals(all[tool], call) }))
      await update($, recent, list => [...list, call].slice(-MAX_RECENT))
      if (isError) await update($, errors, groups => addError(groups, call))
      await update($, repeats, groups => addRepeat(groups, call, argsFull))
    })

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = ui
    const v = await read($, view)
    const all = await read($, tools)
    const errs = await read($, errors)
    const rec = await read($, recent)
    const reps = await read($, repeats)
    const sch = await read($, schemas)
    const schAt = await read($, schemasAt)
    const hist = await read($, baseline)
    const now = await $.clock.now()
    const columns = e.props.bodyColumns || 80

    const hints = hintsOf({ tools: all, errors: errs, repeats: reps, schemas: sch, history: hist, heavyTokens, slowMs })
    const setView = (patch: Partial<StatsView>) => update($, view, prev => ({ ...prev, note: '', ...patch }))

    const tabs = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {TABS.map(t => (
          <Button
            key={`tab-${t.tab}`}
            label={t.tab === 'hints' && hints.length ? `${t.label} (${hints.length})` : t.tab === 'errors' && errs.length ? `${t.label} (${errs.reduce((n, g) => n + g.count, 0)})` : t.label}
            hotkey={t.hotkey}
            variant={v.tab === t.tab ? 'primary' : undefined}
            dimColor={v.tab === t.tab ? undefined : true}
            onPress={() => setView({ tab: t.tab })}
          />
        ))}
      </Box>
    )

    const actions = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {v.tab === 'tools' &&
          SORTS.map(s => (
            <Button
              key={`sort-${s.sort}`}
              label={`${v.sort === s.sort ? '▾ ' : ''}${s.label}`}
              hotkey={s.hotkey}
              plain
              dimColor={v.sort === s.sort ? undefined : true}
              onPress={() => setView({ sort: s.sort })}
            />
          ))}
        <Button key="refresh" label="Refresh" hotkey="r" plain dimColor onPress={() => safely(() => refreshSchemas($, cfg))} />
        <Button
          key="copy"
          label="Copy report"
          hotkey="y"
          plain
          dimColor
          onPress={async press => {
            const copied = await $.ui.copy({ text: await reportOf($, cfg), surface: press.surface })
            await update($, view, prev => ({ ...prev, note: copied.isCopied ? 'Report copied as Markdown.' : `Could not copy: ${copied.reason}` }))
          }}
        />
      </Box>
    )

    let body: string
    if (v.tab === 'tools') body = toolsTable(all, v.sort, columns < 90, now)
    else if (v.tab === 'errors') body = errorsMarkdown(errs, rec, now)
    else if (v.tab === 'hints') body = hintsMarkdown(hints, schAt)
    else body = keepHistory ? historyMarkdown(hist, all, sch, rec[0]?.at ?? now, now) : '_History is off in this mod’s settings._'

    const chart =
      v.tab === 'tools' && 'Svg' in ui && rec.length > 0
        ? (() => {
            const { Svg } = ui
            const width = Math.max(260, Math.min(900, columns * 8 - 24))
            const c = chartSvg(all, v.sort, width)
            return <Svg source={c.svg} alt={c.alt} width={width} height={c.height} />
          })()
        : null

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor wrap="wrap">
          {summaryLine(all)}
        </Text>
        {tabs}
        {actions}
        {v.note ? <Text color="green">{v.note}</Text> : null}
        {chart}
        <Markdown text={body} />
      </Box>
    )
  })
}
