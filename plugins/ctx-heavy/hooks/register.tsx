import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Heavy, PaneReport } from '../types'

/** The Claude config folder, as Claude Code itself reads it from CLAUDE_CONFIG_DIR. Unset, it is ~/.claude, where Claude Code keeps it. */
const claudeDir = async ($: EngineInterface) => {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir) return dir
  const home = await $.env.get('HOME')
  if (!home) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set')
  return `${home}/.claude`
}


const heavy = atom({ plugin: 'ctx-heavy', key: 'heavy' } as const, [])
// The minute the cards were last drawn for: moved once a minute while rows show, so their ages stay current between
// changes to the rows without a redraw on every poll.
const tick = atom({ plugin: 'ctx-heavy', key: 'tick' } as const, 0)

// Each herdr session's ctx-bar writes its context fill here, one file per pane.
// A report older than this belongs to a session that died without ending. ctx-bar writes only when a session starts,
// measures, finishes a turn or ends, so a live session left idle keeps an old file: the window stays a day.
const STALE_MS = 24 * 60 * 60 * 1000
const HEAVY_COUNT = 4
// One session reads the reports and writes the top rows to a summary every other session reads instead. The summary is
// also the lease: it names the session that wrote it and when, the holder rewrites it on each poll, and another
// session takes over once it is HEAVY_LEASE_MS old (three polls missed).
const HEAVY_POLL_MS = 10_000
const HEAVY_LEASE_MS = 3 * HEAVY_POLL_MS
const TICK_MS = 60_000
// A session starts asleep and polls only while the person is at it: dozens of idle sessions each waking every ten
// seconds keep all their memory touched, so none can stay swapped out. Input wakes a session (a keystroke in the
// prompt box stands for its pane taking focus, which the engine does not report); this long with none puts it back to
// sleep. Asleep, it renews no lease: once every session sleeps the summary goes stale, and the first to wake takes it.
const IDLE_MS = 10 * 60_000

export const fmt = (tokens: number): string =>
  tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : `${tokens}`

/** Red over 500k, yellow over 300k, white otherwise. */
export const heat = (tokens: number) => (tokens > 500_000 ? 'red' : tokens > 300_000 ? 'yellow' : 'white')

/** The heaviest sessions, however many share a workspace; each is shown by its full pane ID. */
export function topSessions(rows: readonly Heavy[], count = HEAVY_COUNT): Heavy[] {
  return [...rows].sort((a, b) => b.tokens - a.tokens).slice(0, count)
}

const TURNS_SHOWN = 5

/** 42s, 3m05s, 2h10m. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

const usd = (n: number | null | undefined) => (n === null || n === undefined ? '$?' : `$${n.toFixed(2)}`)

/** The hover card: the session's fill, cost and age, then its last turns, newest first. */
/**
 * The rows that can be drawn: each with a pane and its report. Rows come from the shared summary file, or from saved
 * state that outlives a code update (0.4.1 kept a built card, not the report), so neither is trusted as is.
 */
export function drawable(rows: unknown): Heavy[] {
  return Array.isArray(rows) ? (rows as Heavy[]).filter(row => typeof row?.pane === 'string' && typeof row.report === 'object' && row.report !== null) : []
}

export function cardOf(report: PaneReport, now: number): string[] {
  const percent = report.window > 0 ? ` (${Math.round((report.tokens / report.window) * 100)}%)` : ''
  const age = report.startedAt === undefined ? '' : `  up ${span(now - report.startedAt)}`
  const head = `${report.pane}  ${fmt(report.tokens)}/${fmt(report.window)}${percent}  ${usd(report.usd)} total${age}`
  const turns = [...(report.turns ?? [])].reverse().slice(0, TURNS_SHOWN)
  if (turns.length === 0) return [head, 'no turns recorded yet']
  return [
    head,
    ...turns.map(t => {
      const model = t.model === null ? '' : `  ${t.model.replace(/^claude-/, '')}`
      const reason = t.reason === 'answer' ? '' : `  ${t.reason}`
      return `${span(now - t.at).padStart(6)} ago  ${span(t.durationMs).padStart(6)}  ${usd(t.usd).padStart(6)}  ${fmt(t.inputTokens)} in · ${fmt(t.outputTokens)} out${model}${reason}`
    }),
  ]
}

/** One report's file text as a row, or null when ended or unreadable (a write in flight). Keeps only the turns the card shows. */
export function rowOf(text: string): Heavy | null {
  try {
    const report = JSON.parse(text) as PaneReport
    if (report.isEnded || typeof report.tokens !== 'number' || !report.pane || !report.workspace) return null
    const turns = report.turns === undefined ? undefined : report.turns.slice(-TURNS_SHOWN)
    return { pane: report.pane, workspace: report.workspace, tokens: report.tokens, report: { ...report, turns } }
  } catch {
    return null
  }
}

