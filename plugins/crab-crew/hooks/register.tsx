import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Captain, CrewMember, CrewPanel } from '../types'
import {
  BAND_H,
  FINISHED_H,
  HEADER_H,
  ROSTER_H,
  RUNNING_H,
  asciiLane,
  bandSvg,
  finishedSvg,
  headerSvg,
  rosterSvg,
  runningSvg,
} from './art'
import {
  CAPTAIN,
  CHEER_MS,
  ROSTER,
  actionOf,
  activityOf,
  captainQuip,
  characterKeyOf,
  characterOf,
  crewNameOf,
  crewProgress,
  crewSummary,
  crewTotals,
  detailOf,
  elapsed,
  fmtTime,
  fmtTokens,
  modelName,
  poseOf,
  progressLabel,
  progressOf,
  quipOf,
  statusOf,
  titleOf,
  todoPatch,
} from './crew'

const crew = atom({ plugin: 'crab-crew', key: 'crew' } as const, [])
const captain = atom({ plugin: 'crab-crew', key: 'captain' } as const, {
  isBusy: false,
  activity: 'other',
  detail: '',
  lastActiveAt: 0,
})
const panel = atom({ plugin: 'crab-crew', key: 'panel' } as const, {
  isDoneCollapsed: false,
  isRosterOpen: false,
  hasAutoOpened: false,
  bandSince: 0,
})
const now = atom({ plugin: 'crab-crew', key: 'now' } as const, 0)

const PANE = 'crab-crew'
const PANE_TITLE = 'Crab Crew'
const MAX_CREW = 60
const CLAY = '#D97757'
const STATUS_GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗', stopped: '■' }

/** The panel is decoration: nothing it does may break a tool call, a spawn or a turn. */
async function safely(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // Dropped: a missed update only costs a frame of the drawing.
  }
}

const touch = ($: EngineInterface, agentId: string, fn: (m: CrewMember) => CrewMember) =>
  update($, crew, list => list.map(m => (m.agentId === agentId ? fn(m) : m)))

const setCaptain = ($: EngineInterface, patch: Partial<Captain>) => update($, captain, c => ({ ...c, ...patch }))

async function openPane($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: PANE_TITLE })
}

// Opens the crew pane, or closes it when it is up; true when it ends up open.
async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  await openPane($)
  return true
}

/** Crew the band shows: started or finished after the person last moved on. */
const bandCrew = (list: readonly CrewMember[], p: CrewPanel): CrewMember[] =>
  list.filter(m => m.startedAt > p.bandSince || (m.endedAt ?? -1) > p.bandSince)

