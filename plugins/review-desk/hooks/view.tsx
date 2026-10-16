// The pane's drawing: the list of reviews and one review's cards, for the desktop and the terminal.
import type { Elements, RenderElement } from 'claude-code'

import type { Card, Claim, DeskView, OpenPack, PackSummary, Response } from '../types'
import { TYPE_LABEL, cardOutcome, cardState, partKey, rowIsOn } from './pack'
import type { CardState } from './pack'
import { deskHeaderSvg, sceneSvg, sceneText, stripSvg } from './scenes'

type UI = Elements['terminal'] | Elements['desktop'] | Elements['vscode'] | Elements['mobile']

/** What the pane's controls do; every one saves what it changes. */
export type Actions = {
  tab: (tab: DeskView['tab']) => void
  refresh: () => void
  openPack: (status: DeskView['tab'], id: string) => void
  closePack: () => void
  goCard: (n: number) => void
  goPart: (cardId: string, n: number) => void
  respond: (key: string, patch: Partial<Response>) => void
  toggleRow: (cardId: string, rowId: string) => void
  type: (key: string, text: string) => void
  commit: (key: string, text: string) => void
  toggleSummary: () => void
  ask: (question: string, via: 'quick' | 'session') => void
  askTyped: (via: 'quick' | 'session') => void
  showAllAsks: () => void
  submit: () => void
  confirm: (isOn: boolean) => void
  resend: () => void
}

export type Ctx = {
  ui: UI
  isDesktop: boolean
  width: number
  packs: PackSummary[]
  view: DeskView
  open: OpenPack | null
  act: Actions
  folder: string
}

const GLYPH: Record<CardState, string> = { done: '●', partial: '◐', open: '○' }
const SEVERITY_COLOR: Record<string, string> = { high: 'red', medium: 'yellow', low: 'gray' }
const when = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '')

const md = (ui: UI, text: string | undefined, key?: string, dim?: boolean): RenderElement | null => {
  const { Markdown } = ui
  return text?.trim() ? <Markdown key={key} text={text} dimColor={dim} /> : null
}

/** A text field where the surface has one; otherwise nothing (the mobile app draws no fields yet). */
function field(ctx: Ctx, key: string, label: string, value: string | undefined, placeholder?: string, submitLabel = 'save'): RenderElement | null {
  const ui = ctx.ui
  if (!('Input' in ui)) return null
  const { Input } = ui
  return (
    <Input
      key={key}
      label={label}
      value={value ?? ''}
      placeholder={placeholder}
      submitLabel={submitLabel}
      onInput={v => ctx.act.type(key, v)}
      onSubmit={v => ctx.act.commit(key, v)}
    />
  )
}

// ---------- the list ----------

