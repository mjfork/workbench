import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { PaneRow, QueueItem } from '../types'
import { chipsOf, FOOTER_COLS, reservedCols } from './footer'
import { plainBlock, plainText } from './text'
import { findPanes, isPaneId, paneById, placeOf, rowsOf, workspaceByIdOrNumber } from './panes'
import type { AgentJson, PaneJson, TabJson, WorkspaceJson } from './panes'

/** The Claude config folder, as Claude Code itself reads it from CLAUDE_CONFIG_DIR. Unset, it is ~/.claude, where Claude Code keeps it. */
const claudeDir = async ($: EngineInterface) => {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir) return dir
  const home = await $.env.get('HOME')
  if (!home) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set')
  return `${home}/.claude`
}

const PANE = 'herdr-jump'
// `/jump`: a picker, or straight to a pane, workspace or match.
const JUMP = 'jump'
const QUEUE_PANE = 'herdr-queue'
// `/needs-me` opens the queue pane, the same one the footer's ⚑ count opens, whether or not anyone is waiting.
const QUEUE_COMMAND = 'needs-me'
// `/needs-me-next` goes to the first pane in that list that is not this one.
const NEXT_COMMAND = 'needs-me-next'
// `/jump-back` goes to the pane you were in before this one. herdr keeps no focus history, so the sessions' mods
// watch which pane is focused and keep the last two in a file all of them share. One session does the watching: it holds
// a lease it renews on each poll, and another takes over once the lease is FOCUS_LEASE_MS old.
const BACK_COMMAND = 'jump-back'
const FOCUS_POLL_MS = 2000
const FOCUS_LEASE_MS = 5000
// The queue: every footer polls it, but the script keeps one list for all of them (in .list-cache, under
// QUEUE_FRESH_MS old; the same age as the script's own check). A footer reads that file itself, and starts the script
// only when the file is stale or missing. A turn's stop or a prompt marks the file stale, so a new ask shows at the next poll;
// the age bounds only how late a pane blocked on a dialog shows.
const QUEUE_POLL_MS = 5000
const QUEUE_FRESH_MS = 15_000
const LIST_TIMEOUT_MS = 15_000
// The script's rebuild lock (.list-lock): older than this, its run was killed and the script clears it. Keep the two the same.
const LIST_LOCK_STALE_MS = 30_000
// The two polls run only while the session is awake. ~55 sessions share one machine, and a timer that fires in an idle
// one wakes its whole process, so the system can never leave it swapped out. A session starts asleep; the person's
// input (a first edit in the prompt box: Claude Code has no terminal-focus event), its own work (a turn, a tool call),
// a slash command, or a press on this mod's footer or panes wakes it, and IDLE_MS with none of those puts it back to
// sleep. Asleep, the footer shows the last queue it read, and no session tracks focus for /jump-back.
const IDLE_MS = 10 * 60_000
/** The script that keeps the needs-you queue (`list`, `clear <pane>`, and the `stop` and `prompt` hook actions), shipped in this plugin's bin/. */
const needsYou = ($: EngineInterface) => `${$.plugin.root}/bin/needs-you.sh`
/** Prints a line each time herdr focuses this pane, its tab or its workspace: a blocked socket read, no timer. */
const focusWatch = ($: EngineInterface) => `${$.plugin.root}/bin/focus-watch.sh`
const query = atom({ plugin: 'herdr-jump', key: 'query' } as const, '')
const panes = atom({ plugin: 'herdr-jump', key: 'panes' } as const, [])
const queue = atom({ plugin: 'herdr-jump', key: 'queue' } as const, [])
const now = atom({ plugin: 'herdr-jump', key: 'now' } as const, 0)
// This pane's herdr ID, for the queue script (outside herdr: null).
let pane: string | null = null

// Inside herdr only: outside it there is nothing to poll, and nothing wakes.
let isInHerdr = false
let isAwake = false
// When the last wake event came, as the poll last saw it. A wake while awake only sets isActive, so a keystroke costs
// no clock read; the next queue poll moves lastActivity on.
let lastActivity = 0
let isActive = false
let timers: Timer[] = []

