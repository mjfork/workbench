import { expect, test } from 'claude-code/testing'

import { isMachinePrompt } from '../hooks/cache'
import { COMPOSER, DONE, engine, MIN, TAIL_5M } from './cache-engine'

test('machine prompts by origin or shape', () => {
  expect([isMachinePrompt('composer', 'fix it'), isMachinePrompt('bridge', 'fix it')]).toEqual([false, false])
  expect([isMachinePrompt('projects-relay', 'x'), isMachinePrompt('peer-send-message', 'x'), isMachinePrompt('coordinator', 'x')]).toEqual([true, true, true])
  expect([isMachinePrompt('composer', '[inbox] 2 new'), isMachinePrompt('composer', '  <cross-session-message>')]).toEqual([true, true])
})

// Its own file, so its stand-in hooks are the only ones answering.
test('a bracketed nudge typed into a focused pane is still a machine prompt', async ($, on) => {
  const { seen, clock, start } = engine(on, { focused: true, tail: TAIL_5M })
  await $.session.start(start)
  await $.turn.complete(DONE)
  await clock.advance(6 * MIN)
  await $.prompt.submit(COMPOSER('[inbox] thread t-0007 asked a question'))
  await clock.advance(10)
  expect(seen.compacts).toBe(0)
  expect(seen.fills).toEqual([])
})
