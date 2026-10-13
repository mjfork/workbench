import type { On, RenderPropsOf } from 'claude-code'
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
    lists.push(e.path ?? '')
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
  return { clock, files, reads, lists, sets, reportReads, summaryReads }
}

test('with no summary, this session takes the lease, reads the reports, and writes one summary', async ($, on) => {
  const e = engine(on, reports())
  await $.session.start(START)
  await settle()
  const summary = JSON.parse(e.files[SUMMARY]!.text) as { pane: string; at: number; rows: { pane: string }[] }
  expect(summary.pane).toBe('w9B:p1')
  expect(summary.at).toBe(NOW)
  expect(summary.rows.map(r => r.pane)).toEqual(['w6A:p1', 'w6A:p2', 'w71:p1', 'w67:p1'])
  expect(e.reportReads()).toBe(6)
})

test('holding the lease, a poll reads only the reports that changed since it last read them, ended ones included', async ($, on) => {
  const e = engine(on, reports())
  await $.session.start(START)
  await settle()
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
  const held = { pane: 'w1A:p1', at: NOW - 1000, rows: [{ pane: 'w5Z:p1', workspace: 'w5Z', tokens: 420_000, report: JSON.parse(report('w5Z:p1', 420_000)) }] }
  files[SUMMARY] = { text: JSON.stringify(held), mtimeMs: NOW - 1000 }
  const e = engine(on, files)
  await $.session.start(START)
  await settle()
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
  await $.session.start(START)
  await settle()
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
  await $.session.start(START)
  await settle()
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
