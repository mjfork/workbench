import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fill, Kind, PaneReport, Snapshot, TurnRecord } from '../types'
import { cells, fmt, KINDS, measurer } from './measure'

/** The Claude config folder, as Claude Code itself reads it from CLAUDE_CONFIG_DIR. Unset, it is ~/.claude, where Claude Code keeps it. */
const claudeDir = async ($: EngineInterface) => {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir) return dir
  const home = await $.env.get('HOME')
  if (!home) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set')
  return `${home}/.claude`
}


const snapshot = atom({ plugin: 'ctx-bar', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'ctx-bar', key: 'isHidden' } as const, false)
// What the pane report carries: the last measured fill, the last turns, and
// the session's cost when the last turn ended (to price the next one).
const fill = atom({ plugin: 'ctx-bar', key: 'fill' } as const, null)
const turns = atom({ plugin: 'ctx-bar', key: 'turns' } as const, [])
const lastUsd = atom({ plugin: 'ctx-bar', key: 'lastUsd' } as const, null)
// The footer's turn price: the session's cost when the person's input started
// the turn, and what it has grown by since (live while the turn runs).
const turnStartUsd = atom({ plugin: 'ctx-bar', key: 'turnStartUsd' } as const, null)
const turnCost = atom({ plugin: 'ctx-bar', key: 'turnCost' } as const, null)
const TURNS_KEPT = 10
const WIDTH = 20
// Width of the "132k/1000k" text after the bar, padded on the left so the
// bar keeps its column as the numbers grow.
const TAIL_COLS = 12

const COLOR: Record<Kind, string> = {
  fixed: 'gray',
  chat: 'white',
  Bash: 'red',
  Read: 'yellow',
  Agent: 'magenta',
  mcp: 'cyan',
  edit: 'green',
  other: 'blue',
}

const NAME: Record<Kind, string> = {
  fixed: 'fixed',
  chat: 'chat',
  Bash: 'Bash',
  Read: 'Read',
  Agent: 'Agent',
  mcp: 'MCP',
  edit: 'edits',
  other: 'other tools',
}

let pending: { cancel: () => void } | null = null
// Measures only the messages added since the last refresh; a reload starts it over.
const measure = measurer()

async function refresh($: EngineInterface) {
  const [messages, usage] = await Promise.all([
    $.session.messages(),
    $.session.usage({ breakdown: 'summary' }),
  ])
  const { context } = usage
  const used = context.tokens ?? context.breakdown?.totalTokens ?? 0
  const window = context.breakdown?.rawMaxTokens ?? context.window
  const snap: Snapshot = measure(messages, used, window, context.breakdown?.categories)
  await update($, snapshot, () => snap)
  await priceTurn($, usage.cost?.usd, true)
}

/** The turn's cost so far from the session total; `isLive` false once it has ended. */
async function priceTurn($: EngineInterface, total: number | undefined, isLive: boolean) {
  const start = await read($, turnStartUsd)
  if (start === null || total === undefined) return
  const now = await read($, turnCost)
  if (isLive && now !== null && !now.isLive) return
  await update($, turnCost, () => ({ usd: Math.max(0, total - start), isLive }))
}

// Coalesce bursts of tool calls into one refresh.
function schedule($: EngineInterface) {
  pending?.cancel()
  pending = $.clock.after(1500, () => {
    pending = null
    refresh($).catch(() => {})
  })
}

// Every herdr session writes its context fill here, one file per pane, so
// another session (ctx-heavy) can rank them without reading transcripts.

export type HerdrPane = { pane: string; workspace: string }

/** This session's herdr pane, or null outside herdr. */
export async function herdrPane($: EngineInterface): Promise<HerdrPane | null> {
  if ((await $.env.get('HERDR_ENV')) !== '1') return null
  const pane = await $.env.get('HERDR_PANE_ID')
  const workspace = await $.env.get('HERDR_WORKSPACE_ID')
  if (!pane || !workspace) return null

  return { pane, workspace }
}

