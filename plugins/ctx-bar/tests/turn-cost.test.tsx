import type { SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Its own file, so its stand-in hooks are the only ones answering.
test('the footer shows the turn price since the input: live while it runs, final once it ends', async ($, on) => {
  const messages: SessionMessage[] = [{ role: 'assistant', text: 'ok', toolUses: [] }]
  let usd = 4
  mock.clock(on)
  on('session.messages', () => ({ value: messages }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 120_000, window: 1_000_000, percent: 12 }, rateLimits: [], cost: { usd } } }) as never)
  on('env.get', (_$, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/home/ubuntu/.claude' : undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // Stands for the lines the mods after this one draw.
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['herdr'] })
  })

  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  usd = 4.25
  await $.command.run({ command: 'ctxbar', args: '' } as Parameters<typeof $.command.run>[0])
  const live = await $.ui.mount({ plugin: 'ctx-bar', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await live.find({ text: /…\$0\.25/ })).toBeDefined()

  usd = 4.5
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  const done = await $.ui.mount({ plugin: 'ctx-bar', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await done.find({ text: /\$0\.50 / })).toBeDefined()
  expect(await done.find({ text: /…/ })).toBeUndefined()
})
