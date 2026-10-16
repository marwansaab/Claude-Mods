import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Pack } from '../types'
import { cardState, cleanPack, emptyDraft, handOffPrompt, outcomeMarkdown } from '../hooks/pack'
import { sceneSvg, sceneText, wrap } from '../hooks/scenes'
import { markdownSvg } from '../hooks/mdsvg'
import { isLinkHeavy } from '../hooks/view'
import type { Scene } from '../types'

const AT = '2026-10-16T09:00:00.000Z'

const SAMPLE = {
  id: 'INIT-9-open-questions',
  title: 'Open questions for the sample initiative',
  label: 'Open questions',
  summary: 'Three things only you can settle.',
  sources: [{ id: 'Q-1', title: 'Journey catalogue', updated: '2026-10-15' }],
  claims: [{ id: 'C1', text: 'Most players quit in the first session.', grade: 'B', source: 'Example analytics', url: 'https://example.com/report' }],
  cards: [
    {
      type: 'question',
      id: 'Q-13',
      title: 'Report an inappropriate ad',
      prompt: 'Should players be able to report an ad?',
      options: [
        { id: 'yes', label: 'Yes, from the ad itself' },
        { id: 'no', label: 'No, not in the first release' },
      ],
      recommended: 'yes',
      claims: ['C1'],
    },
    { type: 'decision', id: 'ADR-1', title: 'Use one save slot', proposal: 'One save slot per player.', alternatives: [{ label: 'Three slots', reason: 'more to test' }] },
    { type: 'finding', id: 'F01', title: 'Status differs', body: 'The deck says done; the note says active.', severity: 'high', kind: 'drift', quote: 'Status: done', evidence: { ref: 'TASK-1', quote: 'status: active' } },
    { type: 'plan', id: 'P1', title: 'Write plan', rows: [{ action: 'create', target: 'Notes/A.md' }, { action: 'edit', target: 'Notes/B.md', summary: 'add a line' }] },
    {
      type: 'explainer',
      id: 'E1',
      title: 'Why players leave',
      steps: [
        { title: 'The drop', caption: 'Most leave early.', scene: { kind: 'bars', items: [{ label: 'Day 1', value: 40, claim: 'C1' }, { label: 'Day 7', value: 12 }], mark: { value: 20, label: 'target' } } },
        { title: 'The fix', caption: 'Shorter first session.', scene: { kind: 'flow', items: [{ title: 'Open' }, { title: 'Play', tone: 'subject' }, { title: 'Win' }] } },
      ],
    },
    { type: 'read', id: 'R1', title: 'Script', sections: [{ title: 'Intro', body: 'Hello there.', flags: ['Is the greeting right?'] }, { title: 'Outro', body: 'Goodbye.' }] },
  ],
}

describe('publishing checks', () => {
  test('a well-formed pack is accepted and tidied', async () => {
    const { pack, problems } = cleanPack(SAMPLE, AT)
    expect(problems).toEqual([])
    expect(pack?.id).toBe('INIT-9-open-questions')
    expect(pack?.cards.length).toBe(6)
    const plan = pack?.cards[3]
    expect(plan?.type === 'plan' && plan.rows.map(r => r.id)).toEqual(['r1', 'r2'])
  })

  test('problems are listed, never guessed past', async () => {
    const { pack, problems } = cleanPack({ title: '', cards: [{ type: 'poll', title: 'x' }, { type: 'question', title: 'Q', claims: ['C9'] }] }, AT)
    expect(pack).toBeUndefined()
    expect(problems.join('\n')).toMatch(/"title" is required/)
    expect(problems.join('\n')).toMatch(/must be one of/)
    expect(problems.join('\n')).toMatch(/"prompt" is required/)
    expect(problems.join('\n')).toMatch(/C9/)
  })

  test('an id is made from the date and title when none is given', async () => {
    const { pack } = cleanPack({ ...SAMPLE, id: undefined, title: 'Deck: review #2' }, AT)
    expect(pack?.id).toBe('2026-10-16-Deck-review-2')
  })
})

