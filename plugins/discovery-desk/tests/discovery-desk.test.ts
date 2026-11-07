import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Loaded } from '../types'
import { LiteralError, parseLiteral } from '../hooks/literal'
import { DEFAULT_VOCAB, htmlToMd, nearestStep, nextQuestionId, readJourney, readRegister, stepsOn } from '../hooks/prototype'
import { cardState, cleanWalk, emptyDraft, phonePrompt } from '../hooks/walk'
import { deskChecks, isQuoted, readReport } from '../hooks/checks'
import { placeholders, progressOf, readLoop, readStory } from '../hooks/hub'

const AT = '2026-11-07T09:00:00.000Z'
const ROOT = '/proj'
const PROTO = `${ROOT}/INIT-9 - Sample/UX Prototype`

// A made-up initiative: one readable journey, one whose page is missing.
const REGISTER = `/* Sample register: mirrors the record. */
window.PROTOTYPE = {
  initiative: { id: 'INIT-9', name: 'Sample Game', vault: 'Sample-Vault', catalogue: 'Discovery/Sample Journey Catalogue' },
  personas: {
    'PERS-1': { name: 'Ada Example', initials: 'AE', archetype: 'Casual player', status: 'proposed', team: 'Leeds, UK · iPhone', summary: 'Plays on the bus.' },
  },
  surfaces: {
    shop: { name: 'Purchase sheet', owner: 'iOS · Android', module: { ios: 'StoreKit', android: 'Play Billing' } },
  },
  journeys: [
    { code: 'J01', title: 'First run', file: 'journeys/J01-first-run.html', persona: 'PERS-1', status: 'draft', surfaces: ['shop'], questions: ['Q-01', 'D-01', 'ADR-1'] },
    { code: 'J02', title: 'Missing page', file: 'journeys/J02-missing.html', persona: 'PERS-1', surfaces: [], questions: [] },
  ],
  questions: {
    'Q-01': { status: 'open', title: 'Which table opens first?' },
    'Q-02': { status: 'decided', title: 'Is there a tutorial?' }, // decided last session
    'D-01': { status: 'proposed', title: 'Ads only on request' },
    'ADR-1': { status: 'proposed', title: 'Levels in order', detail: "Players can't skip ahead" },
  },
};
`

const J01 = `<!doctype html><html><body class="kit">
<template id="stage">
  <section class="screen" id="s-home"><div class="g-screen" data-module="Game · home"><span id="play">Play</span></div></section>
  <section class="screen" id="s-shop"><div class="h-sheet" data-host="Purchase sheet · drawn by iOS"></div></section>
</template>
<script>
Kit.journey({
  code: 'J01',
  title: 'First run',
  useCase: 'Ada wants to try the game.',
  trigger: 'Ada opens it on Day 1.',
  preconditions: ['Day 1, on the bus.'],
  outcome: 'Ada has played once.',
  osNotes: { ios: 'iOS draws the purchase sheet.', android: 'Android has a system back button.' },
  storyMap: ['1.1 Open the game'],
  steps: [
    { title: 'Setting the scene', actor: 'PERS-1', caption: 'Ada opens <b>the game</b> &mdash; nothing else yet.', questions: ['ADR-1'],
      actions: [['ring', '#play', '', 'accent'], ['note', '#play', '<b>ADR-1:</b> levels are played in order.', 'right', 'q']] },
    { title: 'The back button', os: 'android', actor: 'PERS-1', caption: 'Android only: the back button.', actions: [['ring', '.kit-nav-back']] },
    { title: { ios: 'The shop on iOS', android: 'The shop on Android' }, screen: 's-shop', actor: 'PERS-1',
      caption: { ios: 'The App Store sheet.', android: 'The Google Play sheet.' }, questions: ['Q-01', 'D-01'], actions: [] },
    { title: 'Where things are left', caption: 'Next: J02.', actions: [], },
  ]
});
</script></body></html>`

const WALK = {
  id: 'INIT-9-J01-walk',
  title: 'Polish the first run',
  initiative: 'INIT-9',
  journeys: ['J01'],
  label: 'Polishing walk',
  summary: 'Three calls on the first run.',
  cards: [
    {
      type: 'question',
      id: 'Q-01',
      prompt: 'Which table should open first?',
      options: [
        { id: 'small', label: 'The small table', description: 'gentle start' },
        { id: 'big', label: 'The big table' },
      ],
      recommended: 'small',
      osDiff: { ios: 'The same on both.', android: 'The same on both.' },
      evidence: 'Competitors open small.',
      linked: [{ id: 'RISK-1', title: 'Players leave early', status: 'open' }],
    },
    { type: 'decision', id: 'D-01', proposal: 'Ads are shown only when the player asks.' },
    { type: 'adr', id: 'ADR-1', proposal: 'Levels are played in order.', clauses: '1. In order, no level list.' },
    { type: 'plan', id: 'write-plan', title: 'Write plan', rows: [{ action: 'Edit', target: 'Discovery/Sample Journey Catalogue.md', summary: 'Q-01 decided' }] },
  ],
}

/** The project's validator, as the desk runs it in the tests: `node check.js <folder>` prints this report. */
const REPORT = `Prototype check — INIT-9 Sample Game
  ERROR  J01 step 3: Q-01 is open here but decided in the catalogue
  warn   J01 step 1: a note gives text for one OS only
FAILED — 1 error(s), 1 warning(s)`