/** One report file as the holder last read it: the row is reused while the file's mtime and size stay the same. */
type Seen = { mtimeMs: number; size: number; row: Heavy | null }

/** What one session keeps between polls: who it is, the reports it has read, and whether a poll is still running. */
type Poller = { me: string; seen: Map<string, Seen>; isPolling: boolean }

/**
 * Whether this session is awake, and its timer while it is. `lastActivity` is when a poll last found input since the
 * one before it; input itself only sets `hasInput`, so a keystroke while awake costs no event and moves no timer.
 * Module state: a reload runs register again, which starts it asleep.
 */
type Waker = { poller: Poller; isAwake: boolean; hasInput: boolean; lastActivity: number; timer: Timer | null }
let waker: Waker | null = null

/**
 * Input from the person: wakes a sleeping session, polling at once and on the timer it starts with the `$` of the hook
 * that woke it; awake, it puts off the idle deadline.
 */
function noteInput($: EngineInterface) {
  if (waker === null) return
  waker.hasInput = true
  if (waker.isAwake) return
  const w = waker
  w.isAwake = true
  void poll($, w)
  w.timer = $.clock.every(HEAVY_POLL_MS, () => void poll($, w))
}

/** One period's poll: asleep after IDLE_MS with no input (its timer cancelled, nothing read), else a refresh. */
async function poll($: EngineInterface, w: Waker) {
  if (w !== waker || !w.isAwake) return
  try {
    const now = await $.clock.now()
    if (w.hasInput) {
      w.hasInput = false
      w.lastActivity = now
    } else if (now - w.lastActivity >= IDLE_MS) {
      w.isAwake = false
      w.timer?.cancel()
      w.timer = null
      return
    }
    await refreshHeavy($, w.poller)
  } catch {
    // A poll that fails leaves the rows drawn; the next tries again.
  }
}

type Summary = { pane?: unknown; at?: unknown; rows?: unknown }

/**
 * The holder's read of the reports: lists the folder, and reads only a file that is new or changed since its last
 * read; one ended, cut mid-write or unchanged costs nothing past the listing.
 */
async function readReports($: EngineInterface, ctxDir: string, now: number, seen: Map<string, Seen>): Promise<Heavy[]> {
  const entries = await $.fs.list(ctxDir).catch(() => [])
  const fresh = entries.filter(f => f.kind === 'file' && f.name.endsWith('.json') && now - f.mtimeMs < STALE_MS)
  const names = new Set(fresh.map(f => f.name))
  for (const name of [...seen.keys()]) if (!names.has(name)) seen.delete(name)
  await Promise.all(
    fresh.map(async f => {
      const known = seen.get(f.name)
      if (known !== undefined && known.mtimeMs === f.mtimeMs && known.size === f.size) return
      const text = await $.fs.read(`${ctxDir}/${f.name}`).catch(() => null)
      const row = text === null ? null : rowOf(String(text))
      // A file cut mid-write is read again next poll: its mtime is not kept.
      if (text !== null && !isWhole(String(text))) seen.delete(f.name)
      else seen.set(f.name, { mtimeMs: f.mtimeMs, size: f.size, row })
    }),
  )
  return [...seen.values()].map(s => s.row).filter((row): row is Heavy => row !== null)
}

