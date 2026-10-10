import { expect, test } from 'claude-code/testing'

import { BAND_PROPS, COMPOSER, DONE, engine, MIN, TAIL_5M } from './cache-engine'

// Its own file, so its stand-in hooks are the only ones answering.
test('a prompt typed into an unfocused pane on an expired, big cache: no card, no compaction: the prompt just goes', async ($, on) => {
  const { seen, clock, start } = engine(on, { focused: false, tail: TAIL_5M })
  await $.session.start(start)
  await $.turn.complete(DONE)
  await clock.advance(6 * MIN)
  const r = await $.prompt.submit(COMPOSER('continue with ## Next'))
  expect((r as { drop?: string }).drop).toBeUndefined()
  await clock.advance(10)
  expect(seen.compacts).toBe(0)
  expect(seen.submits).toEqual(['continue with ## Next'])
  expect(seen.fills).toEqual([])
  const band = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ text: /Prompt cache expired/ })).toBeUndefined()
})
