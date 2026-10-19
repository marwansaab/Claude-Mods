// The pane's drawing: the list of reviews and one review's cards, for the desktop and the terminal.
// Layout, top to bottom: where you are (back, title, progress), which card (stepper and arrows),
// the card itself in a frame (what it says, your answer, questions about it), then submitting.
import type { Elements, RenderElement } from 'claude-code'

import type { Ask, Card, CardType, Claim, DeskView, OpenPack, PackSummary, Response } from '../types'
import { TYPE_LABEL, cardOutcome, cardState, cardText, partKey, rowIsOn } from './pack'
import type { CardState } from './pack'
import { bubbleSvg, markdownSvg, thinkingSvg } from './mdsvg'
import { deskHeaderSvg, ringSvg, sceneSvg, sceneText, stepperSvg } from './scenes'

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
  /** Says yes or no to one plan row. */
  decideRow: (cardId: string, rowId: string, isOn: boolean) => void
  setPlanView: (cardId: string, mode: 'list' | 'one') => void
  type: (key: string, text: string) => void
  commit: (key: string, text: string) => void
  toggleSummary: () => void
  showAllAsks: () => void
  submit: () => void
  confirm: (isOn: boolean) => void
  resend: () => void
  /** Puts text on the clipboard of the surface the press came from. */
  copy: (text: string, surface: string) => void
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
  /** Draw text blocks as interactive SVG, whose text the desktop lets you select and copy. */
  selectable: boolean
}

const GLYPH: Record<CardState, string> = { done: '●', partial: '◐', open: '○' }
/** One colour per card type, mid-tones that read on light and dark. */
const TYPE_COLOR: Record<CardType, string> = {
  question: '#9575CD',
  decision: '#42A5F5',
  finding: '#FFA726',
  plan: '#EC407A',
  explainer: '#26A69A',
  read: '#8D8B85',
}
/** A plan row's action, by its verb: create green, change blue, amend violet, remove red. */
export function actionColor(action: string): string {
  const v = action.trim().toLowerCase()
  if (/^(create|add|new|write)/.test(v)) return '#66BB6A'
  if (/^(amend|supersede)/.test(v)) return '#9575CD'
  if (/^(delete|remove|drop|archive)/.test(v)) return '#EF5350'
  if (/^(move|rename)/.test(v)) return '#FFA726'
  return '#42A5F5'
}

const SEVERITY_COLOR: Record<string, string> = { high: '#EF5350', medium: '#FFA726', low: '#8D8B85' }
const when = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '')
const bar = (done: number, total: number, width = 10) => {
  const n = total ? Math.round((done / total) * width) : 0
  return '▰'.repeat(n) + '▱'.repeat(width - n)
}

/** How text blocks are drawn in the current drawing, by its element table (one per render). */
const drawing = new WeakMap<object, { width: number; isSvg: boolean }>()
const drawText = (ctx: Ctx) => drawing.set(ctx.ui, { width: Math.max(240, ctx.width - 40), isSvg: ctx.selectable && ctx.isDesktop && 'Svg' in ctx.ui })

const LINK = /\[[^\]]+\]\([^)\s]+\)|https?:\/\/\S+/g

/**
 * Whether a block is mostly links (a source list, evidence): those stay the surface's own Markdown,
 * so the links open; the Copy button copies them. Ordinary text with a link or two is drawn
 * selectable, each link followed by its address in brackets.
 */
export function isLinkHeavy(text: string): boolean {
  const links = text.match(LINK) ?? []
  if (links.length >= 3) return true
  const linked = links.reduce((n, l) => n + l.length, 0)
  return links.length > 0 && linked / Math.max(1, text.length) > 0.4
}

/**
 * A block of Markdown. On the desktop it is drawn as SVG text, which can be selected and copied,
 * unless its links must stay clickable (`links: 'open'`, or a block that is mostly links).
 */
const md = (ui: UI, text: string | undefined, key?: string, dim?: boolean, links?: 'open', size?: number): RenderElement | null => {
  if (!text?.trim()) return null
  const how = drawing.get(ui)
  if (how?.isSvg && 'Svg' in ui && links !== 'open' && !isLinkHeavy(text)) {
    const d = markdownSvg(text, how.width, !!dim, size)
    return <ui.Svg key={key} source={d.svg} alt={d.alt} width={how.width} height={d.height} isInteractive />
  }
  const { Markdown } = ui
  return <Markdown key={key} text={text} dimColor={dim} />
}

