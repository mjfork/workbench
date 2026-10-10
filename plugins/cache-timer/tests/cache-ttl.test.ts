import { expect, test } from 'claude-code/testing'

import { engine, MIN } from './cache-engine'

// The resumed transcript's last response wrote to the 1h cache.
const TAIL = JSON.stringify({ type: 'assistant', timestamp: new Date(0).toISOString(), message: { usage: { cache_creation: { ephemeral_1h_input_tokens: 900, ephemeral_5m_input_tokens: 0 } } } })

test('a resumed session counts down from its transcript: last response time and the TTL it wrote with', async ($, on) => {
  const { clock, start } = engine(on, { tail: TAIL })
  await $.session.start(start)
  await clock.advance(10 * MIN)
  const footer = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await footer.find({ text: /cache 50m/ })).toBeDefined()
})
