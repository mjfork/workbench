import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const ENV: Record<string, string> = { CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude', HERDR_ENV: '1', HERDR_PANE_ID: 'w9B:p1', HERDR_WORKSPACE_ID: 'w9B' }

function engine(on: On, env: Record<string, string>) {
  const writes: { path: string; report: Record<string, unknown> }[] = []
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('fs.write', (_$, e) => {
    writes.push({ path: e.path, report: JSON.parse(e.text) })
    return { value: undefined } as never
  })
  on('clock.now', () => ({ value: 1_000 }))
  on('clock.after', () => ({ deny: 'no timers' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  const cost = { usd: 2 }
  on('session.usage', () => ({ value: { startedAt: 500, context: { tokens: 120_000, window: 1_000_000, percent: 12 }, rateLimits: [], cost: { ...cost } } }))
  on('session.messages', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.end', () => ({ sessionId: 's1' }))
  return { writes, cost }
}

test('a herdr session reports its fill, cost and last turns at start, on each measurement and turn, and when it ends', async ($, on) => {
  const { writes, cost } = engine(on, ENV)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  expect(writes.at(-1)).toEqual({
    path: '/home/ubuntu/.claude/ctx/w9B:p1.json',
    report: { pane: 'w9B:p1', workspace: 'w9B', tokens: 120_000, window: 1_000_000, at: 1_000, isEnded: false, startedAt: 500, usd: 2, turns: [] },
  })

  await $.session.measure({ context: { tokens: 150_000, window: 1_000_000, percent: 15 }, rateLimits: [], changed: ['context'] })
  expect(writes.at(-1)?.report.tokens).toBe(150_000)

  // A rate-limit move alone writes nothing.
  const count = writes.length
  await $.session.measure({ context: { tokens: 150_000, window: 1_000_000, percent: 15 }, rateLimits: [], changed: ['rateLimits'] })
  expect(writes.length).toBe(count)

  // A turn is priced by how much the session's cost grew while it ran.
  cost.usd = 2.75
  await $.turn.complete({
    reason: 'answer', answer: 'ok', durationMs: 42_000, isAborted: false, turnId: 't1',
    usage: { input_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 5_000, output_tokens: 1_200, model: 'claude-opus-5-5' },
  } as never)
  expect(writes.at(-1)?.report.usd).toBe(2.75)
  expect(writes.at(-1)?.report.turns).toEqual([
    { at: 1_000, durationMs: 42_000, usd: 0.75, inputTokens: 95_010, outputTokens: 1_200, model: 'claude-opus-5-5', reason: 'answer' },
  ])

  // A subagent's turn is not one of the session's turns.
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1' } as never)
  expect((writes.at(-1)?.report.turns as unknown[]).length).toBe(1)

  await $.session.end({ reason: 'other' } as never)
  expect(writes.at(-1)?.report.isEnded).toBe(true)
})

test('outside herdr nothing is written', async ($, on) => {
  const { writes } = engine(on, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.session.measure({ context: { tokens: 150_000, window: 1_000_000, percent: 15 }, rateLimits: [], changed: ['context'] })
  expect(writes).toEqual([])
})
