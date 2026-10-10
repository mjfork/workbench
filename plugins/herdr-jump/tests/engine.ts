import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export type Seen = { runs: string[][]; stdins: (string | undefined)[] }

const HERDR_ENV: Record<string, string> = { CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude', HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w9B', HERDR_PANE_ID: 'w9B:p1' }

/** Stands in for the engine, by default inside a herdr pane: `runs` and `stdins` are every process the mod started. */
export function engine(on: On, env: Record<string, string> = HERDR_ENV) {
  const seen: Seen = { runs: [], stdins: [] }
  const clock = mock.clock(on)
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('process.run', (_$, e) => {
    seen.runs.push([...e.argv])
    seen.stdins.push((e as { init?: { stdin?: string } }).init?.stdin)
    return { value: { exitCode: 0, stdout: '[]', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  return { seen, clock, start: { cwd: '/home/ubuntu/projects/x', surface: 'terminal', isInteractive: true } as never }
}

export const COMPOSER = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never
export const DONE = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never
export const PLUGIN = (text: string) => ({ text, origin: { kind: 'plugin', name: 'cache-timer' }, wait: false }) as never
export const PEER = (text: string) => ({ text, origin: { kind: 'peer' }, wait: false }) as never
export const PLUGIN_AS_USER = (text: string) => ({ text, origin: { kind: 'plugin', name: 'cache-timer', asUser: true }, wait: false }) as never
