// The kit stamps origin and presentation, as a session does.
import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const LISTS: Record<string, unknown> = {
  workspace: {
    workspaces: [
      { workspace_id: 'w8N', number: 27, label: 'Classic units and #1042', agent_status: 'blocked' },
      { workspace_id: 'w8R', number: 22, label: 'Sonic meter warning 148', agent_status: 'working' },
      { workspace_id: 'w87', number: 17, label: 'Set pressure cleared before frame', agent_status: 'idle' },
    ],
  },
  tab: {
    tabs: [
      { tab_id: 'w8N:t1', label: 'api' },
      { tab_id: 'w8N:t2', label: 'build' },
      { tab_id: 'w8R:t1', label: 'main' },
      { tab_id: 'w87:t1', label: 'main' },
    ],
  },
  pane: {
    panes: [
      { pane_id: 'w8N:p1', workspace_id: 'w8N', tab_id: 'w8N:t1', cwd: '/work/api' },
      { pane_id: 'w8N:p2', workspace_id: 'w8N', tab_id: 'w8N:t2', cwd: '/work/build' },
      { pane_id: 'w8R:p1', workspace_id: 'w8R', tab_id: 'w8R:t1', cwd: '/work/sonic' },
      { pane_id: 'w87:p1', workspace_id: 'w87', tab_id: 'w87:t1', cwd: '/work/pressure' },
    ],
  },
  agent: {
    agents: [
      { pane_id: 'w8N:p2', terminal_title_stripped: 'Fix the meter bug', agent_status: 'blocked' },
      { pane_id: 'w8R:p1', terminal_title_stripped: 'Sonic warning', agent_status: 'working' },
      { pane_id: 'w87:p1', terminal_title_stripped: 'Pressure test', agent_status: 'idle' },
    ],
  },
}

type Seen = { focused: string[][]; toasts: string[]; opened: string[]; files: Record<string, string>; at: { pane: string }; clock: ReturnType<typeof mock.clock> }

