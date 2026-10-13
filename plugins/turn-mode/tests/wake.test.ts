import { expect, test } from 'claude-code/testing'

import { engine, type } from './engine'

test('a keystroke wakes it: the mode is read at once, then every 3s, until 10 idle minutes put it back to sleep', async ($, on) => {
  const { reads, edits, clock, start } = engine(on)
  await $.session.start(start)
  await clock.advance(60_000)
  const asleep = reads.mode

  // The edit passes through as typed.
  const box = await $.prompt.edit(type('fix', 'e'))
  expect(box).toMatchObject({ text: 'fixe', cursor: 4 })
  expect(edits).toEqual([type('fix', 'e')])
  await clock.settle()
  expect(reads.mode).toBe(asleep + 1)
  await clock.advance(3000)
  expect(reads.mode).toBe(asleep + 2)
  await clock.advance(6000)
  expect(reads.mode).toBe(asleep + 4)

  // More typing only extends the deadline; it starts no second timer.
  await $.prompt.edit(type('fixe', 's'))
  await clock.settle()
  await clock.advance(3000)
  expect(reads.mode).toBe(asleep + 5)

  // Ten idle minutes later it has stopped polling.
  await clock.advance(10 * 60_000 + 6000)
  const stopped = reads.mode
  await clock.advance(60_000)
  expect(reads.mode).toBe(stopped)
})
