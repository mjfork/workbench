import type { On } from 'claude-code'
import { KEY } from './engine'
import { expect, test } from 'claude-code/testing'

const QUEUE = [
  { pane: 'w8R:p1', workspace: 'w8R', label: 'Sonic meter warning 148', kind: 'ask', ask: '**Ask:** File the bug?\n**Reply with:** `1`', ts: 1000 },
  { pane: 'w6N:p7', workspace: 'w6N', label: 'fix-verboseness', kind: 'blocked', ask: 'Waiting on a dialog.', ts: null },
]

type Seen = { runs: string[][]; opened: string[]; toasts: string[] }

function engine(on: On, queue: readonly unknown[] = QUEUE, paneId?: string): Seen {
  const seen: Seen = { runs: [], opened: [], toasts: [] }
  on('env.get', (_$, e) => ({ value: ({ CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude', HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w8Q', ...(paneId ? { HERDR_PANE_ID: paneId } : {}) } as Record<string, string>)[e.name] }))
  on('prompt.edit', (_$, e) => ({ text: e.text, cursor: e.cursor }) as never)
  on('ui.toast', (_$, e) => {
    seen.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    seen.runs.push([...e.argv])
    const stdout = e.argv[2] === 'list' ? JSON.stringify(queue) : '{}'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('clock.now', () => ({ value: 1_120_000 }))
  on('clock.every', () => ({ deny: 'no timers' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['modes'] }) as never)
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  return seen
}

const PANE_PROPS = { title: 'Needs you', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 16 }, view: {} } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`queue lists asks and dialogs; clicking one focuses that pane (${surface})`, async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/tmp', surface, isInteractive: true } as never)
    await $.prompt.edit(KEY)
    await new Promise(r => setTimeout(r, 20))
    const footer = await $.ui.mount({ plugin: 'herdr-jump', surface, component: 'SessionMode', props: { modes: [] } })
    await footer.press({ key: 'queue' })
    const pane = await $.ui.mount({ plugin: 'herdr-jump', surface, component: 'Pane', requestId: 'herdr-queue', props: PANE_PROPS })
    await pane.press({ key: 'go-w6N:p7' })
    expect(seen.runs).toContainEqual(['herdr', 'agent', 'focus', 'w6N:p7'])
    // Gone to, it moves to the bottom of the list.
    expect(seen.runs).toContainEqual(['bash', expect.stringMatching(/\/bin\/needs-you\.sh$/), 'seen', 'w6N:p7'])
  })

  test(`dismiss clears an ask (${surface})`, async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/tmp', surface, isInteractive: true } as never)
    await $.prompt.edit(KEY)
    await new Promise(r => setTimeout(r, 20))
    const footer = await $.ui.mount({ plugin: 'herdr-jump', surface, component: 'SessionMode', props: { modes: [] } })
    await footer.press({ key: 'queue' })
    const pane = await $.ui.mount({ plugin: 'herdr-jump', surface, component: 'Pane', requestId: 'herdr-queue', props: PANE_PROPS })
    await pane.press({ key: 'x-w8R:p1' })
    expect(seen.runs.find(r => r[2] === 'clear')).toEqual(['bash', expect.stringMatching(/\/bin\/needs-you\.sh$/), 'clear', 'w8R:p1'])
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/needs-me-list opens the queue, with someone waiting or not (${surface})`, async ($, on) => {
    const seen = engine(on, [])
    await $.session.start({ cwd: '/tmp', surface, isInteractive: true } as never)
    await $.prompt.edit(KEY)
    await $.command.run({ command: 'needs-me-list', args: '' } as never)
    expect(seen.opened).toEqual(['herdr-queue'])
    const pane = await $.ui.mount({ plugin: 'herdr-jump', surface, component: 'Pane', requestId: 'herdr-queue', props: PANE_PROPS })
    expect(await pane.find({ text: /Nobody is waiting on you/ })).toBeDefined()
  })
}

for (const [name, queue] of [['someone is waiting', QUEUE], ['nobody is waiting', []]] as const) {
  test(`the footer shows this pane's full herdr ID on its own, beside what is beneath, when ${name}`, async ($, on) => {
    engine(on, queue, 'w8Q:p3')
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
    await $.prompt.edit(KEY)
    await new Promise(r => setTimeout(r, 20))
    const footer = await $.ui.mount({ plugin: 'herdr-jump', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
    // The pane, not just the workspace: tabs in one workspace each read differently.
    expect(await footer.find({ text: /^herdr w8Q:p3$/ })).toBeDefined()
    // What the mods beneath draw is kept, and the label is not folded into it.
    expect(await footer.find({ text: /^modes$/ })).toBeDefined()
    expect((await footer.find({ key: 'queue' })) !== undefined).toBe(queue.length > 0)
  })
}

test('without a pane ID the footer falls back to the workspace ID', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.edit(KEY)
  const footer = await $.ui.mount({ plugin: 'herdr-jump', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await footer.find({ text: /^herdr w8Q$/ })).toBeDefined()
})

const focusRuns = (seen: Seen) => seen.runs.filter(r => r[0] === 'herdr' && r[2] === 'focus')

test('/needs-me goes to the first waiting pane in the list', async ($, on) => {
  const seen = engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.edit(KEY)
  await $.command.run({ command: 'needs-me', args: '' } as never)
  expect(focusRuns(seen)).toEqual([['herdr', 'agent', 'focus', 'w8R:p1']])
  expect(seen.toasts.join()).toContain('w8R:p1')
})

test('/needs-me skips this pane and goes to the next one', async ($, on) => {
  const seen = engine(on, QUEUE, 'w8R:p1')
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.edit(KEY)
  await $.command.run({ command: 'needs-me', args: '' } as never)
  expect(focusRuns(seen)).toEqual([['herdr', 'agent', 'focus', 'w6N:p7']])
})

test('/needs-me says so when nobody, or only this pane, is waiting', async ($, on) => {
  const none = engine(on, [])
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.edit(KEY)
  await $.command.run({ command: 'needs-me', args: '' } as never)
  expect(focusRuns(none)).toEqual([])
  expect(none.toasts).toEqual(['Nobody is waiting on you.'])
})

test('/needs-me with only this pane waiting stays put', async ($, on) => {
  const seen = engine(on, [QUEUE[0]], 'w8R:p1')
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.edit(KEY)
  await $.command.run({ command: 'needs-me', args: '' } as never)
  expect(focusRuns(seen)).toEqual([])
  expect(seen.toasts).toEqual(['Only this session is waiting on you.'])
})
