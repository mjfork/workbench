import { expect, test } from 'claude-code/testing'

import { DONE, engine, MIN } from './cache-engine'

// The transcript's last response wrote to the 1h cache.
const TAIL = JSON.stringify({ type: 'assistant', timestamp: new Date(0).toISOString(), message: { usage: { cache_creation: { ephemeral_1h_input_tokens: 900, ephemeral_5m_input_tokens: 0 } } } })
const PATH = '/home/ubuntu/.claude/projects/-home-ubuntu-projects-x/s1.jsonl'
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
type Engine = ReturnType<typeof engine>
/** A turn, and the transcript read 2 seconds after it. */
const turn = async ($: any, { clock }: Engine, id = 't1') => {
  await $.turn.start({ text: 'go', turnId: id } as never)
  await $.turn.complete({ ...DONE, turnId: id } as never)
  await clock.advance(2000)
  await settle()
}
const globs = (e: Engine) => e.seen.runs.filter(r => r[0] === 'bash')
const tails = (e: Engine) => e.seen.runs.filter(r => r[0] === 'tail')

test('the projects glob runs once a session: each later read goes to the path it found', async ($, on) => {
  const e = engine(on, { tail: TAIL })
  await $.session.start(e.start)
  for (const id of ['t1', 't2', 't3']) await turn($, e, id)
  expect(globs(e).length).toBe(1)
  expect(e.seen.events.filter(x => x === `read ${PATH}`).length).toBe(4)
})

test('a small transcript is read whole by the engine: no process at all after a turn', async ($, on) => {
  const e = engine(on, { tail: TAIL })
  await $.session.start(e.start)
  const before = e.seen.runs.length
  for (const id of ['t1', 't2']) await turn($, e, id)
  expect(e.seen.runs.slice(before).filter(r => r[0] === 'bash' || r[0] === 'tail')).toEqual([])
})

test('a transcript over 400KB is cut with one tail -c of its path, no shell, and its last response still counts', async ($, on) => {
  const big = 'x'.repeat(500_000) + '\n' + TAIL
  const e = engine(on, { tail: big })
  await $.session.start(e.start)
  await e.clock.advance(10 * MIN)
  const footer = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await footer.find({ text: /cache 50m/ })).toBeDefined()
  await turn($, e)
  expect(tails(e)).toEqual([['tail', '-c', '400000', PATH], ['tail', '-c', '400000', PATH]])
  expect(globs(e).length).toBe(1)
})

test('the glob searches CLAUDE_CONFIG_DIR, not ~/.claude, when it is set', async ($, on) => {
  const e = engine(on, { tail: TAIL, env: { CLAUDE_CONFIG_DIR: '/Users/me/.claude-work', HOME: '/Users/me' } })
  await $.session.start(e.start)
  expect(globs(e)[0]!.slice(4)).toEqual(['/Users/me/.claude-work', 's1'])
  expect(e.seen.events).toContain('read /Users/me/.claude-work/projects/-home-ubuntu-projects-x/s1.jsonl')
})

test('the path the engine gives with SessionStart is used as is: no glob', async ($, on) => {
  const given = '/srv/claude/projects/x/s1.jsonl'
  const e = engine(on, { tail: TAIL, transcript: { path: given } })
  await $.classic.SessionStart({ source: 'startup', session_id: 's1', transcript_path: given } as never)
  await $.session.start(e.start)
  await turn($, e)
  expect(globs(e)).toEqual([])
  expect(e.seen.events.filter(x => x === `read ${given}`).length).toBe(2)
})

test('a transcript that is gone is looked for again, once, and a new session id is looked up afresh', async ($, on) => {
  const session = { id: 's1' }
  const transcript = { path: PATH as string | null }
  const e = engine(on, { tail: TAIL, session, transcript })
  await $.session.start(e.start)
  expect(globs(e).length).toBe(1)
  transcript.path = '/home/ubuntu/.claude/projects/moved/s1.jsonl'
  await turn($, e, 't1')
  await turn($, e, 't2')
  expect(globs(e).length).toBe(2)
  expect(e.seen.events).toContain('read /home/ubuntu/.claude/projects/moved/s1.jsonl')
  session.id = 's2'
  transcript.path = '/home/ubuntu/.claude/projects/moved/s2.jsonl'
  await turn($, e, 't3')
  expect(globs(e).length).toBe(3)
  expect(globs(e)[2]!.at(-1)).toBe('s2')
})