export function homeView(ctx: Ctx): RenderElement {
  const { ui, packs, view, act } = ctx
  const { Box, Text, Button } = ui
  const pending = packs.filter(p => p.status === 'pending')
  const reviewed = packs.filter(p => p.status === 'reviewed')
  const shown = view.tab === 'pending' ? pending : reviewed
  const answered = pending.reduce((n, p) => n + p.answered, 0)
  const cards = pending.reduce((n, p) => n + p.cards, 0)

  let header: RenderElement
  if (ctx.isDesktop && 'Svg' in ui) {
    const { Svg } = ui
    const d = deskHeaderSvg(ctx.width, pending.length, reviewed.length, answered, cards)
    header = <Svg key="desk-header" source={d.svg} alt={d.alt} width={ctx.width} height={d.height} />
  } else {
    header = (
      <Box flexDirection="column">
        <Text bold>Review desk</Text>
        <Text dimColor>
          {pending.length ? `${pending.length} waiting for you` : 'Nothing waiting'} · {reviewed.length} reviewed
        </Text>
      </Box>
    )
  }

  const row = (p: PackSummary) => {
    const meta =
      p.status === 'pending'
        ? [p.label, `${p.answered} of ${p.cards} answered`, when(p.createdAt)]
        : [p.label, `submitted ${when(p.submittedAt)}`, `${p.answered} of ${p.cards} answered`]
    return (
      <Box key={`row-${p.status}-${p.id}`} flexDirection="column" marginBottom={1}>
        <Button key={`open-${p.status}-${p.id}`} plain onPress={() => act.openPack(p.status, p.id)}>
          {p.status === 'pending' ? (p.answered === p.cards ? '● ' : p.answered ? '◐ ' : '○ ') : '✓ '}
          {p.title}
        </Button>
        <Text dimColor wrap="truncate-end">
          {'   '}
          {meta.filter(Boolean).join(' · ')}
          {p.types.length ? ` · ${p.types.map(t => TYPE_LABEL[t].toLowerCase()).join(', ')}` : ''}
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {header}
      <Box flexDirection="row" gap={1} marginTop={1} marginBottom={1} flexWrap="wrap">
        <Button key="tab-pending" variant={view.tab === 'pending' ? 'primary' : 'secondary'} label={`Pending · ${pending.length}`} onPress={() => act.tab('pending')} />
        <Button key="tab-reviewed" variant={view.tab === 'reviewed' ? 'primary' : 'secondary'} label={`Reviewed · ${reviewed.length}`} onPress={() => act.tab('reviewed')} />
        <Button key="refresh" plain dimColor label="↻ Refresh" onPress={act.refresh} />
      </Box>
      {shown.length === 0 && (
        <Text dimColor>
          {view.tab === 'pending'
            ? 'Nothing is waiting for review. Ask Claude to put something up, for example: "put the open questions up for review" or "send this write plan to the review desk".'
            : 'No reviews submitted yet.'}
        </Text>
      )}
      {shown.map(row)}
      <Text dimColor wrap="truncate-end">
        Saved in {ctx.folder}/{view.tab}/
      </Text>
    </Box>
  )
}

// ---------- one review ----------

function claimLines(ids: string[] | undefined, claims: Claim[] | undefined): string {
  const list = (ids ?? []).map(id => claims?.find(c => c.id === id)).filter((c): c is Claim => !!c)
  if (!list.length) return ''
  return list
    .map(c => {
      const grade = c.grade ? ` (${c.grade})` : ' (ungraded)'
      const src = c.url ? ` [${c.source ?? 'source'}](${c.url})` : c.source ? ` ${c.source}` : ''
      return `- **${c.id}**${grade} ${c.text}${src}${c.checked ? `, checked ${c.checked}` : ''}`
    })
    .join('\n')
}

/** A row of choice buttons; the one picked is marked. */
function choices(ctx: Ctx, cardId: string, picked: string | undefined, list: { id: string; label: string; detail?: string }[]): RenderElement {
  const { Box, Button, Text } = ctx.ui
  return (
    <Box flexDirection="column" marginTop={1}>
      {list.map(o => (
        <Button key={`choice-${cardId}-${o.id}`} plain onPress={() => ctx.act.respond(cardId, { choice: picked === o.id ? undefined : o.id })}>
          {picked === o.id ? '◉ ' : '○ '}
          {o.label}
          {o.detail ? <Text dimColor> {o.detail}</Text> : ''}
        </Button>
      ))}
    </Box>
  )
}

function verbs(ctx: Ctx, cardId: string, picked: string | undefined, list: { id: string; label: string }[]): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
      {list.map(v => (
        <Button
          key={`verb-${cardId}-${v.id}`}
          variant={picked === v.id ? 'primary' : 'secondary'}
          label={`${picked === v.id ? '✓ ' : ''}${v.label}`}
          onPress={() => ctx.act.respond(cardId, { choice: picked === v.id ? undefined : v.id })}
        />
      ))}
    </Box>
  )
}

