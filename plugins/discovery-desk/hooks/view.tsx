// The pane's drawing, for the desktop and the terminal: the home (walks waiting, initiatives), one
// initiative (its journeys), one journey (the step player and its context), and one walk (its cards).
// The card frame, the answer controls and the per-card chat are adapted from review-desk's view.tsx.
import type { Elements, RenderElement } from 'claude-code'

import type { Ask, Card, CardType, DeskView, InitiativeSummary, Journey, Loaded, Notes, OpenWalk, Os, Response, Step, StepView, WalkSummary } from '../types'
import { OS_LABEL, htmlToMd, isUndecided, nearestStep, pick, stepsOn, toneOf } from './prototype'
import type { Tone, Vocab } from './prototype'
import { TYPE_LABEL, cardOutcome, cardState, cardText, osDiffText, partKey, rowIsOn, stepPlace } from './walk'
import type { CardState } from './walk'
import { bubbleSvg, markdownSvg, thinkingSvg } from './mdsvg'
import { deskHeaderSvg, ringSvg, stepperSvg, stripSvg } from './svg'

type UI = Elements['terminal'] | Elements['desktop'] | Elements['vscode'] | Elements['mobile']

/** What the pane's controls do; every one saves what it changes. */
export type Actions = {
  home: () => void
  refresh: () => void
  tab: (tab: DeskView['tab']) => void
  openInitiative: (folder: string) => void
  openJourney: (code: string, step?: number) => void
  leaveJourney: () => void
  goStep: (index: number) => void
  setOs: (os: Os) => void
  setStepView: (v: StepView) => void
  toggleContext: () => void
  play: (isOn: boolean) => void
  walked: (key: string, isWalked: boolean) => void
  polish: (code: string) => void
  phone: (code: string, index: number) => void
  sendRaised: () => void
  openWalk: (status: DeskView['tab'], id: string) => void
  closeWalk: () => void
  goCard: (n: number) => void
  respond: (key: string, patch: Partial<Response>) => void
  toggleRow: (cardId: string, rowId: string) => void
  decideRow: (cardId: string, rowId: string, isOn: boolean) => void
  setPlanView: (cardId: string, mode: 'list' | 'one') => void
  goPart: (cardId: string, n: number) => void
  type: (key: string, text: string) => void
  commit: (key: string, text: string) => void
  toggleSummary: () => void
  showAllAsks: () => void
  submit: () => void
  confirm: (isOn: boolean) => void
  resend: () => void
  copy: (text: string, surface: string) => void
}

export type Ctx = {
  ui: UI
  isDesktop: boolean
  width: number
  view: DeskView
  initiatives: InitiativeSummary[]
  walks: WalkSummary[]
  loaded: Loaded | null
  notes: Notes | null
  open: OpenWalk | null
  act: Actions
  folder: string
  selectable: boolean
  vocab: Vocab
}

const GLYPH: Record<CardState, string> = { done: '●', partial: '◐', open: '○' }
/** The kit's chip colours: purple an open question, blue a proposal, green decided. */
export const TONE_COLOR: Record<Tone, string> = { q: '#9575CD', d: '#42A5F5', ok: '#66BB6A', off: '#8D8B85', none: '#8D8B85' }
const TYPE_COLOR: Record<CardType, string> = { question: '#9575CD', decision: '#42A5F5', adr: '#42A5F5', plan: '#EC407A' }
const when = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '')
const bar = (done: number, total: number, width = 10) => {
  const n = total ? Math.round((done / total) * width) : 0
  return '▰'.repeat(n) + '▱'.repeat(width - n)
}

// ---------- text ----------

const drawing = new WeakMap<object, { width: number; isSvg: boolean }>()
const drawText = (ctx: Ctx) => drawing.set(ctx.ui, { width: Math.max(240, ctx.width - 40), isSvg: ctx.selectable && ctx.isDesktop && 'Svg' in ctx.ui })
const LINK = /\[[^\]]+\]\([^)\s]+\)|https?:\/\/\S+/g

/** Whether a block is mostly links: those stay the surface's own Markdown, so the links open. */
export function isLinkHeavy(text: string): boolean {
  const links = text.match(LINK) ?? []
  if (links.length >= 3) return true
  const linked = links.reduce((n, l) => n + l.length, 0)
  return links.length > 0 && linked / Math.max(1, text.length) > 0.4
}

/** A block of Markdown: selectable SVG text on the desktop, the surface's Markdown elsewhere. */
const md = (ui: UI, text: string | undefined, key: string, dim?: boolean, links?: 'open', size?: number): RenderElement | null => {
  if (!text?.trim()) return null
  const how = drawing.get(ui)
  if (how?.isSvg && 'Svg' in ui && links !== 'open' && !isLinkHeavy(text)) {
    const d = markdownSvg(text, how.width, !!dim, size)
    return <ui.Svg key={key} source={d.svg} alt={d.alt} width={how.width} height={d.height} isInteractive />
  }
  const { Markdown } = ui
  return <Markdown key={key} text={text} dimColor={dim} />
}

const label = (ui: UI, text: string, key: string) => {
  const { Text } = ui
  return (
    <Text key={key} bold dimColor>
      {text.toUpperCase()}
    </Text>
  )
}

/** A text field where the surface has one; otherwise nothing. */
function field(ctx: Ctx, key: string, caption: string, value: string | undefined, placeholder?: string, submitLabel = 'save'): RenderElement | null {
  const ui = ctx.ui
  if (!('Input' in ui)) return null
  const { Input } = ui
  return (
    <Input
      key={key}
      label={caption || undefined}
      value={value ?? ''}
      placeholder={placeholder}
      submitLabel={submitLabel}
      onInput={v => ctx.act.type(key, v)}
      onSubmit={v => ctx.act.commit(key, v)}
    />
  )
}

