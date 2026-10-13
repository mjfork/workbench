import { expect, test } from 'claude-code/testing'

import { engine, say } from './engine'

test('a prompt, a turn, a tool and a slash command each wake it; a prompt straight from sleep is told the current mode', async ($, on) => {
  const { reads, contexts, setMode, clock, start } = engine(on)
  await $.session.start(start)
  const idle = 11 * 60_000

  // Asleep, the mode changes; the next prompt reads it fresh.
  setMode('realtime')
  await clock.advance(idle)
  await $.prompt.submit(say('go'))
  expect(contexts[0]!.join()).toContain('[turn mode: real-time]')
  await clock.settle()
  let mark = reads.mode
  await clock.advance(3000)
  expect(reads.mode).toBe(mark + 1)

  const wakers: [string, () => Promise<unknown>][] = [
    ['turn.start', () => $.turn.start({ text: 'go', turnId: 't1' } as never)],
    ['turn.complete', () => $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)],
    ['tool.call', () => $.tool.call({ tool: 'Read', input: { file_path: '/x' } } as never)],
    ['command.run', () => $.command.run({ command: 'status' } as never)],
  ]
  for (const [name, wake] of wakers) {
    await clock.advance(idle)
    mark = reads.mode
    await clock.advance(60_000)
    expect([name, reads.mode]).toEqual([name, mark])
    await wake()
    await clock.settle()
    await clock.advance(3000)
    expect([name, reads.mode]).toEqual([name, mark + 2])
  }
})
