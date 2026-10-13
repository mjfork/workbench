import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// ~55 sessions on one machine: an idle one that polls on a timer wakes its whole process every few seconds, so the
// system can never leave it swapped out. A session starts asleep and polls nothing; the person's input, its own work,
// or a slash command wakes it; ten minutes with none of those puts it back to sleep.

const LEASE = '/home/ubuntu/.claude/ctx/focus/default.poller.json'
const CACHE = '/home/ubuntu/.herdr-queue/default/.list-cache'
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as never
const EDIT = { origin: { kind: 'composer' }, text: 'ab', cursor: 2, start: 2, end: 2, inputText: 'c' } as never
const MINUTE = 60_000

function engine(on: On) {
  const runs: string[][] = []
  const reads: string[] = []
  const edits: unknown[] = []
  const clock = mock.clock(on, { now: 100_000 })
  const files: Record<string, { text: string; mtimeMs?: number }> = {}
  const env: Record<string, string> = { CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude', HOME: '/home/ubuntu', HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w9B', HERDR_PANE_ID: 'w9B:p1' }
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const stdout = e.argv[0] === 'herdr' ? JSON.stringify({ result: { panes: [{ pane_id: 'w9B:p2', focused: true }] } }) : '[]'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    const f = files[e.path]
    if (f === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: f.text } as never
  })
  on('fs.stat', (_$, e) => {
    reads.push(e.path)
    const f = files[e.path]
    if (f === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs ?? 0, isLink: false } } as never
  })
  on('fs.write', (_$, e) => {
    files[e.path] = { text: e.text }
    return { value: undefined } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('prompt.edit', (_$, e) => {
    edits.push(e)
    return { text: 'abc', cursor: 3 } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: {}, text: 'ran' }) as never)
  on('command.run', () => ({}) as never)
  const herdrPolls = () => runs.filter(r => r[0] === 'herdr' && r[1] === 'pane' && r[2] === 'list').length
  const scriptLists = () => runs.filter(r => r[0] === 'bash' && r[2] === 'list').length
  const queueReads = () => reads.filter(p => p === CACHE).length
  const leaseReads = () => reads.filter(p => p === LEASE).length
  return { runs, reads, edits, clock, files, herdrPolls, scriptLists, queueReads, leaseReads }
}

test('a session that has had no input polls nothing: no herdr pane list, no queue reads, no script', async ($, on) => {
  const e = engine(on)
  await $.session.start(START)
  await e.clock.advance(MINUTE)
  await e.clock.settle()
  expect(e.herdrPolls()).toBe(0)
  expect(e.scriptLists()).toBe(0)
  expect(e.queueReads()).toBe(0)
  expect(e.leaseReads()).toBe(0)
})

test('the first edit in the prompt box wakes it: one refresh at once, then the polls run', async ($, on) => {
  const e = engine(on)
  await $.session.start(START)
  await e.clock.advance(MINUTE)
  await $.prompt.edit(EDIT)
  await e.clock.settle()
  expect(e.herdrPolls()).toBe(1)
  expect(e.queueReads()).toBe(1)
  await e.clock.advance(2000)
  await e.clock.settle()
  expect(e.herdrPolls()).toBe(2)
  await e.clock.advance(3000)
  await e.clock.settle()
  expect(e.queueReads()).toBe(2)
})

test('more edits while awake start no second set of timers', async ($, on) => {
  const e = engine(on)
  await $.session.start(START)
  for (let i = 0; i < 5; i++) await $.prompt.edit(EDIT)
  await e.clock.settle()
  expect(e.herdrPolls()).toBe(1)
  await e.clock.advance(2000)
  await e.clock.settle()
  expect(e.herdrPolls()).toBe(2)
})

test('ten minutes with no input puts it back to sleep: the polls stop', async ($, on) => {
  const e = engine(on)
  await $.session.start(START)
  await $.prompt.edit(EDIT)
  await e.clock.advance(11 * MINUTE)
  await e.clock.settle()
  const [polls, reads] = [e.herdrPolls(), e.queueReads()]
  expect(polls).toBeGreaterThan(250)
  await e.clock.advance(5 * MINUTE)
  await e.clock.settle()
  expect(e.herdrPolls()).toBe(polls)
  expect(e.queueReads()).toBe(reads)
  // And the next edit wakes it again.
  await $.prompt.edit(EDIT)
  await e.clock.settle()
  expect(e.herdrPolls()).toBe(polls + 1)
})

test('input while awake holds off sleep: ten minutes are counted from the last one', async ($, on) => {
  const e = engine(on)
  await $.session.start(START)
  await $.prompt.edit(EDIT)
  await e.clock.advance(8 * MINUTE)
  await $.prompt.edit(EDIT)
  await e.clock.advance(7 * MINUTE)
  await e.clock.settle()
  const polls = e.herdrPolls()
  await e.clock.advance(2000)
  await e.clock.settle()
  expect(e.herdrPolls()).toBe(polls + 1)
  await e.clock.advance(5 * MINUTE)
  await e.clock.settle()
  const later = e.herdrPolls()
  await e.clock.advance(MINUTE)
  await e.clock.settle()
  expect(e.herdrPolls()).toBe(later)
})

const WAKERS: [string, (x: Parameters<Parameters<typeof test>[1]>[0]) => Promise<unknown>][] = [
  ['a turn starting', $ => $.turn.start({ text: 'go', turnId: 't1' } as never)],
  ['a tool call', $ => $.tool.call({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'b1' } as never)],
  ['a turn ending', $ => $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never)],
  ['a prompt', $ => $.prompt.submit({ text: 'hi', origin: { kind: 'composer' }, wait: false } as never)],
  ['a slash command', $ => $.command.run({ command: 'model', args: '', origin: { kind: 'composer' } } as never)],
]

for (const [name, wake] of WAKERS) {
  test(`${name} wakes it too`, async ($, on) => {
    const e = engine(on)
    await $.session.start(START)
    await e.clock.advance(MINUTE)
    await wake($)
    await e.clock.settle()
    expect(e.herdrPolls()).toBe(1)
    await e.clock.advance(2000)
    await e.clock.settle()
    expect(e.herdrPolls()).toBe(2)
  })
}

test('an edit goes through untouched: the same edit beneath, the same box back', async ($, on) => {
  const e = engine(on)
  await $.session.start(START)
  const box = await $.prompt.edit(EDIT)
  await $.prompt.edit(EDIT)
  expect(e.edits).toEqual([EDIT, EDIT])
  expect(box).toEqual({ text: 'abc', cursor: 3 })
})
