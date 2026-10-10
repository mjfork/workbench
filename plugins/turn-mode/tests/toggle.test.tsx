import { expect, test } from 'claude-code/testing'

import { engine, MODE_FILE, say } from './engine'

// Its own file, so its stand-in hooks are the only ones answering.
test("the footer toggle shows a driver's mode, and a click writes the pane's mode file", async ($, on) => {
  const { files, contexts, setMode, clock, start } = engine(on)
  // Stands for the block beneath: herdr-jump's line, the heaviest workspaces, the bar.
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({ flexDirection: 'column', children: [Text({ children: ['herdr w9B'] }), Text({ children: ['w6A 704k'] }), Text({ children: ['████░░'] })] })
  })
  await $.session.start(start)
  const footer = () => $.ui.mount({ plugin: 'turn-mode', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await (await footer()).find({ text: /^async$/ })).toBeDefined()
  expect(await (await footer()).find({ text: /w6A 704k/ })).toBeDefined()

  // A driver's turn-mode.sh shows within the refresh.
  setMode('agentic', 'w9R:p3')
  await clock.advance(3000)
  const ui = await footer()
  expect(await ui.find({ text: /agentic/ })).toBeDefined()

  // A click hands it back to async; the next prompt is told so.
  await ui.press({ key: 'turn-mode' })
  expect(JSON.parse(files[MODE_FILE]!)).toMatchObject({ mode: 'async', driver: null, setBy: 'human' })
  await ui.press({ key: 'turn-mode' })
  expect(JSON.parse(files[MODE_FILE]!).mode).toBe('realtime')
  await $.prompt.submit(say('go'))
  expect(contexts[0]!.join()).toContain('[turn mode: real-time]')
})