function memoryWorld(on: On, withPrototype = true, extra: Record<string, string> = {}) {
  const files = new Map<string, string>([...(withPrototype ? [[`${PROTO}/prototype.js`, REGISTER], [`${PROTO}/journeys/J01-first-run.html`, J01]] as [string, string][] : []), ...Object.entries(extra)])
  const prompts: string[] = []
  const runs: string[][] = []
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const isDir = (p: string) => [...files.keys()].some(k => k.startsWith(norm(p) + '/'))
  on('session.root', () => ({ value: ROOT }))
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
      names.set(rest.split('/')[0]!, rest.includes('/') ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', ($, e) => {
    const [cmd, from, to] = e.argv
    runs.push([...e.argv])
    if (cmd === 'node' && from === 'check.js') return { value: { exitCode: 1, stdout: REPORT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return { files, prompts, runs }
}

/** Calls a tool loosely typed: the engine's per-tool typing is too deep for the checker on a spread input. */
const callTool = (tool: { call: unknown }, input: Record<string, unknown>) => (tool.call as (input: unknown) => Promise<unknown>)(input)

const PANE = { component: 'Pane' as const, requestId: 'discovery-desk', props: { title: 'Discovery desk', isFocused: false, bodyColumns: 70, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} } }

const shows = async (ui: { findAll: (q: object) => Promise<{ text: string; props: Record<string, unknown> }[]> }, re: RegExp) =>
  (await ui.findAll({})).some(f => re.test(f.text) || re.test(String(f.props.alt ?? '')))

function sampleLoaded(): Loaded {
  const register = readRegister(REGISTER)
  return { folder: PROTO, rel: 'INIT-9 - Sample/UX Prototype', register, journeys: { J01: readJourney(J01, register.journeys[0]!) } }
}

describe('reading a prototype without running it', () => {
  test('the literal reader takes what registers are written in', async () => {
    const { value } = parseLiteral(`{ a: 'it\\'s', "b": [1, -2.5, true, null,], c: \`multi
line\`, // a comment
      d: { ios: 'x', android: "y" }, /* another */ }`)
    expect(value).toEqual({ a: "it's", b: [1, -2.5, true, null], c: 'multi\nline', d: { ios: 'x', android: 'y' } })
  })

  test('code where a value belongs is refused, saying where', async () => {
    expect(() => parseLiteral(`{ a: compute() }`)).toThrow(LiteralError)
    expect(() => parseLiteral(`{ a: \`\${x}\` }`)).toThrow(/template/)
    expect(() => parseLiteral(`{\n a: 1\n b: 2 }`)).toThrow(/line 3/)
  })

  test('the register, a journey and its captions read as data', async () => {
    const l = sampleLoaded()
    const r = l.register
    expect(r.initiative.id).toBe('INIT-9')
    expect(r.items.map(i => `${i.id}:${i.kind}:${i.status}`)).toEqual(['Q-01:question:open', 'Q-02:question:decided', 'D-01:decision:proposed', 'ADR-1:adr:proposed'])
    const j = l.journeys.J01!
    expect(j.problem).toBeUndefined()
    expect(j.steps.map(s => s.screen)).toEqual(['s-home', 's-home', 's-shop', 's-shop'])
    expect(j.steps[2]!.screenLabel).toBe('Purchase sheet · drawn by iOS')
    expect(j.steps[0]!.callouts.length).toBe(1)
    expect(htmlToMd(j.steps[0]!.caption as string)).toBe('Ada opens **the game** — nothing else yet.')
    expect(stepsOn(j, 'ios').map(s => s.index)).toEqual([0, 2, 3])
    expect(stepsOn(j, 'android').map(s => s.index)).toEqual([0, 1, 2, 3])
    // An Android-only step, shown on iOS, lands on the nearest step that plays there.
    expect(nearestStep(j, 'ios', 1)?.index).toBe(0)
    expect(nextQuestionId(r, [], DEFAULT_VOCAB)).toBe('Q-03')
    expect(readJourney('<html>no script</html>', r.journeys[1]!).problem).toMatch(/Kit\.journey/)
  })
})

describe('publishing a walk', () => {
  test('cards are framed from the register: status, title and the steps that show them', async () => {
    const { walk, problems, notes } = cleanWalk(WALK, AT, { loaded: sampleLoaded(), vocab: DEFAULT_VOCAB })
    expect(problems).toEqual([])
    expect(notes).toEqual([])
    const q = walk!.cards[0]!
    expect(q.type === 'question' && q.title).toBe('Which table opens first?')
    expect(q.type === 'question' && q.status).toBe('open')
    expect(q.type === 'question' && q.appearsAt).toEqual([{ journey: 'J01', step: 2, os: undefined }])
    const adr = walk!.cards[2]!
    expect(adr.type === 'adr' && adr.appearsAt.map(a => a.step)).toEqual([0])
    expect(walk!.initiative.rel).toBe('INIT-9 - Sample/UX Prototype')
  })

  test('problems are listed, never guessed past; an id not in the register is only noted', async () => {
    const bad = cleanWalk({ title: 'x', journeys: ['J07'], cards: [{ type: 'question', id: 'D-01', prompt: 'p' }, { type: 'decision', proposal: 'p' }] }, AT, { loaded: sampleLoaded(), vocab: DEFAULT_VOCAB })
    expect(bad.walk).toBeUndefined()
    expect(bad.problems.join('\n')).toMatch(/no journey J07/)
    expect(bad.problems.join('\n')).toMatch(/reads as a decision/)
    expect(bad.problems.join('\n')).toMatch(/"id" is required/)
    const noted = cleanWalk({ title: 'x', cards: [{ type: 'question', id: 'Q-77', title: 'New one', prompt: 'p' }] }, AT, { loaded: sampleLoaded(), vocab: DEFAULT_VOCAB })
    expect(noted.notes.join('')).toMatch(/Q-77 is not in the register/)
  })

  test('Open on a phone names the kit’s server when the kit folder is set, else the project’s launch configuration', async () => {
    const l = sampleLoaded()
    expect(phonePrompt(l, 'J01', 2, 'android', 'Prototype Kit')).toMatch(/the kit is in `Prototype Kit`/)
    expect(phonePrompt(l, 'J01', 2, 'android')).toMatch(/launch configuration names it/)
    expect(phonePrompt(l, 'J01', 2, 'android')).toMatch(/\?os=android.*kitPlayer\.goto\(2\)/s)
  })

  test('a question is answered once it has a status, and a decided one needs an answer', async () => {
    const { walk } = cleanWalk(WALK, AT, { loaded: sampleLoaded(), vocab: DEFAULT_VOCAB })
    const q = walk!.cards[0]!
    const d = emptyDraft()
    expect(cardState(q, d, DEFAULT_VOCAB)).toBe('open')
    d.responses['Q-01'] = { status: 'decided' }
    expect(cardState(q, d, DEFAULT_VOCAB)).toBe('partial')
    d.responses['Q-01'] = { status: 'decided', choice: 'small' }
    expect(cardState(q, d, DEFAULT_VOCAB)).toBe('done')
    d.responses['Q-01'] = { status: 'deferred' }
    expect(cardState(q, d, DEFAULT_VOCAB)).toBe('done')
  })
})

describe('the desk', () => {
  test('Claude publishes a walk; the owner answers, walks a step, raises a question and submits', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)
    const published: unknown = await callTool($.tool, { tool: 'mcp__discovery-desk__publish_walk', tool_use_id: 'toolu_1', ...WALK })
    expect(String((published as { result?: unknown }).result)).toMatch(/Published "Polish the first run" as INIT-9-J01-walk for INIT-9: 4 cards/)
    expect(world.files.has('/proj/Discovery/pending/INIT-9-J01-walk/walk.json')).toBe(true)
    expect(world.files.has('/proj/Discovery/README.md')).toBe(true)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'discovery-desk', surface, ...PANE })
      expect(await shows(pane, /Which table opens first\?/)).toBe(true)
      expect(await shows(pane, /recommended/)).toBe(true)
      expect(await shows(pane, /open in the register/)).toBe(true)
      expect(await shows(pane, /RISK-1/)).toBe(true)
      await pane.unmount()
    }

    const pane = await $.ui.mount({ plugin: 'discovery-desk', surface: 'desktop', ...PANE })
    const draftOf = () => JSON.parse(world.files.get('/proj/Discovery/pending/INIT-9-J01-walk/draft.json')!)
    await pane.press({ key: 'choice-Q-01-small' })
    await pane.press({ key: 'status-Q-01-decided' })
    await pane.press({ key: 'adr-Q-01' })
    expect(draftOf().responses['Q-01']).toEqual({ choice: 'small', status: 'decided', toAdr: true })

    // "Shown in" opens the journey at the step that carries the chip; back returns to the walk.
    await pane.press({ key: 'at-Q-01-J01-2' })
    expect(await shows(pane, /Step 2 of 3/)).toBe(true)
    expect(await shows(pane, /The App Store sheet/)).toBe(true)
    await pane.press({ key: 'walked' })
    await pane.input({ key: 'note:J01/2', text: 'The sheet copy is too long' })
    await pane.input({ key: 'raise:J01/2#0', text: 'Can players skip the shop?' })
    const notes = JSON.parse(world.files.get('/proj/Discovery/notes/INIT-9.json')!)
    expect(notes.steps['J01/2']).toEqual({ isWalked: true, os: 'ios', text: 'The sheet copy is too long' })
    expect(notes.raised[0]).toMatchObject({ id: 'Q-03', journey: 'J01', step: 2, os: 'ios', text: 'Can players skip the shop?' })
    await pane.press({ key: 'leave' })
    expect(await shows(pane, /Which table opens first\?/)).toBe(true)

    await pane.press({ key: 'card-next' })
    await pane.press({ key: 'verb-D-01-approve' })
    await pane.press({ key: 'card-next' })
    expect(await shows(pane, /The clauses at stake/)).toBe(true)
    await pane.press({ key: 'verb-ADR-1-decide' })
    await pane.press({ key: 'card-next' })
    await pane.press({ key: 'verb-write-plan-go' })
    await pane.press({ key: 'submit' })
    await pane.unmount()

    expect(world.files.has('/proj/Discovery/pending/INIT-9-J01-walk/walk.json')).toBe(false)
    const outcome = world.files.get('/proj/Discovery/reviewed/INIT-9-J01-walk/outcome.md') ?? ''
    expect(outcome).toMatch(/Answer:\*\* The small table \(the recommended option\)/)
    expect(outcome).toMatch(/Status:\*\* `decided`/)
    expect(outcome).toMatch(/Becomes an ADR:\*\* yes/)
    expect(outcome).toMatch(/Decision:\*\* Approved → `decided`/)
    expect(outcome).toMatch(/ADR:\*\* Decided in place → `decided`/)
    expect(outcome).toMatch(/\*\*Q-03\*\* \(proposed number\) · J01, step 2 of 3 on iOS: Can players skip the shop\?/)
    expect(outcome).toMatch(/J01, step 2 of 3 on iOS \(The shop on iOS\): The sheet copy is too long/)
    expect(outcome).toMatch(/- \*\*2026-11-07\*\* — J01 \(iOS\) walked · Q-01 decided \(new ADR for Q-01\) · D-01 accepted · ADR-1 decided/)
    expect(outcome).toMatch(/The record first,\*\* in the vault `Sample-Vault`/)
    expect(outcome).toMatch(/score or verdict/)
    const handOff = world.prompts.at(-1) ?? ''
    expect(handOff).toMatch(/reviewed\/INIT-9-J01-walk\/outcome\.md/)
    expect(handOff).toMatch(/write plan on the discovery desk/)
    expect(handOff).toMatch(/closing checklist/)
    // The raised question went with the outcome, so it is not handed over twice.
    expect(JSON.parse(world.files.get('/proj/Discovery/notes/INIT-9.json')!).raised[0].sentAt).toBe(AT)

    const list = await $.ui.mount({ plugin: 'discovery-desk', surface: 'terminal', ...PANE })
    await list.press({ key: 'tab-reviewed' })
    await list.press({ key: 'open-reviewed-INIT-9-J01-walk' })
    expect(await shows(list, /your response/i)).toBe(true)
    expect(await list.find({ key: 'submit' })).toBeUndefined()
    await list.unmount()
  })

  test('a journey plays step by step on either phone, with its context, chips and views', async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'discovery-desk', surface, ...PANE })
      // The session's start scans for prototypes; here nothing started one, so Refresh does.
      await pane.press({ key: 'refresh' })
      expect(await shows(pane, /Sample Game/)).toBe(true)
      await pane.press({ key: 'ini-INIT-9' })
      expect(await shows(pane, /First run/)).toBe(true)
      expect(await shows(pane, /J02-missing\.html: the page could not be read/)).toBe(true)
      await pane.press({ key: 'journey-J01' })
      await pane.press({ key: 'os-ios' })
      await pane.press({ key: 'restart' })
      expect(await shows(pane, /Step 1 of 3/)).toBe(true)
      expect(await shows(pane, /Ada opens/)).toBe(true)
      expect(await shows(pane, /levels are played in order/)).toBe(true)
      expect(await shows(pane, /ADR-1/)).toBe(true)

      // The views: captions alone, chips alone.
      await pane.press({ key: 'view-captions' })
      expect(await shows(pane, /levels are played in order/)).toBe(false)
      await pane.press({ key: 'view-chips' })
      expect(await shows(pane, /Ada opens/)).toBe(false)
      await pane.press({ key: 'view-all' })

      // Next chip skips to the next step with an open question or a proposal.
      await pane.press({ key: 'next-chip' })
      expect(await shows(pane, /The shop on iOS/)).toBe(true)
      await pane.press({ key: 'os-android' })
      expect(await shows(pane, /The shop on Android/)).toBe(true)
      expect(await shows(pane, /Step 3 of 4/)).toBe(true)
      await pane.press({ key: 'step-prev' })
      expect(await shows(pane, /Android only/)).toBe(true)

      await pane.press({ key: 'context' })
      expect(await shows(pane, /Android \(shown\)/)).toBe(true)
      expect(await shows(pane, /Purchase sheet · drawn by iOS · Android · Play Billing/)).toBe(true)
      expect(await shows(pane, /proposed persona/)).toBe(true)
      await pane.press({ key: 'context' })
      await pane.press({ key: 'leave' })
      await pane.press({ key: 'home' })
      await pane.unmount()
    }

    const pane = await $.ui.mount({ plugin: 'discovery-desk', surface: 'desktop', ...PANE })
    await pane.press({ key: 'refresh' })
    await pane.press({ key: 'ini-INIT-9' })
    await pane.press({ key: 'journey-J01' })
    await pane.press({ key: 'os-ios' })
    await pane.press({ key: 'restart' })
    // Play moves on by itself, and stops at the last step.
    await pane.press({ key: 'play' })
    await clock.advance(4500)
    expect(await shows(pane, /The shop on iOS/)).toBe(true)
    await clock.advance(4500)
    expect(await shows(pane, /Where things are left/)).toBe(true)
    await clock.advance(4500)
    expect(await shows(pane, /▶ Play/)).toBe(true)

    await pane.press({ key: 'phone' })
    expect(world.prompts.at(-1)).toMatch(/J01 on iOS in the browser pane, at step 3 of 3 on iOS/)
    expect(world.prompts.at(-1)).toMatch(/\?os=ios.*kitPlayer\.goto\(2\)/s)
    await pane.press({ key: 'polish' })
    const ask = world.prompts.at(-1) ?? ''
    expect(ask).toMatch(/publish_walk, initiative "INIT-9", journeys \["J01"\]/)
    expect(ask).toMatch(/- Q-01 \(open\): Which table opens first\?/)
    expect(ask).toMatch(/- D-01 \(proposed\)/)
    expect(ask).toMatch(/- ADR-1 \(proposed\)/)
    expect(ask).not.toMatch(/Q-02/)

    // A question raised here waits on the initiative page until it is handed over.
    await pane.input({ key: 'raise:J01/3#0', text: 'What comes after J01?' })
    await pane.press({ key: 'leave' })
    expect(await shows(pane, /Raised while walking/)).toBe(true)
    await pane.press({ key: 'send-raised' })
    expect(world.prompts.at(-1)).toMatch(/\*\*Q-03\*\* \(proposed number\) · J01, step 3 of 3 on iOS: What comes after J01\?/)
    expect(world.prompts.at(-1)).toMatch(/Record each one in the record first/)
    expect(await shows(pane, /Raised while walking/)).toBe(false)
    await pane.unmount()
  })

  test('Claude answers a question asked from a card, on that card', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)
    await callTool($.tool, { tool: 'mcp__discovery-desk__publish_walk', tool_use_id: 'toolu_2', ...WALK })
    const pane = await $.ui.mount({ plugin: 'discovery-desk', surface: 'desktop', ...PANE })
    await pane.input({ key: 'ask:Q-01#0', text: 'What do other games open with?' })
    expect(await shows(pane, /Claude is looking into it/)).toBe(true)
    const askId = /ask "([^"]+)"/.exec(world.prompts.at(-1) ?? '')?.[1] ?? ''
    expect(askId).not.toBe('')
    await callTool($.tool, { tool: 'mcp__discovery-desk__answer_question', tool_use_id: 'toolu_3', walk: 'INIT-9-J01-walk', ask: askId, answer: 'Most open on a small table.', sources: [{ title: 'Store page', url: 'https://example.com' }] })
    expect(await shows(pane, /Most open on a small table/)).toBe(true)
    await pane.unmount()
  })

  test('a walk for an unknown initiative or with bad cards is refused, and nothing is written', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)
    const before = world.files.size
    const unknown = await callTool($.tool, { tool: 'mcp__discovery-desk__publish_walk', tool_use_id: 'toolu_4', ...WALK, initiative: 'INIT-404' })
    expect(JSON.stringify(unknown)).toMatch(/No UX prototype for \\"INIT-404\\"/)
    const bad = await callTool($.tool, { tool: 'mcp__discovery-desk__publish_walk', tool_use_id: 'toolu_5', title: 'x', initiative: 'INIT-9', cards: [] })
    expect(JSON.stringify(bad)).toMatch(/at least one card/)
    expect(world.files.size).toBe(before)
    const listed = await callTool($.tool, { tool: 'mcp__discovery-desk__list_walks', tool_use_id: 'toolu_6' })
    expect(JSON.stringify(listed)).toMatch(/INIT-9 Sample Game · INIT-9 - Sample\/UX Prototype · 2 journeys, 1 open, 2 proposed, 1 decided/)
  })

  test('with no prototype in the project, the desk says where it looks', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    memoryWorld(on, false)
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'discovery-desk', surface, ...PANE })
      expect(await shows(pane, /No UX prototype found/)).toBe(true)
      expect(await shows(pane, /No walk is waiting/)).toBe(true)
      await pane.unmount()
    }
  })
})

