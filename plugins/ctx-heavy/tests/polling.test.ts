import type { On, RenderPropsOf } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

// Every herdr session draws the same heaviest-sessions line. These hold the reading of the per-pane reports to one
// session, which writes a summary the others read, and hold the drawn state still while nothing shown changes.

const CTX = '/home/ubuntu/.claude/ctx'
const SUMMARY = `${CTX}/heavy/summary.json`
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as never
const settle = () => new Promise(r => setTimeout(r, 20))
const NOW = 100 * 24 * 3600 * 1000

type File = { text: string; mtimeMs: number }

const report = (pane: string, tokens: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ pane, workspace: pane.split(':')[0], tokens, window: 1_000_000, at: NOW, isEnded: false, ...extra })

function reports(): Record<string, File> {
  return {
    [`${CTX}/w6A:p1.json`]: { text: report('w6A:p1', 703_931), mtimeMs: NOW - 1000 },
    [`${CTX}/w6A:p2.json`]: { text: report('w6A:p2', 650_000), mtimeMs: NOW - 1000 },
    [`${CTX}/w71:p1.json`]: { text: report('w71:p1', 309_572), mtimeMs: NOW - 1000 },
    [`${CTX}/w67:p1.json`]: { text: report('w67:p1', 183_552), mtimeMs: NOW - 1000 },
    [`${CTX}/w8P:p1.json`]: { text: report('w8P:p1', 155_158), mtimeMs: NOW - 1000 },
    [`${CTX}/w99:p1.json`]: { text: report('w99:p1', 900_000, { isEnded: true }), mtimeMs: NOW - 1000 },
  }
}

function engine(on: On, files: Record<string, File>) {
  const reads: string[] = []
  const lists: string[] = []
  const sets: string[] = []
  const clock = mock.clock(on, { now: NOW })
  const env: Record<string, string> = { CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude', HOME: '/home/ubuntu', HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w9B', HERDR_PANE_ID: 'w9B:p1' }
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('fs.list', (_$, e) => {
    // A poll lists three folders (reports, modes, caches): counted once, by the reports'.
    if (e.path === CTX) lists.push(e.path)
    const dir = `${e.path}/`
    const entries = Object.entries(files)
      .filter(([path]) => path.startsWith(dir) && !path.slice(dir.length).includes('/'))
      .map(([path, f]) => ({ name: path.slice(dir.length), kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false }))
    return { value: [...entries, { name: 'heavy', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] } as never
  })
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    const f = files[e.path]
    if (f === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: f.text } as never
  })
  on('fs.write', (_$, e) => {
    files[e.path] = { text: e.text, mtimeMs: NOW }
    return { value: undefined } as never
  })
  on('state.set', { plugin: 'ctx-heavy' }, ($, e, next) => {
    sets.push(e.key)
    return next(e)
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  // The engine beneath the events that wake a session: each answers as core would, the box or prompt as it came.
  const edits: unknown[] = []
  on('prompt.edit', (_$, e) => {
    edits.push(e)
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('command.run', () => ({ text: '' }) as never)
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['herdr w9B'] })
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['their band'] })
  })
  const reportReads = () => reads.filter(path => path !== SUMMARY).length
  const summaryReads = () => reads.filter(path => path === SUMMARY).length
  const leaseAt = () => (files[SUMMARY] === undefined ? null : (JSON.parse(files[SUMMARY].text) as { at: number }).at)
  return { clock, files, reads, lists, sets, edits, reportReads, summaryReads, leaseAt }
}

/** One keystroke in the prompt box: how a person comes back to a session. */
const KEY = { origin: { kind: 'composer' }, text: 'ab', cursor: 2, start: 2, end: 2, inputText: 'c' } as const
const type = ($: Engine) => ($ as unknown as { prompt: { edit: (e: typeof KEY) => Promise<{ text: string; cursor: number }> } }).prompt.edit(KEY)

/** A session started and woken by a keystroke, as each test of the polling itself begins. */
async function started($: Engine) {
  await $.session.start(START)
  await type($)
  await settle()
}