/** A small capitalised heading inside a card: what this part of it is. */
const label = (ui: UI, text: string, key: string) => {
  const { Text } = ui
  return (
    <Text key={key} bold dimColor>
      {text.toUpperCase()}
    </Text>
  )
}

/** A text field where the surface has one; otherwise nothing (the mobile app draws no fields yet). */
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

// ---------- the list ----------

export function homeView(ctx: Ctx): RenderElement {
  drawText(ctx)
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
    const isDone = p.status === 'reviewed'
    const progress = isDone ? `✓ submitted ${when(p.submittedAt)}` : `${bar(p.answered, p.cards)}  ${p.answered} of ${p.cards} answered`
    const kinds = p.types.map(t => TYPE_LABEL[t].toLowerCase()).join(', ')
    return (
      <Box key={`row-${p.status}-${p.id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        <Button key={`open-${p.status}-${p.id}`} plain onPress={() => act.openPack(p.status, p.id)}>
          {p.title}
          <Text dimColor> ›</Text>
        </Button>
        <Text color={isDone ? '#66BB6A' : undefined} dimColor={!isDone} wrap="truncate-end">
          {progress}
        </Text>
        <Text dimColor wrap="truncate-end">
          {[p.label, kinds, isDone ? '' : `published ${when(p.createdAt)}`].filter(Boolean).join(' · ')}
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {header}
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <Button key="tab-pending" variant={view.tab === 'pending' ? 'primary' : 'secondary'} label={`Waiting · ${pending.length}`} onPress={() => act.tab('pending')} />
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
        Saved in {ctx.folder}/{view.tab === 'pending' ? 'pending' : 'reviewed'}/
      </Text>
    </Box>
  )
}

// ---------- one review: the card's parts ----------

function evidence(ui: UI, ids: string[] | undefined, claims: Claim[] | undefined, key: string): RenderElement | null {
  const list = [...new Set(ids ?? [])].map(id => claims?.find(c => c.id === id)).filter((c): c is Claim => !!c)
  if (!list.length) return null
  const { Box } = ui
  const text = list
    .map(c => {
      const grade = c.grade ? `**${c.id} · ${c.grade}**` : `**${c.id} · ungraded**`
      const src = c.url ? ` [${c.source ?? 'source'}](${c.url})` : c.source ? ` _${c.source}_` : ''
      return `- ${grade} ${c.text}${src}${c.checked ? `, checked ${c.checked}` : ''}`
    })
    .join('\n')
  return (
    <Box key={key} flexDirection="column">
      {label(ui, 'Evidence', `${key}-h`)}
      {md(ui, text, `${key}-b`, true, 'open')}
    </Box>
  )
}

/** A list of choices, one per line; the one picked is filled. */
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

/** A row of verb buttons (Approve, Reject…); the one picked is the primary button. */
function verbs(ctx: Ctx, cardId: string, picked: string | undefined, list: { id: string; label: string }[]): RenderElement {
  const { Box, Button } = ctx.ui
  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
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

/** Steps or sections inside a card: back, the tick, forward. */
function partNav(ctx: Ctx, card: Card, at: number, count: number, noun: string, isDone: boolean, doneLabel: string): RenderElement {
  const { Box, Button } = ctx.ui
  const key = partKey(card.id, card.type === 'explainer' ? card.steps[at]?.id ?? `step-${at + 1}` : card.type === 'read' ? card.sections[at]?.id ?? '' : '')
  const isLast = at >= count - 1
  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      <Button key={`part-prev-${card.id}`} plain dimColor={at === 0} label={`‹ ${noun}`} onPress={() => ctx.act.goPart(card.id, Math.max(0, at - 1))} />
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
      <Button key={`part-next-${card.id}`} plain dimColor={isLast} label={`${noun} ›`} onPress={() => ctx.act.goPart(card.id, Math.min(count - 1, at + 1))} />
    </Box>
  )
}

/** What the card says, and the controls to answer it: two blocks, each with its own heading. */
function cardParts(ctx: Ctx, card: Card): { content: RenderElement; answer: RenderElement | null } {
  const { ui, open, view } = ctx
  const { Box, Text, Button } = ui
  const pack = open!.pack
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
        content: col(`c-${card.id}`, md(ui, card.prompt, `q-${card.id}`), md(ui, card.context, `qc-${card.id}`, true), evidence(ui, card.claims, pack.claims, `qe-${card.id}`)),
        answer: isPending
          ? col(
              `a-${card.id}`,
              card.options &&
                choices(ctx, card.id, r?.choice, [
                  ...card.options.map(o => ({ id: o.id, label: o.label, detail: o.description, isTip: o.id === card.recommended })),
                  ...(card.allowOther !== false ? [{ id: 'other', label: 'Something else' }] : []),
                ]),
              field(
                ctx,
                `t:${card.id}`,
                card.options && r?.choice !== 'other' ? 'Comment' : 'Answer',
                r?.text,
                card.options && r?.choice !== 'other' ? 'optional' : 'type your answer, Enter to save',
              ),
            )
          : null,
      }
    case 'decision':
      return {
        content: col(
          `c-${card.id}`,
          md(ui, card.proposal, `d-${card.id}`),
          md(ui, card.rationale ? `**Why:** ${card.rationale}` : '', `dr-${card.id}`),
          md(ui, card.alternatives?.length ? `**Considered, not chosen**\n\n${card.alternatives.map(a => `- ${a.label}${a.reason ? ` — ${a.reason}` : ''}`).join('\n')}` : '', `da-${card.id}`),
          md(ui, card.consequences ? `**What follows:** ${card.consequences}` : '', `dc-${card.id}`, true),
          evidence(ui, card.claims, pack.claims, `de-${card.id}`),
        ),
        answer: isPending
          ? col(
              `a-${card.id}`,
              verbs(ctx, card.id, r?.choice, [
                { id: 'approve', label: 'Approve' },
                { id: 'amend', label: 'Approve with changes' },
                { id: 'reject', label: 'Reject' },
              ]),
              field(ctx, `t:${card.id}`, r?.choice === 'amend' ? 'Changes' : 'Comment', r?.text, r?.choice === 'amend' ? 'what to change' : 'optional'),
            )
          : null,
      }
    case 'finding':
      return {
        content: col(
          `c-${card.id}`,
          <Text key={`fm-${card.id}`} wrap="truncate-end">
            {card.severity ? (
              <Text color={SEVERITY_COLOR[card.severity]} bold>
                {card.severity.toUpperCase()}
              </Text>
            ) : (
              ''
            )}
            <Text dimColor>
              {[card.severity ? '' : undefined, card.kind === 'drift' ? 'differs from the record' : card.kind === 'review' ? 'reviewer judgement' : '', card.where]
                .filter(x => x !== undefined && x !== '')
                .map(x => `  ·  ${x}`)
                .join('')}
            </Text>
          </Text>,
          md(ui, card.quote ? `> ${card.quote.replace(/\n/g, '\n> ')}` : '', `fq-${card.id}`),
          md(ui, card.body, `fb-${card.id}`),
          md(ui, card.suggestion ? `**Suggested change:** ${card.suggestion}` : '', `fs-${card.id}`),
          md(ui, card.evidence ? `**The record says**${card.evidence.ref ? ` (${card.evidence.ref})` : ''}\n\n> ${card.evidence.quote}` : '', `fe-${card.id}`, true),
          evidence(ui, card.claims, pack.claims, `fc-${card.id}`),
        ),
        answer: isPending
          ? col(
              `a-${card.id}`,
              verbs(ctx, card.id, r?.choice, [
                { id: 'accept', label: 'Accept' },
                { id: 'reject', label: 'Reject' },
                { id: 'discuss', label: 'Discuss' },
              ]),
              field(ctx, `t:${card.id}`, 'Reply', r?.text, 'optional'),
            )
          : null,
      }
    case 'plan': {
      const n = card.rows.length
      const on = card.rows.filter(row => rowIsOn(r, row.id)).length
      const mode = view.planView?.[card.id] ?? (n > 5 ? 'one' : 'list')
      const note = (rowId: string) => draft.responses[partKey(card.id, rowId)]?.text?.trim()
      const rows = (
        <Box key={`pr-${card.id}`} flexDirection="column">
          {card.rows.map(row => {
            const isOn = rowIsOn(r, row.id) && (isPending || r?.choice !== 'cancel')
            const inner = [
              isOn ? '☑  ' : '☐  ',
              <Text bold>{row.action}</Text>,
              ` ${row.target}`,
              row.summary ? <Text dimColor> · {row.summary}</Text> : '',
            ]
            const comment = note(row.id)
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
      const switcher = (
        <Box key={`pv-${card.id}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <Button key={`plan-list-${card.id}`} variant={mode === 'list' ? 'primary' : 'secondary'} label="☰ List" onPress={() => ctx.act.setPlanView(card.id, 'list')} />
          <Button key={`plan-one-${card.id}`} variant={mode === 'one' ? 'primary' : 'secondary'} label="▣ One at a time" onPress={() => ctx.act.setPlanView(card.id, 'one')} />
          <Text dimColor>
            {on} yes · {n - on} no
          </Text>
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
          const color = actionColor(row.action)
          oneRow = (
            <Box key={`one-${card.id}`} flexDirection="column" gap={1}>
              <Box flexDirection="column" gap={1} borderStyle="round" borderColor={color} paddingX={1}>
                <Text>
                  <Text backgroundColor={color} color="#000000" bold>
                    {` ${row.action.toUpperCase()} `}
                  </Text>
                  <Text dimColor>
                    {'  '}
                    row {at + 1} of {n} · {isOn ? 'yes' : 'no'}
                  </Text>
                </Text>
                {md(ui, `**${row.target}**`, `rt-${card.id}-${row.id}`, false, undefined, 17)}
                {md(ui, row.summary, `rs-${card.id}-${row.id}`, false, undefined, 16)}
                <Box flexDirection="row" gap={1}>
                  <Button key={`row-yes-${card.id}-${row.id}`} variant={isOn ? 'primary' : 'secondary'} label={isOn ? '✓ Yes' : 'Yes'} onPress={() => decide(true)} />
                  <Button key={`row-no-${card.id}-${row.id}`} variant={isOn ? 'secondary' : 'primary'} label={isOn ? 'No' : '✗ No'} onPress={() => decide(false)} />
                </Box>
                {field(ctx, `t:${partKey(card.id, row.id)}`, 'Comment', draft.responses[partKey(card.id, row.id)]?.text, 'on this row, optional')}
              </Box>
              <Box flexDirection="row" gap={1}>
                <Button key={`row-prev-${card.id}`} plain dimColor={at === 0} label="‹ Previous row" onPress={() => ctx.act.goPart(card.id, Math.max(0, at - 1))} />
                <Button key={`row-next-${card.id}`} plain dimColor={isLast} label="Next row ›" onPress={() => ctx.act.goPart(card.id, Math.min(n - 1, at + 1))} />
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
              switcher,
              mode === 'one' ? oneRow : <Text key={`ph-${card.id}`} dimColor>Untick any row you do not want, then choose.</Text>,
              mode === 'one' ? null : rows,
              verbs(ctx, card.id, r?.choice, [
                { id: 'go', label: on === n ? 'Go ahead with all' : `Go ahead with ${on} of ${n}` },
                { id: 'cancel', label: 'Cancel: write nothing' },
              ]),
              field(ctx, `t:${card.id}`, 'Comment', r?.text, 'on the whole plan, optional'),
            )
          : null,
      }
    }
    case 'explainer': {
      const n = card.steps.length
      const at = Math.min(view.part[card.id] ?? 0, n - 1)
      const step = card.steps[at]
      if (!step) return { content: <Text dimColor>This explainer has no steps.</Text>, answer: null }
      const key = partKey(card.id, step.id ?? `step-${at + 1}`)
      const sr = draft.responses[key]
      let scene: RenderElement | null = null
      if (step.scene) {
        if (ctx.isDesktop && 'Svg' in ui) {
          const { Svg } = ui
          const w = Math.max(240, ctx.width - 40)
          const d = sceneSvg(w, step.scene, pack.claims)
          scene = <Svg key={`scene-${card.id}-${at}`} source={d.svg} alt={d.alt} width={w} height={d.height} isInteractive />
        } else {
          scene = (
            <Box key={`scene-${card.id}-${at}`} flexDirection="column">
              {sceneText(step.scene).map((l, i) => (
                <Text key={`scene-${card.id}-${at}-${i}`}>{l}</Text>
              ))}
            </Box>
          )
        }
      }
      const sceneClaims =
        step.scene && step.scene.kind === 'matrix'
          ? step.scene.dots.map(d => d.claim)
          : step.scene && 'items' in step.scene
            ? (step.scene.items as { claim?: string }[]).map(i => i.claim)
            : []
      return {
        content: col(
          `c-${card.id}`,
          at === 0 && md(ui, card.intro, `ei-${card.id}`, true),
          <Text key={`eh-${card.id}`}>
            <Text dimColor>
              Step {at + 1} of {n} ·{' '}
            </Text>
            <Text bold>{step.title}</Text>
          </Text>,
          scene,
          md(ui, step.caption, `ec-${card.id}-${at}`),
          evidence(ui, [...(step.claims ?? []), ...sceneClaims.filter((c): c is string => !!c)], pack.claims, `el-${card.id}-${at}`),
          partNav(ctx, card, at, n, 'Step', !!sr?.isDone, 'Got it'),
        ),
        answer: isPending ? field(ctx, `t:${key}`, 'Note on this step', sr?.text, 'optional') : null,
      }
    }
    case 'read': {
      const n = card.sections.length
      const at = Math.min(view.part[card.id] ?? 0, n - 1)
      const s = card.sections[at]
      if (!s) return { content: <Text dimColor>This read-through has no sections.</Text>, answer: null }
      const key = partKey(card.id, s.id)
      const sr = draft.responses[key]
      const jump =
        n > 1 && 'Select' in ui ? (
          <ui.Select
            key={`jump-${card.id}`}
            label="Section"
            value={String(at)}
            options={card.sections.map((x, i) => ({ value: String(i), label: `${i + 1}. ${x.title}${draft.responses[partKey(card.id, x.id)]?.isDone ? '  ✓' : ''}` }))}
            onSelect={v => ctx.act.goPart(card.id, Number(v))}
          />
        ) : null
      return {
        content: col(
          `c-${card.id}`,
          at === 0 && md(ui, card.intro, `ri-${card.id}`, true),
          jump,
          <Text key={`rh-${card.id}`}>
            <Text dimColor>
              Section {at + 1} of {n} ·{' '}
            </Text>
            <Text bold>{s.title}</Text>
          </Text>,
          md(ui, (s.flags ?? []).map(f => `> **Your call:** ${f}`).join('\n\n'), `rf-${card.id}-${at}`),
          md(ui, s.body, `rb-${card.id}-${at}`),
          partNav(ctx, card, at, n, 'Section', !!sr?.isDone, 'Reviewed'),
        ),
        answer: isPending ? field(ctx, `t:${key}`, 'Note on this section', sr?.text, 'optional') : null,
      }
    }
  }
}