export const register: Register = (on, options) => {
  const autoOpen = options.autoOpen !== false
  const showQuips = options.showQuips !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'crew',
      description: 'Show or hide the Crab Crew: every subagent as a crab with a role, animated by its status and progress',
    })

    // Ticks the clocks and the animations' poses while anyone works or celebrates; quiet otherwise.
    $.clock.every(1000, () => {
      void safely(async () => {
        const list = await read($, crew)
        const at = await $.clock.now()
        const isLive = list.some(m => m.status === 'running' || (m.endedAt !== undefined && at - m.endedAt < CHEER_MS + 1000))
        if (isLive) await update($, now, () => at)
      })
    })
    return started
  })

  on('command.run', { command: 'crew' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? 'All hands on deck: the Crab Crew is up.' : 'Crab Crew stood down.' }
  })

  // A new subagent joins the crew, cast by its agent type.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started

    await safely(async () => {
      const at = await $.clock.now()
      const character = characterKeyOf(e.subagentType)
      await update($, crew, list => {
        const member: CrewMember = {
          id: started.agentId ?? e.tool_use_id,
          agentId: started.agentId,
          type: e.subagentType,
          character,
          name: crewNameOf(character, list),
          description: e.description,
          model: started.model,
          status: 'running',
          startedAt: at,
          lastActiveAt: at,
          activity: 'start',
          detail: '',
          toolCalls: 0,
          errors: 0,
          steps: 0,
          contextTokens: 0,
          tokens: 0,
        }
        return [...list.filter(m => m.id !== member.id), member].slice(-MAX_CREW)
      })
      await update($, now, () => at)
      if (!autoOpen) return
      const p = await read($, panel)
      if (p.hasAutoOpened) return
      await update($, panel, prev => ({ ...prev, hasAutoOpened: true }))
      await $.ui.open({ id: PANE, title: PANE_TITLE })
    })
    return started
  }).catch(($, e, next) => next(e))

  // Each model request: the crab (or the captain) is thinking; then its tokens.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    await safely(async () => {
      const at = await $.clock.now()
      if (agentId) {
        await touch($, agentId, m => ({
          ...m,
          status: 'running',
          endedAt: undefined,
          activity: 'think',
          detail: '',
          lastActiveAt: at,
          effort: typeof e.effort === 'string' ? e.effort : m.effort,
        }))
      } else {
        await setCaptain($, { isBusy: true, activity: 'think', detail: '', lastActiveAt: at })
      }
    })

    const result = yield* next(e)

    await safely(async () => {
      const usage = result.usage
      if (!agentId || !usage) return
      const sum =
        (usage.input_tokens || 0) +
        (usage.output_tokens || 0) +
        (usage.cache_read_input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0)
      await touch($, agentId, m => ({
        ...m,
        model: usage.model || m.model,
        contextTokens: sum,
        tokens: m.tokens + sum,
        steps: m.steps + 1,
      }))
    })
    return result
  })

  // Every tool call: what the crab is doing, its todos, and how its calls went.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const activity: Activity = activityOf(tool)
    const detail = detailOf(input)
    const agentId = e.agentId

    await safely(async () => {
      const at = await $.clock.now()
      if (agentId) {
        await touch($, agentId, m => ({
          ...m,
          activity,
          detail,
          lastActiveAt: at,
          toolCalls: m.toolCalls + 1,
          ...todoPatch(tool, input, m),
        }))
      } else {
        await setCaptain($, { isBusy: true, activity, detail, lastActiveAt: at })
      }
    })

    const result = await next(e)

    await safely(async () => {
      if (!agentId) return
      const at = await $.clock.now()
      await touch($, agentId, m => ({ ...m, lastActiveAt: at, errors: m.errors + (result.isError ? 1 : 0) }))
    })
    return result
  }).catch(($, e, next) => next(e))

  // A run ends: back aboard, overboard, or called back.
  on('turn.complete', async ($, e, next) => {
    await safely(async () => {
      const at = await $.clock.now()
      if (e.agentId) {
        const usage = e.usage
        await touch($, e.agentId as string, m => ({
          ...m,
          status: statusOf(e.reason),
          endedAt: at,
          lastActiveAt: at,
          ...(m.steps === 0 && usage
            ? {
                model: usage.model || m.model,
                tokens:
                  usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
              }
            : {}),
        }))
      } else {
        await setCaptain($, { isBusy: false, activity: 'other', detail: '', lastActiveAt: at })
      }
      await update($, now, () => at)
    })
    return next(e)
  })

  // A new prompt with nobody out: the band clears; the panel keeps the history.
  on('prompt.submit', async ($, e, next) => {
    await safely(async () => {
      const list = await read($, crew)
      if (list.some(m => m.status === 'running')) return
      const at = await $.clock.now()
      await update($, panel, p => ({ ...p, bandSince: at }))
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, crew)
    const c = await read($, captain)
    const p = await read($, panel)
    const at = Math.max(await read($, now), ...list.map(m => m.startedAt), 0)
    const tick = Math.floor(at / 1000)

    const running = list.filter(m => m.status === 'running').reverse()
    const finished = list.filter(m => m.status !== 'running').reverse()
    const isRosterShown = p.isRosterOpen || list.length === 0

    const toggleRoster = (
      <Button
        key="roster"
        label={p.isRosterOpen ? 'Hide roster' : 'Meet the crew'}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isRosterOpen: !prev.isRosterOpen }))}
      />
    )
    const toggleDone = (
      <Button
        key="done"
        label={`${p.isDoneCollapsed ? '▸' : '▾'} Back from duty · ${finished.length}`}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
      />
    )

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(260, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      return (
        <Box flexDirection="column">
          <Svg
            source={headerSvg(W, c, list, at)}
            alt={`${CAPTAIN.name}: ${captainQuip(c)}. ${crewSummary(list, at)}`}
            width={W}
            height={HEADER_H}
          />
          {list.length > 0 && toggleRoster}
          {running.length > 0 && <Text dimColor>At work · {running.length}</Text>}
          {running.map(m => (
            <Svg
              key={m.id}
              source={runningSvg(W, m, at, showQuips)}
              alt={`${titleOf(m)}: ${m.description}. ${actionOf(m, at)}, ${progressLabel(m)}`}
              width={W}
              height={RUNNING_H}
            />
          ))}
          {finished.length > 0 && toggleDone}
          {!p.isDoneCollapsed &&
            finished.map(m => (
              <Svg
                key={m.id}
                source={finishedSvg(W, m, at, showQuips)}
                alt={`${titleOf(m)}: ${m.description}. ${actionOf(m, at)}`}
                width={W}
                height={FINISHED_H}
              />
            ))}
          {isRosterShown && <Text dimColor>{list.length ? 'The roster' : 'No crew out yet. Meet the roster:'}</Text>}
          {isRosterShown &&
            ROSTER.map(r => (
              <Svg
                key={`roster-${r.character.key}`}
                source={rosterSvg(W, r.character, r.types)}
                alt={`${r.character.role} (${r.types}): ${r.character.trait}`}
                width={W}
                height={ROSTER_H}
              />
            ))}
        </Box>
      )
    }

    // Terminal and the other text surfaces: the same crew in text, ASCII crabs on their lanes.
    const cols = Math.max(28, e.props.bodyColumns || 40)
    const row = (m: CrewMember) => {
      const ch = characterOf(m.character)
      const pose = poseOf(m, at)
      const lane = asciiLane(pose, tick, progressOf(m).value, Math.min(cols - 2, 48))
      const isRunning = m.status === 'running'
      return (
        <Box key={m.id} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={ch.color} bold wrap="truncate-end">
              {titleOf(m)}
            </Text>
            <Text dimColor wrap="truncate-end">
              {m.description || m.type}
            </Text>
            <Text color={m.status === 'failed' ? 'red' : m.status === 'done' ? 'green' : ch.color}>{STATUS_GLYPH[m.status]}</Text>
          </Box>
          {isRunning ? (
            <Text wrap="truncate-end">
              <Text dimColor>{lane.before}</Text>
              <Text color={CLAY}>{lane.crab}</Text>
              <Text color={ch.color}>{lane.after}</Text>
            </Text>
          ) : (
            <Text wrap="truncate-end">
              <Text color={CLAY}>{lane.crab}</Text>
            </Text>
          )}
          {showQuips && (
            <Text italic dimColor wrap="truncate-end">
              {'  “'}
              {quipOf(m, at)}
              {'”'}
            </Text>
          )}
          <Text dimColor wrap="truncate-end">
            {'  '}
            {[modelName(m.model), actionOf(m, at), progressLabel(m), `${m.toolCalls} tools`, m.tokens ? `${fmtTokens(m.tokens)} tok` : '', fmtTime(elapsed(m, at))]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Box>
      )
    }

    const t = crewTotals(list, at)
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color={CLAY}>{c.isBusy ? '(\\/)(°,,°)(\\/)' : '(\\/)(-,,-)(\\/) z'}</Text>{' '}
          <Text bold color={CAPTAIN.color}>
            {CAPTAIN.name}
          </Text>
          <Text dimColor> · {captainQuip(c)}</Text>
        </Text>
        <Text dimColor wrap="truncate-end">
          {list.length ? `${crewSummary(list, at)} · ${fmtTokens(t.tokens)} tok · ${fmtTime(t.time)}` : 'No crew dispatched yet.'}
        </Text>
        {list.length > 0 && toggleRoster}
        <Box flexDirection="column" marginTop={1}>
          {running.length > 0 && <Text dimColor>At work · {running.length}</Text>}
          {running.map(row)}
          {finished.length > 0 && toggleDone}
          {!p.isDoneCollapsed && finished.map(row)}
          {isRosterShown && <Text dimColor>{list.length ? 'The roster' : 'Meet the roster:'}</Text>}
          {isRosterShown &&
            ROSTER.map(r => (
              <Text key={`roster-${r.character.key}`} wrap="truncate-end">
                <Text color={r.character.color} bold>
                  {r.character.role}
                </Text>
                <Text dimColor>
                  {' '}
                  ({r.types}) {r.character.trait}
                </Text>
              </Text>
            ))}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await read($, crew)
    const p = await read($, panel)
    const shown = bandCrew(list, p)
    if (shown.length === 0) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const at = Math.max(await read($, now), ...shown.map(m => m.startedAt))
    const progress = crewProgress(shown)
    const crewButton = <Button key="crab-crew-open" label={`Crew ×${shown.length}`} plain onPress={() => void togglePane($)} />
    const dismiss = (
      <Button
        key="crab-crew-dismiss"
        label="✕"
        plain
        role="dismiss"
        onPress={async () => {
          const t = await $.clock.now()
          await update($, panel, prev => ({ ...prev, bandSince: t }))
        }}
      />
    )

    if ('Svg' in ui) {
      const { Svg } = ui
      const width = Math.max(200, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 120))
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg source={bandSvg(width, shown, at, progress)} alt={`Crab Crew: ${crewSummary(shown, at)}`} width={width} height={BAND_H} />
          {crewButton}
          {dismiss}
        </Box>
      )
    }

    const running = shown.filter(m => m.status === 'running')
    const lead = running[0]
    const tick = Math.floor(at / 1000)
    const crabFace = running.length ? (tick % 2 ? '(\\|)(°,,°)(|/)' : '(\\/)(°,,°)(\\/)') : '\\(^,,^)/'
    const barW = Math.max(6, Math.min(20, e.props.bodyColumns - 60))
    const filled = Math.round(barW * progress)
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={CLAY}>{crabFace}</Text>
        <Text wrap="truncate-end">
          {lead ? `${titleOf(lead)}: ${quipOf(lead, at)}` : 'All back aboard'}
          <Text dimColor> · {crewSummary(shown, at)}</Text>
        </Text>
        <Text color={running.length ? CLAY : 'green'}>{'█'.repeat(filled) + '░'.repeat(Math.max(0, barW - filled))}</Text>
        {crewButton}
        {dismiss}
      </Box>
    )
  })
}
