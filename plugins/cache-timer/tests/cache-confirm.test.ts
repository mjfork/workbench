import { expect, test } from 'claude-code/testing'

import { BAND_PROPS, COMPOSER, DONE, engine, MIN, TAIL_5M } from './cache-engine'

test('an expired cache holds the prompt and asks; "Submit anyway" sends it', async ($, on) => {
  const { seen, clock, start } = engine(on, { tail: TAIL_5M })
  await $.session.start(start)
  await $.turn.complete(DONE)
  await clock.advance(6 * MIN)

  const r = await $.prompt.submit(COMPOSER('fix the bug'))
  expect((r as { drop?: string }).drop).toBeDefined()
  expect(seen.submits).toEqual([])
  expect(seen.fills).toEqual(['fix the bug'])

  const pane = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await pane.find({ text: /Prompt cache expired 1m ago \(5-minute TTL\)/ })).toBeDefined()
  // 180k × $5/MTok (Opus 5.5, 5-minute write: 1.25 × $4) = $0.90; warm: 180k × $0.20 = $0.04.
  expect(await pane.find({ text: /Cache size: 180k tokens\. Rebuild: \$0\.90 \(180k × \$5\/MTok 5-minute write, Opus 5\.5\); warm it would have read for \$0\.04\./ })).toBeDefined()
  expect(await pane.find({ text: /their band/ })).toBeDefined()
  await pane.press({ key: 'cache-send' })
  expect(seen.submits).toEqual(['fix the bug'])
  const after = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await after.find({ text: /Prompt cache expired/ })).toBeUndefined()
})