describe('progress and outcome', () => {
  const pack = cleanPack(SAMPLE, AT).pack as Pack

  test('each card type knows when it is answered', async () => {
    const d = emptyDraft()
    expect(pack.cards.map(c => cardState(c, d))).toEqual(['open', 'open', 'open', 'open', 'open', 'open'])
    d.responses['Q-13'] = { choice: 'yes' }
    d.responses['ADR-1'] = { choice: 'amend' }
    d.responses['F01'] = { text: 'Which note?' }
    d.responses['P1'] = { choice: 'go', rows: { r2: false } }
    d.responses['E1/step-1'] = { isDone: true }
    d.responses['R1/s1'] = { isDone: true }
    d.responses['R1/s2'] = { isDone: true }
    expect(pack.cards.map(c => cardState(c, d))).toEqual(['done', 'partial', 'partial', 'done', 'partial', 'done'])
  })

  test('the outcome says what was decided, card by card', async () => {
    const d = emptyDraft()
    d.responses['Q-13'] = { choice: 'yes', text: 'and log it' }
    d.responses['ADR-1'] = { choice: 'reject' }
    d.responses['P1'] = { choice: 'go', rows: { r2: false } }
    d.asks.push({ id: 'a1', question: 'What is C1 based on?', answer: 'An analytics report.', at: AT, via: 'quick' })
    const md = outcomeMarkdown(pack, d, AT)
    expect(md).toMatch(/Answer:\*\* Yes, from the ad itself \(the recommended option\)/)
    expect(md).toMatch(/Comment:\*\* and log it/)
    expect(md).toMatch(/Decision:\*\* Rejected/)
    expect(md).toMatch(/Go ahead with 1 of 2 rows/)
    expect(md).toMatch(/\[ \] edit `Notes\/B.md`/)
    expect(md).toMatch(/What is C1 based on\?/)
    expect(handOffPrompt(pack, '/p/Reviews/reviewed/x/outcome.md')).toMatch(/confirm with me before writing/)
  })
})

describe('selectable text', () => {
  test('ordinary text keeps a link as its words plus the address in brackets', async () => {
    const d = markdownSvg('Read the [store policy](https://example.com/policy) first.', 400)
    expect(d.alt).toBe('Read the store policy (https://example.com/policy) first.')
    expect(d.svg).toMatch(/store policy/)
    expect(d.svg).toMatch(/\(https:\/\/example\.com\/policy\)/)
    expect(d.svg).not.toMatch(/<a /)
  })

  test('lists, quotes and bold survive; markup is escaped', async () => {
    const d = markdownSvg('**Bold** <b>tag</b>\n\n- one\n- two\n\n> quoted', 400)
    expect(d.svg).toMatch(/class="b"/)
    expect(d.svg).toMatch(/&lt;b&gt;tag&lt;\/b&gt;/)
    expect(d.alt).toMatch(/• one/)
    expect(d.alt).toMatch(/quoted/)
  })

  test('long text wraps inside the width and grows taller', async () => {
    const long = 'word '.repeat(200)
    const narrow = markdownSvg(long, 300)
    const wide = markdownSvg(long, 900)
    expect(narrow.height).toBeGreaterThan(wide.height)
  })

  test('blocks that are mostly links stay clickable; prose with a link does not', async () => {
    expect(isLinkHeavy('- [A](https://a.example)\n- [B](https://b.example)\n- [C](https://c.example)')).toBe(true)
    expect(isLinkHeavy('[Store policy](https://example.com/policy)')).toBe(true)
    expect(isLinkHeavy('Players quit early, as the [report](https://example.com/r) found over a long study of many games.')).toBe(false)
    expect(isLinkHeavy('No links at all.')).toBe(false)
  })
})