test('with no summary, this session takes the lease, reads the reports, and writes one summary', async ($, on) => {
  const e = engine(on, reports())
  await started($)
  const summary = JSON.parse(e.files[SUMMARY]!.text) as { pane: string; at: number; rows: { pane: string }[] }
  expect(summary.pane).toBe('w9B:p1')
  expect(summary.at).toBe(NOW)
  expect(summary.rows.map(r => r.pane)).toEqual(['w6A:p1', 'w6A:p2', 'w71:p1', 'w67:p1'])
  expect(e.reportReads()).toBe(6)
})

test('holding the lease, a poll reads only the reports that changed since it last read them, ended ones included', async ($, on) => {
  const e = engine(on, reports())
  await started($)
  expect(e.reportReads()).toBe(6)
  await e.clock.advance(10_000)
  await settle()
  expect(e.reportReads()).toBe(6)
  // It renewed the lease all the same.
  expect(JSON.parse(e.files[SUMMARY]!.text).at).toBe(NOW + 10_000)
  // One session reports a new fill: that file alone is read, and the summary carries it.
  e.files[`${CTX}/w8P:p1.json`] = { text: report('w8P:p1', 800_000), mtimeMs: NOW + 15_000 }
  await e.clock.advance(10_000)
  await settle()
  expect(e.reportReads()).toBe(7)
  expect(JSON.parse(e.files[SUMMARY]!.text).rows[0].pane).toBe('w8P:p1')
})

