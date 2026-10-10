import { expect, test } from 'claude-code/testing'

import { engine, say, TRANSCRIPT } from './engine'

test('after a compaction the next prompt is told again', { plugins: [TRANSCRIPT] }, async ($, on) => {
  const { contexts, start } = engine(on)
  await $.session.start(start)
  await $.prompt.submit(say('one'))
  await $.session.compact({ trigger: 'manual', messages: [] } as never)
  await $.prompt.submit(say('two'))
  expect(contexts[1]!.join()).toContain('[turn mode: async]')
})