/** Questions belong to the card they were asked on (older ones are matched by the card's title). */
export const asksOf = (asks: Ask[], card: Card) => asks.filter(a => (a.card ? a.card === card.id : a.about === card.title || a.about?.startsWith(`${card.title}: `)))

const clock = (iso: string) => iso.slice(11, 16)

/** One question as a bubble on the right, as Claude Desktop draws what you sent. */
function questionBubble(ctx: Ctx, a: Ask): RenderElement {
  const { ui } = ctx
  const { Box, Text } = ui
  if (ctx.isDesktop && 'Svg' in ui) {
    const d = bubbleSvg(a.question, Math.max(200, Math.round((ctx.width - 40) * 0.8)))
    return (
      <Box key={`q-${a.id}`} flexDirection="row" justifyContent="flex-end">
        <ui.Svg source={d.svg} alt={d.alt} width={d.width} height={d.height} isInteractive />
      </Box>
    )
  }
  return (
    <Box key={`q-${a.id}`} flexDirection="row" justifyContent="flex-end">
      <Text inverse> {a.question} </Text>
    </Box>
  )
}

/** Claude's reply as plain text on the left, its sources under it, a quiet Copy beside them. */
function reply(ctx: Ctx, a: Ask): RenderElement {
  const { ui, act } = ctx
  const { Box, Text, Button } = ui
  if (!a.answer) {
    const dots = ctx.isDesktop && 'Svg' in ui ? thinkingSvg() : undefined
    return (
      <Box key={`r-${a.id}`} flexDirection="row" gap={1} alignItems="center">
        {dots && 'Svg' in ui ? <ui.Svg source={dots.svg} alt={dots.alt} width={dots.width} height={dots.height} isInteractive /> : <Text color="#D97757">●●●</Text>}
        <Text dimColor italic>
          Claude is looking into it…
        </Text>
      </Box>
    )
  }
  const sources = (a.sources ?? []).map(x => `- ${x.url ? `[${x.title}](${x.url})` : x.title}`).join('\n')
  return (
    <Box key={`r-${a.id}`} flexDirection="column" gap={1}>
      {md(ui, a.answer, `ans-${a.id}`, !!a.isError)}
      {sources && md(ui, `**Sources**\n\n${sources}`, `src-${a.id}`, true, 'open')}
      <Box flexDirection="row" gap={1}>
        <Button key={`copy-ask-${a.id}`} plain dimColor label="⧉ Copy" onPress={p => act.copy(askText(a), p.surface)} />
        <Text dimColor>{clock(a.answeredAt ?? a.at)}</Text>
      </Box>
    </Box>
  )
}

