import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { CallRecord, ToolTotals } from '../types'
import {
  addError,
  addRepeat,
  addToTotals,
  emptyHistory,
  estTokens,
  hintsOf,
  maskError,
  mergeHistory,
  parseHistory,
  reportMarkdown,
  shortNameOf,
  stableStringify,
} from '../hooks/stats'

const PLUGIN = 'obsidian-cli-mcp-tool-stats'

const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  id: 'c1',
  tool: 'read',
  at: 1_000,
  wallMs: 120,
  runMs: 100,
  inTokens: 10,
  outTokens: 500,
  isError: false,
  isDenied: false,
  isSubagent: false,
  args: '{"path":"a.md"}',
  ...over,
})

const PANE_PROPS = {
  title: 'obsidian-cli-mcp tool stats',
  isFocused: false,
  bodyColumns: 120,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

describe('matching the server', () => {
  test('takes the obsidian-cli-mcp tools and nothing else', async () => {
    expect(shortNameOf('mcp__obsidian-cli-mcp__read', 'obsidian-cli-mcp')).toBe('read')
    expect(shortNameOf('mcp__plugin_vault_obsidian-cli-mcp__read_heading', 'obsidian-cli-mcp')).toBe('read_heading')
    expect(shortNameOf('mcp__other-obsidian-cli-mcp__read', 'obsidian-cli-mcp')).toBeUndefined()
    expect(shortNameOf('mcp__github__search', 'obsidian-cli-mcp')).toBeUndefined()
    expect(shortNameOf('Read', 'obsidian-cli-mcp')).toBeUndefined()
  })
})

describe('figures', () => {
  test('arguments compare the same whatever their key order', async () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3] } })).toBe(stableStringify({ a: { c: [3], d: 2 }, b: 1 }))
    expect(estTokens('x'.repeat(400))).toBe(100)
  })

  test('errors that differ in a path or a number group together', async () => {
    expect(maskError('File not found: Notes/Daily/2026-10-10.md')).toBe(maskError('File not found: Projects/plan.md'))
    expect(maskError('Timeout after 3000 ms')).toBe(maskError('Timeout after 12000 ms'))
    let groups = addError([], call({ isError: true, error: 'Heading "Plan" not found' }))
    groups = addError(groups, call({ isError: true, error: 'Heading "Goals" not found', at: 2_000 }))
    expect(groups).toHaveLength(1)
    expect(groups[0]?.count).toBe(2)
  })

  test('repeats count the result tokens a cache would have saved', async () => {
    let groups = addRepeat({}, call(), '{"path":"a.md"}')
    groups = addRepeat(groups, call({ id: 'c2' }), '{"path":"a.md"}')
    groups = addRepeat(groups, call({ id: 'c3', outTokens: 300 }), '{"path":"a.md"}')
    const g = Object.values(groups)[0]
    expect(g?.count).toBe(3)
    expect(g?.wastedTokens).toBe(800)
  })

  test('history folds a session in once and survives a bad store', async () => {
    const tools = { read: addToTotals(undefined, call()) }
    const once = mergeHistory(emptyHistory(), tools, [], 1_000)
    expect(once.sessions).toBe(1)
    expect(once.tools.read?.calls).toBe(1)
    expect(mergeHistory(emptyHistory(), {}, [], 1_000).sessions).toBe(0)
    expect(parseHistory('nonsense')).toEqual(emptyHistory())
    expect(parseHistory(JSON.parse(JSON.stringify(once))).tools.read?.outTokens).toBe(500)
  })
})

