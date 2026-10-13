import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// What an idle session costs: ~60 sessions load this mod, so a plain turn should start no process, and a queue that has
// not changed should draw no footer again.

const HOME = '/home/ubuntu'
const REPLIED = `${HOME}/.herdr-queue/default/w9B_p1.json.replied`
const CACHE = `${HOME}/.herdr-queue/default/.list-cache`
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as never
const DONE = { reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' }
const ASK = 'Done.\n\n## ⚑ Needs you\n**Ask:** Approve?'
const settle = () => new Promise(r => setTimeout(r, 20))

function engine(on: On, files: Record<string, { text: string; mtimeMs?: number }> = {}, queue: readonly unknown[] = []) {
  const runs: string[][] = []
  const writes: string[] = []
  let draws = 0
  const clock = mock.clock(on, { now: 100_000 })
  const env: Record<string, string> = { CLAUDE_CONFIG_DIR: `${HOME}/.claude`, HOME, HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w9B', HERDR_PANE_ID: 'w9B:p1' }
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const stdout = e.argv[0] === 'bash' && e.argv[2] === 'list' ? JSON.stringify(queue) : '{}'
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
  on('fs.write', () => ({ value: undefined }) as never)
  on('state.set', ($, e, next) => {
    writes.push((e as { key: string }).key)
    return next(e)
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => {
    draws++
    return { type: 'Text', props: {}, children: ['modes'] } as never
  })
  const stops = () => runs.filter(r => r[0] === 'bash' && r[2] === 'stop').length
  return { runs, writes, clock, files, stops, draws: () => draws }
}

test('a turn with no Needs-you section and no relayed reply starts no process', async ($, on) => {
  const e = engine(on)
  await $.session.start(START)
  await $.turn.complete({ ...DONE, answer: 'All done; the tests pass.' } as never)
  await settle()
  expect(e.stops()).toBe(0)
})

test('a turn with a Needs-you section starts the script, whatever the heading level or case', async ($, on) => {
  const e = engine(on)
  await $.session.start(START)
  await $.turn.complete({ ...DONE, answer: ASK } as never)
  await $.turn.complete({ ...DONE, answer: 'x\n### ⚑   NEEDS YOU\nok?' } as never)
  await settle()
  expect(e.stops()).toBe(2)
})

test('a heading not at the start of its line is not a section: the turn starts nothing', async ($, on) => {
  const e = engine(on)
  await $.session.start(START)
  await $.turn.complete({ ...DONE, answer: 'Write a "## ⚑ Needs you" section when blocked.' } as never)
  await settle()
  expect(e.stops()).toBe(0)
})

test('a turn with no section but a relayed reply waiting starts the script, which closes the ask', async ($, on) => {
  const e = engine(on, { [REPLIED]: { text: '' } })
  await $.session.start(START)
  await $.turn.complete({ ...DONE, answer: 'Done as you said.' } as never)
  await settle()
  expect(e.stops()).toBe(1)
})

test('an empty answer starts the script: it may find the text in the transcript', async ($, on) => {
  const e = engine(on)
  await $.session.start(START)
  await $.turn.complete({ ...DONE, answer: '' } as never)
  await settle()
  expect(e.stops()).toBe(1)
})

const ITEM = { pane: 'w8R:p1', workspace: 'w8R', label: 'x', kind: 'ask', ask: 'File it?', ts: 10 }

test('an unchanged empty queue on repeated polls writes no state and draws no footer again', async ($, on) => {
  const e = engine(on, { [CACHE]: { text: '[]', mtimeMs: 100_000 } })
  await $.session.start(START)
  await settle()
  await $.ui.mount({ plugin: 'herdr-jump', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const [writes, draws] = [e.writes.length, e.draws()]
  for (let i = 0; i < 2; i++) {
    e.files[CACHE]!.mtimeMs = 100_000 + (i + 1) * 5000
    await e.clock.advance(5000)
    await settle()
  }
  expect(e.writes.length).toBe(writes)
  expect(e.draws()).toBe(draws)
})

test('an unchanged queue of old asks writes nothing until its shown age changes', async ($, on) => {
  // The ask is 99,990s old: shown as 27h, which stays the same across these polls.
  const e = engine(on, { [CACHE]: { text: JSON.stringify([ITEM]), mtimeMs: 100_000 } })
  await $.session.start(START)
  await settle()
  const writes = e.writes.length
  for (let i = 0; i < 3; i++) {
    e.files[CACHE]!.mtimeMs = 100_000 + (i + 1) * 5000
    await e.clock.advance(5000)
    await settle()
  }
  expect(e.writes.length).toBe(writes)
})

test('a queue that changes is written', async ($, on) => {
  const e = engine(on, { [CACHE]: { text: '[]', mtimeMs: 100_000 } })
  await $.session.start(START)
  await settle()
  e.files[CACHE] = { text: JSON.stringify([ITEM]), mtimeMs: 105_000 }
  await e.clock.advance(5000)
  await settle()
  expect(e.writes).toContain('queue')
})

test('a fresh ask shown in seconds keeps its age current: the time is written as the shown age moves', async ($, on) => {
  const e = engine(on, { [CACHE]: { text: JSON.stringify([{ ...ITEM, ts: 99 }]), mtimeMs: 100_000 } })
  await $.session.start(START)
  await settle()
  const nows = e.writes.filter(k => k === 'now').length
  e.files[CACHE]!.mtimeMs = 105_000
  await e.clock.advance(5000)
  await settle()
  expect(e.writes.filter(k => k === 'now').length).toBe(nows + 1)
})
