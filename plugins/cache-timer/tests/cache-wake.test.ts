import { expect, test } from 'claude-code/testing'

import { HANDOFF_TURN_PROMPT } from '../hooks/cache'
import { COMPOSER, DONE, engine, MIN } from './cache-engine'

// An idle session must not wake every few seconds: each wake-up touches its memory, so the OS can never leave it
// swapped out. It wakes for the moments that matter (yellow, the handoff, expiry) and, while the person is there
// (an edit, a submit, a turn), for the footer's minutes, falling asleep 10 minutes after the last of those.

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
const BIG = { tokens: 250_000 }
const between = (wakes: number[], from: number, to: number) => wakes.filter(t => t > from && t <= to)
const EDIT = (text: string) => ({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: 'x' }) as never

test('an idle session with a live cache wakes only at its deadlines: yellow, the handoff time and expiry', { options: { handoffLeadMinutes: 10 } }, async ($, on) => {
  const { seen, clock, start } = engine(on)
  await $.session.start(start)
  await $.turn.complete(DONE)
  await clock.advance(120 * MIN)
  await settle()
  // Awake for the 10 minutes after the turn (the footer's minutes), then only the deadlines: 45m (yellow), 50m (the
  // handoff's time; this context is under the minimum, so none is written) and 60m (expired). Then nothing.
  expect(between(seen.wakes, 11 * MIN, 120 * MIN)).toEqual([45 * MIN, 50 * MIN, 60 * MIN])
  expect(seen.wakes.length).toBeLessThan(20)
  expect(seen.submits).toEqual([])
})

test('yellow and the handoff come at the same times as before', { options: { handoffLeadMinutes: 10 } }, async ($, on) => {
  const { seen, clock, start } = engine(on, BIG)
  await $.session.start(start)
  await $.turn.complete(DONE)
  const footer = async () => $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  await clock.advance(45 * MIN - 1000)
  expect(await (await footer()).find({ text: /cache 15m/ })).toBeDefined()
  await clock.advance(1000)
  expect(seen.wakes).toContain(45 * MIN)
  expect(await (await footer()).find({ text: /cache 15m/ })).toBeDefined()

  await clock.advance(5 * MIN - 1000)
  await settle()
  expect(seen.submits).toEqual([])
  await clock.advance(1000)
  await settle()
  expect(seen.submits).toEqual([HANDOFF_TURN_PROMPT])
})

test('a new turn moves the deadlines: the old ones do not fire', { options: { handoffLeadMinutes: 10 } }, async ($, on) => {
  const { seen, clock, start } = engine(on)
  await $.session.start(start)
  await $.turn.complete(DONE)
  await clock.advance(30 * MIN)
  await $.turn.start({ text: 'more', turnId: 't2' } as never)
  await clock.advance(5 * MIN)
  await $.turn.complete({ ...DONE, turnId: 't2' } as never)
  await clock.advance(120 * MIN)
  await settle()
  expect(between(seen.wakes, 46 * MIN, 155 * MIN)).toEqual([80 * MIN, 85 * MIN, 95 * MIN])
})

test('a session with no cache to lose sets no timer', async ($, on) => {
  const { seen, clock, start } = engine(on)
  await $.session.start(start)
  await clock.advance(120 * MIN)
  expect(seen.wakes).toEqual([])

  // Nor does a compacted one.
  await $.turn.complete(DONE)
  await clock.advance(1 * MIN)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  const at = clock.now()
  await clock.advance(120 * MIN)
  expect(between(seen.wakes, at, at + 120 * MIN)).toEqual([])
})

test('an edit wakes the footer and passes through as it came; 10 minutes without one, it sleeps again', async ($, on) => {
  const { seen, clock, start } = engine(on)
  // The editor beneath: the splice applied.
  on('prompt.edit', (_$, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }) as never)
  await $.session.start(start)
  await $.turn.complete(DONE)
  await clock.advance(20 * MIN)
  // Asleep since minute 10: no wake-up since.
  expect(between(seen.wakes, 11 * MIN, 20 * MIN)).toEqual([])

  const r = await $.prompt.edit(EDIT('ab'))
  expect(r).toMatchObject({ text: 'abx', cursor: 3 })
  await clock.advance(5 * MIN)
  // Awake: the footer's minutes.
  expect(between(seen.wakes, 20 * MIN, 25 * MIN).length).toBeGreaterThanOrEqual(4)
  // Typing keeps it awake; ten quiet minutes after the last edit it sleeps until yellow at 45m.
  await $.prompt.edit(EDIT('abx'))
  await clock.advance(20 * MIN)
  expect(between(seen.wakes, 37 * MIN, 45 * MIN)).toEqual([45 * MIN])
})

test('a submit wakes it too', async ($, on) => {
  const { seen, clock, start } = engine(on)
  await $.session.start(start)
  await $.turn.complete(DONE)
  await clock.advance(20 * MIN)
  await $.prompt.submit(COMPOSER('/help'))
  await clock.advance(3 * MIN)
  expect(between(seen.wakes, 20 * MIN, 23 * MIN).length).toBeGreaterThanOrEqual(2)
})
