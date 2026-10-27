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

test('a compaction its own hook never saw still has the next prompt told, once', async ($, on) => {
  const { contexts, start, compactBehind } = engine(on)
  await $.session.start(start)
  await $.prompt.submit(say('one'))
  await $.prompt.submit(say('two'))
  compactBehind()
  await $.prompt.submit(say('three'))
  await $.prompt.submit(say('four'))
  expect(contexts.map(c => c.join().includes('[turn mode: async]'))).toEqual([true, false, true, false])
})
