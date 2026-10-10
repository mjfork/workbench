/** One main-loop turn, as ctx-bar's pane report lists it. */
export type TurnRecord = {
  /** When it ended, milliseconds since the epoch. */
  at: number
  durationMs: number
  /** What the session's cost grew by over the turn; null when unknown. */
  usd: number | null
  inputTokens: number
  outputTokens: number
  model: string | null
  reason: string
}

/** One pane's report, as ctx-bar writes it to ~/.claude/ctx/<pane>.json. */
export type PaneReport = {
  pane: string
  workspace: string
  tokens: number
  window: number
  /** When it was written, milliseconds since the epoch. */
  at: number
  isEnded: boolean
  /** Absent in a report written before ctx-bar carried cost. */
  startedAt?: number
  usd?: number
  turns?: TurnRecord[]
}

/** One herdr pane and the context its Claude session holds. */
export type Heavy = {
  pane: string
  workspace: string
  tokens: number
  /** The hover card's lines, written when the reports were read. */
  card: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'ctx-heavy': { heavy: Heavy[] }
  }
}