describe('checks', () => {
  test('the desk’s own checks: surfaces, chips, pronouns, value-out wording and unlabelled figures', async () => {
    const register = readRegister(
      REGISTER.replace("surfaces: ['shop']", "surfaces: ['shop', 'ghost']").replace("shop: { name: 'Purchase sheet'", "ads: { name: 'Interstitial' },\n    shop: { name: 'Purchase sheet'"),
    )
    const page = J01.replace('Ada opens <b>the game</b> &mdash; nothing else yet.', 'Ada opens it; she can cash out 30 coins.').replace("questions: ['Q-01', 'D-01']", "questions: ['Q-01', 'D-01', 'Q-02']")
    const l: Loaded = { folder: PROTO, rel: 'x', register, journeys: { J01: readJourney(page, register.journeys[0]!) } }
    const found = deskChecks(l, { valueWords: String.raw`\bcash[ -]?out\b`, figurePattern: String.raw`\b\d+\s?coins?\b` })
    const titles = found.map(f => f.title).join('\n')
    expect(titles).toMatch(/Surface "Interstitial" does not say who draws it/)
    expect(titles).toMatch(/J01 uses surface "ghost", which is not in the surfaces table/)
    expect(titles).toMatch(/J01 step 3 shows Q-02, which J01’s register entry does not list/)
    expect(titles).toMatch(/Gendered pronoun in the caption of J01 step 1/)
    expect(titles).toMatch(/“cash out” in the caption of J01 step 1/)
    expect(titles).toMatch(/J01 shows figures without calling them placeholders/)
    // Ids are stable: the same problem keeps its id from run to run.
    expect(deskChecks(l, { valueWords: '', figurePattern: '' }).map(f => f.id)).toEqual(deskChecks(l, { valueWords: '', figurePattern: '' }).map(f => f.id))
  })

  test('a validator’s report becomes findings; drift is told apart', async () => {
    const found = readReport(REPORT)
    expect(found.map(f => [f.severity, f.where, !!f.isDrift])).toEqual([
      ['high', 'J01 step 3', true],
      ['low', 'J01 step 1', false],
    ])
  })

  test('quotes match word for word, forgiving markup, typographic quotes, dashes and spaces only', async () => {
    expect(isQuoted('Ada opens the game - nothing else', '<b>Ada</b> opens <b>the game</b> &mdash; nothing  else yet')).toBe(true)
    expect(isQuoted("Players can't skip", 'Players can’t skip ahead')).toBe(true)
    expect(isQuoted('Ada closes the game', 'Ada opens the game')).toBe(false)
  })

  test('Run checks puts what the checks and the validator find on the desk', { options: { validator: 'node check.js' } }, async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)
    const pane = await $.ui.mount({ plugin: 'discovery-desk', surface: 'desktop', ...PANE })
    await pane.press({ key: 'refresh' })
    await pane.press({ key: 'ini-INIT-9' })
    expect(await shows(pane, /Not checked yet/)).toBe(true)
    await pane.press({ key: 'run-checks-offline' })
    expect(world.runs.at(-1)).toEqual(['node', 'check.js', PROTO, '--no-vault'])
    const walk = JSON.parse(world.files.get('/proj/Discovery/pending/INIT-9-checks/walk.json') ?? '{}')
    // The desk's own check (J02's page is missing) and the validator's two lines.
    expect(walk.cards?.map((c: { kind: string; severity: string }) => `${c.kind}:${c.severity}`)).toEqual(['check:high', 'drift:high', 'check:low'])
    expect(await shows(pane, /Checks for INIT-9 Sample Game/)).toBe(true)
    expect(await shows(pane, /J02’s page could not be read/)).toBe(true)
    await pane.press({ key: 'card-next' })
    expect(await shows(pane, /the prototype differs from the record/)).toBe(true)
    await pane.press({ key: `verb-${walk.cards[1].id}-accept` })
    await pane.press({ key: 'back' })
    await pane.press({ key: 'ini-INIT-9' })
    expect(await shows(pane, /2 errors, 1 warning/)).toBe(true)
    await pane.unmount()
  })

  test('a drift finding from Claude quotes the prototype and the record, both found word for word', { options: { vaultRoot: '/vault' } }, async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on, true, { '/vault/Discovery/Sample Journey Catalogue.md': '| Q-01 | Which table opens first? | decided: the small table |' })
    const drift = (quote: string, recordQuote: string) => ({
      tool: 'mcp__discovery-desk__publish_walk',
      tool_use_id: 'toolu_d',
      id: 'INIT-9-drift',
      title: 'Drift',
      initiative: 'INIT-9',
      cards: [{ type: 'finding', kind: 'drift', severity: 'high', title: 'Q-01 is decided in the record', body: 'The register still says open.', where: 'prototype.js', quote, evidence: { ref: 'Discovery/Sample Journey Catalogue', quote: recordQuote } }],
    })
    const wrongPrototype = await callTool($.tool, drift("'Q-01': { status: 'closed'", 'decided: the small table'))
    expect(JSON.stringify(wrongPrototype)).toMatch(/the quote is not in prototype\.js/)
    const wrongRecord = await callTool($.tool, drift("'Q-01': { status: 'open'", 'decided: the big table'))
    expect(JSON.stringify(wrongRecord)).toMatch(/the quote is not in Discovery\/Sample Journey Catalogue/)
    expect(world.files.has('/proj/Discovery/pending/INIT-9-drift/walk.json')).toBe(false)
    const ok = await callTool($.tool, drift("'Q-01': { status: 'open'", 'decided: the small table'))
    expect(JSON.stringify(ok)).toMatch(/Published \\"Drift\\"/)
    const walk = JSON.parse(world.files.get('/proj/Discovery/pending/INIT-9-drift/walk.json')!)
    // The walk keeps fingerprints of the register, the page and the catalogue note.
    expect(walk.sources.map((s: { label: string }) => s.label)).toEqual(['prototype.js', 'the J01 page', 'the catalogue'])
    const pane = await $.ui.mount({ plugin: 'discovery-desk', surface: 'terminal', ...PANE })
    expect(await shows(pane, /The record says/)).toBe(true)
    expect(await shows(pane, /Accept: fix toward the record/)).toBe(true)
    // The register changes: opened again, the walk says its cards may be out of date.
    world.files.set(`${PROTO}/prototype.js`, REGISTER.replace("'Q-01': { status: 'open'", "'Q-01': { status: 'decided'"))
    await pane.press({ key: 'back' })
    await pane.press({ key: 'open-pending-INIT-9-drift' })
    expect(await shows(pane, /Changed since this walk was published: prototype\.js/)).toBe(true)
    await pane.press({ key: 'republish' })
    expect(world.prompts.at(-1)).toMatch(/publish the walk again with publish_walk under the same id/)
    await pane.unmount()
  })

  test('without the record on disk, a drift finding is published with its record quote marked unchecked', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    memoryWorld(on)
    const res = await callTool($.tool, {
      tool: 'mcp__discovery-desk__publish_walk',
      tool_use_id: 'toolu_u',
      title: 'Drift',
      initiative: 'INIT-9',
      cards: [{ type: 'finding', kind: 'drift', title: 'Q-01', body: 'b', quote: 'Which table opens first?', evidence: { ref: 'Catalogue', quote: 'decided' } }],
    })
    expect(JSON.stringify(res)).toMatch(/record quotes were not checked/)
  })
})