/** Starts the polls with one refresh at once; awake already, it only notes the activity. Never awaited by its callers. */
function wake($: EngineInterface): void {
  if (!isInHerdr) return
  if (isAwake) {
    isActive = true
    return
  }
  watchFocus($)
  isAwake = true
  isActive = false
  // A wake rides on a tool call or a keystroke: nothing in it may throw into that.
  try {
    void $.clock.now().then(ms => { lastActivity = ms }, () => {})
    void pollFocus($).catch(() => {})
    void refreshQueue($, false).catch(() => {})
    timers = [
      $.clock.every(FOCUS_POLL_MS, () => void pollFocus($).catch(() => {})),
      $.clock.every(QUEUE_POLL_MS, () => void pollQueue($).catch(() => {})),
    ]
  } catch {
    sleep()
  }
}

// Claude Code has no terminal-focus event, so an asleep footer would show the queue it last read until you typed in it:
// asks you cleared from another pane stayed on screen. herdr's own focus events reach the session through one child
// per session that reads its socket and prints a line when this pane gets focus; each line wakes the session and
// redraws the footer from the shared list. A child that ended (herdr restarted) starts again on the next wake.
let isWatchingFocus = false

/** Starts the focus child unless it runs already. Never awaited: it lives as long as the session. */
function watchFocus($: EngineInterface): void {
  if (!isInHerdr || isWatchingFocus) return
  isWatchingFocus = true
  void (async () => {
    try {
      for await (const { stream, text } of $.process.spawn({ argv: ['bash', focusWatch($)] })) {
        if (stream === 'stdout' && text.includes('focused')) onFocused($)
      }
    } catch {
      // No herdr socket, or the child could not start: the footer keeps its old behaviour.
    } finally {
      isWatchingFocus = false
    }
  })()
}

/** This pane got focus: wake (an asleep session refreshes as it wakes), else refresh now. */
function onFocused($: EngineInterface): void {
  if (!isAwake) return wake($)
  isActive = true
  void refreshQueue($, false).catch(() => {})
}

/** Cancels the polls; the next wake event starts them again. */
function sleep(): void {
  isAwake = false
  for (const timer of timers) timer.cancel()
  timers = []
}

/** The queue timer's poll, which also tells when the session has gone IDLE_MS without a wake event and sleeps it. */
async function pollQueue($: EngineInterface): Promise<void> {
  const ms = await $.clock.now()
  if (isActive) {
    isActive = false
    lastActivity = ms
  } else if (ms - lastActivity >= IDLE_MS) {
    sleep()
    return
  }
  await refreshQueue($, false)
}

const STATUS_COLOR: Record<string, string> = { blocked: 'red', working: 'yellow', idle: 'green', done: 'green' }

const MAX_ROWS = 24

type FocusHistory = { current: string | null; previous: string | null }

/** The pane herdr has focused right now, from a light `pane list`; null when herdr does not say. */
async function focusedPaneId($: EngineInterface): Promise<string | null> {
  const r = await $.process.run(['herdr', 'pane', 'list'], { timeoutMs: 3000 }).catch(() => null)
  if (r === null || r.exitCode !== 0) return null
  try {
    const list = (JSON.parse(r.stdout) as { result?: { panes?: { pane_id: string; focused?: boolean }[] } }).result?.panes ?? []
    return list.find(p => p.focused === true)?.pane_id ?? null
  } catch {
    return null
  }
}

const focusFile = async ($: EngineInterface) => `${await claudeDir($)}/ctx/focus/${(await $.env.get('HERDR_SESSION')) ?? 'default'}.json`
const leaseFile = async ($: EngineInterface) => `${await claudeDir($)}/ctx/focus/${(await $.env.get('HERDR_SESSION')) ?? 'default'}.poller.json`

async function readFocus($: EngineInterface): Promise<FocusHistory> {
  try {
    const raw = JSON.parse(String(await $.fs.read(await focusFile($)))) as Partial<FocusHistory>
    return { current: typeof raw.current === 'string' ? raw.current : null, previous: typeof raw.previous === 'string' ? raw.previous : null }
  } catch {
    return { current: null, previous: null }
  }
}

/**
 * Notes a change of focus: the pane that was current becomes the previous one. Every session does this, from the same
 * answer and the same file, so they agree; a move the file already shows changes nothing.
 */
async function trackFocus($: EngineInterface): Promise<FocusHistory> {
  const focused = await focusedPaneId($)
  const was = await readFocus($)
  if (focused === null || focused === was.current) return was
  const now: FocusHistory = { current: focused, previous: was.current }
  await $.fs.write(await focusFile($), JSON.stringify(now) + '\n').catch(() => {})
  return now
}