describe('scenes', () => {
  const scenes: Scene[] = [
    { kind: 'cards', items: [{ title: 'A', text: 'one' }, { title: 'B', tone: 'risk' }] },
    { kind: 'flow', items: [{ title: 'A' }, { title: 'B' }] },
    { kind: 'list', items: [{ title: 'A' }] },
    { kind: 'timeline', items: [{ title: 'Q1' }, { title: 'Q2' }] },
    { kind: 'funnel', items: [{ label: 'All', value: '100' }, { label: 'Paid', value: '3' }] },
    { kind: 'bars', items: [{ label: 'A', value: 3 }], mark: { value: 2, label: 'line' } },
    { kind: 'tiles', items: [{ value: 'AUD 50', label: 'price' }] },
    { kind: 'compare', columns: ['Us', 'Them'], rows: [{ label: 'Price', cells: ['low', 'high'], tone: 'subject' }] },
    { kind: 'matrix', x: 'Effort', y: 'Value', quadrants: ['a', 'b', 'c', 'd'], dots: [{ label: 'Idea', x: 0.2, y: 0.8 }] },
  ]
  test('every scene draws, settles when motion is reduced, and says what it shows', async () => {
    for (const s of scenes) {
      for (const w of [300, 800]) {
        const d = sceneSvg(w, s, [{ id: 'C1', text: 't', grade: 'A' }])
        expect(d.svg.startsWith('<svg')).toBe(true)
        expect(d.svg).toMatch(/prefers-reduced-motion: reduce/)
        expect(d.height).toBeGreaterThan(20)
        expect(d.alt.length).toBeGreaterThan(0)
      }
      expect(sceneText(s).length).toBeGreaterThan(0)
    }
  })

  test('text in a scene is escaped', async () => {
    const d = sceneSvg(500, { kind: 'cards', items: [{ title: '<script>&' }] })
    expect(d.svg).not.toMatch(/<script>/)
    expect(d.svg).toMatch(/&lt;script&gt;&amp;/)
  })

  test('long text wraps to the width', async () => {
    const lines = wrap('one two three four five six seven eight nine ten', 12)
    expect(lines.every(l => l.length <= 18)).toBe(true)
    expect(lines.length).toBeGreaterThan(2)
  })
})

// ---------- the desk end to end, over an in-memory project folder ----------

const ROOT = '/proj'