/** Writes this pane's fill; `isEnded` marks a session that has ended. */
/** Writes this pane's report; `isEnded` marks a session that has ended. */
export async function writeReport($: EngineInterface, where: HerdrPane, isEnded = false): Promise<void> {
  const usage = await $.session.usage()
  const now = await read($, fill)
  const report: PaneReport = {
    ...where,
    tokens: now?.tokens ?? 0,
    window: now?.window ?? usage.context.window,
    at: await $.clock.now(),
    isEnded,
    startedAt: usage.startedAt,
    usd: usage.cost?.usd ?? 0,
    turns: await read($, turns),
  }
  await $.fs.write(`${await claudeDir($)}/ctx/${where.pane}.json`, JSON.stringify(report))
}

export const register: Register = on => {
  // This session's herdr pane, where its context reports go; null outside herdr.
  let here: HerdrPane | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ctxbar', description: 'Context breakdown by kind and the biggest chunks; /ctxbar toggle hides the footer bar' })
    const result = await next(e)
    schedule($)
    here = await herdrPane($)
    if (here !== null) {
      // Report at once, so a session that sits idle is listed too. Until the
      // live window's first response there is no measured fill: estimate it as
      // /context does.
      const usage = await $.session.usage({ breakdown: 'summary' })
      const tokens = usage.context.tokens ?? usage.context.breakdown?.totalTokens
      if (tokens !== undefined) await update($, fill, () => ({ tokens, window: usage.context.window }))
      if ((await read($, lastUsd)) === null) await update($, lastUsd, () => usage.cost?.usd ?? null)
      await writeReport($, here).catch(() => {})
    }

    return result
  })

  // Claude Code's own measurement, after each turn: report the fill when it moved.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    const tokens = e.context.tokens
    if (here !== null && e.changed.includes('context') && tokens !== undefined) {
      await update($, fill, () => ({ tokens, window: e.context.window }))
      await writeReport($, here).catch(() => {})
    }

    return result
  })

  // Ended (exit, /clear, /resume): the next measurement reports the pane again.
  on('session.end', async ($, e, next) => {
    if (here !== null) await writeReport($, here, true).catch(() => {})

    return next(e)
  })

  on('command.run', { command: 'ctxbar' }, async ($, e, next) => {
    if (e.args.trim() === 'toggle') {
      const hidden = await update($, isHidden, v => !v)

      return { text: hidden ? 'Context bar hidden.' : 'Context bar shown.' }
    }

    await refresh($)
    const snap = await read($, snapshot)
    if (snap === null) return { text: 'No measurement yet.' }

    return { text: report(snap) }
  })

  // The person's input starts a turn: price it from here.
  on('turn.start', async ($, e, next) => {
    const usd = (await $.session.usage()).cost?.usd
    await update($, turnStartUsd, () => usd ?? null)
    await update($, turnCost, () => (usd === undefined ? null : { usd: 0, isLive: true }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) schedule($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    await refresh($)
    await priceTurn($, (await $.session.usage()).cost?.usd, false)
    if (here !== null) {
      // The turn's price is what the session's cost grew by since the last
      // turn ended, its subagents included; null when that is unknown.
      const usage = await $.session.usage()
      const total = usage.cost?.usd ?? null
      const before = await read($, lastUsd)
      const u = e.usage
      const turn: TurnRecord = {
        at: await $.clock.now(),
        durationMs: e.durationMs,
        usd: total !== null && before !== null ? Math.max(0, total - before) : null,
        inputTokens: u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0,
        outputTokens: u?.output_tokens ?? 0,
        model: u?.model ?? null,
        reason: e.reason,
      }
      await update($, turns, list => [...list, turn].slice(-TURNS_KEPT))
      await update($, lastUsd, () => total)
      await writeReport($, here).catch(() => {})
    }

    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute') schedule($)

    return result
  })

  // The right-hand block of the footer, the mode labels' site. herdr-jump draws
  // its line there and ctx-heavy stacks the heaviest sessions under it; this
  // mod runs ahead of both (it lists ctx-heavy under dependencies) and stacks
  // the bar under theirs. Each segment joins a hover group whose card sits in
  // the band above the prompt: a card drawn in the footer would be clipped.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const theirs = await next(e)
    const snap = await read($, snapshot)
    if (snap === null || (await read($, isHidden))) return theirs

    const { Box, Text } = $.ui.resolve(e)
    const n = cells(snap, WIDTH)
    const usedCells = KINDS.reduce((s, k) => s + n[k], 0)
    const free = Math.max(0, WIDTH - usedCells)
    const tail = ` ${fmt(snap.used)}/${fmt(snap.window)}`.padStart(TAIL_COLS)
    // Left of the bar, so the bar keeps its column as the price grows.
    const cost = await read($, turnCost)

    const segments = KINDS.filter(k => n[k] > 0).map(k => ({ kind: k, width: n[k] }))
    // Cells from each segment's right edge to the line's end, so every
    // floating card ends where the line does.
    const after = segments.map((_, i) => segments.slice(i + 1).reduce((w, seg) => w + seg.width, 0) + free + tail.length)
    const isFloating = e.viewport?.isFullscreen === true

    return (
      <Box flexDirection="column" alignItems="flex-end" flexShrink={0}>
        {theirs}
        <Box flexShrink={0}>
          {cost !== null && (
            <Text key="turn-cost" dimColor={cost.isLive}>{`${cost.isLive ? '…' : ''}${usd(cost.usd)} `}</Text>
          )}
          {segments.map((seg, i) => (
            <Box key={`seg-${seg.kind}`} hover={{ scope: scopeOf(seg.kind) }}>
              <Text color={COLOR[seg.kind]}>{'█'.repeat(seg.width)}</Text>
              {/* Fullscreen: the card floats over the rows above the bar;
                  elsewhere the band draws it. */}
              {isFloating && (
                <Box position="absolute" bottom={1} right={-(after[i] ?? 0)} display="none" hover={{ display: 'flex' }}>
                  <Text color={COLOR[seg.kind]} inverse>{cardText(snap, seg.kind)}</Text>
                </Box>
              )}
            </Box>
          ))}
          <Text dimColor>{'░'.repeat(free)}{tail}</Text>
        </Box>
      </Box>
    )
  })

  // The hover cards: hidden until a footer segment of the same group is
  // hovered, right-aligned like the bar in the footer.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Off fullscreen, where a floating card would be clipped to the footer row,
    // the cards live here. The band is shared: keep what later mods draw.
    const theirs = await next(e)
    const snap = await read($, snapshot)
    const isFloating = e.viewport?.isFullscreen === true
    if (e.props.hasSurvey || snap === null || isFloating || (await read($, isHidden))) return theirs

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box width={e.props.bodyColumns} justifyContent="flex-end">
          {KINDS.filter(k => snap.tokens[k] > 0).map(k => (
            <Box key={`card-${k}`} display="none" hover={{ scope: scopeOf(k), display: 'flex' }}>
              <Text color={COLOR[k]} inverse wrap="truncate-end">{cardText(snap, k)}</Text>
            </Box>
          ))}
        </Box>
        {theirs}
      </Box>
    )
  })
}