/** One chip: its colour dot, id, status and title. */
function chip(ctx: Ctx, id: string, key: string, isHere?: boolean): RenderElement {
  const { Text } = ctx.ui
  const item = ctx.loaded?.register.items.find(i => i.id === id)
  const tone = toneOf(item, ctx.vocab)
  return (
    <Text key={key} wrap="truncate-end">
      <Text color={TONE_COLOR[tone]} bold>
        {'● '}
        {id}
      </Text>
      <Text dimColor> {item ? item.status : 'not in the register'}</Text>
      {item ? ` · ${item.title}` : ''}
      {isHere ? <Text color="#D97757"> ◂ this step</Text> : ''}
    </Text>
  )
}

const walkRow = (ctx: Ctx, w: WalkSummary) => {
  const { Box, Text, Button } = ctx.ui
  const isDone = w.status === 'reviewed'
  return (
    <Box key={`walk-${w.status}-${w.id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      <Button key={`open-${w.status}-${w.id}`} plain onPress={() => ctx.act.openWalk(w.status, w.id)}>
        {w.title}
        <Text dimColor> ›</Text>
      </Button>
      <Text color={isDone ? '#66BB6A' : undefined} dimColor={!isDone} wrap="truncate-end">
        {isDone ? `✓ submitted ${when(w.submittedAt)}` : `${bar(w.answered, w.cards)}  ${w.answered} of ${w.cards} answered`}
      </Text>
      <Text dimColor wrap="truncate-end">
        {[w.initiative, w.journeys.join(', '), w.label, isDone ? '' : `published ${when(w.createdAt)}`].filter(Boolean).join(' · ')}
      </Text>
    </Box>
  )
}

// ---------- the home ----------

export function homeView(ctx: Ctx): RenderElement {
  drawText(ctx)
  const { ui, view, act, walks, initiatives } = ctx
  const { Box, Text, Button } = ui
  const pending = walks.filter(w => w.status === 'pending')
  const reviewed = walks.filter(w => w.status === 'reviewed')
  const shown = view.tab === 'pending' ? pending : reviewed
  const open = initiatives.reduce((n, i) => n + i.open, 0)
  const proposed = initiatives.reduce((n, i) => n + i.proposed, 0)
  let header: RenderElement
  if (ctx.isDesktop && 'Svg' in ui) {
    const d = deskHeaderSvg(ctx.width, pending.length, open, proposed, initiatives.length)
    header = <ui.Svg key="desk-header" source={d.svg} alt={d.alt} width={ctx.width} height={d.height} />
  } else {
    header = (
      <Box key="desk-header" flexDirection="column">
        <Text bold>Discovery desk</Text>
        <Text dimColor>
          {pending.length ? `${pending.length} walk${pending.length === 1 ? '' : 's'} waiting` : 'No walk waiting'} · {open} open · {proposed} proposed
        </Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      {header}
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <Button key="tab-pending" variant={view.tab === 'pending' ? 'primary' : 'secondary'} label={`Waiting · ${pending.length}`} onPress={() => act.tab('pending')} />
        <Button key="tab-reviewed" variant={view.tab === 'reviewed' ? 'primary' : 'secondary'} label={`Walked · ${reviewed.length}`} onPress={() => act.tab('reviewed')} />
        <Button key="refresh" plain dimColor label="↻ Refresh" onPress={act.refresh} />
      </Box>
      {shown.length === 0 && (
        <Text dimColor>
          {view.tab === 'pending' ? 'No walk is waiting. Open a journey below and press "Polish this journey", or ask Claude to put a journey\'s open questions on the discovery desk.' : 'No walk submitted yet.'}
        </Text>
      )}
      {shown.map(w => walkRow(ctx, w))}
      {label(ui, 'Initiatives', 'ini-h')}
      {initiatives.length === 0 && <Text dimColor>No UX prototype found: the desk looks for a prototype.js in each folder under the prototype root (setting prototypeRoot), or in its UX Prototype folder.</Text>}
      {initiatives.map(i => (
        <Box key={`ini-${i.folder}`} flexDirection="column">
          <Button key={`ini-${i.id || i.rel}`} plain onPress={() => act.openInitiative(i.folder)}>
            {i.id ? `${i.id} · ` : ''}
            {i.name}
            <Text dimColor> ›</Text>
          </Button>
          {i.problem ? (
            <Text color="#EF5350" wrap="truncate-end">
              {i.problem}
            </Text>
          ) : (
            <Text dimColor wrap="truncate-end">
              {i.journeys} journeys · <Text color={TONE_COLOR.q}>{i.open} open</Text> · <Text color={TONE_COLOR.d}>{i.proposed} proposed</Text> · <Text color={TONE_COLOR.ok}>{i.decided} decided</Text>
            </Text>
          )}
        </Box>
      ))}
      <Text dimColor wrap="truncate-end">
        Walks are saved in {ctx.folder}/
      </Text>
    </Box>
  )
}

// ---------- one initiative ----------

const walkedOf = (notes: Notes | null, j: Journey, os?: Os) =>
  (os ? stepsOn(j, os) : j.steps).filter(st => notes?.steps[`${j.code}/${st.index}`]?.isWalked).length

export function initiativeView(ctx: Ctx): RenderElement {
  drawText(ctx)
  const { ui, act, loaded, notes, walks } = ctx
  const { Box, Text, Button } = ui
  if (!loaded) {
    return (
      <Box flexDirection="column" gap={1}>
        <Button key="home" plain dimColor label="‹ Discovery desk" onPress={act.home} />
        <Text dimColor>This initiative could not be read. Its prototype.js may have moved or stopped being a plain object.</Text>
      </Box>
    )
  }
  const r = loaded.register
  const summary = ctx.initiatives.find(i => i.folder === loaded.folder)
  const mine = walks.filter(w => w.status === 'pending' && w.initiative === r.initiative.id)
  const raised = (notes?.raised ?? []).filter(q => !q.sentAt)
  return (
    <Box flexDirection="column" gap={1}>
      <Button key="home" plain dimColor label="‹ Discovery desk" onPress={act.home} />
      <Box flexDirection="column">
        <Text bold>
          {r.initiative.id ? `${r.initiative.id} · ` : ''}
          {r.initiative.name}
        </Text>
        {summary && (
          <Text dimColor wrap="truncate-end">
            {summary.journeys} journeys · <Text color={TONE_COLOR.q}>{summary.open} open</Text> · <Text color={TONE_COLOR.d}>{summary.proposed} proposed</Text> · <Text color={TONE_COLOR.ok}>{summary.decided} decided</Text>
          </Text>
        )}
        <Text dimColor wrap="truncate-end">
          {loaded.rel}
          {r.initiative.vault ? ` · mirrors vault ${r.initiative.vault}` : ''}
        </Text>
      </Box>
      {mine.length > 0 && label(ui, 'Walks waiting', 'mine-h')}
      {mine.map(w => walkRow(ctx, w))}
      {raised.length > 0 && (
        <Box key="raised" flexDirection="column" borderStyle="round" borderColor={TONE_COLOR.q} paddingX={1}>
          <Text bold>Raised while walking, not yet with Claude</Text>
          {raised.map(q => (
            <Text key={`raised-${q.id}`} wrap="truncate-end">
              <Text color={TONE_COLOR.q} bold>
                {q.id}
              </Text>
              <Text dimColor> {q.journey} · </Text>
              {q.text}
            </Text>
          ))}
          <Button key="send-raised" variant="primary" label="Hand them to Claude" onPress={act.sendRaised} />
        </Box>
      )}
      {label(ui, 'Journeys, in story-map order', 'j-h')}
      {r.journeys.map(e => {
        const j = loaded.journeys[e.code]
        const persona = r.personas.find(p => p.id === e.persona)
        const undecided = j ? [...new Set([...e.questions, ...j.steps.flatMap(st => st.chips)])].filter(id => isUndecided(r.items.find(i => i.id === id), ctx.vocab)).length : 0
        return (
          <Box key={`j-${e.code}`} flexDirection="column">
            <Button key={`journey-${e.code}`} plain onPress={() => act.openJourney(e.code)}>
              <Text bold>{e.code}</Text> {e.title}
              <Text dimColor> ›</Text>
            </Button>
            {j?.problem ? (
              <Text color="#EF5350" wrap="truncate-end">
                {e.file}: {j.problem}
              </Text>
            ) : (
              <Text dimColor wrap="truncate-end">
                {[persona?.name ?? e.persona, e.status, j ? `${j.steps.length} steps` : '', j ? `walked ${walkedOf(notes, j)} of ${j.steps.length}` : '', undecided ? `${undecided} undecided` : ''].filter(Boolean).join(' · ')}
              </Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// ---------- one journey ----------

const VIEWS: { id: StepView; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'captions', label: 'Captions only' },
  { id: 'chips', label: 'Chips only' },
  { id: 'no-notes', label: 'Hide callouts' },
]

/** The strongest chip on a step: an open question over a proposal over a decision. */
export function stepTone(ctx: Ctx, st: Step): Tone {
  const tones = st.chips.map(id => toneOf(ctx.loaded?.register.items.find(i => i.id === id), ctx.vocab))
  for (const t of ['q', 'd', 'ok', 'off'] as Tone[]) if (tones.includes(t)) return t
  return 'none'
}

function contextBlock(ctx: Ctx, j: Journey, st: Step): RenderElement {
  const { ui, loaded, view } = ctx
  const { Box, Text } = ui
  const r = loaded!.register
  const entry = r.journeys.find(e => e.code === j.code)
  const os = view.os
  const persona = r.personas.find(p => p.id === entry?.persona)
  const others = j.alsoInvolved.map(id => r.personas.find(p => p.id === id)?.name ?? id)
  const t = (v: Parameters<typeof pick>[0]) => htmlToMd(pick(v, os))
  const parts: string[] = []
  if (persona) parts.push(`**${persona.name ?? persona.id}** · ${persona.archetype ?? ''}${persona.status && persona.status !== 'active' ? ` · _${persona.status} persona_` : ''}${persona.team ? `\n\n${persona.team}` : ''}${persona.summary ? `\n\n${persona.summary}` : ''}`)
  if (others.length) parts.push(`**Also involved:** ${others.join(', ')}`)
  if (j.useCase) parts.push(`**Use case:** ${t(j.useCase)}`)
  if (j.trigger) parts.push(`**Trigger:** ${t(j.trigger)}`)
  if (j.preconditions.length) parts.push(`**Preconditions**\n\n${j.preconditions.map(p => `- ${t(p)}`).join('\n')}`)
  if (j.outcome) parts.push(`**Outcome:** ${t(j.outcome)}`)
  const notes = (['ios', 'android'] as Os[]).filter(o => j.osNotes?.[o]).map(o => `- ${o === os ? `**${OS_LABEL[o]} (shown):**` : `${OS_LABEL[o]}:`} ${htmlToMd(j.osNotes![o]!)}`)
  if (notes.length) parts.push(`**What differs between the phones**\n\n${notes.join('\n')}`)
  if (j.storyMap.length) parts.push(`**Story-map steps**\n\n${j.storyMap.map(s => `- ${s}`).join('\n')}`)
  const surfaces = (entry?.surfaces ?? []).map(k => r.surfaces.find(s => s.key === k)).filter(s => !!s)
  if (surfaces.length) parts.push(`**Surfaces**\n\n${surfaces.map(s => `- ${s!.name}${s!.owner ? ` · drawn by ${s!.owner}` : ''}${s!.module ? ` · ${pick(s!.module, os)}` : ''}`).join('\n')}`)
  const ids = [...new Set([...(entry?.questions ?? []), ...j.steps.flatMap(x => x.chips)])]
  return (
    <Box key="context" flexDirection="column" gap={1} paddingLeft={2}>
      {md(ui, parts.join('\n\n'), `ctx-${j.code}-${os}`)}
      {ids.length > 0 && <Text bold>Questions, decisions and ADRs in this journey</Text>}
      {ids.map(id => chip(ctx, id, `ctxchip-${id}`, st.chips.includes(id)))}
    </Box>
  )
}

export function journeyView(ctx: Ctx): RenderElement {
  drawText(ctx)
  const { ui, act, loaded, notes, view } = ctx
  const { Box, Text, Button } = ui
  const j = loaded && view.journey ? loaded.journeys[view.journey] : undefined
  const back = view.openId ? (
    <Button key="leave" plain dimColor label="‹ Back to the walk" onPress={act.leaveJourney} />
  ) : (
    <Button key="leave" plain dimColor label={`‹ ${loaded?.register.initiative.id || 'Initiative'}`} onPress={act.leaveJourney} />
  )
  if (!loaded || !j) {
    return (
      <Box flexDirection="column" gap={1}>
        {back}
        <Text dimColor>This journey could not be read.</Text>
      </Box>
    )
  }
  const os = view.os
  const on = stepsOn(j, os)
  const st = nearestStep(j, os, view.step[j.code] ?? 0)
  if (!st || j.problem) {
    return (
      <Box flexDirection="column" gap={1}>
        {back}
        <Text bold>
          {j.code} · {j.title}
        </Text>
        <Text color="#EF5350">{j.problem ?? `No step plays on ${OS_LABEL[os]}.`}</Text>
      </Box>
    )
  }
  const at = on.indexOf(st)
  const r = loaded.register
  const entry = r.journeys.find(e => e.code === j.code)
  const persona = r.personas.find(p => p.id === entry?.persona)
  const actor = r.personas.find(p => p.id === st.actor)
  const key = `${j.code}/${st.index}`
  const note = notes?.steps[key]
  const walked = walkedOf(notes, j, os)
  const isDesktop = ctx.isDesktop && 'Svg' in ui
  const nextChip = on.slice(at + 1).find(x => x.chips.some(id => isUndecided(r.items.find(i => i.id === id), ctx.vocab)))

  let strip: RenderElement
  let ring: RenderElement | null = null
  if (isDesktop && 'Svg' in ui) {
    const d = stripSvg(ctx.width, on.map(x => ({ tone: stepTone(ctx, x), isWalked: !!notes?.steps[`${j.code}/${x.index}`]?.isWalked })), at)
    strip = <ui.Svg key={`strip-${j.code}-${os}-${at}-${walked}`} source={d.svg} alt={d.alt} width={ctx.width} height={d.height} />
    const g = ringSvg(walked, on.length, `steps walked on ${OS_LABEL[os]}`)
    ring = <ui.Svg key={`ring-${walked}-${on.length}`} source={g.svg} alt={g.alt} width={g.height} height={g.height} />
  } else {
    strip = (
      <Text key="strip" wrap="truncate-end">
        {on.map((x, i) => {
          const glyph = notes?.steps[`${j.code}/${x.index}`]?.isWalked ? '✓' : '•'
          const tone = stepTone(ctx, x)
          return (
            <Text key={`dot-${i}`} color={tone === 'none' ? undefined : TONE_COLOR[tone]} bold={i === at} inverse={i === at}>
              {glyph}
            </Text>
          )
        })}
      </Text>
    )
  }

  const sv = view.stepView
  const showCaption = sv !== 'chips'
  const showChips = sv !== 'captions'
  const showCallouts = sv === 'all' || sv === 'chips'
  const callouts = st.callouts.map((c, i) => md(ui, `> ${htmlToMd(pick(c.text, os)).replace(/\n/g, '\n> ')}`, `call-${key}-${i}`, false))

  return (
    <Box flexDirection="column" gap={1}>
      <Box key="top" flexDirection="column">
        {back}
        <Box flexDirection="row" gap={1} alignItems="center">
          {ring}
          <Box flexDirection="column" flexShrink={1}>
            <Text bold>
              {j.code} · {j.title}
            </Text>
            <Text dimColor wrap="truncate-end">
              {[persona ? `${persona.name ?? persona.id}${persona.status === 'proposed' ? ' (proposed persona)' : ''}` : '', entry?.status, isDesktop ? '' : `walked ${walked} of ${on.length} on ${OS_LABEL[os]}`].filter(Boolean).join(' · ')}
            </Text>
          </Box>
        </Box>
      </Box>
      <Box key="phones" flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        {(['ios', 'android'] as Os[]).map(o => (
          <Button key={`os-${o}`} variant={o === os ? 'primary' : 'secondary'} label={OS_LABEL[o]} onPress={() => act.setOs(o)} />
        ))}
        <Button key="context" plain dimColor={!view.isContextOpen} label={`${view.isContextOpen ? '▾' : '▸'} Context`} onPress={act.toggleContext} />
      </Box>
      {view.isContextOpen && contextBlock(ctx, j, st)}
      {strip}
      <Box key={`step-${key}`} flexDirection="column" gap={1} borderStyle="round" borderColor={TONE_COLOR[stepTone(ctx, st)]} paddingX={1}>
        <Text wrap="truncate-end">
          <Text dimColor>
            Step {at + 1} of {on.length}
            {st.os ? ` · ${OS_LABEL[st.os]} only` : ''}
            {actor ? ` · ${actor.name ?? actor.id}` : ''}
            {st.screenLabel ? ` · ${st.screenLabel}` : ''}
          </Text>
        </Text>
        <Text bold>{htmlToMd(pick(st.title, os)).replace(/\*\*/g, '')}</Text>
        {showCaption && md(ui, htmlToMd(pick(st.caption, os)), `cap-${key}-${os}`)}
        {showChips && st.chips.map(id => chip(ctx, id, `chip-${key}-${id}`))}
        {showCallouts && callouts}
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          <Button key="walked" hotkey="w" variant={note?.isWalked ? 'secondary' : 'primary'} label={note?.isWalked ? '✓ Walked' : 'Walked'} onPress={() => act.walked(key, !note?.isWalked)} />
          {field(ctx, `note:${key}`, 'Note on this step', note?.text, 'optional')}
        </Box>
        {field(ctx, `raise:${key}#${notes?.raised.length ?? 0}`, 'Raise a question here', '', 'a new open question, Enter to add', 'add')}
      </Box>
      <Box key="controls" flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="step-prev" hotkey="k" dimColor={at === 0} label="‹ Previous" onPress={() => act.goStep(on[Math.max(0, at - 1)]!.index)} />
        <Button key="step-next" hotkey="j" variant={at < on.length - 1 ? 'primary' : 'secondary'} dimColor={at >= on.length - 1} label="Next ›" onPress={() => act.goStep(on[Math.min(on.length - 1, at + 1)]!.index)} />
        <Button key="next-chip" hotkey="n" dimColor={!nextChip} label="Next chip »" onPress={() => nextChip && act.goStep(nextChip.index)} />
        <Button key="play" hotkey="p" label={view.isPlaying ? '❚❚ Pause' : '▶ Play'} onPress={() => act.play(!view.isPlaying)} />
        <Button key="restart" hotkey="r" plain dimColor label="⟲ Restart" onPress={() => act.goStep(on[0]!.index)} />
      </Box>
      <Box key="views" flexDirection="row" gap={1} flexWrap="wrap">
        {VIEWS.map(v => (
          <Button key={`view-${v.id}`} plain dimColor={sv !== v.id} label={`${sv === v.id ? '◉' : '○'} ${v.label}`} onPress={() => act.setStepView(v.id)} />
        ))}
      </Box>
      <Box key="claude" flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="phone" label={`📱 Open on ${OS_LABEL[os]}`} onPress={() => act.phone(j.code, st.index)} />
        <Button key="polish" label="✻ Polish this journey" onPress={() => act.polish(j.code)} />
      </Box>
      <Text dimColor wrap="truncate-end">
        j k step · n next chip · p play · w walked · r restart
      </Text>
    </Box>
  )
}

// ---------- one walk: the card's parts ----------

function choices(ctx: Ctx, cardId: string, picked: string | undefined, list: { id: string; label: string; detail?: string; isTip?: boolean }[]): RenderElement {
  const { Box, Button, Text } = ctx.ui
  return (
    <Box flexDirection="column">
      {list.map(o => (
        <Button key={`choice-${cardId}-${o.id}`} plain onPress={() => ctx.act.respond(cardId, { choice: picked === o.id ? undefined : o.id })}>
          {picked === o.id ? '◉  ' : '○  '}
          {o.label}
          {o.isTip ? <Text color="#66BB6A"> ★ recommended</Text> : ''}
          {o.detail ? <Text dimColor> · {o.detail}</Text> : ''}
        </Button>
      ))}
    </Box>
  )
}

/** A row of buttons, one picked; pressing the picked one again clears it. */
function verbs(ctx: Ctx, cardId: string, picked: string | undefined, list: { id: string; label: string }[], field: 'choice' | 'status' = 'choice'): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      {list.map(v => (
        <Button
          key={`${field === 'status' ? 'status' : 'verb'}-${cardId}-${v.id}`}
          variant={picked === v.id ? 'primary' : 'secondary'}
          label={`${picked === v.id ? '✓ ' : ''}${v.label}`}
          onPress={() => ctx.act.respond(cardId, { [field]: picked === v.id ? undefined : v.id })}
        />
      ))}
    </Box>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Where the item shows in the journeys, each a button that opens the step; its links and evidence. */
function framing(ctx: Ctx, card: Exclude<Card, { type: 'plan' }>): (RenderElement | null)[] {
  const { ui, act, loaded, view } = ctx
  const { Box, Text, Button } = ui
  const shown = card.appearsAt.filter(a => !a.os || a.os === view.os).slice(0, 8)
  return [
    card.isUnregistered ? (
      <Text key={`unreg-${card.id}`} color="#FFA726">
        {card.id} is not in the register (prototype.js).
      </Text>
    ) : null,
    shown.length ? (
      <Box key={`at-${card.id}`} flexDirection="column">
        {label(ui, 'Shown in', `ath-${card.id}`)}
        {shown.map(a => (
          <Button key={`at-${card.id}-${a.journey}-${a.step}`} plain onPress={() => act.openJourney(a.journey, a.step)}>
            {a.journey}, {stepPlace(loaded?.journeys[a.journey], a.step, view.os)}
            {loaded?.journeys[a.journey]?.steps[a.step] ? <Text dimColor> · {htmlToMd(pick(loaded.journeys[a.journey]!.steps[a.step]!.title, view.os)).replace(/\*\*/g, '')}</Text> : ''}
            <Text dimColor> ›</Text>
          </Button>
        ))}
      </Box>
    ) : null,
    md(ui, osDiffText(card.osDiff), `os-${card.id}`),
    md(ui, card.evidence ? `**Evidence:** ${card.evidence}` : '', `ev-${card.id}`, true, 'open'),
    card.linked?.length ? (
      <Box key={`ln-${card.id}`} flexDirection="column">
        {label(ui, 'Linked', `lnh-${card.id}`)}
        {card.linked.map(l => (
          <Text key={`ln-${card.id}-${l.id}`} wrap="truncate-end">
            <Text bold>{l.id}</Text>
            {l.title ? ` ${l.title}` : ''}
            {l.status ? <Text dimColor> · {l.status}</Text> : ''}
            {l.note ? <Text dimColor> · {l.note}</Text> : ''}
          </Text>
        ))}
      </Box>
    ) : null,
  ]
}

function cardParts(ctx: Ctx, card: Card): { content: RenderElement; answer: RenderElement | null } {
  const { ui, open, view, vocab } = ctx
  const { Box, Text, Button } = ui
  const draft = open!.draft
  const r = draft.responses[card.id]
  const isPending = open!.status === 'pending'
  const col = (key: string, ...children: (RenderElement | null | false | undefined)[]) => (
    <Box key={key} flexDirection="column" gap={1}>
      {children.filter(Boolean)}
    </Box>
  )
  switch (card.type) {
    case 'question':
      return {
        content: col(`c-${card.id}`, md(ui, card.prompt, `q-${card.id}`), md(ui, card.context, `qc-${card.id}`, true), ...framing(ctx, card)),
        answer: isPending
          ? col(
              `a-${card.id}`,
              card.options &&
                choices(ctx, card.id, r?.choice, [
                  ...card.options.map(o => ({ id: o.id, label: o.label, detail: o.description, isTip: o.id === card.recommended })),
                  ...(card.allowOther !== false ? [{ id: 'other', label: 'Something else' }] : []),
                ]),
              field(ctx, `t:${card.id}`, card.options && r?.choice !== 'other' ? 'Comment' : 'Answer', r?.text, card.options && r?.choice !== 'other' ? 'optional; for a deferred question, say to when' : 'type your answer, Enter to save'),
              <Text key={`st-h-${card.id}`} dimColor>
                Status after this walk
              </Text>,
              verbs(ctx, card.id, r?.status, vocab.qStatuses.map((s, i) => ({ id: s, label: i === 0 ? `Leave ${s}` : cap(s) })), 'status'),
              <Button key={`adr-${card.id}`} plain onPress={() => ctx.act.respond(card.id, { toAdr: !r?.toAdr })}>
                {r?.toAdr ? '☑  ' : '☐  '}
                The answer has alternatives worth recording: make it an ADR
              </Button>,
            )
          : null,
      }
    case 'decision':
    case 'adr': {
      const isAdr = card.type === 'adr'
      return {
        content: col(
          `c-${card.id}`,
          md(ui, card.proposal, `d-${card.id}`),
          card.type === 'decision' && md(ui, card.rationale ? `**Why:** ${card.rationale}` : '', `dr-${card.id}`),
          card.type === 'adr' && md(ui, card.clauses ? `**The clauses at stake**\n\n${card.clauses}` : '', `dcl-${card.id}`),
          md(ui, card.alternatives?.length ? `**Considered, not chosen**\n\n${card.alternatives.map(a => `- ${a.label}${a.reason ? ` — ${a.reason}` : ''}`).join('\n')}` : '', `da-${card.id}`),
          card.type === 'decision' && md(ui, card.consequences ? `**What follows:** ${card.consequences}` : '', `dc-${card.id}`, true),
          ...framing(ctx, card),
        ),
        answer: isPending
          ? col(
              `a-${card.id}`,
              verbs(
                ctx,
                card.id,
                r?.choice,
                isAdr
                  ? [
                      { id: 'decide', label: 'Decide it' },
                      { id: 'amend', label: 'Decide with changes' },
                      { id: 'keep', label: 'Keep it proposed' },
                    ]
                  : [
                      { id: 'approve', label: 'Approve' },
                      { id: 'amend', label: 'Approve with changes' },
                      { id: 'reject', label: 'Reject' },
                    ],
              ),
              field(ctx, `t:${card.id}`, r?.choice === 'amend' ? (isAdr ? 'Changes to the clauses' : 'Changes') : isAdr ? 'Comment' : "Owner's call", r?.text, r?.choice === 'amend' ? 'what to change' : 'optional'),
            )
          : null,
      }
    }
    case 'plan': {
      const n = card.rows.length
      const on = card.rows.filter(row => rowIsOn(r, row.id)).length
      const mode = view.planView?.[card.id] ?? (n > 5 ? 'one' : 'list')
      const rows = (
        <Box key={`pr-${card.id}`} flexDirection="column">
          {card.rows.map(row => {
            const isOn = rowIsOn(r, row.id) && (isPending || r?.choice !== 'cancel')
            const inner = [isOn ? '☑  ' : '☐  ', <Text bold>{row.action}</Text>, ` ${row.target}`, row.summary ? <Text dimColor> · {row.summary}</Text> : '']
            const comment = draft.responses[partKey(card.id, row.id)]?.text?.trim()
            return (
              <Box key={`row-${card.id}-${row.id}`} flexDirection="column">
                {isPending ? (
                  <Button key={`row-${card.id}-${row.id}`} plain onPress={() => ctx.act.toggleRow(card.id, row.id)}>
                    {inner}
                  </Button>
                ) : (
                  <Text>{inner}</Text>
                )}
                {comment && (
                  <Text dimColor italic>
                    {'     ↳ '}
                    {comment}
                  </Text>
                )}
              </Box>
            )
          })}
        </Box>
      )
      let oneRow: RenderElement | null = null
      if (isPending && mode === 'one') {
        const at = Math.min(view.part[card.id] ?? 0, n - 1)
        const row = card.rows[at]
        if (row) {
          const isOn = rowIsOn(r, row.id)
          const isLast = at >= n - 1
          const decide = (yes: boolean) => {
            ctx.act.decideRow(card.id, row.id, yes)
            if (!isLast) ctx.act.goPart(card.id, at + 1)
          }
          oneRow = (
            <Box key={`one-${card.id}`} flexDirection="column" gap={1}>
              <Box flexDirection="column" gap={1} borderStyle="round" borderColor={TYPE_COLOR.plan} paddingX={1}>
                <Text dimColor>
                  <Text bold>{row.action.toUpperCase()}</Text> · row {at + 1} of {n} · {isOn ? 'yes' : 'no'}
                </Text>
                {md(ui, `**${row.target}**`, `rt-${card.id}-${row.id}`, false, undefined, 17)}
                {md(ui, row.summary, `rs-${card.id}-${row.id}`, false, undefined, 16)}
                <Box flexDirection="row" gap={1}>
                  <Button key={`row-yes-${card.id}-${row.id}`} variant={isOn ? 'primary' : 'secondary'} label={isOn ? '✓ Yes' : 'Yes'} onPress={() => decide(true)} />
                  <Button key={`row-no-${card.id}-${row.id}`} variant={isOn ? 'secondary' : 'primary'} label={isOn ? 'No' : '✗ No'} onPress={() => decide(false)} />
                </Box>
                {field(ctx, `t:${partKey(card.id, row.id)}`, 'Comment', draft.responses[partKey(card.id, row.id)]?.text, 'on this row, optional')}
              </Box>
              <Box flexDirection="row" justifyContent="space-between" width="100%">
                <Button key={`row-prev-${card.id}`} variant="secondary" dimColor={at === 0} label="‹ Previous row" onPress={() => ctx.act.goPart(card.id, Math.max(0, at - 1))} />
                <Button key={`row-next-${card.id}`} variant={isLast ? 'secondary' : 'primary'} dimColor={isLast} label="Next row ›" onPress={() => ctx.act.goPart(card.id, Math.min(n - 1, at + 1))} />
              </Box>
            </Box>
          )
        }
      }
      return {
        content: col(`c-${card.id}`, md(ui, card.intro, `pi-${card.id}`), isPending ? null : rows),
        answer: isPending
          ? col(
              `a-${card.id}`,
              <Box key={`pv-${card.id}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                <Button key={`plan-list-${card.id}`} variant={mode === 'list' ? 'primary' : 'secondary'} label="☰ List" onPress={() => ctx.act.setPlanView(card.id, 'list')} />
                <Button key={`plan-one-${card.id}`} variant={mode === 'one' ? 'primary' : 'secondary'} label="▣ One at a time" onPress={() => ctx.act.setPlanView(card.id, 'one')} />
                <Text dimColor>
                  {on} yes · {n - on} no
                </Text>
              </Box>,
              mode === 'one' ? oneRow : rows,
              verbs(ctx, card.id, r?.choice, [
                { id: 'go', label: on === n ? 'Go ahead with all' : `Go ahead with ${on} of ${n}` },
                { id: 'cancel', label: 'Cancel: write nothing' },
              ]),
              field(ctx, `t:${card.id}`, 'Comment', r?.text, 'on the whole plan, optional'),
            )
          : null,
      }
    }
  }
}

export const asksOf = (asks: Ask[], card: Card) => asks.filter(a => a.card === card.id)

function chatBlock(ctx: Ctx, card: Card): RenderElement {
  const { ui, open, view, act } = ctx
  const { Box, Text, Button } = ui
  const asks = asksOf(open!.draft.asks, card)
  const shown = view.showAllAsks ? asks : asks.slice(-4)
  const isSvg = ctx.isDesktop && 'Svg' in ui
  return (
    <Box key={`chat-${card.id}`} flexDirection="column" gap={1} marginTop={1}>
      <Text>
        <Text color="#D97757" bold>
          ✻{' '}
        </Text>
        <Text bold>Ask Claude about this card</Text>
      </Text>
      {asks.length === 0 && <Text dimColor>Claude can search the web and read your project and its record. The answer appears here.</Text>}
      {asks.length > shown.length && <Button key={`ask-all-${card.id}`} plain dimColor label={`Show ${asks.length - shown.length} earlier`} onPress={act.showAllAsks} />}
      {shown.flatMap(a => {
        const q =
          isSvg && 'Svg' in ui ? (
            (() => {
              const d = bubbleSvg(a.question, Math.max(200, Math.round((ctx.width - 40) * 0.8)))
              return (
                <Box key={`q-${a.id}`} flexDirection="row" justifyContent="flex-end">
                  <ui.Svg source={d.svg} alt={d.alt} width={d.width} height={d.height} isInteractive />
                </Box>
              )
            })()
          ) : (
            <Box key={`q-${a.id}`} flexDirection="row" justifyContent="flex-end">
              <Text inverse> {a.question} </Text>
            </Box>
          )
        if (!a.answer) {
          const dots = isSvg ? thinkingSvg() : undefined
          return [
            q,
            <Box key={`r-${a.id}`} flexDirection="row" gap={1} alignItems="center">
              {dots && 'Svg' in ui ? <ui.Svg source={dots.svg} alt={dots.alt} width={dots.width} height={dots.height} isInteractive /> : <Text color="#D97757">●●●</Text>}
              <Text dimColor italic>
                Claude is looking into it…
              </Text>
            </Box>,
          ]
        }
        const sources = (a.sources ?? []).map(x => `- ${x.url ? `[${x.title}](${x.url})` : x.title}`).join('\n')
        return [
          q,
          <Box key={`r-${a.id}`} flexDirection="column" gap={1}>
            {md(ui, a.answer, `ans-${a.id}`)}
            {sources && md(ui, `**Sources**\n\n${sources}`, `src-${a.id}`, true, 'open')}
            <Button key={`copy-ask-${a.id}`} plain dimColor label="⧉ Copy" onPress={p => act.copy(`**Q:** ${a.question}\n\n**A:** ${a.answer}${sources ? `\n\nSources:\n${sources}` : ''}`, p.surface)} />
          </Box>,
        ]
      })}
      {'Input' in ui && (
        <Box key={`composer-${card.id}`} flexDirection="column" alignItems="stretch" width="100%" borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="column" alignItems="stretch" width="100%">
            {field(ctx, `ask:${card.id}#${asks.length}`, '', '', 'Ask Claude about this card…', '↑')}
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ---------- one walk ----------

export function walkView(ctx: Ctx): RenderElement {
  drawText(ctx)
  const { ui, open, view, act, vocab } = ctx
  const { Box, Text, Button } = ui
  if (!open) {
    return (
      <Box flexDirection="column" gap={1}>
        <Button key="back" plain dimColor label="‹ Discovery desk" onPress={act.closeWalk} />
        <Text dimColor>This walk could not be read. It may have been moved or edited by hand.</Text>
      </Box>
    )
  }
  const { walk, draft } = open
  const n = walk.cards.length
  const at = Math.min(view.card, n - 1)
  const card = walk.cards[at]
  if (!card) return <Text dimColor>This walk has no cards.</Text>
  const states = walk.cards.map(c => cardState(c, draft, vocab))
  const answered = states.filter(s => s === 'done').length
  const isPending = open.status === 'pending'
  const isDesktop = ctx.isDesktop && 'Svg' in ui

  const meta = [walk.initiative.id, walk.journeys.join(', '), walk.label, isPending ? `published ${when(walk.createdAt)}` : `submitted ${when(open.submittedAt)}`].filter(Boolean).join(' · ')
  let ring: RenderElement | null = null
  let stepper: RenderElement
  if (isDesktop && 'Svg' in ui) {
    const g = ringSvg(answered, n)
    ring = <ui.Svg key={`ring-${answered}`} source={g.svg} alt={g.alt} width={g.height} height={g.height} />
    const d = stepperSvg(ctx.width, states, at)
    stepper = <ui.Svg key={`stepper-${at}-${answered}`} source={d.svg} alt={d.alt} width={ctx.width} height={d.height} />
  } else {
    stepper = <Text wrap="truncate-end">{states.map((s, i) => (i === at ? `[${GLYPH[s]}]` : GLYPH[s])).join(' ')}</Text>
  }
  const jump =
    n > 1 && 'Select' in ui ? (
      <ui.Select key="jump-card" value={String(at)} options={walk.cards.map((c, i) => ({ value: String(i), label: `${i + 1}. ${c.id === c.title ? c.title : `${c.id} ${c.title}`}` }))} onSelect={v => act.goCard(Number(v))} />
    ) : null

  const { content, answer } = cardParts(ctx, card)
  const color = card.type === 'plan' || card.type === 'question' ? TYPE_COLOR[card.type] : TONE_COLOR[toneOf(ctx.loaded?.register.items.find(i => i.id === card.id), vocab) === 'ok' ? 'ok' : 'd']
  const state = states[at] ?? 'open'
  const response = !isPending ? md(ui, cardOutcome(card, draft, vocab).join('\n'), `outcome-${card.id}`) : null
  const status = card.type !== 'plan' && card.status ? ` · ${card.status} in the register` : ''

  return (
    <Box flexDirection="column" gap={1}>
      <Box key="top" flexDirection="column">
        <Button key="back" plain dimColor label="‹ Discovery desk" onPress={act.closeWalk} />
        <Box flexDirection="row" gap={1} alignItems="center">
          {ring}
          <Box flexDirection="column" flexShrink={1}>
            <Text bold>{walk.title}</Text>
            <Text dimColor wrap="truncate-end">
              {isDesktop ? meta : `${answered} of ${n} answered · ${meta}`}
            </Text>
          </Box>
        </Box>
      </Box>
      {walk.summary ? (
        <Box key="about" flexDirection="column">
          <Button key="about" plain dimColor={!view.isSummaryOpen} label={`${view.isSummaryOpen ? '▾' : '▸'} About this walk`} onPress={act.toggleSummary} />
          {view.isSummaryOpen && <Box paddingLeft={2}>{md(ui, walk.summary, 'summary')}</Box>}
        </Box>
      ) : null}
      <Box key="nav" flexDirection="column">
        {stepper}
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <Button key="card-prev" label="‹ Previous" dimColor={at === 0} onPress={() => act.goCard(Math.max(0, at - 1))} />
          <Box flexGrow={1} flexShrink={1} flexDirection="column">
            {jump}
          </Box>
          <Button key="card-next" label="Next ›" variant={at < n - 1 ? 'primary' : 'secondary'} dimColor={at >= n - 1} onPress={() => act.goCard(Math.min(n - 1, at + 1))} />
        </Box>
      </Box>
      <Box key={`card-${card.id}`} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} gap={1}>
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={color} bold>
              {TYPE_LABEL[card.type].toUpperCase()} {card.type !== 'plan' ? card.id : ''}
            </Text>
            <Text dimColor>
              {status} · card {at + 1} of {n}
              {isPending ? ` · ${state === 'done' ? 'answered' : state === 'partial' ? 'started' : 'not answered yet'}` : ''}
            </Text>
          </Text>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text bold>{card.title}</Text>
            <Button key={`copy-card-${card.id}`} plain dimColor label="⧉ Copy" onPress={p => act.copy(cardText(walk, card, draft, vocab), p.surface)} />
          </Box>
        </Box>
        {content}
        {answer && (
          <Box flexDirection="column" gap={1}>
            {label(ui, 'Your answer', `ah-${card.id}`)}
            {answer}
          </Box>
        )}
        {response && (
          <Box flexDirection="column">
            {label(ui, 'Your response', `rh-${card.id}`)}
            {response}
          </Box>
        )}
      </Box>
      {chatBlock(ctx, card)}
      {isPending ? (
        view.isConfirming ? (
          <Box key="footer" flexDirection="column" gap={1}>
            <Text color="#FFA726">
              {n - answered} of {n} cards are not fully answered yet. Submit anyway?
            </Text>
            <Box flexDirection="row" gap={1}>
              <Button key="submit-anyway" variant="primary" label="Submit anyway" onPress={act.submit} />
              <Button key="keep-walking" label="Keep walking" onPress={() => act.confirm(false)} />
            </Box>
          </Box>
        ) : (
          <Box key="footer" flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
            <Button key="submit" variant={answered === n ? 'primary' : 'secondary'} label="Submit walk" onPress={() => (answered === n ? act.submit() : act.confirm(true))} />
            <Text dimColor>
              {answered} of {n} answered · saved as you go
            </Text>
          </Box>
        )
      ) : (
        <Box key="footer" flexDirection="column">
          <Text color="#66BB6A">✓ Submitted {when(open.submittedAt)} · outcome.md is beside the walk</Text>
          <Button key="resend" plain dimColor label="Send the outcome to Claude again" onPress={act.resend} />
        </Box>
      )}
    </Box>
  )
}
