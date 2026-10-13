import { expect, test } from 'claude-code/testing'

import { rowsOf } from '../hooks/panes'
import { plainBlock, plainText } from '../hooks/text'
import { KEY } from './engine'

const ESC = '\u001b'
// Clears the screen, retitles the window, then hides the rest behind a direction mark.
const HOSTILE = `ok${ESC}[2J${ESC}]0;pwned\u0007 then‮ evil\r\nline 2`

test('plainText draws one line: escape sequences gone, controls and invisible marks a space', () => {
  expect(plainText(HOSTILE)).toBe('ok then  evil  line 2')
  expect(plainText(undefined)).toBe('')
})

test('plainBlock keeps line breaks and drops the rest', () => {
  expect(plainBlock(HOSTILE)).toBe('ok then  evil\nline 2')
  expect(plainBlock(`a\tb${ESC}M`)).toBe('a b')
})

test("/jump rows carry herdr's names and titles without terminal codes", () => {
  const [row] = rowsOf(
    [{ workspace_id: 'w1', number: 1, label: `work${ESC}[31m` }],
    [{ tab_id: 'w1:t1', label: `tab${ESC}]0;x\u0007` }],
    [{ pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1', cwd: `/w/a${ESC}[H` }],
    [{ pane_id: 'w1:p1', terminal_title_stripped: `title${ESC}[2J`, agent_status: `idle\u0007` }],
  )
  expect(row).toMatchObject({ workspace_label: 'work', tab_label: 'tab', title: 'title', cwd: '/w/a', status: 'idle ' })
})

test("the queue draws another session's ask as text, never as terminal codes", async ($, on) => {
  const queue = [{ pane: 'w8R:p1', workspace: 'w8R', label: `fix${ESC}[2J`, kind: 'ask', ask: `**Ask:** ship it?${ESC}]0;pwned\u0007\n**Reply with:** \`1\``, ts: 1000 }]
  on('env.get', (_$, e) => ({ value: ({ CLAUDE_CONFIG_DIR: '/home/u/.claude', HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w8Q', HERDR_PANE_ID: 'w8Q:p1' } as Record<string, string>)[e.name] }))
  on('prompt.edit', (_$, e) => ({ text: e.text, cursor: e.cursor }) as never)
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: e.argv[2] === 'list' ? JSON.stringify(queue) : '{}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('clock.now', () => ({ value: 1_120_000 }))
  on('clock.every', () => ({ deny: 'no timers' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['modes'] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.edit(KEY)
  await new Promise(r => setTimeout(r, 20))
  const footer = await $.ui.mount({ plugin: 'herdr-jump', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  await footer.press({ key: 'queue' })
  const pane = await $.ui.mount({
    plugin: 'herdr-jump', surface: 'terminal', component: 'Pane', requestId: 'herdr-queue',
    props: { title: 'Needs you', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 16 }, view: {} },
  })
  expect(await pane.find({ text: /ship it\?\n\*\*Reply with/ })).toBeDefined()
  expect(await pane.find({ text: /\u001b|\u0007/ })).toBeUndefined()
  expect(await footer.find({ text: /\u001b/ })).toBeUndefined()
})
