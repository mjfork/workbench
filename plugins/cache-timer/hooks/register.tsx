import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { CACHE_COLOR, cacheLabel, cacheState, cardLines, nextWake, handoffDue, handoffInTranscript, handoffLeadMsOf, handoffMinTokensOf, handoffNote, isWorthHandoff, previewOf, resumePrompt, HANDOFF_MARK, HANDOFF_TURN_PROMPT, isMachinePrompt, isNoHandoff, lastResponse, paramsOf, redact, withTtl } from './cache'
import type { CacheParams } from './cache'
import type { Handoff } from '../types'

/** The Claude config folder, as Claude Code itself reads it from CLAUDE_CONFIG_DIR. Unset, it is ~/.claude, where Claude Code keeps it. */
const claudeDir = async ($: EngineInterface) => {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir) return dir
  const home = await $.env.get('HOME')
  if (!home) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set')
  return `${home}/.claude`
}

// The cache timer: when the main conversation's last response landed (null: no
// cache to lose yet), whether a turn is running, the clock it is drawn against,
// and the prompt held while the person decides.
const cacheAt = atom({ plugin: 'cache-timer', key: 'cacheAt' } as const, null)
const isWorking = atom({ plugin: 'cache-timer', key: 'isWorking' } as const, false)
const clockMs = atom({ plugin: 'cache-timer', key: 'clockMs' } as const, 0)
const held = atom({ plugin: 'cache-timer', key: 'held' } as const, null)
// The TTL the last main response's cache was written with, from the transcript.
const cacheTtl = atom({ plugin: 'cache-timer', key: 'cacheTtl' } as const, null)
// The handoff: when this idle stretch's was tried (null: not yet; it is tried once, then not again until the
// next turn), and the note it wrote (null: none, or the conversation has moved on since).
const handoffAt = atom({ plugin: 'cache-timer', key: 'handoffAt' } as const, null)
const handoff = atom({ plugin: 'cache-timer', key: 'handoff' } as const, null)

// The TTL comes from the transcript (1 hour until it says); yellow is its last quarter. The one setting (userConfig):
// handoffLeadMinutes (0 = off, the default; e.g. 10): that long before the cache expires, with it still warm and on the long tier, the
// model writes a handoff note, which the plugin keeps for a new session, and handoffMinTokens (200K; 0 = any size): a
// smaller context is not worth one.
const params: CacheParams = paramsOf()
let handoffLeadMs: number | null = null
let handoffMinTokens = handoffMinTokensOf(undefined)
// A pane's state file not written for this long belongs to a pane that is gone.
const STATE_KEEP_DAYS = 7
const DAY_MS = 24 * 60 * 60_000
// The handoff turn, told from a person's by its prompt's mark: submitted but not started, then its turn id; and
// when it was triggered and how old the cache was.
let isHandoffPending = false
let handoffTurnId: string | null = null
let handoffTrigger: { at: number; ageMin: number | null } | null = null
// This pane's herdr ID when there is one: other sessions look the state file up by it (cache-state.sh).
let pane: string | null = null

// The one timer: a one-shot for the next moment that matters (see nextWake), never a poll, so an idle session's process
// sleeps (55 of them on one machine: each wake-up touches its memory, and the OS can never leave it swapped out).
// While the person is there (an edit, a submit, a turn, a command, a press on the card) it is also awake for the
// footer's minutes; IDLE_MS after the last of those it sleeps, and the footer's minutes are drawn only when something
// else repaints it. `isTouched`: input since the timer last looked, so a keystroke costs no clock read.
const IDLE_MS = 10 * 60_000
let timer: Timer | null = null
let isAwake = false
let isTouched = false
let sleepAt = 0

// How much of the transcript's end is read: enough for the last responses and a handoff.
const TAIL_BYTES = 400_000
// This session's transcript, kept once found: the path the engine gives (`classic.SessionStart` and `classic.Stop` carry
// it), else the one the projects glob found. `isGiven`: the engine's, kept even before the file is written.
let transcript: { session: string; path: string; isGiven: boolean } | null = null