describe('the vault-first guard and checks after edits', () => {
  const stubTools = (on: On) => {
    on('tool.call', { tool: 'Edit' }, () => ({ result: { ok: true } }) as never)
    on('tool.call', { tool: 'mcp__obsidian-cli-mcp__write_note' }, () => ({ result: { ok: true } }) as never)
    on('turn.complete', () => ({ text: '' }))
  }
  const edit = { tool: 'Edit', tool_use_id: 'toolu_e', file_path: `${PROTO}/prototype.js`, old_string: 'open', new_string: 'decided' }

  test('warn: an edit to the prototype before the record is written reminds Claude; after a record write it does not', { options: { validator: 'node check.js' } }, async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)
    stubTools(on)
    await callTool($.tool, { tool: 'mcp__discovery-desk__list_walks', tool_use_id: 'toolu_l' })
    const first = (await callTool($.tool, edit)) as { context?: string[] }
    expect((first.context ?? []).join('')).toMatch(/vault-first rule/)
    // A subagent's turn ending changes nothing; the main turn's end runs the checks on what was edited.
    await $.turn.complete({ reason: 'answer', answer: '', text: '', agentId: 'agent-1' } as never)
    expect(world.files.has('/proj/Discovery/pending/INIT-9-checks/walk.json')).toBe(false)
    await $.turn.complete({ reason: 'answer', answer: '', text: 'Done.' } as never)
    expect(world.files.has('/proj/Discovery/pending/INIT-9-checks/walk.json')).toBe(true)
    // A new turn: the record is written first, then the prototype.
    await callTool($.tool, { tool: 'mcp__obsidian-cli-mcp__write_note', tool_use_id: 'toolu_w', vault: 'Sample-Vault', path: 'x.md', content: 'x' })
    const second = (await callTool($.tool, edit)) as { context?: string[] }
    expect((second.context ?? []).join('')).not.toMatch(/vault-first rule/)
  })

  test('block: the edit is refused with the reason', { options: { guardMode: 'block' } }, async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    memoryWorld(on)
    stubTools(on)
    await callTool($.tool, { tool: 'mcp__discovery-desk__list_walks', tool_use_id: 'toolu_l' })
    const res = await callTool($.tool, edit)
    expect(JSON.stringify(res)).toMatch(/guard is set to block/)
    // A file outside the prototypes is never guarded.
    const other = await callTool($.tool, { ...edit, file_path: '/proj/notes.md' })
    expect(JSON.stringify(other)).not.toMatch(/guard/)
  })
})

