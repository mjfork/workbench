import { expect, test } from 'claude-code/testing'

import type { RenderPropsOf } from 'claude-code'
import { cardOf, heat, rowOf, span, topSessions } from '../hooks/register'

const ROWS = [
  { pane: 'w6A:p1', workspace: 'w6A', tokens: 703_931 },
  { pane: 'w6A:p2', workspace: 'w6A', tokens: 650_000 },
  { pane: 'w71:p1', workspace: 'w71', tokens: 309_572 },
  { pane: 'w67:p1', workspace: 'w67', tokens: 183_552 },
  { pane: 'w8P:p1', workspace: 'w8P', tokens: 155_158 },
  { pane: 'w6C:p1', workspace: 'w6C', tokens: 134_219 },
]

test('ranks the heaviest sessions, however many share a workspace, and colors by size', () => {
  const top = topSessions(ROWS.map(r => ({ ...r, report: { ...r, window: 1_000_000, at: 0, isEnded: false } })))
  expect(top.map(r => r.pane)).toEqual(['w6A:p1', 'w6A:p2', 'w71:p1', 'w67:p1'])
  expect([heat(500_001), heat(500_000), heat(300_001), heat(300_000)]).toEqual(['red', 'yellow', 'yellow', 'white'])
})

test('a report reads as a row unless ended or cut mid-write', () => {
  const report = { pane: 'w6A:p1', workspace: 'w6A', tokens: 703_931, window: 1_000_000, at: 1, isEnded: false }
  expect(rowOf(JSON.stringify(report))).toMatchObject({ pane: 'w6A:p1', workspace: 'w6A', tokens: 703_931 })
  expect(rowOf(JSON.stringify({ ...report, isEnded: true }))).toBeNull()
  expect(rowOf('{"pane":"w6A')).toBeNull()
})

test('the card shows the fill, cost and age, then the last turns newest first', () => {
  expect([span(42_000), span(185_000), span(7_800_000)]).toEqual(['42s', '3m05s', '2h10m'])
  const now = 10_000_000
  const turn = { durationMs: 42_000, inputTokens: 95_010, outputTokens: 1_200, model: 'claude-opus-5-5', reason: 'answer' }
  const card = cardOf({
    pane: 'w45:p1', workspace: 'w45', tokens: 354_772, window: 1_000_000, at: now, isEnded: false,
    startedAt: now - 7_800_000, usd: 9.55,
    turns: [{ ...turn, at: now - 600_000, usd: 0.5 }, { ...turn, at: now - 180_000, usd: null, reason: 'aborted' }],
  }, now)
  expect(card).toEqual([
    'w45:p1  355k/1000k (35%)  $9.55 total  up 2h10m',
    ' 3m00s ago     42s      $?  95k in · 1.2k out  opus-5-5  aborted',
    '10m00s ago     42s   $0.50  95k in · 1.2k out  opus-5-5',
  ])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`keeps the line beneath and adds the heaviest sessions under it on ${surface}`, async ($, on) => {
    const runs: string[][] = []
    on('env.get', (_$, e) => ({ value: ({ CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude', HERDR_ENV: '1' } as Record<string, string>)[e.name] }))
    on('process.run', (_$, e) => {
      runs.push([...e.argv])
      return { value: { exitCode: 0, stdout: '{}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    // The reports each session's ctx-bar writes, plus one ended and one stale.
    const NOW = 100 * 24 * 3600 * 1000
    const files: Record<string, { text: string; mtimeMs: number }> = Object.fromEntries(
      ROWS.map(r => [`${r.pane}.json`, { text: JSON.stringify({ ...r, window: 1_000_000, at: NOW, isEnded: false }), mtimeMs: NOW - 1000 }]),
    )
    files['w99:p1.json'] = { text: JSON.stringify({ pane: 'w99:p1', workspace: 'w99', tokens: 900_000, window: 1_000_000, at: NOW, isEnded: true }), mtimeMs: NOW }
    files['w98:p1.json'] = { text: JSON.stringify({ pane: 'w98:p1', workspace: 'w98', tokens: 950_000, window: 1_000_000, at: 0, isEnded: false }), mtimeMs: 0 }
    on('clock.now', () => ({ value: NOW }))
    on('fs.list', () => ({
      value: Object.entries(files).map(([name, f]) => ({ name, kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })),
    }))
    on('fs.read', (_$, e) => ({ value: files[e.path.split('/').at(-1) ?? '']?.text ?? '' }))
    on('clock.every', () => ({ deny: 'no timers' }) as never)
    on('fs.write', () => ({ value: undefined }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
    // Stands for herdr-jump's line, the one this mod runs ahead of.
    on('ui.render', { component: 'SessionMode' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: ['herdr w9B'] })
    })
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: ['their band'] })
    })

    await $.session.start({ cwd: '/tmp', surface, isInteractive: true } as never)
    // The refreshes session.start leaves running settle before drawing.
    await new Promise(r => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => r(undefined), 20))

    const ui = await $.ui.mount({ plugin: 'ctx-heavy', surface, component: 'SessionMode', props: { modes: [] } })
    expect(await ui.find({ text: /herdr w9B/ })).toBeDefined()
    // Both w6A sessions show; w8P, fifth heaviest, does not.
    expect(await ui.find({ key: 'go-w6A:p1' })).toBeDefined()
    expect(await ui.find({ key: 'go-w6A:p2' })).toBeDefined()
    expect(await ui.find({ key: 'go-w8P:p1' })).toBeUndefined()
    expect(await ui.find({ key: 'go-w99:p1' })).toBeUndefined()
    // Every session goes by its full pane ID, alone in its workspace or not.
    expect(await ui.find({ text: /^w71:p1$/ })).toBeDefined()
    expect(await ui.find({ text: /^w71$/ })).toBeUndefined()
    expect(await ui.find({ key: 'go-w98:p1' })).toBeUndefined()
    // Each token count opens its session's card in the band, hidden until hovered.
    expect(await ui.find({ key: 'tokens-w6A:p2' })).toBeDefined()
    const band = await $.ui.mount({
      plugin: 'ctx-heavy', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as RenderPropsOf['AbovePrompt'],
    })
    expect(await band.find({ key: 'card-w6A:p1' })).toBeDefined()
    expect(await band.find({ key: 'card-w6A:p2' })).toBeDefined()
    expect(await band.find({ text: /w6A:p1  704k\/1000k \(70%\)/ })).toBeDefined()
    expect(await band.find({ text: /their band/ })).toBeDefined()
    await band.unmount()

    // Fullscreen: the card floats from the count itself, and the band stays empty of it.
    const full = { columns: 200, rows: 50, isFullscreen: true }
    const footer = await $.ui.mount({ plugin: 'ctx-heavy', surface, component: 'SessionMode', props: { modes: [] }, viewport: full })
    expect(await footer.find({ text: /w6A:p1  704k\/1000k \(70%\)/ })).toBeDefined()
    await footer.unmount()
    const fullBand = await $.ui.mount({
      plugin: 'ctx-heavy', surface, component: 'AbovePrompt', viewport: full,
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as RenderPropsOf['AbovePrompt'],
    })
    expect(await fullBand.find({ key: 'card-w6A:p1' })).toBeUndefined()
    await fullBand.unmount()

    await ui.press({ key: 'go-w71:p1' })
    expect(runs).toContainEqual(['herdr', 'agent', 'focus', 'w71:p1'])
    await ui.press({ key: 'go-w6A:p2' })
    expect(runs).toContainEqual(['herdr', 'agent', 'focus', 'w6A:p2'])
    await ui.unmount()
  })
}
