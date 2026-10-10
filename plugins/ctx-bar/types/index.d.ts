export type Kind = 'fixed' | 'chat' | 'Bash' | 'Read' | 'Agent' | 'mcp' | 'edit' | 'other'

/** The biggest single tool result in the transcript. */
export type Chunk = { tool: string; label: string; tokens: number }

export type Snapshot = {
  /** Estimated tokens per kind; together they sum to `used`. */
  tokens: Record<Kind, number>
  used: number
  window: number
  largest: Chunk[]
  /** The two biggest results of each kind, for the hover cards. */
  byKind: Record<Kind, Chunk[]>
}

/** One main-loop turn, as the pane report lists it. */
export type TurnRecord = {
  /** When it ended, milliseconds since the epoch. */
  at: number
  durationMs: number
  /** What the session's cost grew by over the turn, subagents included; null when unknown. */
  usd: number | null
  /** Input tokens over the turn's requests: uncached, cache-read and cache-written. */
  inputTokens: number
  outputTokens: number
  model: string | null
  /** answer, aborted, refusal or error. */
  reason: string
}

/** What the current or last main turn has cost since the person's input; `isLive` while it runs. */
export type TurnCost = { usd: number; isLive: boolean }

/** This session's last measured context fill. */
export type Fill = { tokens: number; window: number }

/** One pane's report, as written to ~/.claude/ctx/<pane>.json. */
export type PaneReport = {
  pane: string
  workspace: string
  tokens: number
  window: number
  /** When it was written, milliseconds since the epoch. */
  at: number
  isEnded: boolean
  /** When the session's figures count from (its first launch; /clear restarts it). */
  startedAt: number
  /** What the session has cost so far, as /cost totals it. */
  usd: number
  /** The last turns, oldest first. */
  turns: TurnRecord[]
}

declare module 'claude-code' {
  interface PluginState {
    'ctx-bar': { snapshot: Snapshot | null; isHidden: boolean; fill: Fill | null; turns: TurnRecord[]; lastUsd: number | null; turnStartUsd: number | null; turnCost: TurnCost | null }
  }
}