function engine(on: On, failOn: string[] = []): Seen {
  const seen: Seen = { focused: [], toasts: [], opened: [], files: {}, at: { pane: 'w8N:p1' }, clock: mock.clock(on) }
  on('fs.read', (_$, e) => (seen.files[e.path] !== undefined ? { value: seen.files[e.path]! } : ({ deny: 'ENOENT' } as never)))
  on('fs.write', (_$, e) => {
    seen.files[e.path] = e.text
    return { value: undefined } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('env.get', (_$, e) => ({ value: ({ CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude', HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w8Q' } as Record<string, string>)[e.name] }))
  on('process.run', (_$, e) => {
    const [, noun, verb, target] = e.argv
    if (verb === 'focus') {
      seen.focused.push([String(noun), String(target)])
      const exitCode = failOn.includes(String(noun)) ? 1 : 0
      return { value: { exitCode, stdout: '{}', stderr: exitCode ? 'no such target' : '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const list = noun === 'pane' ? { panes: (LISTS.pane as { panes: { pane_id: string }[] }).panes.map(p => ({ ...p, focused: p.pane_id === seen.at.pane })) } : LISTS[String(noun)]
    const stdout = verb === 'list' ? JSON.stringify({ result: list }) : '{}'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  return seen
}

const jump = (args: string) => ({ command: 'jump', args }) as CommandRunInput
const PANE_PROPS = { title: 'Jump to pane', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 16 }, view: {} } as const

for (const [query, id] of [['w8n', 'w8N'], ['27', 'w8N'], ['W87', 'w87']] as const) {
  test(`/jump ${query} names a workspace exactly: it focuses ${id} and leaves the transcript empty`, async ($, on) => {
    const seen = engine(on)
    const out = await $.command.run(jump(query))
    expect(seen.focused).toEqual([['workspace', id]])
    expect(out.text).toBeUndefined()
    expect(seen.toasts.join()).toContain(id)
  })
}

for (const query of ['w8n:p2', '/W8N:P2']) {
  test(`/jump ${query} takes you to that agent pane`, async ($, on) => {
    const seen = engine(on)
    await $.command.run(jump(query))
    expect(seen.focused).toEqual([['agent', 'w8N:p2']])
    expect(seen.toasts.join()).toContain('Classic units and #1042 › build')
  })
}

test('/jump to a pane that is not an agent focuses its tab', async ($, on) => {
  const seen = engine(on)
  await $.command.run(jump('w8n:p1'))
  expect(seen.focused).toEqual([['tab', 'w8N:t1']])
})

test('an agent pane herdr will not focus falls back to its tab, then its workspace', async ($, on) => {
  const seen = engine(on, ['agent', 'tab'])
  await $.command.run(jump('w8n:p2'))
  expect(seen.focused).toEqual([['agent', 'w8N:p2'], ['tab', 'w8N:t2'], ['workspace', 'w8N']])
})

for (const [words, noun, target] of [
  ['sonic', 'agent', 'w8R:p1'],
  ['build', 'agent', 'w8N:p2'],
  ['api', 'tab', 'w8N:t1'],
  ['classic bug', 'agent', 'w8N:p2'],
  ['pressure', 'agent', 'w87:p1'],
] as const) {
  test(`/jump ${words}: the one pane it matches is where you land (${noun} ${target})`, async ($, on) => {
    const seen = engine(on)
    await $.command.run(jump(words))
    expect(seen.focused).toEqual([[noun, target]])
  })
}

test('/jump with no match focuses nothing and says so', async ($, on) => {
  const seen = engine(on)
  await $.command.run(jump('zzz'))
  await $.command.run(jump('wZZ:p1'))
  expect(seen.focused).toEqual([])
  expect(seen.toasts).toEqual(['No pane matches "zzz"', 'No pane matches "wZZ:p1"'])
})

test('/jump with words that match several panes opens the picker, already filtered', async ($, on) => {
  const seen = engine(on)
  await $.command.run(jump('classic'))
  expect(seen.focused).toEqual([])
  expect(seen.opened).toEqual(['herdr-jump'])
  const pane = await $.ui.mount({ plugin: 'herdr-jump', surface: 'terminal', component: 'Pane', requestId: 'herdr-jump', props: PANE_PROPS })
  expect(await pane.find({ key: 'go-w8N:p1' })).toBeDefined()
  expect(await pane.find({ key: 'go-w8N:p2' })).toBeDefined()
  expect(await pane.find({ key: 'go-w8R:p1' })).toBeUndefined()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/jump alone opens the picker: every pane with its workspace › tab; typing and Enter jump (${surface})`, async ($, on) => {
    const seen = engine(on)
    await $.command.run(jump(''))
    expect(seen.opened).toEqual(['herdr-jump'])

    const pane = await $.ui.mount({ plugin: 'herdr-jump', surface, component: 'Pane', requestId: 'herdr-jump', props: PANE_PROPS })
    for (const id of ['w87:p1', 'w8R:p1', 'w8N:p1', 'w8N:p2']) expect(await pane.find({ key: `go-${id}` })).toBeDefined()
    expect(await pane.find({ text: /Classic units and #1042 › build/ })).toBeDefined()
    expect(await pane.find({ text: /Fix the meter bug/ })).toBeDefined()

    await pane.input({ key: 'q', text: 'son', kind: 'change' })
    expect(await pane.find({ key: 'go-w8N:p1' })).toBeUndefined()
    await pane.input({ key: 'q', text: 'son' })
    expect(seen.focused).toEqual([['agent', 'w8R:p1']])
  })

  test(`clicking a row jumps (${surface})`, async ($, on) => {
    const seen = engine(on)
    await $.command.run(jump(''))
    const pane = await $.ui.mount({ plugin: 'herdr-jump', surface, component: 'Pane', requestId: 'herdr-jump', props: PANE_PROPS })
    await pane.press({ key: 'go-w8N:p1' })
    expect(seen.focused).toEqual([['tab', 'w8N:t1']])
  })
}

// ---- /jump-back: herdr keeps no focus history, so the mod notes each change of the focused pane.
const HISTORY = '/home/ubuntu/.claude/ctx/focus/default.json'
const history = (seen: Seen) => JSON.parse(seen.files[HISTORY]!) as { current: string | null; previous: string | null }
const start = ($: { session: { start: (e: never) => Promise<unknown> } }) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)

test('the mod notes each change of focus: the pane you were in becomes the previous one', async ($, on) => {
  const seen = engine(on)
  await start($)
  await seen.clock.advance(10)
  expect(history(seen)).toEqual({ current: 'w8N:p1', previous: null })

  seen.at.pane = 'w8R:p1'
  await seen.clock.advance(2000)
  expect(history(seen)).toEqual({ current: 'w8R:p1', previous: 'w8N:p1' })

  // No change, no rewrite of what the history says.
  await seen.clock.advance(4000)
  expect(history(seen)).toEqual({ current: 'w8R:p1', previous: 'w8N:p1' })

  seen.at.pane = 'w87:p1'
  await seen.clock.advance(2000)
  expect(history(seen)).toEqual({ current: 'w87:p1', previous: 'w8R:p1' })
})

test('/jump-back goes to the previous pane', async ($, on) => {
  const seen = engine(on)
  seen.at.pane = 'w8R:p1'
  seen.files[HISTORY] = JSON.stringify({ current: 'w8R:p1', previous: 'w8N:p2' })
  await start($)
  await $.command.run({ command: 'jump-back', args: '' } as CommandRunInput)
  expect(seen.focused).toEqual([['agent', 'w8N:p2']])
  expect(seen.toasts.join()).toContain('w8N:p2')
})

test('/jump-back to a pane that is not an agent focuses its tab', async ($, on) => {
  const seen = engine(on)
  seen.at.pane = 'w8R:p1'
  seen.files[HISTORY] = JSON.stringify({ current: 'w8R:p1', previous: 'w8N:p1' })
  await start($)
  await $.command.run({ command: 'jump-back', args: '' } as CommandRunInput)
  expect(seen.focused).toEqual([['tab', 'w8N:t1']])
})

test('/jump-back looks first: a move made a moment ago is not lost', async ($, on) => {
  const seen = engine(on)
  seen.files[HISTORY] = JSON.stringify({ current: 'w8N:p2', previous: null })
  await start($)
  // You moved to w8R:p1 just now; the next poll has not run.
  seen.at.pane = 'w8R:p1'
  await $.command.run({ command: 'jump-back', args: '' } as CommandRunInput)
  expect(seen.focused).toEqual([['agent', 'w8N:p2']])
})

test('/jump-back says so with no previous pane, or one that is gone', async ($, on) => {
  const none = engine(on)
  none.at.pane = 'w8R:p1'
  await start($)
  await $.command.run({ command: 'jump-back', args: '' } as CommandRunInput)
  expect(none.focused).toEqual([])
  expect(none.toasts).toEqual(['No previous pane yet.'])

  none.files[HISTORY] = JSON.stringify({ current: 'w8R:p1', previous: 'wZZ:p9' })
  await $.command.run({ command: 'jump-back', args: '' } as CommandRunInput)
  expect(none.focused).toEqual([])
  expect(none.toasts.at(-1)).toBe('wZZ:p9 is gone.')
})