/** Takes you to a waiting agent's pane; a pane herdr will not focus falls back to its workspace. */
async function focusItem($: EngineInterface, item: QueueItem): Promise<void> {
  const focused = await $.process.run(['herdr', 'agent', 'focus', item.pane])
  if (focused.exitCode !== 0) await $.process.run(['herdr', 'workspace', 'focus', item.workspace])
}

/** herdr's workspace, tab, pane and agent lists, joined into one row per pane. The tab and agent lists are best effort. */
async function listPanes($: EngineInterface): Promise<{ workspaces: WorkspaceJson[]; rows: PaneRow[] } | string> {
  const run = (args: string[]) => $.process.run(['herdr', ...args], { timeoutMs: 8000 }).catch(() => null)
  const [ws, tabs, panesOut, agents] = await Promise.all([run(['workspace', 'list']), run(['tab', 'list']), run(['pane', 'list']), run(['agent', 'list'])])
  const pick = <T,>(r: Awaited<ReturnType<typeof run>>, key: string): T[] | null => {
    if (r === null || r.exitCode !== 0) return null
    try {
      const list = (JSON.parse(r.stdout) as { result?: Record<string, unknown> }).result?.[key]
      return Array.isArray(list) ? (list as T[]) : null
    } catch {
      return null
    }
  }
  const workspaces = pick<WorkspaceJson>(ws, 'workspaces')?.map(w => ({ ...w, label: plainText(w.label), agent_status: w.agent_status === undefined ? undefined : plainText(w.agent_status) })) ?? null
  const paneList = pick<PaneJson>(panesOut, 'panes')
  if (workspaces === null) return `herdr workspace list failed: ${plainText(ws?.stderr).trim() || 'no answer'}`
  if (paneList === null) return `herdr pane list failed: ${plainText(panesOut?.stderr).trim() || 'no answer'}`
  return { workspaces, rows: rowsOf(workspaces, pick<TabJson>(tabs, 'tabs') ?? [], paneList, pick<AgentJson>(agents, 'agents') ?? []) }
}

async function focusWorkspace($: EngineInterface, target: WorkspaceJson): Promise<void> {
  const focused = await $.process.run(['herdr', 'workspace', 'focus', target.workspace_id])
  $.ui.toast(
    focused.exitCode === 0
      ? `→ ${target.workspace_id} ${target.label}${target.agent_status ? ` (${target.agent_status})` : ''}`
      : `herdr workspace focus failed: ${plainText(focused.stderr).trim()}`,
  )
}

/** Takes you to a pane: an agent by its pane ID, any other pane by its tab, and failing both its workspace. */
async function focusRow($: EngineInterface, row: PaneRow): Promise<void> {
  let isFocused = false
  if (row.isAgent) isFocused = (await $.process.run(['herdr', 'agent', 'focus', row.pane_id])).exitCode === 0
  if (!isFocused) isFocused = (await $.process.run(['herdr', 'tab', 'focus', row.tab_id])).exitCode === 0
  if (!isFocused) isFocused = (await $.process.run(['herdr', 'workspace', 'focus', row.workspace_id])).exitCode === 0
  $.ui.toast(isFocused ? `→ ${row.pane_id} ${placeOf(row)} · ${row.title} (${row.status})` : `herdr could not focus ${row.pane_id}`)
}

/**
 * The timer's poll: only the session holding the lease asks herdr. It takes the lease when it is free, its own, or stale
 * (its holder has gone); two sessions that take it at once both poll for a moment, which does no harm.
 */
async function pollFocus($: EngineInterface): Promise<void> {
  const ms = await $.clock.now()
  const path = await leaseFile($)
  let lease: { pane?: unknown; at?: unknown } | null = null
  try {
    lease = JSON.parse(String(await $.fs.read(path))) as { pane?: unknown; at?: unknown }
  } catch {
    lease = null
  }
  const isHeld = lease !== null && lease.pane !== pane && typeof lease.at === 'number' && ms - lease.at < FOCUS_LEASE_MS
  if (isHeld) return
  await $.fs.write(path, JSON.stringify({ pane, at: ms }) + '\n').catch(() => {})
  await trackFocus($)
}

