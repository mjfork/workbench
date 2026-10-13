import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export const MIN = 60_000

// A resumed transcript whose last response wrote to the 5-minute cache (at time 0): a short clock, yellow in its last 1.25 minutes.
export const TAIL_5M = JSON.stringify({ type: 'assistant', timestamp: new Date(0).toISOString(), message: { usage: { cache_creation: { ephemeral_5m_input_tokens: 900, ephemeral_1h_input_tokens: 0 } } } })

export type Seen = { wakes: number[]; logs: string[]; toasts: string[]; fills: string[]; submits: string[]; commands: string[]; opened: string[]; closed: string[]; files: Record<string, string>; compacts: number; runs: string[][]; events: string[]; stdins: (string | undefined)[] }

/** Stands in for the engine; the transcript tail is empty unless given. */
// The transcript sits in the config folder's projects/<project>/<session id>.jsonl, found by the glob; `transcript` moves it
// (null: gone), `session.id` changes the session's id.
export function engine(on: On, opts: { env?: Record<string, string>; tail?: string; cwd?: string; focused?: boolean; tokens?: number; dirs?: Record<string, { name: string; mtimeMs: number }[]>; session?: { id: string }; transcript?: { path: string | null } } = {}) {
  const seen: Seen = { wakes: [], logs: [], toasts: [], fills: [], submits: [], commands: [], opened: [], closed: [], files: {}, compacts: 0, runs: [], events: [], stdins: [] }
  // Each timer of the plugin's that fires ($.clock.after, a period of $.clock.every) is a wake-up: its time is kept.
  const counted = ((name: string, ...rest: unknown[]) => {
    const fn = rest.at(-1) as (...a: unknown[]) => Promise<unknown>
    if (name === 'clock.after' || name === 'clock.every') {
      rest[rest.length - 1] = async (...a: unknown[]) => {
        const done = await fn(...a)
        seen.wakes.push(clock.now())
        return done
      }
    }
    return (on as (...a: unknown[]) => unknown)(name, ...rest)
  }) as On
  const clock = mock.clock(counted)
  const env = opts.env ?? { CLAUDE_CONFIG_DIR: '/home/ubuntu/.claude', HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w9B', HERDR_PANE_ID: 'w9B:p1' }
  const session = opts.session ?? { id: 's1' }
  // Where the transcript is: none until a tail is given.
  const transcriptAt = () => opts.transcript !== undefined ? opts.transcript.path : opts.tail === undefined ? null : `${env.CLAUDE_CONFIG_DIR ?? `${env.HOME}/.claude`}/projects/-home-ubuntu-projects-x/${session.id}.jsonl`
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('process.run', (_$, e) => {
    seen.runs.push([...e.argv])
    seen.events.push(`run ${e.argv.join(' ')}`)
    seen.stdins.push((e as { init?: { stdin?: string } }).init?.stdin)
    if (e.argv[0] === 'git') {
      const out = e.argv.includes('--abbrev-ref') ? 'feat/x' : e.argv.includes('--short') ? 'abc1234' : ' M a.ts\n M b.ts\n'
      return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const isAgentGet = e.argv[0] === 'herdr' && e.argv[1] === 'agent' && e.argv[2] === 'get'
    // The glob: the transcript's path when it is under the folder it searches, for this id.
    if (e.argv[0] === 'bash' && e.argv[1] === '-c') {
      const at = transcriptAt()
      const found = at !== null && at.startsWith(`${e.argv[4]}/projects/`) && at.endsWith(`/${e.argv[5]}.jsonl`)
      return { value: { exitCode: 0, stdout: found ? `${at}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[0] === 'tail') {
      const isThere = e.argv.at(-1) === transcriptAt()
      return { value: { exitCode: isThere ? 0 : 1, stdout: isThere ? (opts.tail ?? '').slice(-Number(e.argv[2])) : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const stdout = isAgentGet ? JSON.stringify({ result: { agent: { focused: opts.focused ?? true } } }) : '[]'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_$, e) => ({ value: e.path in seen.files }))
  // The transcript, the one file read here; anything else is missing.
  on('fs.stat', (_$, e) => {
    seen.events.push(`stat ${e.path}`)
    if (e.path !== transcriptAt()) throw Object.assign(new Error(`ENOENT: ${e.path}`), { code: 'ENOENT' })
    return { value: { kind: 'file', size: new TextEncoder().encode(opts.tail ?? '').length, mtimeMs: 0, isLink: false } } as never
  })
  on('fs.read', (_$, e) => {
    seen.events.push(`read ${e.path}`)
    if (e.path !== transcriptAt()) throw Object.assign(new Error(`ENOENT: ${e.path}`), { code: 'ENOENT' })
    return { value: opts.tail ?? '' } as never
  })
  // A folder's files, as given; any other folder is empty.
  on('fs.list', (_$, e) => ({ value: (opts.dirs?.[e.path] ?? []).map(f => ({ ...f, kind: 'file', size: 1, isLink: false })) }) as never)
  on('session.id', () => ({ value: session.id }))
  on('ui.log', (_$, e) => {
    seen.logs.push(e.text)
    return { value: undefined } as never
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('fs.write', (_$, e) => {
    seen.files[e.path] = e.text
    seen.events.push(`write ${e.path}`)
    return { value: undefined } as never
  })
  on('session.cwd', () => ({ value: opts.cwd ?? '/home/ubuntu/projects/x' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: opts.tokens ?? 180_000, window: 1_000_000 }, rateLimits: [] } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  // No settings hook beneath the classic events.
  on('classic.SessionStart', () => ({}) as never)
  on('classic.Stop', () => ({}) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // Stands for what the other mods draw in the band.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['their band'] })
  })
  // Stands for the footer row beneath this mod.
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [e.props.modes.join(' & ')] })
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', (_$, e) => {
    seen.closed.push((e as { id: string }).id)
    return { value: undefined } as never
  })
  on('session.compact', () => {
    seen.compacts += 1
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }], tokensBefore: 180_000, tokensAfter: 20_000 } as never
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('prompt.fill', (_$, e) => {
    seen.fills.push(e.text)
    return { isFilled: true } as never
  })
  on('prompt.submit', (_$, e) => {
    seen.submits.push(e.text)
    return { text: e.text }
  })
  on('command.run', (_$, e) => {
    seen.commands.push(e.command)
    return { text: '' }
  })
  return { seen, clock, start: { cwd: '/home/ubuntu/projects/x', surface: 'terminal', isInteractive: true } as never }
}

export const COMPOSER = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never
export const DONE = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never
export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never
