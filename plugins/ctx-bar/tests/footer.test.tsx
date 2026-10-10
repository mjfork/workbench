import type { RenderPropsOf, SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'


for (const surface of ['terminal', 'desktop'] as const) {
  test(`the footer's right-hand block keeps the lines above and adds the bar under them, and the band holds its hover cards on ${surface}`, async ($, on) => {
    const messages: SessionMessage[] = [
      { role: 'assistant', text: 'ok', toolUses: [{ tool_use_id: 't1', tool: 'Bash', input: { command: 'npm test', description: 'Run tests' } }] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'x'.repeat(200_000), isError: false }] },
    ]
    // Stand in for the engine: the transcript and the window's fill.
    on('session.messages', () => ({ value: messages }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 120_000, window: 1_000_000, percent: 12 }, rateLimits: [] } }))
    // Stands for the lines herdr-jump and ctx-heavy draw, which this mod runs ahead of.
    on('ui.render', { component: 'SessionMode' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: ['herdr w9B'] })
    })
    // Stands for what the mods after this one draw in the band.
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: ['their card'] })
    })

    // /ctxbar measures, which seeds the snapshot the footer reads.
    const report = await $.command.run({ command: 'ctxbar', args: '' } as Parameters<typeof $.command.run>[0])
    expect(JSON.stringify(report)).toContain('Run tests')

    const ui = await $.ui.mount({
      plugin: 'ctx-bar',
      surface,
      component: 'SessionMode',
      props: { modes: [] },
    })

    expect(await ui.find({ text: /herdr w9B/ })).toBeDefined()
    expect(await ui.find({ text: /120k\/1000k/ })).toBeDefined()
    expect(await ui.find({ key: 'seg-Bash' })).toBeDefined()

    // The cards live in the band above the prompt, hidden until hovered.
    const band = await $.ui.mount({
      plugin: 'ctx-bar',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as RenderPropsOf['AbovePrompt'],
    })
    expect(await band.find({ text: /Bash 120k \(100%\) · 120k Run tests/ })).toBeDefined()
    expect(await band.find({ text: /their card/ })).toBeDefined()

    // Fullscreen: the cards float from the bar's segments, and the band keeps only theirs.
    const full = { columns: 200, rows: 50, isFullscreen: true }
    const footer = await $.ui.mount({ plugin: 'ctx-bar', surface, component: 'SessionMode', props: { modes: [] }, viewport: full })
    expect(await footer.find({ text: /Bash 120k \(100%\) · 120k Run tests/ })).toBeDefined()
    const fullBand = await $.ui.mount({
      plugin: 'ctx-bar', surface, component: 'AbovePrompt', viewport: full,
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as RenderPropsOf['AbovePrompt'],
    })
    expect(await fullBand.find({ text: /Bash 120k/ })).toBeUndefined()
    expect(await fullBand.find({ text: /their card/ })).toBeDefined()
  })
}