/**
 * The queue's two writers are a Stop hook and a UserPromptSubmit hook in the script's original setup. This plugin hands
 * the script the same JSON instead, so no hook settings are needed. Outside herdr the script does nothing; it runs in
 * the session's directory. Not awaited: a slow herdr must not hold a turn.
 */
function feedQueue($: EngineInterface, action: 'stop' | 'prompt', input: Record<string, unknown>): void {
  if (pane === null) return
  void $.process.run(['bash', needsYou($), action], { stdin: JSON.stringify(input), timeoutMs: 20_000 }).catch(() => {})
}

/** A file in the script's queue folder for this herdr server. */
const queueFile = async ($: EngineInterface, name: string) =>
  `${await $.env.get('HOME')}/.herdr-queue/${(await $.env.get('HERDR_SESSION')) ?? 'default'}/${name}`

// The script's own test for a "Needs you" heading (awk, case-blind, on each line of the message); `\s` here also takes
// spaces awk would not, which only starts the script more often.
const NEEDS_YOU_HEADING = /^#+\s*⚑\s*needs you/im

/**
 * True when the script's `stop` could change something after a turn that ended with `answer`. Without a section it
 * routes nothing and writes no item; all it can do is close an ask a relayed reply answered, which that reply marks with
 * a `.replied` file. Most turns have neither, and skip a dozen short processes. An empty answer still goes: the script
 * then looks for the text in the transcript.
 */
async function isStopNeeded($: EngineInterface, answer: string): Promise<boolean> {
  if (pane === null) return false
  if (answer === '' || NEEDS_YOU_HEADING.test(answer)) return true
  if (!(await $.env.get('HOME'))) return true
  try {
    await $.fs.stat(await queueFile($, `${pane.replaceAll(':', '_')}.json.replied`))
    return true
  } catch {
    return false
  }
}

/** True while some session's script holds the rebuild lock (a lock over LIST_LOCK_STALE_MS old was left by a killed run). */
async function isRebuilding($: EngineInterface): Promise<boolean> {
  try {
    const stat = await $.fs.stat(await queueFile($, '.list-lock'))
    return (await $.clock.now()) - stat.mtimeMs < LIST_LOCK_STALE_MS
  } catch {
    return false
  }
}

/** The script's shared list, when it is fresh enough to use as is (or at any age, `isAnyAge`); null when stale, missing or unreadable. */
async function cachedQueue($: EngineInterface, isAnyAge = false): Promise<unknown[] | null> {
  try {
    const path = await queueFile($, '.list-cache')
    const stat = await $.fs.stat(path)
    if (!isAnyAge && (await $.clock.now()) - stat.mtimeMs >= QUEUE_FRESH_MS) return null
    const parsed: unknown = JSON.parse(String(await $.fs.read(path)))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** True while this session's script run is going: a timer poll then skips, so a slow herdr cannot stack runs up. */
let isListing = false

/** Refreshes the queue: from the shared list when it is fresh (the timer's poll), else from the script (`isForced`: always). */
async function refreshQueue($: EngineInterface, isForced = true): Promise<void> {
  let parsed: unknown = isForced ? null : await cachedQueue($)
  // Another session is rebuilding the list: keep the last one rather than start a script only to be told so.
  if (parsed === null && !isForced && (await isRebuilding($))) {
    parsed = await cachedQueue($, true)
    if (parsed === null) return
  }
  if (parsed === null) {
    if (isListing && !isForced) return
    isListing = true
    try {
      const listed = await $.process.run(['bash', needsYou($), 'list'], { timeoutMs: LIST_TIMEOUT_MS })
      if (listed.exitCode !== 0) return
      parsed = JSON.parse(listed.stdout)
    } finally {
      isListing = false
    }
  }
  // Each ask is another session's reply: drawn as text, never as terminal codes.
  const items: QueueItem[] = (Array.isArray(parsed) ? (parsed as QueueItem[]) : []).map(i => ({
    ...i,
    pane: plainText(i.pane),
    workspace: plainText(i.workspace),
    label: plainText(i.label),
    ask: plainBlock(i.ask),
  }))
  // Written only when what is drawn changes: every write draws each footer that reads it again, and an idle session's
  // list is the same poll after poll. The time is there only for the ages the queue pane and the hover card show, so it
  // is written when one of those would read differently (each 5s for an ask under a minute old, each minute after).
  if (JSON.stringify(items) !== JSON.stringify(await read($, queue))) await update($, queue, () => items)
  const at = Math.floor((await $.clock.now()) / 1000)
  const ages = (t: number) => items.map(i => age(i.ts, t)).join()
  if (ages(at) !== ages(await read($, now))) await update($, now, () => at)
}

const CARD_COLS = 76
const CARD_ASK_LINES = 8

/** Word-wraps text to `cols`, keeping its own line breaks. */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      for (let w = word; w.length > 0; w = w.slice(cols)) {
        const piece = w.slice(0, cols)
        if (line === '') line = piece
        else if (line.length + 1 + piece.length <= cols) line += ` ${piece}`
        else { out.push(line); line = piece }
      }
    }
    out.push(line)
  }
  return out
}

