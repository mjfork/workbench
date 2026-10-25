import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { isPeerOrigin, keyOf, MODE_REL, nextMode, parseMode, textFor } from './modes'

/** The Claude config folder, as Claude Code itself reads it from CLAUDE_CONFIG_DIR. Unset, it is ~/.claude, where Claude Code keeps it. */
const claudeDir = async ($: EngineInterface) => {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir) return dir
  const home = await $.env.get('HOME')
  if (!home) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set')
  return `${home}/.claude`
}


// How a turn ends, per session (see modes.ts): async (the default), real-time or
// agentic. The mode lives in ~/.claude/ctx/mode/<pane>.json, set by the footer
// toggle or turn-mode.sh. With no file the mode is async.
// The instructions ride on the prompt as context the user never sees, and only
// when they change: the first prompt, a mode change, a peer's turn and the one
// after, and after a compaction or /clear (which drop what was said). The system
// prompt is never touched, so a toggle never spends the prompt cache.
const injected = atom({ plugin: 'turn-mode', key: 'injected' } as const, null)
const shown = atom({ plugin: 'turn-mode', key: 'shown' } as const, 'async')
const LABEL = { async: 'async', realtime: 'real-time', agentic: 'agentic' } as const

let pane: string | null = null
let isActive = false

// Asleep until input: an idle session runs no timer, so the OS can leave its memory
// swapped out. A keystroke (prompt.edit, the nearest thing to focus Claude Code
// shows), a prompt, a turn, a tool, a slash command or a click wakes it: one read
// at once, then the 3s poll. The poll stops after IDLE_MS with no wake. While
// asleep the footer shows the last mode read; a prompt still reads its own.
const POLL_MS = 3000
const IDLE_MS = 10 * 60_000
let isAwake = false
// A wake only marks activity; the next poll stamps it, so a keystroke costs nothing.
let sawActivity = false
let lastActivity = 0
let poll: { cancel: () => void } | null = null

/** This pane's mode, read fresh for each prompt (a toggle takes effect on the next one). */
/** This pane's mode: its file when one is set, else async. */
async function modeNow($: EngineInterface) {
  const text = pane === null ? null : await $.fs.read(`${await claudeDir($)}/${MODE_REL}/${pane}.json`).then(String, () => null)
  return text === null ? { mode: 'async' as const, driver: null, driverName: null } : parseMode(text)
}

async function refreshShown($: EngineInterface) {
  const { mode } = await modeNow($)
  await update($, shown, () => mode)
}

/** One poll: stamp any activity since the last, or sleep once idle too long. */
async function tick($: EngineInterface) {
  const now = await $.clock.now()
  if (sawActivity) {
    sawActivity = false
    lastActivity = now
  } else if (now - lastActivity > IDLE_MS) {
    poll?.cancel()
    poll = null
    isAwake = false
    return
  }
  await refreshShown($).catch(() => {})
}

/** Input seen: awake already, the idle deadline moves; asleep, read the mode now and poll again. */
async function wake($: EngineInterface) {
  sawActivity = true
  if (isAwake || pane === null) return
  isAwake = true
  poll = $.clock.every(POLL_MS, () => void tick($).catch(() => {}))
  await refreshShown($).catch(() => {})
}

/** A click: async and real-time swap; agentic (a driver's) goes back to async. */
async function toggle($: EngineInterface) {
  if (pane === null) return
  await wake($)
  const mode = nextMode(await read($, shown))
  const file = { pane, mode, driver: null, setBy: 'human', at: await $.clock.now() }
  await $.fs.write(`${await claudeDir($)}/${MODE_REL}/${pane}.json`, JSON.stringify(file) + '\n')
  await update($, shown, () => mode)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    pane = (await $.env.get('HERDR_ENV')) === '1' ? ((await $.env.get('HERDR_PANE_ID')) ?? null) : null
    isActive = true
    // A new conversation (start, /clear, resume) has not been told yet.
    await update($, injected, () => null)
    // One read for the footer, then asleep until input.
    if (pane !== null) await refreshShown($).catch(() => {})

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    void wake($).catch(() => {})
    if (!isActive || e.text.trimStart().startsWith('/')) return next(e)
    const { mode, driver, driverName } = await modeNow($)
    const key = keyOf(mode, driver, isPeerOrigin(e.origin.kind), driverName)
    if ((await read($, injected)) === key) return next(e)

    const result = await next({ ...e, context: [...(e.context ?? []), textFor(key)] })
    if (result.drop === undefined) await update($, injected, () => key)
    return result
  })

  // The first keystroke wakes it: passed through as typed, the wake not awaited.
  on('prompt.edit', ($, e, next) => {
    void wake($).catch(() => {})
    return next(e)
  })
  on('turn.start', ($, e, next) => {
    void wake($).catch(() => {})
    return next(e)
  })
  on('turn.complete', ($, e, next) => {
    void wake($).catch(() => {})
    return next(e)
  })
  on('tool.call', ($, e, next) => {
    void wake($).catch(() => {})
    return next(e)
  })
  on('command.run', ($, e, next) => {
    void wake($).catch(() => {})
    return next(e)
  })

  // A compacted conversation keeps only its summary: say it again on the next prompt.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) await update($, injected, () => null)
    return result
  })

  // The toggle, left of the footer's bottom-right block. Declared dependencies set the order the footer mods draw in
  // (a mod runs ahead of the mods it depends on), so this mod, which depends on ctx-bar, which depends on ctx-heavy,
  // which depends on herdr-jump, sees the whole block: herdr-jump's line, ctx-heavy's heaviest sessions, then ctx-bar's
  // bar. Bottom-aligned and lifted one row, the toggle sits on the heaviest-sessions row, flush when that row is the
  // block's widest line. With ctx-bar's bar hidden it sits one row higher.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const theirs = await next(e)
    if (!isActive || pane === null) return theirs
    const mode = await read($, shown)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="flex-end" gap={1} flexShrink={0}>
        <Box marginBottom={1} flexShrink={0}>
          <Button key="turn-mode" plain label={LABEL[mode]} dimColor={mode === 'async'} variant={mode === 'realtime' ? 'primary' : mode === 'agentic' ? 'secondary' : undefined} onPress={() => void toggle($)} />
        </Box>
        {theirs}
      </Box>
    )
  })
}