function partNav(ctx: Ctx, card: Card, at: number, count: number, noun: string, isDone: boolean, doneLabel: string): RenderElement {
  const { Box, Button } = ctx.ui
  const key = partKey(card.id, card.type === 'explainer' ? card.steps[at]?.id ?? `step-${at + 1}` : card.type === 'read' ? card.sections[at]?.id ?? '' : '')
  const isLast = at >= count - 1
  return (
    <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
      <Button key={`part-prev-${card.id}`} label={`‹ ${noun}`} dimColor={at === 0} onPress={() => ctx.act.goPart(card.id, Math.max(0, at - 1))} />
      {ctx.open?.status === 'pending' && (
        <Button
          key={`part-done-${card.id}`}
          variant={isDone ? 'secondary' : 'primary'}
          label={isDone ? `✓ ${doneLabel}` : `${doneLabel}${isLast ? '' : ', next ›'}`}
          onPress={() => {
            ctx.act.respond(key, { isDone: !isDone })
            if (!isDone && !isLast) ctx.act.goPart(card.id, at + 1)
          }}
        />
      )}
      <Button key={`part-next-${card.id}`} label={`${noun} ›`} dimColor={isLast} onPress={() => ctx.act.goPart(card.id, Math.min(count - 1, at + 1))} />
    </Box>
  )
}