/** The floating card: who is waiting and for how long, then the ask, padded to one width. */
export function askCard(item: QueueItem, at: number): string[] {
  const since = age(item.ts, at)
  const head = `${item.workspace} ${item.label} · ${item.kind === 'blocked' ? 'dialog' : 'ask'}${since ? ` · ${since}` : ''}`
  let body = wrap(item.ask.trim(), CARD_COLS)
  if (body.length > CARD_ASK_LINES) body = [...body.slice(0, CARD_ASK_LINES - 1), `… click ⚑ to see the rest`]
  const lines = [head, ...body]
  const width = Math.max(...lines.map(line => line.length))
  return lines.map(line => ` ${line.padEnd(width)} `)
}

function age(ts: number | null, at: number): string {
  if (ts === null) return ''
  const s = Math.max(0, at - ts)
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

async function openQueue($: EngineInterface): Promise<void> {
  wake($)
  await refreshQueue($)
  const items = await read($, queue)
  const rows = items.reduce((n, i) => n + 1 + Math.min(4, i.ask.split('\n').length), 2)
  await $.ui.open({ id: QUEUE_PANE, title: 'Needs you', focus: true, closeOnEscape: true, rows })
}

export const register: Register = on => {
  let current: string | undefined

  on('session.start', async ($, e, next) => {
    isInHerdr = false
    if ((await $.env.get('HERDR_ENV')) === '1') {
      current = await $.env.get('HERDR_WORKSPACE_ID')
      await $.command.register({
        name: JUMP,
        description: 'Jump to a herdr pane: alone opens a picker (workspace › tab › pane); or give a pane ID (w8N:p2), a workspace ID or number, or words from its workspace, tab or title',
        argumentHint: '[pane id | workspace | words]',
        immediate: true,
      })
      await $.command.register({
        name: QUEUE_COMMAND,
        description: 'Open the list of agents waiting on you: asks and dialogs, click one to go there',
        immediate: true,
      })
      await $.command.register({
        name: NEXT_COMMAND,
        description: 'Jump to the first agent waiting on you: a dialog first, then the longest wait; never this pane',
        immediate: true,
      })
      await $.command.register({
        name: BACK_COMMAND,
        description: 'Go back to the herdr pane you were in before this one',
        immediate: true,
      })
      pane = (await $.env.get('HERDR_PANE_ID')) ?? null
      isInHerdr = true
    }
    // Asleep until something wakes it: no poll, and the footer draws the queue it last read (none yet). Focusing
    // this pane is one of those wakes.
    sleep()
    watchFocus($)

    return next(e)
  })

  // The queue's writers: what a Stop and a UserPromptSubmit hook would get, handed to the script.
  on('turn.complete', async ($, e, next) => {
    wake($)
    const result = await next(e)
    if (e.agentId === undefined && !e.isAborted) {
      const answer = e.answer
      void isStopNeeded($, answer).then(isNeeded => isNeeded && feedQueue($, 'stop', { last_assistant_message: answer }), () => {})
    }
    return result
  })

  // Only the person's own prompts can answer an ask (typed, or sent to this pane with `herdr agent prompt`, which
  // arrives as the same): a plugin's own, a task's, a peer's or a schedule's is not. A prompt another plugin drops
  // (the cache card's hold, say) is not an answer yet.
  on('prompt.submit', async ($, e, next) => {
    wake($)
    const result = await next(e)
    // A plugin that submits the person's own held words (asUser) is the person too: the cache card's resend.
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge' || (e.origin.kind === 'plugin' && (e.origin as { asUser?: boolean }).asUser === true)
    if (isPerson && (result as { drop?: unknown } | undefined)?.drop === undefined) feedQueue($, 'prompt', { prompt: e.text })
    return result
  })

  // The wake events. Each passes its event on untouched; an edit in the prompt box costs a flag while awake.
  on('prompt.edit', ($, e, next) => {
    wake($)
    return next(e)
  })
  on('turn.start', ($, e, next) => {
    wake($)
    return next(e)
  })
  on('tool.call', ($, e, next) => {
    wake($)
    return next(e)
  })
  on('command.run', ($, e, next) => {
    wake($)
    return next(e)
  })

  on('command.run', { command: QUEUE_COMMAND }, async $ => {
    await openQueue($)
    return {}
  })

  on('command.run', { command: BACK_COMMAND }, async $ => {
    // Look first: a move you made a moment ago may not be in the file yet.
    const history = await trackFocus($)
    if (history.previous === null) {
      $.ui.toast('No previous pane yet.')
      return {}
    }
    const listed = await listPanes($)
    if (typeof listed === 'string') {
      $.ui.toast(listed)
      return {}
    }
    const row = listed.rows.find(r => r.pane_id === history.previous)
    if (row === undefined) {
      $.ui.toast(`${history.previous} is gone.`)
      return {}
    }
    await focusRow($, row)
    return {}
  })

  on('command.run', { command: NEXT_COMMAND }, async $ => {
    await refreshQueue($)
    const items = await read($, queue)
    if (items.length === 0) {
      $.ui.toast('Nobody is waiting on you.')
      return {}
    }
    const next = items.find(i => i.pane !== pane)
    if (next === undefined) {
      $.ui.toast('Only this session is waiting on you.')
      return {}
    }
    await focusItem($, next)
    $.ui.toast(`→ ${next.pane} ${next.label} · ${next.kind === 'blocked' ? 'dialog' : 'ask'}`)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: QUEUE_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const items = await read($, queue)
    const at = await read($, now)

    const go = async (item: QueueItem) => {
      await $.ui.close({ id: QUEUE_PANE })
      await focusItem($, item)
    }
    const dismiss = async (item: QueueItem) => {
      await $.process.run(['bash', needsYou($), 'clear', item.pane])
      await refreshQueue($)
    }

    return (
      <Box flexDirection="column">
        {items.length === 0 && <Text dimColor>Nobody is waiting on you.</Text>}
        {items.map((item, i) => (
          <Box key={item.pane} flexDirection="column" marginBottom={1}>
            <Box gap={1}>
              <Button key={`go-${item.pane}`} plain label={`${item.workspace} ${item.label}`} variant={i === 0 ? 'primary' : undefined} onPress={() => void go(item)} />
              <Text color={item.kind === 'blocked' ? 'red' : 'yellow'}>{item.kind === 'blocked' ? 'dialog' : 'ask'}</Text>
              <Text dimColor>{age(item.ts, at)}</Text>
              {item.kind === 'ask' && <Button key={`x-${item.pane}`} plain dimColor label="dismiss" onPress={() => void dismiss(item)} />}
            </Box>
            <Box paddingLeft={4}>
              <Text dimColor wrap="wrap">{item.ask.split('\n').slice(0, 4).join('\n')}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    )
  })

  // The footer, one row: what the engine and the mods beneath draw (the mode labels, the turn-mode toggle, the cache
  // countdown), then herdr's pane ID, then the queue depth, which opens the queue on a click.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!current) return next(e)
    const items = await read($, queue)
    const depth = items.length
    const theirs = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    // The full pane ID, so tabs in one workspace each read differently; the workspace when there is no pane.
    const here = pane ?? current
    const label = <Text key="herdr" dimColor>{`herdr ${here}`}</Text>
    if (depth === 0) {
      return (
        <Box gap={1} flexShrink={0}>
          {theirs}
          {label}
        </Box>
      )
    }

    // After the count: the waiting panes that fit in the width of the context bar, click one to go there; `+N` is the rest.
    const { chips, more } = chipsOf(items, current, pane, Math.max(0, FOOTER_COLS - reservedCols(here, depth)))
    const go = (item: QueueItem) => {
      wake($)
      return focusItem($, item)
    }

    const isFloating = e.viewport?.isFullscreen === true
    // Only the hover card shows an age: a footer that draws none does not read the time, so is not drawn again as it moves.
    const at = isFloating ? await read($, now) : 0
    // One row, flush right: what is beneath, `herdr <pane>`, the count, then the waiting workspaces.
    return (
      <Box gap={1} flexShrink={0}>
        {theirs}
        {label}
        <Button key="queue" plain label={`⚑ ${depth}`} onPress={() => void openQueue($)} />
        {chips.map(({ item, label }) => (
          <Box key={`ask-${item.pane}`}>
            <Button key={`top-${item.pane}`} plain label={label} onPress={() => void go(item)} />
            {/* Fullscreen: hovering the ID floats its ask over the rows above. */}
            {isFloating && (
              <Box position="absolute" bottom={1} right={0} flexDirection="column" display="none" hover={{ display: 'flex' }}>
                {askCard(item, at).map((line, i) => (
                  <Text key={`line-${i}`} color={i === 0 ? (item.kind === 'blocked' ? 'red' : 'yellow') : undefined} inverse>{line}</Text>
                ))}
              </Box>
            )}
          </Box>
        ))}
        {more > 0 && <Button key="more" plain dimColor label={`+${more}`} onPress={() => void openQueue($)} />}
      </Box>
    )
  })

  // Answers go to a toast, never the transcript, so jumps cost the model nothing.
  // The old name still runs but stays out of the typeahead and /help.
  on('command.run', { command: JUMP }, async ($, e) => {
    const listed = await listPanes($)
    if (typeof listed === 'string') {
      $.ui.toast(listed)
      return {}
    }
    const { workspaces, rows } = listed
    const text = e.args.trim()

    // A pane ID, or a workspace named by its ID or number: straight there.
    if (isPaneId(text)) {
      const row = paneById(rows, text)
      if (row) await focusRow($, row)
      else $.ui.toast(`No pane matches "${text.replace(/^\//, '')}"`)
      return {}
    }
    const workspace = workspaceByIdOrNumber(workspaces, text)
    if (workspace) {
      await focusWorkspace($, workspace)
      return {}
    }

    // Words: one pane jumps, none says so, several open the picker already filtered.
    if (text !== '') {
      const hits = findPanes(rows, text)
      if (hits.length === 0) {
        $.ui.toast(`No pane matches "${text}"`)
        return {}
      }
      if (hits.length === 1) {
        await focusRow($, hits[0]!)
        return {}
      }
    }

    await update($, panes, () => rows)
    await update($, query, () => text)
    await $.ui.open({ id: PANE, title: 'Jump to pane', focus: true, closeOnEscape: true, rows: Math.min(findPanes(rows, text).length, MAX_ROWS) + 4 })
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // The mobile app draws no Input yet; /jump <id> still works there.
    if (e.surface === 'mobile') return next(e)
    const { Box, Text, Input, Button } = $.ui.resolve(e)
    const text = await read($, query)
    const hits = findPanes(await read($, panes), text)
    const shown = hits.slice(0, MAX_ROWS)

    const go = async (row: PaneRow | undefined) => {
      if (!row) return
      await $.ui.close({ id: PANE })
      await focusRow($, row)
    }

    return (
      <Box flexDirection="column">
        <Input
          key="q"
          label="go "
          placeholder="workspace, tab, pane or title"
          submitLabel="jump"
          autoFocus
          onInput={(value: string) => void update($, query, () => value)}
          onSubmit={(value: string) => void go(findPanes(hits, value)[0] ?? hits[0])}
        />
        {hits.length === 0 && <Text dimColor>No match</Text>}
        {shown.map((r, i) => (
          <Box key={r.pane_id} gap={1}>
            <Button key={`go-${r.pane_id}`} plain label={r.pane_id.padEnd(7)} variant={i === 0 ? 'primary' : undefined} onPress={() => void go(r)} />
            <Text color={STATUS_COLOR[r.status]} dimColor={r.status === 'shell'}>{r.status.padEnd(8)}</Text>
            <Text dimColor wrap="truncate-end">{placeOf(r)}</Text>
            <Text wrap="truncate-end">{r.title}</Text>
          </Box>
        ))}
        {hits.length > shown.length && <Text dimColor>{`… ${hits.length - shown.length} more: keep typing`}</Text>}
      </Box>
    )
  })
}
