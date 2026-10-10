import { expect, test } from 'claude-code/testing'

import { engine, say } from './engine'

test("a peer's message runs that turn as peer; the next prompt is told the session mode again", async ($, on) => {
  const { contexts, start } = engine(on)
  await $.session.start(start)
  await $.prompt.submit(say('one'))
  await $.prompt.submit(say('<cross-session-message from="x">hi</cross-session-message>', 'peer-send-message'))
  await $.prompt.submit(say('two'))
  expect(contexts[1]!.join()).toContain("[this turn: a peer session's message]")
  expect(contexts[2]!.join()).toContain('[turn mode: async]')
})
