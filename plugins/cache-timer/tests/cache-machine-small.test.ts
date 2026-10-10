import { expect, test } from 'claude-code/testing'

import { COMPOSER, DONE, engine, MIN, TAIL_5M } from './cache-engine'

// Its own file, so its stand-in hooks are the only ones answering.
test('a small context on an expired cache just goes too', async ($, on) => {
  const { seen, clock, start } = engine(on, { focused: false, tokens: 60_000, tail: TAIL_5M })
  await $.session.start(start)
  await $.turn.complete(DONE)
  await clock.advance(6 * MIN)
  await $.prompt.submit(COMPOSER('go on'))
  await clock.advance(10)
  expect(seen.compacts).toBe(0)
  expect(seen.submits).toEqual(['go on'])
})
