import { expect, test } from 'claude-code/testing'

import { engine, say } from './engine'

test('a slash command carries nothing and does not count as told', async ($, on) => {
  const { contexts, start } = engine(on)
  await $.session.start(start)
  await $.prompt.submit(say('/compact'))
  await $.prompt.submit(say('go'))
  expect(contexts[0]).toEqual([])
  expect(contexts[1]!.join()).toContain('[turn mode: async]')
})
