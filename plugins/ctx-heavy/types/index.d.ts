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

/** A pane's prompt cache, as cache-timer's state file gives it: when it expires (null: no cache yet), its TTL, and whether a turn is using it. */
export type PaneCache = { expiresAt: number | null; ttlMs: number; isWorking: boolean }

/** One herdr pane and the context its Claude session holds. */
export type Heavy = {
  pane: string
  workspace: string
  tokens: number
  /** The pane's report, its turns cut to those the card shows; the card is drawn from it, its ages from the clock. */
  report: PaneReport
  /** Its cache, when cache-timer runs there; absent in a summary written before ctx-heavy carried it. */
  cache?: PaneCache
}

declare module 'claude-code' {
  interface PluginState {
    'ctx-heavy': { heavy: Heavy[]; tick: number }
  }
}