describe('hints', () => {
  const base = { errors: [], repeats: {}, schemas: [], history: emptyHistory(), heavyTokens: 2000, slowMs: 3000 }

  test('heavy reads point at outline and read_heading', async () => {
    let t: ToolTotals | undefined
    for (let i = 0; i < 3; i++) t = addToTotals(t, call({ outTokens: 6000 }))
    const hints = hintsOf({ ...base, tools: { read: t as ToolTotals } })
    const heavy = hints.find(h => h.kind === 'heavy')
    expect(heavy?.text).toMatch(/read_heading/)
  })

  test('a tool that fails often is flagged with its commonest error', async () => {
    let t: ToolTotals | undefined
    let errors = addError([], call({ isError: true, error: 'Vault "x" not open' }))
    errors = addError(errors, call({ isError: true, error: 'Vault "y" not open' }))
    for (const isError of [true, true, false, false]) t = addToTotals(t, call({ tool: 'search', isError }))
    const hints = hintsOf({ ...base, tools: { search: t as ToolTotals }, errors: errors.map(g => ({ ...g, tool: 'search' })) })
    expect(hints.find(h => h.kind === 'errors')?.text).toMatch(/50%.*not open/)
  })

  test('schemas loaded but never called are counted', async () => {
    const hints = hintsOf({
      ...base,
      tools: { read: addToTotals(undefined, call()) },
      schemas: [
        { tool: 'read', tokens: 300, isLoaded: true },
        { tool: 'create_base', tokens: 900, isLoaded: true },
        { tool: 'views_base', tokens: 700, isLoaded: false },
      ],
    })
    const schema = hints.find(h => h.kind === 'schema')
    expect(schema?.text).toMatch(/create_base/)
    expect(schema?.text).not.toMatch(/views_base/)
  })

  test('the report carries every section', async () => {
    const md = reportMarkdown({ ...base, tools: { read: addToTotals(undefined, call()) }, recent: [call()], schemasAt: 1, firstAt: 1_000, now: 5_000, server: 'obsidian-cli-mcp' })
    for (const heading of ['## This session', '## Optimisation hints', '## Errors', '## All sessions']) expect(md).toContain(heading)
  })
})

// The server, stood in for beneath the mod: reads answer with the note, a missing note fails.
const vault = (on: On) =>
  on('tool.call', ($, e) => {
    if (e.tool === 'mcp__obsidian-cli-mcp__read') {
      const path = String((e as Record<string, unknown>).path)
      if (path === 'missing.md') return { isError: true as const, result: 'File not found: missing.md', text: 'File not found: missing.md' }
      return { result: 'x'.repeat(8000), text: 'x'.repeat(8000) }
    }
    return { result: 'ok', text: 'ok' }
  })

describe('in a session', () => {
  test('obsidian calls are counted, other tools are not, and the pane shows them', async ($, on) => {
    mock.clock(on, { now: 10_000 })
    vault(on)
    await $.tool.call({ tool: 'mcp__obsidian-cli-mcp__read', path: 'a.md' })
    await $.tool.call({ tool: 'mcp__obsidian-cli-mcp__read', path: 'a.md' })
    await $.tool.call({ tool: 'mcp__obsidian-cli-mcp__read', path: 'missing.md' })
    await $.tool.call({ tool: 'mcp__github__search', q: 'x' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: PANE_PROPS })
      const all = await pane.findAll({})
      const texts = all.map(f => `${f.text} ${String(f.props.text ?? '')} ${String(f.props.label ?? '')}`).join('\n')
      // Three reads, one failed; the GitHub call is not the server's and is left out.
      expect(texts).toMatch(/3 calls · 1 tool/)
      expect(texts).toMatch(/\| `read` \| 3 \| 1 \|/)
      expect(texts).not.toMatch(/search/)
      expect(texts).toMatch(/Errors \(1\)/)
      if (surface === 'desktop') expect(all.some(f => /Top obsidian-cli-mcp tools/.test(String(f.props.alt ?? '')))).toBe(true)

      await pane.press({ key: 'tab-hints' })
      const hints = await pane.findAll({})
      expect(hints.some(f => /Repeat calls/.test(String(f.props.text ?? '')))).toBe(true)
      await pane.press({ key: 'tab-tools' })
      await pane.unmount()
    }
  })
})
