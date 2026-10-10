import { expect, test } from 'claude-code/testing'

import { BAND_PROPS, COMPOSER, DONE, engine, MIN, TAIL_5M } from './cache-engine'

test('"New session" runs /clear and leaves the prompt in the box', async ($, on) => {
  const { seen, clock, start } = engine(on, { tail: TAIL_5M })
  await $.session.start(start)
  await $.turn.complete(DONE)
  await clock.advance(6 * MIN)
  await $.prompt.submit(COMPOSER('fix the bug'))
  const pane = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  await pane.press({ key: 'cache-clear' })
  expect(seen.commands).toContain('clear')
  expect(seen.fills.at(-1)).toBe('fix the bug')
  expect(seen.submits).toEqual([])
})