/** The path of the transcript of session `id`, by a glob over the config folder's projects; null when there is none yet. */
async function findTranscript($: EngineInterface, id: string): Promise<string | null> {
  const found = await $.process.run(['bash', '-c', 'ls "$1"/projects/*/"$2".jsonl 2>/dev/null | head -1', '_', await claudeDir($), id], { timeoutMs: 5000 }).catch(() => null)
  const path = found?.exitCode === 0 ? found.stdout.trim() : ''
  return path === '' ? null : path
}

/** This session's transcript path: the one kept for its id, else found (and kept); null when there is none yet. */
async function transcriptPath($: EngineInterface, id: string): Promise<string | null> {
  if (transcript?.session === id) return transcript.path
  const path = await findTranscript($, id)
  transcript = path === null ? null : { session: id, path, isGiven: false }
  return path
}

/**
 * The transcript's tail; empty when there is none yet. A file of at most TAIL_BYTES is read whole by the engine, a larger
 * one cut by `tail -c`. A found path that is gone (the file moved) is looked for again, once.
 */
async function readTail($: EngineInterface): Promise<string> {
  const id = await $.session.id()
  const wasKept = transcript?.session === id
  const path = await transcriptPath($, id)
  if (path === null) return ''
  const stat = await $.fs.stat(path).catch(() => null)
  if (stat === null) {
    if (transcript?.isGiven) return ''
    transcript = null
    return wasKept ? readTail($) : ''
  }
  if (stat.size <= TAIL_BYTES) {
    const text = await $.fs.read(path).catch(() => null)
    if (text !== null) return text
  }
  const tail = await $.process.run(['tail', '-c', String(TAIL_BYTES), path], { timeoutMs: 5000 })
  return tail.exitCode === 0 ? tail.stdout : ''
}

/** Keeps the transcript path a classic event carries: the engine's own, so no glob is needed. */
function keepTranscript(e: { session_id?: string; transcript_path?: string }): void {
  if (e.session_id && e.transcript_path) transcript = { session: e.session_id, path: e.transcript_path, isGiven: true }
}

/** The transcript's last main response: its time and its cache's TTL. */
async function readTranscript($: EngineInterface) {
  return lastResponse(await readTail($))
}

/**
 * A resumed session's clock starts from its transcript's last response, and a handoff its conversation ended on is
 * offered again (the plugin keeps the note only while it runs; after a restart the transcript has it).
 */
async function seedCache($: EngineInterface): Promise<void> {
  const tail = await readTail($)
  const last = lastResponse(tail)
  await update($, cacheAt, () => last.at)
  await update($, cacheTtl, () => last.ttlMs)
  if ((await read($, handoff)) !== null) return
  const found = handoffInTranscript(tail)
  if (found === null) return
  await update($, handoffAt, () => found.at ?? last.at)
  await keepHandoff($, { at: found.at ?? last.at ?? (await $.clock.now()), ageMin: found.ageMin }, found.body)
}

/** After a turn: the TTL its responses wrote with (kept when the tail names none). */
async function refreshTtl($: EngineInterface): Promise<void> {
  const { ttlMs } = await readTranscript($)
  if (ttlMs !== null) await update($, cacheTtl, () => ttlMs)
  await writeState($)
  await schedule($)
}

/** The flag's params with the transcript's TTL. */
async function paramsNow($: EngineInterface): Promise<CacheParams> {
  return withTtl(params, await read($, cacheTtl))
}

/** Writes this pane's cache state; best effort. */
/** The handoff as the state file records it: that there is one, not what it says. */
async function handoffForState($: EngineInterface) {
  const note = await read($, handoff)
  return note === null ? null : { at: note.at, ageMin: note.ageMin, tokens: note.tokens }
}

