import { expect, test } from 'claude-code/testing'

import { engine, say } from './engine'

test('the instructions refer to "the user"', async ($, on) => {
  const { contexts, start } = engine(on)
  await $.session.start(start)
  await $.prompt.submit(say('fix it'))
  const text = contexts[0]!.join('\n')
  expect(text).toContain('the user reads this session later')
  expect(text).toContain('queues this pane for the user')
})