function memoryWorld(on: On) {
  const files = new Map<string, string>()
  const prompts: string[] = []
  const clipboard: string[] = []
  // The engine resolves paths for the platform (on Windows `/proj` arrives as `C:\proj`): compare them as POSIX.
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const isDir = (p: string) => [...files.keys()].some(k => k.startsWith(norm(p) + '/'))
  on('session.root', () => ({ value: ROOT }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('fs.read', ($, e) => (files.has(norm(e.path)) ? { value: files.get(norm(e.path))! } : { deny: `ENOENT: ${e.path}` }))
  on('fs.write', ($, e) => {
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: files.has(norm(e.path)) || isDir(e.path) }))
  on('fs.list', ($, e) => {
    const names = new Map<string, 'file' | 'dir'>()
    const dir = norm(e.path)
    for (const k of files.keys()) {
      if (!k.startsWith(dir + '/')) continue
      const rest = k.slice(dir.length + 1)
      const [first] = rest.split('/')
      names.set(first!, rest.includes('/') ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', ($, e) => {
    const [cmd, from, to] = e.argv
    if (cmd === 'pbcopy') {
      clipboard.push(e.init?.stdin ?? '')
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (cmd !== 'mv' || !from || !to) return { value: { exitCode: 1, stdout: '', stderr: 'no', isStdoutTruncated: false, isStderrTruncated: false } }
    for (const [k, v] of [...files])
      if (k.startsWith(norm(from) + '/')) {
        files.delete(k)
        files.set(norm(to) + k.slice(norm(from).length), v)
      }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return { text: e.text } as never
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Because the report says so.', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  // The desktop app has no clipboard path for plugins yet: the desk falls back to the system's command.
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-surface' } }) as never)
  return { files, prompts, clipboard }
}

const PANE = { component: 'Pane' as const, requestId: 'review-desk', props: { title: 'Review desk', isFocused: false, bodyColumns: 70, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} } }

const shows = async (ui: { findAll: (q: object) => Promise<{ text: string; props: Record<string, unknown> }[]> }, re: RegExp) =>
  (await ui.findAll({})).some(f => re.test(f.text) || re.test(String(f.props.alt ?? '')))

describe('the desk', () => {
  test('Claude publishes; the owner answers, asks and submits; the outcome goes back', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)

    const published = await $.tool.call({ tool: 'mcp__review-desk__publish_review', tool_use_id: 'toolu_1', ...SAMPLE } as never)
    expect(String((published as { result?: unknown }).result)).toMatch(/Published "Open questions for the sample initiative"/)
    expect(world.files.has('/proj/Reviews/pending/INIT-9-open-questions/pack.json')).toBe(true)
    expect(world.files.has('/proj/Reviews/README.md')).toBe(true)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'review-desk', surface, ...PANE })
      // The new review opened by itself, on its first card.
      expect(await shows(pane, /Report an inappropriate ad/)).toBe(true)
      expect(await shows(pane, /recommended/)).toBe(true)
      await pane.unmount()
    }

    const pane = await $.ui.mount({ plugin: 'review-desk', surface: 'desktop', ...PANE })
    await pane.press({ key: 'choice-Q-13-yes' })
    const draft = JSON.parse(world.files.get('/proj/Reviews/pending/INIT-9-open-questions/draft.json')!)
    expect(draft.responses['Q-13'].choice).toBe('yes')

    // A comment typed but not entered is kept when the owner moves on.
    await pane.input({ key: 't:Q-13', text: 'and log it', kind: 'change' })
    await pane.press({ key: 'card-next' })
    expect(await shows(pane, /Use one save slot/)).toBe(true)
    await pane.press({ key: 'verb-ADR-1-approve' })

    // Every question goes to Claude in the session; its answer comes back onto this card only.
    await pane.input({ key: 'ask:ADR-1#0', text: 'Why one slot?' })
    expect(await shows(pane, /Claude is looking into it/)).toBe(true)
    // Asked, the question field is drawn afresh and empty.
    expect(await pane.find({ key: 'ask:ADR-1#0' })).toBeUndefined()
    expect((await pane.find({ key: 'ask:ADR-1#1' }))?.text ?? '').toBe('')
    const askId = /ask "([^"]+)"/.exec(world.prompts.at(-1) ?? '')?.[1] ?? ''
    await $.tool.call({ tool: 'mcp__review-desk__answer_question', tool_use_id: 'toolu_ans', review: 'INIT-9-open-questions', ask: askId, answer: 'Because the report says so.' } as never)
    expect(await shows(pane, /Because the report says so/)).toBe(true)
    await pane.press({ key: 'card-prev' })
    expect(await shows(pane, /Why one slot\?/)).toBe(false)
    await pane.press({ key: 'card-next' })

    // The explainer draws its scene and steps through.
    await pane.select({ key: 'jump-card', value: '4' })
    expect(await shows(pane, /Step 1 of 2/)).toBe(true)
    expect(await shows(pane, /The drop/)).toBe(true)
    expect(await shows(pane, /Day 1: 40/)).toBe(true)
    await pane.press({ key: 'part-done-E1' })
    expect(await shows(pane, /The fix/)).toBe(true)

    // Submitting with cards left asks first, then moves the review and hands it back.
    await pane.press({ key: 'submit' })
    expect(await shows(pane, /Submit anyway/)).toBe(true)
    await pane.press({ key: 'submit-anyway' })
    await pane.unmount()

    expect(world.files.has('/proj/Reviews/pending/INIT-9-open-questions/pack.json')).toBe(false)
    const outcome = world.files.get('/proj/Reviews/reviewed/INIT-9-open-questions/outcome.md') ?? ''
    expect(outcome).toMatch(/Yes, from the ad itself/)
    expect(outcome).toMatch(/Comment:\*\* and log it/)
    expect(outcome).toMatch(/Decision:\*\* Approved/)
    expect(outcome).toMatch(/Why one slot\?/)
    expect(world.prompts.some(p => /reviewed\/INIT-9-open-questions\/outcome\.md/.test(p))).toBe(true)

    // The list shows it under Reviewed, and it opens read-only with the response.
    const list = await $.ui.mount({ plugin: 'review-desk', surface: 'terminal', ...PANE })
    await list.press({ key: 'tab-reviewed' })
    expect(await shows(list, /Open questions for the sample initiative/)).toBe(true)
    await list.press({ key: 'open-reviewed-INIT-9-open-questions' })
    expect(await shows(list, /your response/i)).toBe(true)
    expect(await list.find({ key: 'submit' })).toBeUndefined()
    await list.unmount()
  })

  test('findings, plans and read-throughs answer from the panel on every surface that takes input', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)
    await $.tool.call({ tool: 'mcp__review-desk__publish_review', tool_use_id: 'toolu_3', ...SAMPLE } as never)
    const draftOf = () => JSON.parse(world.files.get('/proj/Reviews/pending/INIT-9-open-questions/draft.json')!)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'review-desk', surface, ...PANE })
      await pane.select({ key: 'jump-card', value: '2' })
      expect(await shows(pane, /HIGH/)).toBe(true)
      expect(await shows(pane, /The record says/)).toBe(true)
      // The second surface sees the first one's answers: a second press on a choice clears it.
      await pane.press({ key: 'verb-F01-discuss' })
      await pane.input({ key: 't:F01', text: `which note? (${surface})` })
      expect(draftOf().responses.F01.choice).toBe(surface === 'terminal' ? 'discuss' : undefined)
      expect(draftOf().responses.F01.text).toBe(`which note? (${surface})`)

      await pane.press({ key: 'card-next' })
      await pane.press({ key: 'row-P1-r2' })
      expect(draftOf().responses.P1.rows.r2).toBe(surface === 'terminal' ? false : true)
      expect(await pane.find({ key: 'verb-P1-go' })).toBeDefined()

      await pane.select({ key: 'jump-card', value: '5' })
      expect(await shows(pane, /Your call:(\*\*)? Is the greeting right\?/)).toBe(true)
      await pane.press({ key: 'part-done-R1' })
      if (surface === 'terminal') {
        expect(await shows(pane, /Outro/)).toBe(true)
        expect(draftOf().responses['R1/s1'].isDone).toBe(true)
      } else expect(draftOf().responses['R1/s1'].isDone).toBe(false)
      await pane.press({ key: 'back' })
      expect(await shows(pane, /Waiting · 1/)).toBe(true)
      await pane.press({ key: `open-pending-INIT-9-open-questions` })
      await pane.unmount()
    }
  })

  test('a question sent to the session comes back onto its card, with its sources', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)
    await $.tool.call({ tool: 'mcp__review-desk__publish_review', tool_use_id: 'toolu_5', ...SAMPLE } as never)
    const pane = await $.ui.mount({ plugin: 'review-desk', surface: 'desktop', ...PANE })
    await pane.input({ key: 'ask:Q-13#0', text: 'Do other games let players report ads?', kind: 'change' })
    await pane.press({ key: 'ask-send-Q-13' })
    expect(await shows(pane, /Claude is looking into it/)).toBe(true)
    // The question shows as a bubble (an Svg on the desktop, its words in the alt text).
    expect(await shows(pane, /Do other games let players report ads\?/)).toBe(true)

    const prompt = world.prompts.at(-1) ?? ''
    expect(prompt).toMatch(/answer_question/)
    const askId = /ask "([^"]+)"/.exec(prompt)?.[1] ?? ''
    expect(askId).not.toBe('')

    const wrong = await $.tool.call({ tool: 'mcp__review-desk__answer_question', tool_use_id: 'toolu_6', review: 'INIT-9-open-questions', ask: 'nope', answer: 'x' } as never)
    expect(JSON.stringify(wrong)).toMatch(/has no question/)

    await $.tool.call({
      tool: 'mcp__review-desk__answer_question',
      tool_use_id: 'toolu_7',
      review: 'INIT-9-open-questions',
      ask: askId,
      answer: 'Yes: several store policies require it.',
      sources: [{ title: 'Store policy', url: 'https://example.com/policy' }],
    } as never)
    expect(await shows(pane, /several store policies require it/)).toBe(true)
    expect(await shows(pane, /Store policy/)).toBe(true)
    const draft = JSON.parse(world.files.get('/proj/Reviews/pending/INIT-9-open-questions/draft.json')!)
    expect(draft.asks[0].answer).toBe('Yes: several store policies require it.')

    // Copy works where the surface has no clipboard: the card, then the answer.
    await pane.press({ key: 'copy-card-Q-13' })
    expect(world.clipboard.at(-1)).toMatch(/## Report an inappropriate ad/)
    expect(world.clipboard.at(-1)).toMatch(/Yes, from the ad itself \(recommended\)/)
    await pane.press({ key: `copy-ask-${askId}` })
    expect(world.clipboard.at(-1)).toMatch(/\*\*A:\*\* Yes: several store policies/)
    expect(world.clipboard.at(-1)).toMatch(/https:\/\/example.com\/policy/)
    await pane.unmount()
  })

  test('on the desktop, prose is selectable text and evidence keeps clickable links', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    memoryWorld(on)
    await $.tool.call({ tool: 'mcp__review-desk__publish_review', tool_use_id: 'toolu_8', ...SAMPLE } as never)
    const desk = await $.ui.mount({ plugin: 'review-desk', surface: 'desktop', ...PANE })
    // An Svg carries no key in the drawing: find the question by its alt text.
    const prompt = (await desk.findAll({ type: 'Svg' })).find(f => /report an ad/.test(String(f.props.alt)))
    expect(prompt).toBeDefined()
    expect(prompt?.props.isInteractive).toBe(true)
    const evidence = await desk.find({ key: 'qe-Q-13-b' })
    expect(evidence?.type).toBe('Markdown')
    expect(evidence?.text).toMatch(/\(https:\/\/example\.com\/report\)/)
    await desk.unmount()
    // The terminal keeps its own Markdown throughout.
    const term = await $.ui.mount({ plugin: 'review-desk', surface: 'terminal', ...PANE })
    expect((await term.find({ key: 'q-Q-13' }))?.type).toBe('Markdown')
    await term.unmount()
  })

  test('a view saved by an older version still draws', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    memoryWorld(on)
    // 0.1.0 kept no askOpen, and $.state outlives a reload: serve the view without it, as an old session would.
    on('state.get', async ($, e, next) => {
      const got = (await next(e)) as { value?: { value?: Record<string, unknown>; version: number } }
      const stored = got.value?.value
      if ((e as { key?: string }).key !== 'view' || !stored) return got as never
      const { askOpen: _gone, ...older } = stored
      return { ...got, value: { ...got.value, value: older } } as never
    })
    await $.tool.call({ tool: 'mcp__review-desk__publish_review', tool_use_id: 'toolu_4', ...SAMPLE } as never)
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'review-desk', surface, ...PANE })
      expect(await shows(pane, /Report an inappropriate ad/)).toBe(true)
      expect(await shows(pane, /Ask Claude about this card/)).toBe(true)
      await pane.unmount()
    }
  })

  test('a bad pack is refused with what to fix, and nothing is written', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)
    const res = await $.tool.call({ tool: 'mcp__review-desk__publish_review', tool_use_id: 'toolu_2', title: 'x', cards: [] } as never)
    expect(JSON.stringify(res)).toMatch(/at least one card/)
    expect([...world.files.keys()].length).toBe(0)
  })

  test('with nothing published, the desk says how to start', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    memoryWorld(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'review-desk', surface, ...PANE })
      expect(await shows(pane, /Nothing is waiting for review/)).toBe(true)
      await pane.unmount()
    }
  })
})
