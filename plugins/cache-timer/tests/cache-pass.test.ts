import { expect, test } from 'claude-code/testing'

import { COMPOSER, DONE, engine, MIN } from './cache-engine'

test('a warm cache, a slash command, or a fresh session passes straight through', async ($, on) => {
  const { seen, clock, start } = engine(on)
  await $.session.start(start)
  // No response yet (fresh session): nothing to lose.
  await clock.advance(8 * MIN)
  await $.prompt.submit(COMPOSER('first'))
  await $.turn.complete(DONE)
  await clock.advance(1 * MIN)
  await $.prompt.submit(COMPOSER('warm'))
  await clock.advance(5 * MIN)
  await $.prompt.submit(COMPOSER('/compact'))
  expect(seen.submits).toEqual(['first', 'warm', '/compact'])
  expect(seen.opened).toEqual([])
})
