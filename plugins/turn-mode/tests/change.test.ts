import { expect, test } from 'claude-code/testing'

import { engine, say } from './engine'

test('a mode change is told on the next prompt: real-time, then agentic with its driver', async ($, on) => {
  const { contexts, setMode, start } = engine(on)
  await $.session.start(start)
  await $.prompt.submit(say('one'))
  setMode('realtime')
  await $.prompt.submit(say('two'))
  await $.prompt.submit(say('three'))
  setMode('agentic', 'w9R:p3')
  await $.prompt.submit(say('four'))
  expect(contexts[1]!.join()).toContain('[turn mode: real-time]')
  expect(contexts[2]).toEqual([])
  expect(contexts[3]!.join()).toContain('[turn mode: agentic, driver w9R:p3]')
  expect(contexts[3]!.join()).toContain('`DONE`, `BLOCKED: <reason>`, `NEEDS-INPUT: <reason>`, then one plain sentence')
})