const scopeOf = (k: Kind) => `ctx-bar-${k}`

/** A turn's price: cents under $10, then dimes. */
const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(1)}`

const CARD_MAX = 90

/** One line: the kind's share, then its biggest results. */
function cardText(snap: Snapshot, k: Kind): string {
  const share = Math.round((snap.tokens[k] / Math.max(1, snap.used)) * 100)
  const head = k === 'fixed'
    ? `fixed ${fmt(snap.tokens[k])} (${share}%): system prompt, tools, skills, memory`
    : `${NAME[k]} ${fmt(snap.tokens[k])} (${share}%)`
  const chunks = (snap.byKind?.[k] ?? []).map(c => `${fmt(c.tokens)} ${c.label || c.tool}`)
  const text = ` ${[head, ...chunks].join(' · ')} `

  return text.length > CARD_MAX ? `${text.slice(0, CARD_MAX - 2)}… ` : text
}

function report(snap: Snapshot): string {
  const percent = Math.round((snap.used / snap.window) * 100)
  const rows = KINDS.filter(k => snap.tokens[k] > 0)
    .sort((a, b) => snap.tokens[b] - snap.tokens[a])
    .map(k => `  ${NAME[k].padEnd(12)}${fmt(snap.tokens[k]).padStart(6)}`)
  const top = snap.largest.map(c => `  ${c.tool.padEnd(12)}${fmt(c.tokens).padStart(6)}  ${c.label}`)

  return [
    `Context ${fmt(snap.used)}/${fmt(snap.window)} (${percent}%)`,
    ...rows,
    '',
    'Biggest tool results:',
    ...top,
  ].join('\n')
}
