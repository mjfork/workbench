import { expect, test } from 'claude-code/testing'

import { COMPOSER, DONE, engine, PEER, PLUGIN, PLUGIN_AS_USER } from './engine'
import type { Seen } from './engine'

const ASK = 'Done with the spec.\n\n## ⚑ Needs you\n**Ask:** Approve the spec?\n**Reply with:** `yes`'
const script = expect.stringMatching(/\/bin\/needs-you\.sh$/)
const runsOf = (seen: Seen, action: string) =>
  seen.runs.flatMap((r, i) => (r[0] === 'bash' && r[2] === action ? [{ argv: r, stdin: seen.stdins[i] }] : []))
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

// Another plugin that drops every prompt, as the cache timer's hold does.
const DROPS = {
  name: 'drops',
  tier: 'append' as const,
  register(on: Parameters<typeof engine>[0]) {
    on('prompt.submit', () => ({ drop: 'held' }) as never)
  },
}

test('a finished turn is handed to the queue script as a Stop hook would', async ($, on) => {
  const { seen, start } = engine(on)
  await $.session.start(start)
  await $.turn.complete({ ...DONE, answer: ASK } as never)
  await settle()
  const [stop] = runsOf(seen, 'stop')
  expect(stop?.argv).toEqual(['bash', script, 'stop'])
  expect(JSON.parse(stop!.stdin!)).toEqual({ last_assistant_message: ASK })
})

test('an aborted turn is not handed over', async ($, on) => {
  const { seen, start } = engine(on)
  await $.session.start(start)
  await $.turn.complete({ ...DONE, answer: ASK, isAborted: true } as never)
  await settle()
  expect(runsOf(seen, 'stop')).toEqual([])
})

test('a submitted prompt is handed to the queue script as a UserPromptSubmit hook would', async ($, on) => {
  const { seen, start } = engine(on)
  await $.session.start(start)
  await $.prompt.submit(COMPOSER('yes, approved'))
  await settle()
  const [prompt] = runsOf(seen, 'prompt')
  expect(prompt?.argv).toEqual(['bash', script, 'prompt'])
  expect(JSON.parse(prompt!.stdin!)).toEqual({ prompt: 'yes, approved' })
})

test('a prompt another plugin holds back is not an answer yet', { plugins: [DROPS] }, async ($, on) => {
  const { seen, start } = engine(on)
  await $.session.start(start)
  const held = await $.prompt.submit(COMPOSER('yes, approved'))
  await settle()
  expect((held as { drop?: string }).drop).toBeDefined()
  expect(runsOf(seen, 'prompt')).toEqual([])
})

test('outside a herdr pane nothing is handed over', async ($, on) => {
  const { seen, start } = engine(on, { CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude' })
  await $.session.start(start)
  await $.turn.complete({ ...DONE, answer: ASK } as never)
  await $.prompt.submit(COMPOSER('hi'))
  await settle()
  expect(runsOf(seen, 'stop').concat(runsOf(seen, 'prompt'))).toEqual([])
})

test("only the person's own prompts can answer an ask: a plugin's or a peer's are not handed over", async ($, on) => {
  const { seen, start } = engine(on)
  await $.session.start(start)
  await $.prompt.submit(PLUGIN('[cache-timer handoff] write the note'))
  await $.prompt.submit(PEER('did you see the build?'))
  await settle()
  expect(runsOf(seen, 'prompt')).toEqual([])
  await $.prompt.submit(COMPOSER('yes'))
  await settle()
  expect(runsOf(seen, 'prompt')).toHaveLength(1)
})

test("a plugin that submits the person's own held words counts as the person: the cache card's resend answers an ask", async ($, on) => {
  const { seen, start } = engine(on)
  await $.session.start(start)
  await $.prompt.submit(PLUGIN_AS_USER('yes, approved'))
  await settle()
  expect(runsOf(seen, 'prompt')).toHaveLength(1)
})

test('a turn that takes back its own ask (a Resolved heading) is handed over too; a plain turn is not', async ($, on) => {
  const { seen, start } = engine(on)
  await $.session.start(start)
  await $.turn.complete({ ...DONE, answer: 'The peer settled it.\n\n## ✓ Resolved\nAnswered in w7:p3.' } as never)
  await $.turn.complete({ ...DONE, answer: 'Still waiting.' } as never)
  await settle()
  expect(runsOf(seen, 'stop')).toHaveLength(1)
})

test("a ! command is the person's answer: its turn raises no prompt.submit, so its start hands one over", async ($, on) => {
  const { seen, start } = engine(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  await $.session.start(start)
  await $.turn.start({ text: '<bash-stdout>hi</bash-stdout><bash-stderr></bash-stderr>', turnId: 't1' } as never)
  await $.turn.start({ text: 'a typed prompt', turnId: 't2' } as never)
  await settle()
  const runs = runsOf(seen, 'prompt')
  expect(runs).toHaveLength(1)
  expect(JSON.parse(runs[0]!.stdin!)).toEqual({ prompt: '! (a shell command)' })
})