function cardBody(ctx: Ctx, card: Card): RenderElement {
  const { ui, open, view } = ctx
  const { Box, Text } = ui
  const pack = open!.pack
  const draft = open!.draft
  const r = draft.responses[card.id]
  const isPending = open!.status === 'pending'

  switch (card.type) {
    case 'question':
      return (
        <Box flexDirection="column">
          {md(ui, card.prompt, `q-${card.id}`)}
          {md(ui, card.context, `qc-${card.id}`, true)}
          {md(ui, claimLines(card.claims, pack.claims), `qe-${card.id}`, true)}
          {isPending &&
            card.options &&
            choices(ctx, card.id, r?.choice, [
              ...card.options.map(o => ({ id: o.id, label: o.label + (o.id === card.recommended ? '  · recommended' : ''), detail: o.description })),
              ...(card.allowOther !== false ? [{ id: 'other', label: 'Something else (write it below)' }] : []),
            ])}
          {isPending &&
            field(ctx, `t:${card.id}`, card.options && r?.choice !== 'other' ? 'Comment' : 'Your answer', r?.text, card.options ? 'optional' : 'type your answer, Enter to save')}
        </Box>
      )
    case 'decision':
      return (
        <Box flexDirection="column">
          {md(ui, card.proposal, `d-${card.id}`)}
          {md(ui, card.rationale ? `**Why:** ${card.rationale}` : '', `dr-${card.id}`)}
          {md(ui, card.alternatives?.length ? `**Considered and not chosen**\n\n${card.alternatives.map(a => `- ${a.label}${a.reason ? `: ${a.reason}` : ''}`).join('\n')}` : '', `da-${card.id}`)}
          {md(ui, card.consequences ? `**What follows:** ${card.consequences}` : '', `dc-${card.id}`)}
          {md(ui, claimLines(card.claims, pack.claims), `de-${card.id}`, true)}
          {isPending &&
            verbs(ctx, card.id, r?.choice, [
              { id: 'approve', label: 'Approve' },
              { id: 'amend', label: 'Approve with changes' },
              { id: 'reject', label: 'Reject' },
            ])}
          {isPending && field(ctx, `t:${card.id}`, r?.choice === 'amend' ? 'Changes' : 'Comment', r?.text, r?.choice === 'amend' ? 'what to change' : 'optional')}
        </Box>
      )
    case 'finding':
      return (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            {card.severity && <Text color={SEVERITY_COLOR[card.severity]} bold>{card.severity.toUpperCase()} </Text>}
            <Text dimColor>
              {[card.kind === 'drift' ? 'differs from the record' : card.kind === 'review' ? 'reviewer judgement' : '', card.where].filter(Boolean).join(' · ')}
            </Text>
          </Text>
          {md(ui, card.quote ? `> ${card.quote.replace(/\n/g, '\n> ')}` : '', `fq-${card.id}`)}
          {md(ui, card.body, `fb-${card.id}`)}
          {md(ui, card.suggestion ? `**Suggested change:** ${card.suggestion}` : '', `fs-${card.id}`)}
          {md(ui, card.evidence ? `**The record says**${card.evidence.ref ? ` (${card.evidence.ref})` : ''}:\n\n> ${card.evidence.quote}` : '', `fe-${card.id}`)}
          {md(ui, claimLines(card.claims, pack.claims), `fc-${card.id}`, true)}
          {isPending &&
            verbs(ctx, card.id, r?.choice, [
              { id: 'accept', label: 'Accept' },
              { id: 'reject', label: 'Reject' },
              { id: 'discuss', label: 'Discuss' },
            ])}
          {isPending && field(ctx, `t:${card.id}`, 'Reply', r?.text, 'optional')}
        </Box>
      )
    case 'plan': {
      const { Button } = ui
      const on = card.rows.filter(row => rowIsOn(r, row.id)).length
      return (
        <Box flexDirection="column">
          {md(ui, card.intro, `pi-${card.id}`)}
          <Box flexDirection="column" marginTop={1}>
            {card.rows.map(row =>
              isPending ? (
                <Button key={`row-${card.id}-${row.id}`} plain onPress={() => ctx.act.toggleRow(card.id, row.id)}>
                  {rowIsOn(r, row.id) ? '☑ ' : '☐ '}
                  <Text bold>{row.action}</Text> {row.target}
                  {row.summary ? <Text dimColor> · {row.summary}</Text> : ''}
                </Button>
              ) : (
                <Text key={`row-${card.id}-${row.id}`}>
                  {rowIsOn(r, row.id) && r?.choice !== 'cancel' ? '☑ ' : '☐ '}
                  <Text bold>{row.action}</Text> {row.target}
                  {row.summary ? <Text dimColor> · {row.summary}</Text> : ''}
                </Text>
              ),
            )}
          </Box>
          {isPending &&
            verbs(ctx, card.id, r?.choice, [
              { id: 'go', label: on === card.rows.length ? 'Go ahead with all' : `Go ahead with ${on} of ${card.rows.length}` },
              { id: 'cancel', label: 'Cancel: write nothing' },
            ])}
          {isPending && field(ctx, `t:${card.id}`, 'Comment', r?.text, 'edits to the plan, optional')}
        </Box>
      )
    }
    case 'explainer': {
      const n = card.steps.length
      const at = Math.min(view.part[card.id] ?? 0, n - 1)
      const step = card.steps[at]
      if (!step) return <Text dimColor>This explainer has no steps.</Text>
      const key = partKey(card.id, step.id ?? `step-${at + 1}`)
      const sr = draft.responses[key]
      let scene: RenderElement | null = null
      if (step.scene) {
        if (ctx.isDesktop && 'Svg' in ui) {
          const { Svg } = ui
          const d = sceneSvg(ctx.width, step.scene, pack.claims)
          scene = <Svg key={`scene-${card.id}-${at}`} source={d.svg} alt={d.alt} width={ctx.width} height={d.height} isInteractive />
        } else {
          scene = (
            <Box flexDirection="column" marginTop={1} marginBottom={1}>
              {sceneText(step.scene).map((l, i) => (
                <Text key={`scene-${card.id}-${at}-${i}`}>{l}</Text>
              ))}
            </Box>
          )
        }
      }
      return (
        <Box flexDirection="column">
          {at === 0 && md(ui, card.intro, `ei-${card.id}`, true)}
          <Text bold>
            Step {at + 1} of {n}: {step.title}
          </Text>
          {scene}
          {md(ui, step.caption, `ec-${card.id}-${at}`)}
          {md(ui, claimLines([...(step.claims ?? []), ...((step.scene && 'items' in step.scene ? (step.scene.items as { claim?: string }[]) : step.scene?.kind === 'matrix' ? step.scene.dots : []).map(i => i.claim).filter((c): c is string => !!c))].filter((c, i, a) => a.indexOf(c) === i), pack.claims), `el-${card.id}-${at}`, true)}
          {partNav(ctx, card, at, n, 'Step', !!sr?.isDone, 'Got it')}
          {isPending && field(ctx, `t:${key}`, 'Note on this step', sr?.text, 'optional')}
        </Box>
      )
    }
    case 'read': {
      const n = card.sections.length
      const at = Math.min(view.part[card.id] ?? 0, n - 1)
      const s = card.sections[at]
      if (!s) return <Text dimColor>This read-through has no sections.</Text>
      const key = partKey(card.id, s.id)
      const sr = draft.responses[key]
      const jump =
        n > 1 && 'Select' in ui ? (
          <ui.Select
            key={`jump-${card.id}`}
            label="Section"
            value={String(at)}
            options={card.sections.map((x, i) => ({ value: String(i), label: `${draft.responses[partKey(card.id, x.id)]?.isDone ? '✓' : '·'} ${i + 1}. ${x.title}` }))}
            onSelect={v => ctx.act.goPart(card.id, Number(v))}
          />
        ) : null
      return (
        <Box flexDirection="column">
          {at === 0 && md(ui, card.intro, `ri-${card.id}`, true)}
          {jump}
          <Text bold>
            {at + 1} of {n}: {s.title}
          </Text>
          {md(ui, (s.flags ?? []).map(f => `> **Your call:** ${f}`).join('\n\n'), `rf-${card.id}-${at}`)}
          {md(ui, s.body, `rb-${card.id}-${at}`)}
          {partNav(ctx, card, at, n, 'Section', !!sr?.isDone, 'Reviewed')}
          {isPending && field(ctx, `t:${key}`, 'Note on this section', sr?.text, 'optional')}
        </Box>
      )
    }
  }
}

