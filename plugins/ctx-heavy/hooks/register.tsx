import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Heavy, PaneReport } from '../types'

/** The Claude config folder, as Claude Code itself reads it from CLAUDE_CONFIG_DIR. Unset, it is ~/.claude, where Claude Code keeps it. */
const claudeDir = async ($: EngineInterface) => {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir) return dir
  const home = await $.env.get('HOME')
  if (!home) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set')
  return `${home}/.claude`
}


const heavy = atom({ plugin: 'ctx-heavy', key: 'heavy' } as const, [])

// Each herdr session's ctx-bar writes its context fill here, one file per pane.
// A report older than this belongs to a session that died without ending.
const STALE_MS = 24 * 60 * 60 * 1000
const HEAVY_COUNT = 4

export const fmt = (tokens: number): string =>
  tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : `${tokens}`

/** Red over 500k, yellow over 300k, white otherwise. */
export const heat = (tokens: number) => (tokens > 500_000 ? 'red' : tokens > 300_000 ? 'yellow' : 'white')

/** The heaviest sessions, however many share a workspace; each is shown by its full pane ID. */
export function topSessions(rows: readonly Heavy[], count = HEAVY_COUNT): Heavy[] {
  return [...rows].sort((a, b) => b.tokens - a.tokens).slice(0, count)
}

const TURNS_SHOWN = 5

/** 42s, 3m05s, 2h10m. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

const usd = (n: number | null | undefined) => (n === null || n === undefined ? '$?' : `$${n.toFixed(2)}`)

/** The hover card: the session's fill, cost and age, then its last turns, newest first. */
export function cardOf(report: PaneReport, now: number): string[] {
  const percent = report.window > 0 ? ` (${Math.round((report.tokens / report.window) * 100)}%)` : ''
  const age = report.startedAt === undefined ? '' : `  up ${span(now - report.startedAt)}`
  const head = `${report.pane}  ${fmt(report.tokens)}/${fmt(report.window)}${percent}  ${usd(report.usd)} total${age}`
  const turns = [...(report.turns ?? [])].reverse().slice(0, TURNS_SHOWN)
  if (turns.length === 0) return [head, 'no turns recorded yet']
  return [
    head,
    ...turns.map(t => {
      const model = t.model === null ? '' : `  ${t.model.replace(/^claude-/, '')}`
      const reason = t.reason === 'answer' ? '' : `  ${t.reason}`
      return `${span(now - t.at).padStart(6)} ago  ${span(t.durationMs).padStart(6)}  ${usd(t.usd).padStart(6)}  ${fmt(t.inputTokens)} in · ${fmt(t.outputTokens)} out${model}${reason}`
    }),
  ]
}

/** One report's file text as a row, or null when ended or unreadable (a write in flight). */
export function rowOf(text: string, now: number): Heavy | null {
  try {
    const report = JSON.parse(text) as PaneReport
    if (report.isEnded || typeof report.tokens !== 'number' || !report.pane || !report.workspace) return null
    return { pane: report.pane, workspace: report.workspace, tokens: report.tokens, card: cardOf(report, now) }
  } catch {
    return null
  }
}

async function refreshHeavy($: EngineInterface) {
  const ctxDir = `${await claudeDir($)}/ctx`
  const entries = await $.fs.list(ctxDir).catch(() => [])
  const now = await $.clock.now()
  const fresh = entries.filter(f => f.kind === 'file' && f.name.endsWith('.json') && now - f.mtimeMs < STALE_MS)
  const texts = await Promise.all(fresh.map(f => $.fs.read(`${ctxDir}/${f.name}`).catch(() => '')))
  const rows = texts.map(text => rowOf(String(text), now)).filter((row): row is Heavy => row !== null)
  await update($, heavy, () => topSessions(rows))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if ((await $.env.get('HERDR_ENV')) === '1') {
      void refreshHeavy($).catch(() => {})
      $.clock.every(10_000, () => void refreshHeavy($).catch(() => {}))
    }

    return result
  })

  // The footer's mode labels, where herdr-jump draws (this mod runs first: it
  // lists herdr-jump under dependencies). Its line stays on top, right-aligned;
  // this mod's line goes under it.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const theirs = await next(e)
    const top = await read($, heavy)
    if (top.length === 0) return theirs

    const go = async (row: Heavy) => {
      const focused = await $.process.run(['herdr', 'agent', 'focus', row.pane])
      if (focused.exitCode !== 0) await $.process.run(['herdr', 'workspace', 'focus', row.workspace])
    }

    const isFloating = e.viewport?.isFullscreen === true
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" alignItems="flex-end">
        {theirs}
        <Box gap={1}>
          {top.map(row => (
            <Box key={`heavy-${row.pane}`} flexShrink={0}>
              <Button key={`go-${row.pane}`} plain label={row.pane} onPress={() => void go(row)} />
              <Box key={`tokens-${row.pane}`} hover={{ scope: scopeOf(row.pane) }}>
                <Text color={heat(row.tokens)}> {fmt(row.tokens)}</Text>
                {/* Fullscreen: the card floats over the rows above the count,
                    its right edge on the count's; elsewhere the band draws it. */}
                {isFloating && (
                  <Box position="absolute" bottom={1} right={0} flexDirection="column" display="none" hover={{ display: 'flex' }}>
                    {padded(row.card).map((line, i) => (
                      <Text key={`line-${i}`} color={i === 0 ? heat(row.tokens) : undefined} inverse>{line}</Text>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })

  // The hover cards off fullscreen, where a floating card would be clipped to
  // the footer row: drawn in the band above the prompt, hidden until the
  // pointer is on a workspace's token count, right-aligned over the footer.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    const top = await read($, heavy)
    if (e.props.hasSurvey || top.length === 0 || e.viewport?.isFullscreen === true) return theirs

    const { Box, Text } = $.ui.resolve(e)
    const rows = Math.max(1, e.props.maxRows)
    return (
      <Box flexDirection="column">
        <Box width={e.props.bodyColumns} justifyContent="flex-end">
          {top.map(row => {
            return (
              <Box key={`card-${row.pane}`} flexDirection="column" display="none" hover={{ scope: scopeOf(row.pane), display: 'flex' }}>
                {padded(row.card.slice(0, rows)).map((line, i) => (
                  <Text key={`line-${i}`} color={i === 0 ? heat(row.tokens) : undefined} inverse wrap="truncate-end">
                    {line}
                  </Text>
                ))}
              </Box>
            )
          })}
        </Box>
        {theirs}
      </Box>
    )
  })
}

const scopeOf = (pane: string) => `ctx-heavy-${pane}`

/** The card's lines padded to one width, a cell of margin each side. */
function padded(lines: readonly string[]): string[] {
  const width = Math.max(...lines.map(line => line.length))
  return lines.map(line => ` ${line.padEnd(width)} `)
}