async function writeState($: EngineInterface): Promise<void> {
  const session = await $.session.id()
  const lastResponseAt = await read($, cacheAt)
  const { ttlMs } = await paramsNow($)
  const state = {
    pane,
    session,
    lastResponseAt,
    ttlMs,
    expiresAt: lastResponseAt === null ? null : lastResponseAt + ttlMs,
    isWorking: await read($, isWorking),
    handoff: await handoffForState($),
    at: await $.clock.now(),
  }
  await $.fs.write(`${await claudeDir($)}/ctx/cache/${pane ?? session}.json`, JSON.stringify(state) + '\n').catch(err => $.ui.log(`could not write the cache state: ${String(err).slice(0, 120)}`))
}

/** The timer fired, or the person is back: the footer is redrawn at the time, the handoff tried if due, the next wake set. */
async function tick($: EngineInterface): Promise<void> {
  const ms = await $.clock.now()
  await update($, clockMs, () => ms)
  await maybeHandoff($, ms)
  await schedule($, ms)
}

/**
 * Sets the one timer for the next moment that matters from now (nextWake); none when there is no cache to lose, a turn
 * runs, or it has expired. Called whenever one of those moments moves: a turn, its TTL read, a compaction, a seed.
 */
async function schedule($: EngineInterface, at?: number): Promise<void> {
  const ms = at ?? (await $.clock.now())
  if (isTouched) {
    isTouched = false
    sleepAt = ms + IDLE_MS
  }
  if (isAwake && ms >= sleepAt) isAwake = false
  const { ttlMs, warnMs } = await paramsNow($)
  const due = nextWake({ now: ms, lastAt: await read($, cacheAt), ttlMs, warnMs, isWorking: await read($, isWorking), leadMs: (await read($, handoffAt)) === null ? handoffLeadMs : null, isAwake })
  timer?.cancel()
  timer = due === null ? null : $.clock.after(due - ms, () => {
    timer = null
    void tick($).catch(() => {})
  })
}

/**
 * The person is there: awake for the footer's minutes. Cheap while already awake (a keystroke reads no clock); from
 * asleep, the footer is redrawn at once and its minute timer set.
 */
function touch($: EngineInterface): void {
  isTouched = true
  if (isAwake) return
  isAwake = true
  void tick($).catch(() => {})
}

/** The git facts for the handoff's header, best effort: branch, short commit, and how many files are changed. */
async function gitFacts($: EngineInterface, cwd: string): Promise<string | null> {
  const run = async (args: string[]) => {
    const r = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 5000 }).catch(() => null)
    return r !== null && r.exitCode === 0 ? r.stdout.trim() : null
  }
  const branch = await run(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === null) return null
  const sha = await run(['rev-parse', '--short', 'HEAD'])
  const changed = (await run(['status', '--porcelain']))?.split('\n').filter(Boolean).length ?? 0
  return `${branch} @ ${sha ?? '?'}, ${changed === 0 ? 'clean' : `${changed} changed files`}`
}

/**
 * Once per idle stretch, `handoffLeadMinutes` before the cache would expire, while it is still warm (and on the long
 * tier), the plugin submits a prompt, which runs a real turn on the warm cache; the model writes a handoff note from the
 * context it already holds, and that turn's reply is kept. The turn restarts the cache's clock like any other. Tried once
 * per stretch; the next turn a person starts re-arms it.
 */
async function maybeHandoff($: EngineInterface, ms: number): Promise<void> {
  const lastAt = await read($, cacheAt)
  const ttlMs = (await paramsNow($)).ttlMs
  if (!handoffDue({ leadMs: handoffLeadMs, lastAt, now: ms, ttlMs, isWorking: await read($, isWorking), isTried: (await read($, handoffAt)) !== null })) return
  // Decided for this stretch either way: an idle session's context does not grow, so a small one is not asked again.
  await update($, handoffAt, () => ms)
  if (!isWorthHandoff((await $.session.usage()).context.tokens, handoffMinTokens)) return
  isHandoffPending = true
  handoffTrigger = { at: ms, ageMin: Math.round((ms - (lastAt ?? ms)) / 60_000) }
  await $.prompt.submit({ text: HANDOFF_TURN_PROMPT } as never).catch(err => {
    isHandoffPending = false
    $.ui.log(`handoff not written: ${String(err).slice(0, 120)}`)
  })
}

