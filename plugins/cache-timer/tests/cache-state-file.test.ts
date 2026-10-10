import { expect, test } from 'claude-code/testing'

import { DONE, engine, MIN } from './cache-engine'

const FILE = '/home/ubuntu/.claude/ctx/cache/w9B:p1.json'

test('each pane writes its cache state for other sessions: at start, turn start and turn end', async ($, on) => {
  const { seen, clock, start } = engine(on)
  await $.session.start(start)
  expect(JSON.parse(seen.files[FILE]!)).toMatchObject({ pane: 'w9B:p1', session: 's1', lastResponseAt: null, expiresAt: null, isWorking: false })

  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  expect(JSON.parse(seen.files[FILE]!).isWorking).toBe(true)

  await clock.advance(1 * MIN)
  await $.turn.complete(DONE)
  const state = JSON.parse(seen.files[FILE]!)
  // No transcript to say otherwise: the 1-hour TTL.
  expect(state).toMatchObject({ isWorking: false, lastResponseAt: 1 * MIN, ttlMs: 60 * MIN, expiresAt: 61 * MIN })
})
