import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export const MODE_FILE = '/home/ubuntu/.claude/ctx/mode/w9B:p1.json'

// The test session has no transcript to compact; this plugin, above the one under
// test, supplies one as a live session would.
export const TRANSCRIPT = {
  name: 'transcript',
  tier: 'prepend' as const,
  register(on: On) {
    on('session.compact', ($, e, next) => next({ ...e, messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never))
  },
}

/** Stands in for the engine; `files` is the disk, `contexts` what each prompt carried, `reads` how often the mode file was read. */
export function engine(on: On, opts: { cwd?: string } = {}) {
  const files: Record<string, string> = {}
  const contexts: string[][] = []
  const reads = { mode: 0 }
  const clock = mock.clock(on)
  on('env.get', (_$, e) => ({ value: ({ CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude', HERDR_ENV: '1', HERDR_PANE_ID: 'w9B:p1', HERDR_WORKSPACE_ID: 'w9B' } as Record<string, string>)[e.name] }))
  on('fs.read', (_$, e) => {
    if (e.path === MODE_FILE) reads.mode++
    return files[e.path] !== undefined ? { value: files[e.path]! } : ({ deny: 'ENOENT' } as never)
  })
  on('fs.write', (_$, e) => {
    files[e.path] = e.text
    return { value: undefined } as never
  })
  on('session.cwd', () => ({ value: opts.cwd ?? '/home/ubuntu/projects/acme-app' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 1_000_000 }, rateLimits: [] } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('prompt.submit', (_$, e) => {
    contexts.push([...(e.context ?? [])])
    return { text: e.text, context: e.context }
  })
  // What wakes the mod: a keystroke (the edit applied as typed), a turn, a tool, a slash command.
  const edits: unknown[] = []
  on('prompt.edit', (_$, e) => {
    edits.push(e)
    return { text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('command.run', () => ({ text: '' }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }], tokensBefore: 9, tokensAfter: 1 }) as never)
  const setMode = (mode: string, driver: string | null = null) => {
    files[MODE_FILE] = JSON.stringify({ pane: 'w9B:p1', mode, driver, setBy: 'test', at: 0 })
  }
  return { files, contexts, reads, edits, setMode, clock, start: { cwd: '/home/ubuntu/projects/acme-app', surface: 'terminal', isInteractive: true } as never }
}

export const say = (text: string, kind = 'composer') => ({ text, origin: { kind }, wait: false }) as never

/** One keystroke at the end of the draft. */
export const type = (text: string, char: string) => ({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: char }) as never