/** Keeps the note for a new session, under a header of what the mod knows, with escape codes and secrets taken out. */
async function keepHandoff($: EngineInterface, trigger: { at: number; ageMin: number | null }, body: string): Promise<void> {
  const cwd = await $.session.cwd()
  const masked = redact(body)
  const text = handoffNote({ session: await $.session.id(), cwd, at: new Date(trigger.at).toISOString(), ageMin: trigger.ageMin, git: await gitFacts($, cwd), body: masked })
  await update($, handoff, () => ({ text, at: trigger.at, ageMin: trigger.ageMin, tokens: Math.round(text.length * 0.27), preview: previewOf(masked) }))
  await writeState($)
}

/**
 * Settles the prompt the card is holding. `send` submits it (its turn drops the note); `handoff` clears the conversation
 * and submits the handoff note with it; `clear` starts a new session and leaves it in the box; `cancel` puts
 * it back in the box. What is submitted is the person's own words (`asUser`: the transcript still names this plugin), so it
 * answers a pending ask.
 */
async function settleHeld($: EngineInterface, choice: 'send' | 'clear' | 'handoff' | 'cancel'): Promise<void> {
  touch($)
  const text = await read($, held)
  const note = await read($, handoff)
  await update($, held, () => null)
  if (text === null) return
  if (choice === 'send') {
    await $.prompt.fill({ text: '', mode: 'replace' } as never)
    await $.prompt.submit({ text, asUser: true } as never)
    return
  }
  if (choice === 'handoff' && note !== null) {
    await $.prompt.fill({ text: '', mode: 'replace' } as never)
    await $.command.run({ command: 'clear', args: '' } as never)
    await $.prompt.submit({ text: resumePrompt(note.text, text), asUser: true } as never)
    return
  }
  if (choice === 'clear') await $.command.run({ command: 'clear', args: '' } as never)
  await $.prompt.fill({ text, mode: 'replace' } as never)
}

/** Deletes the state files of panes not written for STATE_KEEP_DAYS; best effort. (The engine's `$.fs` has no delete.) */
async function pruneStates($: EngineInterface, now: number): Promise<void> {
  const dir = `${await claudeDir($)}/ctx/cache`
  const entries = await $.fs.list(dir).catch(() => [])
  const old = entries.filter(f => f.kind === 'file' && f.name.endsWith('.json') && now - f.mtimeMs > STATE_KEEP_DAYS * DAY_MS)
  if (old.length > 0) await $.process.run(['rm', '-f', '--', ...old.map(f => `${dir}/${f.name}`)], { timeoutMs: 5000 }).catch(() => null)
}

/** Whether the person has this pane focused in herdr: a prompt typed there is theirs. Unknown reads as theirs. */
async function isFocused($: EngineInterface): Promise<boolean> {
  const id = await $.env.get('HERDR_PANE_ID')
  if (!id) return true
  const got = await $.process.run(['herdr', 'agent', 'get', id], { timeoutMs: 3000 }).catch(() => null)
  if (got === null || got.exitCode !== 0) return true
  try {
    return (JSON.parse(got.stdout) as { result?: { agent?: { focused?: boolean } } }).result?.agent?.focused !== false
  } catch {
    return true
  }
}