/** False for a file cut mid-write, whose text does not parse. */
function isWhole(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/**
 * The timer's poll. The session holding the lease (the summary's writer) reads the reports and rewrites the summary;
 * every other session reads the summary alone. A session takes the lease when the summary is missing, its own, or
 * stale (its writer has gone); two that take it at once both read for a moment, which does no harm.
 */
async function refreshHeavy($: EngineInterface, poller: Poller) {
  if (poller.isPolling) return
  poller.isPolling = true
  try {
    const ctxDir = `${await claudeDir($)}/ctx`
    const path = `${ctxDir}/heavy/summary.json`
    const now = await $.clock.now()
    let summary: Summary | null = null
    try {
      summary = JSON.parse(String(await $.fs.read(path))) as Summary
    } catch {
      summary = null
    }
    const isHeld = summary !== null && summary.pane !== poller.me && typeof summary.at === 'number' && now - summary.at < HEAVY_LEASE_MS
    let rows: Heavy[]
    if (isHeld) {
      if (!Array.isArray(summary?.rows)) return
      rows = drawable(summary.rows)
    } else {
      rows = topSessions(await readReports($, ctxDir, now, poller.seen))
      await $.fs.write(path, JSON.stringify({ pane: poller.me, at: now, rows }) + '\n').catch(() => {})
    }
    await show($, rows, now)
  } finally {
    poller.isPolling = false
  }
}

/** Writes the rows to the drawn state only when they differ from what is drawn, and moves the tick once a minute. */
async function show($: EngineInterface, rows: Heavy[], now: number) {
  const drawn = await read($, heavy)
  if (JSON.stringify(drawn) !== JSON.stringify(rows)) await update($, heavy, () => rows)
  const minute = Math.floor(now / TICK_MS) * TICK_MS
  if (rows.length > 0 && (await read($, tick)) !== minute) await update($, tick, () => minute)
}

export const register: Register = on => {
  waker?.timer?.cancel()
  waker = null

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if ((await $.env.get('HERDR_ENV')) === '1') {
      // Outside a pane's ID, a name of its own, so its lease is never taken for another session's.
      const me = (await $.env.get('HERDR_PANE_ID')) || `session-${Math.random().toString(36).slice(2)}`
      waker?.timer?.cancel()
      // Asleep: no timer and no read until the person's first input; the footer keeps the rows last drawn.
      waker = { poller: { me, seen: new Map(), isPolling: false }, isAwake: false, hasInput: false, lastActivity: 0, timer: null }
    }

    return result
  })

  // What wakes a session: the person typing, submitting or running a command, and the session's own work. Each
  // passes on untouched.
  on('prompt.edit', ($, e, next) => {
    noteInput($)
    return next(e)
  })
  on('prompt.submit', ($, e, next) => {
    noteInput($)
    return next(e)
  })
  on('command.run', ($, e, next) => {
    noteInput($)
    return next(e)
  })
  on('turn.start', ($, e, next) => {
    noteInput($)
    return next(e)
  })
  on('tool.call', ($, e, next) => {
    noteInput($)
    return next(e)
  })
  on('turn.complete', ($, e, next) => {
    noteInput($)
    return next(e)
  })

  // The footer's mode labels, where herdr-jump draws (this mod runs first: it
  // lists herdr-jump under dependencies). Its line stays on top, right-aligned;
  // this mod's line goes under it.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const theirs = await next(e)
    const top = drawable(await read($, heavy))
    if (top.length === 0) return theirs
    const now = await drawnAt($)

    const go = async (row: Heavy) => {
      noteInput($)
      const focused = await $.process.run(['herdr', 'agent', 'focus', row.pane])
      if (focused.exitCode !== 0) await $.process.run(['herdr', 'workspace', 'focus', row.workspace])
    }

    const isFloating = e.viewport?.isFullscreen === true
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" alignItems="flex-end">
        {theirs}
        <Box gap={1}>
          {top.map(row => (
            <Box key={`heavy-${row.pane}`} flexShrink={0}>
              <Button key={`go-${row.pane}`} plain label={row.pane} onPress={() => void go(row)} />
              <Box key={`tokens-${row.pane}`} hover={{ scope: scopeOf(row.pane) }}>
                <Text color={heat(row.tokens)}> {fmt(row.tokens)}</Text>
                {/* Fullscreen: the card floats over the rows above the count,
                    its right edge on the count's; elsewhere the band draws it. */}
                {isFloating && (
                  <Box position="absolute" bottom={1} right={0} flexDirection="column" display="none" hover={{ display: 'flex' }}>
                    {padded(cardOf(row.report, now)).map((line, i) => (
                      <Text key={`line-${i}`} color={i === 0 ? heat(row.tokens) : undefined} inverse>{line}</Text>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })

  // The hover cards off fullscreen, where a floating card would be clipped to
  // the footer row: drawn in the band above the prompt, hidden until the
  // pointer is on a workspace's token count, right-aligned over the footer.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    const top = drawable(await read($, heavy))
    if (e.props.hasSurvey || top.length === 0 || e.viewport?.isFullscreen === true) return theirs
    const now = await drawnAt($)

    const { Box, Text } = $.ui.resolve(e)
    const rows = Math.max(1, e.props.maxRows)
    return (
      <Box flexDirection="column">
        <Box width={e.props.bodyColumns} justifyContent="flex-end">
          {top.map(row => {
            return (
              <Box key={`card-${row.pane}`} flexDirection="column" display="none" hover={{ scope: scopeOf(row.pane), display: 'flex' }}>
                {padded(cardOf(row.report, now).slice(0, rows)).map((line, i) => (
                  <Text key={`line-${i}`} color={i === 0 ? heat(row.tokens) : undefined} inverse wrap="truncate-end">
                    {line}
                  </Text>
                ))}
              </Box>
            )
          })}
        </Box>
        {theirs}
      </Box>
    )
  })
}

/** The time the cards' ages are reckoned from: the clock now, the tick read so a new minute draws them again. */
async function drawnAt($: EngineInterface): Promise<number> {
  await read($, tick)
  return $.clock.now()
}

const scopeOf = (pane: string) => `ctx-heavy-${pane}`

/** The card's lines padded to one width, a cell of margin each side. */
function padded(lines: readonly string[]): string[] {
  const width = Math.max(...lines.map(line => line.length))
  return lines.map(line => ` ${line.padEnd(width)} `)
}
