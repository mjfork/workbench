import { expect, test } from 'claude-code/testing'

import { engine } from './engine'

const WIN = { OS: 'Windows_NT', HERDR_ENV: '1', HERDR_PANE_ID: 'w9B:p1', HERDR_WORKSPACE_ID: 'w9B' }

/** Stands for the footer block beneath the toggle; registered before the session starts. */
const beneath = (on: Parameters<Parameters<typeof test>[1]>[1]) => on('ui.render', { component: 'SessionMode' }, ($, e) => $.ui.resolve(e).Text({ children: ['herdr w9B'] }))

/** A click on the footer toggle writes the pane's mode file. */
async function toggle($: Parameters<Parameters<typeof test>[1]>[0]) {
  const ui = await $.ui.mount({ plugin: 'turn-mode', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  await ui.press({ key: 'turn-mode' })
}

test('the toggle writes the mode file under the pane id with the colon replaced, and the pane id inside stays real', async ($, on) => {
  const { files, start } = engine(on)
  beneath(on)
  await $.session.start(start)
  await toggle($)
  expect(Object.keys(files)).toEqual(['/home/ubuntu/.claude/ctx/mode/w9B_p1.json'])
  expect(JSON.parse(files['/home/ubuntu/.claude/ctx/mode/w9B_p1.json']!)).toMatchObject({ pane: 'w9B:p1', mode: 'realtime' })
})

test('a colon-named mode file from an older version is ignored, not migrated', async ($, on) => {
  const { files, contexts, start } = engine(on)
  files['/home/ubuntu/.claude/ctx/mode/w9B:p1.json'] = JSON.stringify({ pane: 'w9B:p1', mode: 'agentic', driver: 'w1:p1', setBy: 'test', at: 0 })
  await $.session.start(start)
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' }, wait: false } as never)
  expect(contexts[0]!.join()).toContain('[turn mode: async]')
})

test('on Windows with only USERPROFILE set, the mode is written under the profile folder', async ($, on) => {
  const { files, start } = engine(on, { env: { ...WIN, USERPROFILE: 'C:/Users/me' } })
  beneath(on)
  await $.session.start(start)
  await toggle($)
  expect(Object.keys(files)).toEqual(['/Users/me/.claude/ctx/mode/w9B_p1.json'])
})

test('CLAUDE_CONFIG_DIR wins over HOME and USERPROFILE', async ($, on) => {
  const { files, start } = engine(on, { env: { ...WIN, CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/h', USERPROFILE: 'C:/Users/me' } })
  beneath(on)
  await $.session.start(start)
  await toggle($)
  expect(Object.keys(files)).toEqual(['/cfg/ctx/mode/w9B_p1.json'])
})

test('HOME wins over USERPROFILE', async ($, on) => {
  const { files, start } = engine(on, { env: { ...WIN, HOME: '/home/h', USERPROFILE: 'C:/Users/me' } })
  beneath(on)
  await $.session.start(start)
  await toggle($)
  expect(Object.keys(files)).toEqual(['/home/h/.claude/ctx/mode/w9B_p1.json'])
})