function asksView(ctx: Ctx): RenderElement | null {
  const { ui, open, view, act } = ctx
  const { Box, Text, Button } = ui
  if (!open) return null
  const asks = [...open.draft.asks].reverse()
  const shown = view.showAllAsks ? asks : asks.slice(0, 3)
  const canType = 'Input' in ui
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Ask about this review</Text>
      {canType && field(ctx, 'ask', '?', '', 'a question about this card, Enter for a quick answer', 'ask')}
      {canType && (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="ask-quick" plain dimColor label="Quick answer" onPress={() => act.askTyped('quick')} />
          <Button key="ask-session" plain dimColor label="Ask Claude in the session" onPress={() => act.askTyped('session')} />
        </Box>
      )}
      {view.isAsking && <Text dimColor italic>Thinking…</Text>}
      {shown.map(a =>
        md(
          ui,
          `**You${a.about ? ` (${a.about})` : ''}:** ${a.question}\n\n${a.via === 'session' ? '_Sent to the session: Claude answers in the conversation._' : a.answer ? (a.isError ? `_${a.answer}_` : a.answer) : '_…_'}`,
          `ask-${a.id}`,
        ),
      )}
      {asks.length > shown.length && <Button key="ask-all" plain dimColor label={`Show all ${asks.length} questions`} onPress={act.showAllAsks} />}
    </Box>
  )
}

