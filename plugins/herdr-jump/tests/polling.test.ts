import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

// Every pane's footer polls herdr for the same two facts: which pane is focused, and who is waiting. These hold the
// polling to one session for focus, and to the script's shared list for the queue.

const LEASE = '/home/ubuntu/.claude/ctx/focus/default.poller.json'
const CACHE = '/home/ubuntu/.herdr-queue/default/.list-cache'
const QUEUE = [{ pane: 'w8R:p1', workspace: 'w8R', label: 'x', kind: 'ask', ask: 'File it?', ts: 1000 }]
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as never
const settle = () => new Promise(r => setTimeout(r, 20))

function engine(on: On, files: Record<string, { text: string; mtimeMs?: number }> = {}) {
  const runs: string[][] = []
  const clock = mock.clock(on, { now: 100_000 })
  const env: Record<string, string> = { CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude', HOME: '/home/ubuntu', HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w9B', HERDR_PANE_ID: 'w9B:p1' }
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const stdout = e.argv[0] === 'herdr' ? JSON.stringify({ result: { panes: [{ pane_id: 'w9B:p2', focused: true }] } }) : JSON.stringify(QUEUE)
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_$, e) => {
    const f = files[e.path]
    if (f === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: f.text } as never
  })
  on('fs.stat', (_$, e) => {
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
  const herdrPolls = () => runs.filter(r => r[0] === 'herdr' && r[1] === 'pane' && r[2] === 'list').length
  const scriptLists = () => runs.filter(r => r[0] === 'bash' && r[2] === 'list').length
  return { runs, clock, files, herdrPolls, scriptLists }
}

test('with no lease, this session takes it and polls herdr for focus', async ($, on) => {
  const e = engine(on)
  await $.session.start(START)
  await settle()
  expect(e.herdrPolls()).toBe(1)
  expect(JSON.parse(e.files[LEASE]!.text)).toEqual({ pane: 'w9B:p1', at: 100_000 })
  // Its own lease: it keeps polling and renewing.
  await e.clock.advance(2000)
  await settle()
  expect(e.herdrPolls()).toBe(2)
  expect(JSON.parse(e.files[LEASE]!.text).at).toBe(102_000)
})

test("another session's fresh lease: this one does not poll, and takes over once the lease is 5 seconds old", async ($, on) => {
  const e = engine(on, { [LEASE]: { text: JSON.stringify({ pane: 'w1A:p1', at: 99_000 }) } })
  await $.session.start(START)
  await settle()
  await e.clock.advance(2000)
  await settle()
  expect(e.herdrPolls()).toBe(0)
  // The holder stopped renewing (its session ended): at 104s the lease is 5s old.
  await e.clock.advance(2000)
  await settle()
  expect(e.herdrPolls()).toBe(1)
  expect(JSON.parse(e.files[LEASE]!.text).pane).toBe('w9B:p1')
})

test('the queue poll reads the shared list while it is fresh, and starts the script only once it is stale', async ($, on) => {
  const e = engine(on, { [CACHE]: { text: JSON.stringify(QUEUE), mtimeMs: 98_000 } })
  await $.session.start(START)
  await settle()
  expect(e.scriptLists()).toBe(0)
  // At 110s the list is 12s old: still fresh. At 115s it is 17s old: past the 15s the script itself serves it for.
  await e.clock.advance(10_000)
  await settle()
  expect(e.scriptLists()).toBe(0)
  await e.clock.advance(5000)
  await settle()
  expect(e.scriptLists()).toBe(1)
})

test('with no shared list yet, or one that does not parse, the poll starts the script', async ($, on) => {
  const e = engine(on, { [CACHE]: { text: '[{"pane": ', mtimeMs: 100_000 } })
  await $.session.start(START)
  await settle()
  expect(e.scriptLists()).toBe(1)
})
