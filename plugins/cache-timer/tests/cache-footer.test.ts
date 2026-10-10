import { expect, test } from 'claude-code/testing'

import { DONE, engine, MIN, TAIL_5M } from './cache-engine'

test('the footer counts down, yellow in the last quarter (5-minute tier: 1.25 minutes), red once expired', async ($, on) => {
  const { clock, start } = engine(on, { tail: TAIL_5M })
  await $.session.start(start)
  await $.turn.complete(DONE)
  const footer = async () => $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })

  await clock.advance(1 * MIN)
  expect(await (await footer()).find({ text: /cache 4m/ })).toBeDefined()
  await clock.advance(3 * MIN)
  expect(await (await footer()).find({ text: /cache 1m/ })).toBeDefined()
  await clock.advance(2 * MIN)
  expect(await (await footer()).find({ text: /cache expired/ })).toBeDefined()

  // While a turn runs the cache is in use: no timer.
  await $.turn.start({ text: 'go', turnId: 't2' } as never)
  expect(await (await footer()).find({ text: /cache/ })).toBeUndefined()
})
