import { expect, test } from 'claude-code/testing'

import { engine } from './engine'

// Idle sessions stay asleep, so their memory can stay swapped out.
test('a session starts asleep: with no input, a minute passes without reading the mode file', async ($, on) => {
  const { reads, clock, start } = engine(on)
  await $.session.start(start)
  const before = reads.mode
  await clock.advance(60_000)
  expect(reads.mode).toBe(before)
})
