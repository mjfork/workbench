import { expect, test } from 'claude-code/testing'

import { engine, say } from './engine'

test('async by default, told once: the first prompt carries it, the next does not', async ($, on) => {
  const { contexts, start } = engine(on)
  await $.session.start(start)
  await $.prompt.submit(say('fix it'))
  await $.prompt.submit(say('and the tests'))
  expect(contexts[0]!.join()).toContain('[turn mode: async]')
  expect(contexts[0]!.join()).toContain('## ⚑ Needs you')
  expect(contexts[0]!.join()).toContain('**Possible next steps**')
  expect(contexts[1]).toEqual([])
})
