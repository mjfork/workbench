import { expect, test } from 'claude-code/testing'

import { DONE, engine, MIN } from './cache-engine'

const FILE = '/home/ubuntu/.claude/ctx/cache/w9B_p1.json'

test('each pane writes its cache state for other sessions: at start, turn start and turn end', async ($, on) => {
  const { seen, clock, start } = engine(on)
  await $.session.start(start)
  expect(JSON.parse(seen.files[FILE]!)).toMatchObject({ pane: 'w9B:p1', session: 's1', lastResponseAt: null, expiresAt: null, isWorking: false })

  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  expect(JSON.parse(seen.files[FILE]!).isWorking).toBe(true)

  await clock.advance(1 * MIN)
  await $.turn.complete(DONE)
  const state = JSON.parse(seen.files[FILE]!)
  // No transcript to say otherwise: the 1-hour TTL.
  expect(state).toMatchObject({ isWorking: false, lastResponseAt: 1 * MIN, ttlMs: 60 * MIN, expiresAt: 61 * MIN })
})

const WIN = { OS: 'Windows_NT', HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w9B', HERDR_PANE_ID: 'w9B:p1' }

test('on Windows with only USERPROFILE set, the state lands under the profile folder and the pane id stays real inside', async ($, on) => {
  const { seen, start } = engine(on, { env: { ...WIN, USERPROFILE: 'C:/Users/me' } })
  await $.session.start(start)
  expect(JSON.parse(seen.files['/Users/me/.claude/ctx/cache/w9B_p1.json']!)).toMatchObject({ pane: 'w9B:p1' })
})

test('CLAUDE_CONFIG_DIR wins over HOME and USERPROFILE, and HOME over USERPROFILE', async ($, on) => {
  const first = engine(on, { env: { ...WIN, CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/h', USERPROFILE: 'C:/Users/me' } })
  await $.session.start(first.start)
  expect(Object.keys(first.seen.files)).toEqual(['/cfg/ctx/cache/w9B_p1.json'])
})

test('HOME wins over USERPROFILE', async ($, on) => {
  const { seen, start } = engine(on, { env: { ...WIN, HOME: '/home/h', USERPROFILE: 'C:/Users/me' } })
  await $.session.start(start)
  expect(Object.keys(seen.files)).toEqual(['/home/h/.claude/ctx/cache/w9B_p1.json'])
})
