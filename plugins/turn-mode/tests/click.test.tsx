import { expect, test } from 'claude-code/testing'

import { engine, MODE_FILE } from './engine'

test('a click on the toggle wakes it: it reads the mode first, so a driver set while asleep goes back to async', async ($, on) => {
  const { files, reads, setMode, clock, start } = engine(on)
  on('ui.render', { component: 'SessionMode' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  await $.session.start(start)
  setMode('agentic', 'w9R:p3')
  await clock.advance(60_000)
  const ui = await $.ui.mount({ plugin: 'turn-mode', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  await ui.press({ key: 'turn-mode' })
  expect(JSON.parse(files[MODE_FILE]!)).toMatchObject({ mode: 'async', setBy: 'human' })
  const mark = reads.mode
  await clock.advance(3000)
  expect(reads.mode).toBe(mark + 1)
})