export function packView(ctx: Ctx): RenderElement {
  const { ui, open, view, act } = ctx
  const { Box, Text, Button } = ui
  if (!open) {
    return (
      <Box flexDirection="column">
        <Button key="back" plain label="‹ All reviews" onPress={act.closePack} />
        <Text dimColor>This review could not be read. It may have been moved or edited by hand.</Text>
      </Box>
    )
  }
  const { pack, draft } = open
  const n = pack.cards.length
  const at = Math.min(view.card, n - 1)
  const card = pack.cards[at]
  if (!card) return <Text dimColor>This review has no cards.</Text>
  const states = pack.cards.map(c => cardState(c, draft))
  const answered = states.filter(s => s === 'done').length
  const isPending = open.status === 'pending'

  let strip: RenderElement
  if (ctx.isDesktop && 'Svg' in ui) {
    const { Svg } = ui
    const d = stripSvg(ctx.width, states, at)
    strip = <Svg key={`strip-${at}-${answered}`} source={d.svg} alt={d.alt} width={ctx.width} height={d.height} />
  } else {
    strip = (
      <Text wrap="truncate-end">
        {states.map((s, i) => (i === at ? `[${GLYPH[s]}]` : GLYPH[s])).join(' ')}
      </Text>
    )
  }

  const jump =
    n > 1 && 'Select' in ui ? (
      <ui.Select
        key="jump-card"
        label="Card"
        value={String(at)}
        options={pack.cards.map((c, i) => ({ value: String(i), label: `${GLYPH[states[i] ?? 'open']} ${i + 1}. ${c.title}` }))}
        onSelect={v => act.goCard(Number(v))}
      />
    ) : null

  const sources = pack.sources?.length
    ? `\n\n**Mirrors:** ${pack.sources.map(s => [s.id, s.title, s.path ? `\`${s.path}\`` : '', s.updated ? `(updated ${s.updated})` : ''].filter(Boolean).join(' ')).join('; ')}`
    : ''

  const submitRow = isPending ? (
    view.isConfirming ? (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow">
          {n - answered} of {n} cards have no full response yet. Submit anyway?
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="submit-anyway" variant="primary" label="Submit anyway" onPress={act.submit} />
          <Button key="keep-reviewing" label="Keep reviewing" onPress={() => act.confirm(false)} />
        </Box>
      </Box>
    ) : (
      <Box flexDirection="row" gap={1} marginTop={1} alignItems="center">
        <Button key="submit" variant={answered === n ? 'primary' : 'secondary'} label="Submit review" onPress={() => (answered === n ? act.submit() : act.confirm(true))} />
        <Text dimColor>
          {answered} of {n} answered · saved as you go
        </Text>
      </Box>
    )
  ) : (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>Submitted {when(open.submittedAt)}. The outcome is in outcome.md beside the pack.</Text>
      <Button key="resend" plain label="Send the outcome to Claude again" onPress={act.resend} />
    </Box>
  )

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Button key="back" plain label="‹ All reviews" onPress={act.closePack} />
      </Box>
      <Text bold>{pack.title}</Text>
      <Text dimColor wrap="truncate-end">
        {[pack.label, isPending ? 'pending' : 'reviewed', `published ${when(pack.createdAt)}`, pack.origin].filter(Boolean).join(' · ')}
      </Text>
      {(pack.summary || sources) && (
        <Button key="about" plain dimColor label={`${view.isSummaryOpen ? '▾' : '▸'} About this review`} onPress={act.toggleSummary} />
      )}
      {view.isSummaryOpen && md(ui, `${pack.summary ?? ''}${sources}`, 'summary')}
      {strip}
      {jump}
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text color="magenta" bold>
            {TYPE_LABEL[card.type]}
          </Text>
          <Text dimColor> · {card.id} · {at + 1} of {n}</Text>
        </Text>
        <Text bold>{card.title}</Text>
        {cardBody(ctx, card)}
        {!isPending && md(ui, `**Your response**\n\n${cardOutcome(card, draft).join('\n')}`, `outcome-${card.id}`)}
      </Box>
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Button key="card-prev" label="‹ Previous" dimColor={at === 0} onPress={() => act.goCard(Math.max(0, at - 1))} />
        <Button key="card-next" label="Next ›" dimColor={at >= n - 1} onPress={() => act.goCard(Math.min(n - 1, at + 1))} />
      </Box>
      {asksView(ctx)}
      {submitRow}
    </Box>
  )
}