export const register: Register = (on, options) => {
  handoffLeadMs = handoffLeadMsOf(options)
  handoffMinTokens = handoffMinTokensOf(options)
  transcript = null
  timer = null
  isAwake = false
  isTouched = false

  // The engine names the transcript at start (and after /clear) and at each main turn's end: kept, so it is not globbed for.
  on('classic.SessionStart', async ($, e, next) => {
    keepTranscript(e)
    return next(e)
  })
  on('classic.Stop', async ($, e, next) => {
    keepTranscript(e)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    pane = (await $.env.get('HERDR_PANE_ID')) ?? null
    await update($, isWorking, () => false)
    await seedCache($).catch(() => {})
    await writeState($)
    // The state files of panes that are gone, after this pane's own is fresh.
    await pruneStates($, await $.clock.now())
    // Asleep until the person is there: only the cache's own deadlines wake it.
    await tick($)

    return next(e)
  })

  // The handoff turn only answers: the plugin keeps the reply. The prompt asks for no tools; this holds it to that, even in a
  // permissive permission mode with nobody there.
  on('tool.call', async ($, e, next) => {
    if (handoffTurnId !== null) return { deny: 'cache-timer: this turn only writes the handoff note, which the plugin keeps; it uses no tools.' }
    touch($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (isHandoffPending && e.text.includes(HANDOFF_MARK)) {
      isHandoffPending = false
      handoffTurnId = e.turnId
    } else {
      touch($)
      // Work resumed: a new idle stretch, and a handoff from before it is out of date.
      await update($, handoffAt, () => null)
      await update($, handoff, () => null)
    }
    await update($, isWorking, () => true)
    await update($, held, () => null)
    await writeState($)
    // A running turn uses the cache: no timer until it ends.
    await schedule($)
    return next(e)
  })

  // The turn's last request just landed: the cache's clock restarts.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await update($, isWorking, () => false)
    const ms = await $.clock.now()
    await update($, cacheAt, () => ms)
    await update($, clockMs, () => ms)
    // The handoff's turn is the plugin's own, not the person back.
    if (handoffTurnId === null || e.turnId !== handoffTurnId) touch($)
    if (handoffTurnId !== null && e.turnId === handoffTurnId) {
      handoffTurnId = null
      if (!e.isAborted && isNoHandoff(e.answer)) $.ui.log('no handoff written: nothing in this session worth resuming')
      else if (!e.isAborted && e.answer.trim() !== '' && handoffTrigger !== null) {
        await keepHandoff($, handoffTrigger, e.answer).catch(err => $.ui.log(`handoff not kept: ${String(err).slice(0, 160)}`))
      }
    }
    await writeState($)
    await schedule($)
    // The transcript has the turn's responses once it settles.
    $.clock.after(2000, () => void refreshTtl($).catch(() => {}))
    return result
  })

  // A compacted conversation is small: nothing worth warning about until it answers again.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) {
      await update($, cacheAt, () => null)
      await update($, handoffAt, () => null)
      await update($, handoff, () => null)
      await writeState($)
      await schedule($)
    }
    return result
  })

  // /clear starts the conversation over: a handoff of the old one is not this one's.
  on('session.end', async ($, e, next) => {
    await update($, handoffAt, () => null)
    await update($, handoff, () => null)
    await schedule($)
    return next(e)
  })

  // The person typing: awake for the footer's minutes. The edit passes as it came.
  on('prompt.edit', async ($, e, next) => {
    touch($)
    return next(e)
  })
  on('command.run', async ($, e, next) => {
    touch($)
    return next(e)
  })

  // The person's Enter on an idle session whose cache has expired: hold the
  // prompt (back in the box) and ask whether to send it or start a new session.
  // Commands, prompts typed over a running turn, any other origin, and ticket or
  // thread sessions (herdr types their prompts: a dialog would stall them) pass.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') touch($)
    // Commands, prompts over a running turn, and the person's own Remote Control messages pass.
    if (e.turnId !== undefined || e.text.trimStart().startsWith('/') || e.origin.kind === 'bridge') return next(e)
    const at = await read($, cacheAt)
    if (at === null || (await read($, isWorking))) return next(e)
    const ms = await $.clock.now()
    if (cacheState(at, ms, await paramsNow($)).state !== 'expired') return next(e)

    // Sent by herdr or another tool: never the card, never a
    // compaction; it just goes. (Compacting on an expired cache re-reads the whole
    // context at full price, the same as the rebuild a plain send pays, and then
    // answers from a summary: cheap compaction belongs before expiry or on a warm turn.)
    if (isMachinePrompt(e.origin.kind, e.text) || !(await isFocused($))) return next(e)
    if ((e.attachments?.length ?? 0) > 0) return next(e)

    // A person typed it: hold it and ask. The engine puts a dropped prompt back in the box itself; filling it here too
    // left it there twice.
    await update($, clockMs, () => ms)
    await update($, held, () => e.text)
    return { drop: 'prompt cache expired: confirm' }
  })

  // The question, as a small card in the band above the prompt (a pane would dock
  // floor to ceiling in fullscreen): what expired, its size, what a re-send costs
  // at list prices against a warm read, and the three choices. The band is shared:
  // what the other mods draw stays under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    if (e.props.hasSurvey) return theirs
    const { Box, Text, Button } = $.ui.resolve(e)
    // A handoff written while the person was away is noted on screen until the conversation moves on.
    if ((await read($, held)) === null) {
      const kept = await read($, handoff)
      if (kept === null) return theirs
      return (
        <Box flexDirection="column">
          <Text key="handoff-ready" dimColor>handoff ready: "Resume from handoff" is offered when the cache expires</Text>
          {theirs}
        </Box>
      )
    }
    const at = await read($, cacheAt)
    const now = await paramsNow($)
    const left = at === null ? 0 : cacheState(at, await read($, clockMs), now).leftMs
    const tokens = (await $.session.usage()).context.tokens
    const note = await read($, handoff)
    const lines = cardLines(left, tokens, await $.session.model(), now.ttlMs, note === null ? null : { ageMin: note.ageMin, tokens: note.tokens, preview: note.preview })
    return (
      <Box flexDirection="column">
        <Box key="cache-card" flexDirection="column" borderStyle="round" borderColor="red" paddingX={1} width={Math.min(e.props.bodyColumns, 100)}>
          {lines.map((line, i) => (
            <Text key={`cache-line-${i}`} color={i === 0 ? 'red' : undefined} bold={i === 0} wrap="wrap">{line}</Text>
          ))}
          <Box gap={2}>
            <Button key="cache-send" label="Submit anyway" variant={note === null ? 'primary' : undefined} onPress={() => void settleHeld($, 'send')} />
            {/* Always three choices: the middle one is the resume when a note is kept, else a plain new session. */}
            {note !== null
              ? <Button key="cache-handoff" label="Resume from handoff" variant="primary" onPress={() => void settleHeld($, 'handoff')} />
              : <Button key="cache-clear" label="New session (/clear)" onPress={() => void settleHeld($, 'clear')} />}
            <Button key="cache-cancel" plain dimColor label="cancel" onPress={() => void settleHeld($, 'cancel')} />
          </Box>
        </Box>
        {theirs}
      </Box>
    )
  })

  // The footer: the countdown, while idle with a cache to lose, left of what the mods beneath draw.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const theirs = await next(e)
    const lastAt = !(await read($, isWorking)) ? await read($, cacheAt) : null
    if (lastAt === null) return theirs
    // Drawn from the clock, not the last wake: any repaint shows the time left. Reading clockMs redraws it at each wake.
    const cache = cacheState(lastAt, Math.max(await read($, clockMs), await $.clock.now()), await paramsNow($))
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box gap={1} flexShrink={0}>
        <Text key="cache" color={CACHE_COLOR[cache.state]} dimColor={cache.state === 'warm'}>{cacheLabel(cache.leftMs)}</Text>
        {theirs}
      </Box>
    )
  })
}
