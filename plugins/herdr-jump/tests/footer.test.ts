import type { On } from 'claude-code'
import { KEY } from './engine'
import { expect, test } from 'claude-code/testing'

import { wrap } from '../hooks/register'

const QUEUE = [
  { pane: 'w8R:p1', workspace: 'w8R', label: 'Sonic', kind: 'ask', ask: 'x', ts: 1 },
  { pane: 'w6N:p7', workspace: 'w6N', label: 'fix', kind: 'blocked', ask: 'y', ts: null },
  { pane: 'w45:p1', workspace: 'w45', label: 'scm', kind: 'ask', ask: 'z', ts: 3 },
  { pane: 'w80:p1', workspace: 'w80', label: 'k', kind: 'ask', ask: 'z', ts: 4 },
]

function engine(on: On) {
  const runs: string[][] = []
  on('env.get', (_$, e) => ({ value: ({ CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude', HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w8Q' } as Record<string, string>)[e.name] }))
  on('prompt.edit', (_$, e) => ({ text: e.text, cursor: e.cursor }) as never)
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const stdout = e.argv[2] === 'list' ? JSON.stringify(QUEUE) : '{}'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('clock.now', () => ({ value: 5000 }))
  on('clock.every', () => ({ deny: 'no timers' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['modes'] }) as never)
  return runs
}

test('footer lists the first three waiting workspaces; a click jumps there', async ($, on) => {
  const runs = engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.edit(KEY)
  await new Promise(r => setTimeout(r, 20))
  const footer = await $.ui.mount({ plugin: 'herdr-jump', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  await footer.press({ key: 'top-w6N:p7' })
  expect(runs).toContainEqual(['herdr', 'agent', 'focus', 'w6N:p7'])
})

test('wrap keeps line breaks and splits long words', () => {
  expect(wrap('one two three\nfour', 9)).toEqual(['one two', 'three', 'four'])
  expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
})

test('fullscreen: hovering a waiting ID floats its ask above the footer', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.edit(KEY)
  await new Promise(r => setTimeout(r, 20))
  const full = { columns: 200, rows: 50, isFullscreen: true }
  const footer = await $.ui.mount({ plugin: 'herdr-jump', surface: 'terminal', component: 'SessionMode', props: { modes: [] }, viewport: full })
  expect(await footer.find({ key: 'ask-w6N:p7' })).toBeDefined()
  expect(await footer.find({ text: /w6N fix · dialog/ })).toBeDefined()
  // Off fullscreen the card would be clipped to the footer row: none is drawn.
  const plain = await $.ui.mount({ plugin: 'herdr-jump', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await plain.find({ text: /w6N fix · dialog/ })).toBeUndefined()
})

// Another mod's footer part (the cache timer's countdown) must survive a non-empty queue, whichever side of this mod it sits.
const COUNTDOWN = {
  name: 'countdown',
  tier: 'append' as const,
  register(on: On) {
    on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
      const theirs = await next(e)
      const { Box, Text } = $.ui.resolve(e)
      return Box({ gap: 1, children: [Text({ children: ['cache 42m'] }), theirs] }) as never
    })
  },
}

test('the footer keeps what the mods beneath draw while the queue has items', { plugins: [COUNTDOWN] }, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.edit(KEY)
  await new Promise(r => setTimeout(r, 20))
  const footer = await $.ui.mount({ plugin: 'herdr-jump', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await footer.find({ text: /cache 42m/ })).toBeDefined()
  expect(await footer.find({ key: 'queue' })).toBeDefined()
})

test('the footer lists as many waiting panes as fit the context bar width, and +N stands for the rest', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.edit(KEY)
  await new Promise(r => setTimeout(r, 20))
  const footer = await $.ui.mount({ plugin: 'herdr-jump', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  // Four wait; in the 14 columns left after the toggle, `herdr w8Q` and the count, two fit with room for the +2.
  expect(await footer.find({ key: 'top-w8R:p1' })).toBeDefined()
  expect(await footer.find({ key: 'top-w6N:p7' })).toBeDefined()
  expect(await footer.find({ key: 'top-w45:p1' })).toBeUndefined()
  expect(await footer.find({ text: /\+2/ })).toBeDefined()
})