// ---------- phase 3: the hub and authoring help ----------

const HUB = `<main class="hub"><h1>Sample Game</h1>
<h2>The sample loop (draft)</h2>
<div class="card">
  <div class="life"><span class="st">Open the game</span><span class="ar">→</span><span class="st">Play a table</span><span class="ar">→</span><span class="st end">Next table</span></div>
  <div class="life"><span class="st side">Out of chips: a refill</span><span class="st flag">⚑ Every table must stay fair</span></div>
  <p class="life-note">Drafted on Day 1; the record is canonical.</p>
</div></main>`

const README = `# INIT-9 — Sample Game

## What is here

The prototype.

## The story the journeys tell

- **Ada Example** plays on the bus on **Day 1** (J01).

## Status

Draft.
`

const HUB_FILES = {
  [`${PROTO}/index.html`]: HUB,
  [`${ROOT}/INIT-9 - Sample/README.md`]: README,
  [`${PROTO}/journeys/J01-first-run.html`]: J01.replace("preconditions: ['Day 1, on the bus.']", "preconditions: ['Day 1, on the bus.', 'Placeholders, not decisions: the 50-chip refill.']"),
}

describe('the hub', () => {
  test('the loop, the story and the placeholders read from the hub page, the README and the journeys', async () => {
    const loop = readLoop(HUB)
    expect(loop).toEqual({ title: 'The sample loop (draft)', main: ['Open the game', 'Play a table'], end: 'Next table', side: ['Out of chips: a refill'], flags: ['Every table must stay fair'], note: 'Drafted on Day 1; the record is canonical.' })
    expect(readLoop('<main>no loop</main>')).toBeUndefined()
    expect(readStory(README)).toEqual({ title: 'The story the journeys tell', body: '- **Ada Example** plays on the bus on **Day 1** (J01).' })
    const l = sampleLoaded()
    const register = l.register
    const withHolder: Loaded = { ...l, journeys: { J01: readJourney(HUB_FILES[`${PROTO}/journeys/J01-first-run.html`]!, register.journeys[0]!) } }
    expect(placeholders(withHolder)).toEqual([{ journey: 'J01', text: 'Placeholders, not decisions: the 50-chip refill.' }])
    expect(progressOf(l, 'J01', DEFAULT_VOCAB)).toEqual({ decided: 0, waiting: 3 })
  })

  test('the initiative page shows the kit’s hub: experience map, personas, questions, story and progress', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on, true, HUB_FILES)
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'discovery-desk', surface, ...PANE })
      await pane.press({ key: 'refresh' })
      await pane.press({ key: 'ini-INIT-9' })
      await pane.press({ key: 'hub-surfaces' })
      expect(await shows(pane, /Purchase sheet/)).toBe(true)
      expect(await shows(pane, /●J01/)).toBe(true)
      expect(await shows(pane, /iOS: StoreKit · Android: Play Billing/)).toBe(true)
      await pane.press({ key: 'hub-personas' })
      expect(await shows(pane, /Ada Example/)).toBe(true)
      expect(await shows(pane, /Primary in J01, J02/)).toBe(true)
      await pane.press({ key: 'hub-questions' })
      await pane.press({ key: 'qf-undecided' })
      expect(await shows(pane, /Which table opens first/)).toBe(true)
      expect(await shows(pane, /Is there a tutorial/)).toBe(false)
      await pane.press({ key: 'qf-decided' })
      expect(await shows(pane, /Is there a tutorial/)).toBe(true)
      await pane.press({ key: 'hub-story' })
      expect(await shows(pane, /The sample loop \(draft\)/)).toBe(true)
      expect(await shows(pane, /Every table must stay fair/)).toBe(true)
      expect(await shows(pane, /Ada Example\** plays on the bus/)).toBe(true)
      expect(await shows(pane, /the 50-chip refill/)).toBe(true)
      await pane.press({ key: 'hub-progress' })
      expect(await shows(pane, /J01.*0 decided.*3 waiting/)).toBe(true)
      await pane.press({ key: 'hub-journeys' })
      await pane.press({ key: 'home' })
      await pane.unmount()
    }

    const pane = await $.ui.mount({ plugin: 'discovery-desk', surface: 'desktop', ...PANE })
    await pane.press({ key: 'ini-INIT-9' })
    // A register item opens the step that shows it.
    await pane.press({ key: 'hub-questions' })
    await pane.press({ key: 'qf-undecided' })
    await pane.press({ key: 'reg-at-Q-01-J01-2' })
    expect(await shows(pane, /The shop on/)).toBe(true)
    // The journey map: every step at a glance, the chips beside each.
    await pane.press({ key: 'map' })
    expect(await shows(pane, /1\. Setting the scene \(ADR-1\)/)).toBe(true)
    await pane.press({ key: 'leave' })
    await pane.press({ key: 'journey-set' })
    expect(world.prompts.at(-1)).toMatch(/plan card titled "Journey set"/)
    expect(world.prompts.at(-1)).toMatch(/J01 First run; J02 Missing page/)
    await pane.press({ key: 'read-notes' })
    expect(world.prompts.at(-1)).toMatch(/one read card per note/)
    await pane.unmount()
  })

  test('a new initiative: the form asks Claude to scaffold it, the record first', { options: { scaffold: 'node scaffold.js' } }, async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)
    const pane = await $.ui.mount({ plugin: 'discovery-desk', surface: 'terminal', ...PANE })
    await pane.press({ key: 'new-initiative' })
    expect(await shows(pane, /An id and a name are needed/)).toBe(true)
    await pane.input({ key: 'new:id', text: 'INIT-10' })
    await pane.input({ key: 'new:name', text: 'Next Game' })
    await pane.input({ key: 'new:pitch', text: 'A calm card game.', kind: 'change' })
    await pane.press({ key: 'scaffold' })
    const ask = world.prompts.at(-1) ?? ''
    expect(ask).toMatch(/`node scaffold\.js --id INIT-10 --name "Next Game" --pitch "A calm card game\."`/)
    expect(ask).toMatch(/The record comes first/)
    expect(await shows(pane, /Discovery desk/)).toBe(true)
    await pane.unmount()
  })

  test('proposals and read-throughs: accepted, ticked, and handed back as a plan only', async ($, on) => {
    mock.clock(on, { now: Date.parse(AT) })
    const world = memoryWorld(on)
    const taken = await callTool($.tool, { tool: 'mcp__discovery-desk__publish_walk', tool_use_id: 'toolu_p0', title: 'x', initiative: 'INIT-9', cards: [{ type: 'proposal', id: 'Q-01', title: 'Taken' }] })
    expect(JSON.stringify(taken)).toMatch(/Q-01 is in the register already/)
    const res = await callTool($.tool, {
      tool: 'mcp__discovery-desk__publish_walk',
      tool_use_id: 'toolu_p1',
      id: 'INIT-9-proposals',
      title: 'Proposals and notes',
      initiative: 'INIT-9',
      cards: [
        { type: 'proposal', id: 'Q-03', kind: 'question', title: 'Can players skip the shop?', detail: 'Raised while building J01.', raisedIn: { journey: 'J01', step: 2 }, from: 'the J01 agent' },
        { type: 'read', id: 'overview', title: 'Overview', sections: [{ title: 'The player', body: 'Plays on the bus.', flags: ['Is the bus right?'] }, { title: 'Evidence', body: 'Inferred.' }] },
      ],
    })
    expect(JSON.stringify(res)).toMatch(/2 cards \(1 proposal, 1 read\)/)
    const pane = await $.ui.mount({ plugin: 'discovery-desk', surface: 'desktop', ...PANE })
    expect(await shows(pane, /A new question, not yet in the record · raised in J01 · by the J01 agent/)).toBe(true)
    await pane.press({ key: 'verb-Q-03-accept' })
    await pane.press({ key: 'card-next' })
    expect(await shows(pane, /Your call:(\*\*)? Is the bus right\?/)).toBe(true)
    await pane.press({ key: 'part-done-overview' })
    expect(await shows(pane, /Section 2 of 2/)).toBe(true)
    await pane.press({ key: 'plan-only' })
    expect(await shows(pane, /Submit as a plan/)).toBe(true)
    await pane.press({ key: 'submit' })
    await pane.press({ key: 'submit-anyway' })
    await pane.unmount()
    const outcome = world.files.get('/proj/Discovery/reviewed/INIT-9-proposals/outcome.md') ?? ''
    expect(outcome).toMatch(/Proposal:\*\* Accepted: record it as a new question row first/)
    expect(outcome).toMatch(/Raised in:\*\* J01, step index 2 \(by the J01 agent\)/)
    expect(outcome).toMatch(/Reviewed:\*\* 1 of 2 sections/)
    expect(outcome).toMatch(/## Plan only/)
    expect(outcome).toMatch(/For accepted proposals/)
    expect(world.prompts.at(-1)).toMatch(/as a plan only/)
    expect(world.prompts.at(-1)).toMatch(/write nothing/)
  })
})