test("another session's fresh summary: this one reads that file alone, once per poll, and shows its rows", async ($, on) => {
  const files = reports()
  const held = { pane: 'w1A:p1', at: NOW - 1000, pick: 'context/hide', rows: [{ pane: 'w5Z:p1', workspace: 'w5Z', tokens: 420_000, report: JSON.parse(report('w5Z:p1', 420_000)) }] }
  files[SUMMARY] = { text: JSON.stringify(held), mtimeMs: NOW - 1000 }
  const e = engine(on, files)
  await started($)
  await e.clock.advance(10_000)
  await settle()
  expect(e.lists).toEqual([])
  expect(e.reportReads()).toBe(0)
  expect(e.summaryReads()).toBe(2)
  const ui = await $.ui.mount({ plugin: 'ctx-heavy', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await ui.find({ key: 'go-w5Z:p1' })).toBeDefined()
  await ui.unmount()
  // The holder stopped renewing (its session ended): at 30 seconds old this session takes over.
  await e.clock.advance(10_000)
  await settle()
  expect(e.lists).toEqual([])
  await e.clock.advance(10_000)
  await settle()
  expect(e.lists.length).toBe(1)
  expect(JSON.parse(e.files[SUMMARY]!.text).pane).toBe('w9B:p1')
})

test('the drawn state is written only when what shows changes, and the clock moves it at most once a minute', async ($, on) => {
  const e = engine(on, reports())
  await started($)
  const first = e.sets.filter(key => key === 'heavy').length
  expect(first).toBe(1)
  // Five polls, under a minute, nothing new.
  for (let i = 0; i < 5; i++) {
    await e.clock.advance(10_000)
    await settle()
  }
  expect(e.sets.filter(key => key === 'heavy').length).toBe(1)
  expect(e.sets.filter(key => key === 'tick').length).toBeLessThanOrEqual(1)
  // A fill changes: one write.
  e.files[`${CTX}/w71:p1.json`] = { text: report('w71:p1', 320_000), mtimeMs: NOW + 55_000 }
  await e.clock.advance(10_000)
  await settle()
  expect(e.sets.filter(key => key === 'heavy').length).toBe(2)
})

test("the card's ages are reckoned from the clock when drawn, and move on while nothing else changes", async ($, on) => {
  const files = reports()
  const turn = { at: NOW - 180_000, durationMs: 42_000, usd: 0.5, inputTokens: 95_010, outputTokens: 1_200, model: 'claude-opus-5-5', reason: 'answer' }
  files[`${CTX}/w6A:p1.json`] = { text: report('w6A:p1', 703_931, { turns: [turn] }), mtimeMs: NOW - 1000 }
  const e = engine(on, files)
  await started($)
  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as RenderPropsOf['AbovePrompt']
  const band = await $.ui.mount({ plugin: 'ctx-heavy', surface: 'terminal', component: 'AbovePrompt', props })
  expect(await band.find({ text: / 3m00s ago/ })).toBeDefined()
  for (let i = 0; i < 6; i++) {
    await e.clock.advance(10_000)
    await settle()
  }
  expect(await band.find({ text: / 4m00s ago/ })).toBeDefined()
  await band.unmount()
})

// A session starts asleep and runs no timer until the person comes back to it: an idle one is never woken, so the
// memory of the dozens left open can stay swapped out. Input wakes it; ten minutes without any puts it back to sleep.

test('started with no input, a session reads, lists and writes nothing, however long it sits', async ($, on) => {
  const e = engine(on, reports())
  await $.session.start(START)
  await settle()
  for (let i = 0; i < 6; i++) await e.clock.advance(10_000)
  await settle()
  expect(e.reads).toEqual([])
  expect(e.lists).toEqual([])
  expect(e.leaseAt()).toBeNull()
  expect(e.sets).toEqual([])
})

test('a keystroke wakes it: one refresh at once, then the polls resume', async ($, on) => {
  const e = engine(on, reports())
  await $.session.start(START)
  await e.clock.advance(60_000)
  await type($)
  await settle()
  expect(e.lists.length).toBe(1)
  expect(e.leaseAt()).toBe(NOW + 60_000)
  await e.clock.advance(10_000)
  await settle()
  expect(e.lists.length).toBe(2)
  expect(e.leaseAt()).toBe(NOW + 70_000)
  // More keys while awake start no second timer: still one poll per period.
  await type($)
  await type($)
  await e.clock.advance(10_000)
  await settle()
  expect(e.lists.length).toBe(3)
})

test('ten minutes with no input, the polls stop and the lease is left to go stale', async ($, on) => {
  // Each period of a timer is one clock.every dispatch: the timer itself must stop, not just its polls.
  let periods = 0
  on('clock.every', { ms: 10_000 }, ($, e, next) => {
    periods++
    return next(e)
  })
  const e = engine(on, reports())
  await started($)
  await e.clock.advance(5 * 60_000)
  // Input half way through puts the deadline off: ten minutes from the poll that finds it.
  await type($)
  await e.clock.advance(9 * 60_000)
  await settle()
  expect(e.leaseAt()).toBe(NOW + 14 * 60_000)
  await e.clock.advance(2 * 60_000)
  await settle()
  const lists = e.lists.length
  const reads = e.reads.length
  const at = e.leaseAt()
  expect(at).toBe(NOW + 15 * 60_000)
  const asleep = periods
  await e.clock.advance(60 * 60_000)
  await settle()
  expect(periods).toBe(asleep)
  expect(e.lists.length).toBe(lists)
  expect(e.reads.length).toBe(reads)
  expect(e.leaseAt()).toBe(at)
  // Back again: it wakes, finds its own lease stale, and takes it.
  await type($)
  await settle()
  expect(e.leaseAt()).toBe(NOW + 76 * 60_000)
})

const WAKERS: [string, ($: Engine) => Promise<unknown>][] = [
  ['a submitted prompt', $ => $.prompt.submit({ text: 'hi' } as never)],
  ['a turn starting', $ => $.turn.start({ text: 'hi', turnId: 't1' })],
  ['a tool call', $ => $.tool.call({ tool: 'Read', input: { file_path: '/tmp/x' } } as never).catch(() => undefined)],
  ['a turn completing', $ => $.turn.complete({ turnId: 't1', reason: 'answer' } as never)],
  ['a slash command', $ => $.command.run({ name: 'help' } as never)],
]
for (const [name, wake] of WAKERS) {
  test(`${name} wakes it too`, async ($, on) => {
    const e = engine(on, reports())
    on('tool.call', () => ({ result: '' }) as never)
    await $.session.start(START)
    await settle()
    await wake($)
    await settle()
    expect(e.lists.length).toBe(1)
    await e.clock.advance(10_000)
    await settle()
    expect(e.lists.length).toBe(2)
  })
}

test('a keystroke passes through as typed', async ($, on) => {
  const e = engine(on, reports())
  await $.session.start(START)
  expect(await type($)).toMatchObject({ text: 'abc', cursor: 3 })
  expect(e.edits).toEqual([KEY])
})

test("a press on one of this mod's rows wakes it", async ($, on) => {
  const e = engine(on, reports())
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  await started($)
  await e.clock.advance(11 * 60_000)
  await settle()
  const lists = e.lists.length
  const ui = await $.ui.mount({ plugin: 'ctx-heavy', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  // Asleep, the footer keeps the rows it last read.
  expect(await ui.find({ key: 'go-w6A:p1' })).toBeDefined()
  await ui.press({ key: 'go-w6A:p1' })
  await settle()
  expect(e.lists.length).toBe(lists + 1)
  await ui.unmount()
})

// Only the person's own panes are listed: one an agent drives (turn-mode's agentic, as an orchestrator sets its
// workers) is left out, and the next heaviest takes its place. Each row carries its cache from cache-timer's state.

test('a pane an agent drives is left out; each row carries its cache, and the footer shows its time left', async ($, on) => {
  const files = reports()
  files[`${CTX}/mode/w6A:p1.json`] = { text: JSON.stringify({ pane: 'w6A:p1', mode: 'agentic', driver: 'w9B:p1', setBy: 'agent', at: NOW }), mtimeMs: NOW }
  files[`${CTX}/mode/w6A:p2.json`] = { text: JSON.stringify({ pane: 'w6A:p2', mode: 'realtime', driver: null, setBy: 'human', at: NOW }), mtimeMs: NOW }
  files[`${CTX}/cache/w6A:p2.json`] = { text: JSON.stringify({ pane: 'w6A:p2', expiresAt: NOW + 31 * 60_000 + 5000, ttlMs: 3_600_000, isWorking: false }), mtimeMs: NOW }
  files[`${CTX}/cache/w71:p1.json`] = { text: JSON.stringify({ pane: 'w71:p1', expiresAt: NOW + 4 * 60_000 + 5000, ttlMs: 3_600_000, isWorking: false }), mtimeMs: NOW }
  files[`${CTX}/cache/w67:p1.json`] = { text: JSON.stringify({ pane: 'w67:p1', expiresAt: NOW + 50 * 60_000, ttlMs: 3_600_000, isWorking: true }), mtimeMs: NOW }
  const e = engine(on, files)
  await started($)
  const summary = JSON.parse(e.files[SUMMARY]!.text) as { rows: { pane: string; cache?: unknown }[] }
  expect(summary.rows.map(r => r.pane)).toEqual(['w6A:p2', 'w71:p1', 'w67:p1', 'w8P:p1'])
  expect(summary.rows[0]!.cache).toEqual({ expiresAt: NOW + 31 * 60_000 + 5000, ttlMs: 3_600_000, isWorking: false })

  const ui = await $.ui.mount({ plugin: 'ctx-heavy', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await ui.find({ key: 'go-w6A:p1' })).toBeUndefined()
  expect(await ui.find({ text: / 31m$/ })).toBeDefined()
  expect(await ui.find({ text: / 4m$/ })).toBeDefined()
  // Mid-turn (w67:p1, 50 minutes left): no time.
  expect(await ui.find({ text: / 50m$/ })).toBeUndefined()
  await ui.unmount()

  // The orchestrator hands the pane back (async): it is listed again on the next poll.
  files[`${CTX}/mode/w6A:p1.json`] = { text: JSON.stringify({ pane: 'w6A:p1', mode: 'async', driver: null, setBy: 'human', at: NOW + 5000 }), mtimeMs: NOW + 5000 }
  await e.clock.advance(10_000)
  await settle()
  expect((JSON.parse(e.files[SUMMARY]!.text) as { rows: { pane: string }[] }).rows[0]!.pane).toBe('w6A:p1')
})
