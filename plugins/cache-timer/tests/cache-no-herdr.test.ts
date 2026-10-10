import { expect, test } from 'claude-code/testing'

import { BAND_PROPS, COMPOSER, DONE, engine, MIN, TAIL_5M } from './cache-engine'

// No herdr in the environment: no pane, no workspace. The timer, the card and the state file still work.
const NO_HERDR = { CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude' }

test('outside herdr the timer counts down and the state file is keyed by session', async ($, on) => {
  const { seen, clock, start } = engine(on, { env: NO_HERDR })
  await $.session.start(start)
  await $.turn.complete(DONE)
  const footer = async () => $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  await clock.advance(1 * MIN)
  expect(await (await footer()).find({ text: /cache 59m/ })).toBeDefined()
  expect(JSON.parse(seen.files['/home/ubuntu/.claude/ctx/cache/s1.json']!)).toMatchObject({ pane: null, session: 's1' })
})

test('outside herdr an expired cache still holds the prompt and asks', async ($, on) => {
  const { seen, clock, start } = engine(on, { env: NO_HERDR, tail: TAIL_5M })
  await $.session.start(start)
  await $.turn.complete(DONE)
  await clock.advance(6 * MIN)
  const held = await $.prompt.submit(COMPOSER('fix the bug'))
  expect((held as { drop?: string }).drop).toBeDefined()
  const pane = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await pane.find({ key: 'cache-send' })).toBeDefined()
  expect(seen.fills.at(-1)).toBe('fix the bug')
})