/** One question and its answer as plain Markdown, for the clipboard. */
export function askText(a: Ask): string {
  const lines = [`**Q:** ${a.question}`, '', `**A:** ${a.answer ?? ''}`]
  if (a.sources?.length) lines.push('', 'Sources:', ...a.sources.map(x => `- ${x.url ? `${x.title}: ${x.url}` : x.title}`))
  return lines.join('\n')
}

/**
 * A conversation with Claude about the card, under it: your questions on the right, Claude's answers
 * on the left, and a composer at the bottom. Every question goes to Claude in the session, which can
 * search the web and read the project, and the answer comes back here.
 */
function chatBlock(ctx: Ctx, card: Card): RenderElement {
  const { ui, open, view, act } = ctx
  const { Box, Text, Button } = ui
  const asks = asksOf(open!.draft.asks, card)
  const shown = view.showAllAsks ? asks : asks.slice(-4)
  return (
    <Box key={`chat-${card.id}`} flexDirection="column" gap={1} marginTop={1}>
      <Text>
        <Text color="#D97757" bold>
          ✻{' '}
        </Text>
        <Text bold>Ask Claude about this card</Text>
      </Text>
      {asks.length === 0 && <Text dimColor>Claude can search the web and read your project. The answer appears here.</Text>}
      {asks.length > shown.length && <Button key={`ask-all-${card.id}`} plain dimColor label={`Show ${asks.length - shown.length} earlier`} onPress={act.showAllAsks} />}
      {shown.flatMap(a => [questionBubble(ctx, a), reply(ctx, a)])}
      {'Input' in ui && (
        <Box key={`composer-${card.id}`} flexDirection="column" alignItems="stretch" width="100%" borderStyle="round" borderDimColor paddingX={1}>
          {/* The field takes no width of its own: it is stretched across the composer. */}
          <Box flexDirection="column" alignItems="stretch" width="100%">
            {/* Keyed by the count asked: each question asked draws a fresh, empty field. */}
            {/* The field's own button (and Enter) sends: one way to send, as in Claude Desktop. */}
            {field(ctx, `ask:${card.id}#${asks.length}`, '', '', 'Ask Claude about this card…', '↑')}
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ---------- one review ----------

export function packView(ctx: Ctx): RenderElement {
  drawText(ctx)
  const { ui, open, view, act } = ctx
  const { Box, Text, Button } = ui
  if (!open) {
    return (
      <Box flexDirection="column" gap={1}>
        <Button key="back" plain dimColor label="‹ All reviews" onPress={act.closePack} />
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
  const isDesktop = ctx.isDesktop && 'Svg' in ui

  // 1. Where you are.
  const meta = [pack.label, isPending ? `published ${when(pack.createdAt)}` : `submitted ${when(open.submittedAt)}`, pack.origin].filter(Boolean).join(' · ')
  let ring: RenderElement | null = null
  if (isDesktop && 'Svg' in ui) {
    const d = ringSvg(answered, n)
    ring = <ui.Svg key={`ring-${answered}`} source={d.svg} alt={d.alt} width={d.height} height={d.height} />
  }
  const top = (
    <Box key="top" flexDirection="column">
      <Button key="back" plain dimColor label="‹ All reviews" onPress={act.closePack} />
      <Box flexDirection="row" gap={1} alignItems="center">
        {ring}
        <Box flexDirection="column" flexShrink={1}>
          <Text bold>{pack.title}</Text>
          <Text dimColor wrap="truncate-end">
            {isDesktop ? meta : `${answered} of ${n} answered · ${meta}`}
          </Text>
        </Box>
      </Box>
    </Box>
  )

  const sources = pack.sources?.length
    ? `\n\n**Mirrors:** ${pack.sources.map(s => [s.id, s.title, s.path ? `\`${s.path}\`` : '', s.updated ? `(updated ${s.updated})` : ''].filter(Boolean).join(' ')).join('; ')}`
    : ''
  const about =
    pack.summary || sources ? (
      <Box key="about" flexDirection="column">
        <Button key="about" plain dimColor={!view.isSummaryOpen} label={`${view.isSummaryOpen ? '▾' : '▸'} About this review`} onPress={act.toggleSummary} />
        {view.isSummaryOpen && <Box paddingLeft={2}>{md(ui, `${pack.summary ?? ''}${sources}`, 'summary')}</Box>}
      </Box>
    ) : null

  // 2. Which card.
  let stepper: RenderElement
  if (isDesktop && 'Svg' in ui) {
    const d = stepperSvg(ctx.width, states, at)
    stepper = <ui.Svg key={`stepper-${at}-${answered}`} source={d.svg} alt={d.alt} width={ctx.width} height={d.height} />
  } else {
    stepper = <Text wrap="truncate-end">{states.map((s, i) => (i === at ? `[${GLYPH[s]}]` : GLYPH[s])).join(' ')}</Text>
  }
  const jump =
    n > 1 && 'Select' in ui ? (
      <ui.Select
        key="jump-card"
        value={String(at)}
        options={pack.cards.map((c, i) => ({ value: String(i), label: `${i + 1}. ${c.title}` }))}
        onSelect={v => act.goCard(Number(v))}
      />
    ) : null
  const nav = (
    <Box key="nav" flexDirection="column">
      {stepper}
      <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <Button key="card-prev" label="‹ Previous" dimColor={at === 0} onPress={() => act.goCard(Math.max(0, at - 1))} />
        {/* The list takes every column the two buttons leave. */}
        <Box flexGrow={1} flexShrink={1} flexDirection="column">
          {jump}
        </Box>
        <Button key="card-next" label="Next ›" variant={at < n - 1 ? 'primary' : 'secondary'} dimColor={at >= n - 1} onPress={() => act.goCard(Math.min(n - 1, at + 1))} />
      </Box>
    </Box>
  )

  // 3. The card, framed: what it says, your answer, questions about it.
  const { content, answer } = cardParts(ctx, card)
  const color = TYPE_COLOR[card.type]
  const state = states[at] ?? 'open'
  const response = !isPending ? md(ui, cardOutcome(card, draft).join('\n'), `outcome-${card.id}`) : null
  const framed = (
    <Box key={`card-${card.id}`} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} gap={1}>
      <Box flexDirection="column">
        <Text>
          <Text color={color} bold>
            {TYPE_LABEL[card.type].toUpperCase()}
          </Text>
          <Text dimColor>
            {'  '}
            {card.id} · card {at + 1} of {n}
            {isPending ? ` · ${state === 'done' ? 'answered' : state === 'partial' ? 'started' : 'not answered yet'}` : ''}
          </Text>
        </Text>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text bold>{card.title}</Text>
          <Button key={`copy-card-${card.id}`} plain dimColor label="⧉ Copy" onPress={p => act.copy(cardText(pack, card, draft), p.surface)} />
        </Box>
      </Box>
      {content}
      {answer && (
        <Box flexDirection="column" gap={1}>
          {label(ui, card.type === 'explainer' || card.type === 'read' ? 'Your note' : 'Your answer', `ah-${card.id}`)}
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
  )

  // 4. Submitting.
  const footer = isPending ? (
    view.isConfirming ? (
      <Box key="footer" flexDirection="column" gap={1}>
        <Text color="#FFA726">
          {n - answered} of {n} cards are not fully answered yet. Submit anyway?
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="submit-anyway" variant="primary" label="Submit anyway" onPress={act.submit} />
          <Button key="keep-reviewing" label="Keep reviewing" onPress={() => act.confirm(false)} />
        </Box>
      </Box>
    ) : (
      <Box key="footer" flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <Button key="submit" variant={answered === n ? 'primary' : 'secondary'} label="Submit review" onPress={() => (answered === n ? act.submit() : act.confirm(true))} />
        <Text dimColor>
          {answered} of {n} answered · saved as you go
        </Text>
      </Box>
    )
  ) : (
    <Box key="footer" flexDirection="column">
      <Text color="#66BB6A">✓ Submitted {when(open.submittedAt)} · outcome.md is beside the pack</Text>
      <Button key="resend" plain dimColor label="Send the outcome to Claude again" onPress={act.resend} />
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {top}
      {about}
      {nav}
      {framed}
      {chatBlock(ctx, card)}
      {footer}
    </Box>
  )
}
