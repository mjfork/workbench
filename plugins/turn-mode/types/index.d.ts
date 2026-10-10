/** The mode key last injected. */
export type Injected = string | null

/** How this pane's turns end, as the footer toggle shows it. */
export type ShownMode = 'async' | 'realtime' | 'agentic'

declare module 'claude-code' {
  interface PluginState {
    'turn-mode': {
      /** The instructions last put in the conversation (a mode key); null: none since start, /clear or compaction. */
      injected: Injected
      /** This pane's mode, for the footer toggle (re-read every few seconds: a driver's turn-mode.sh shows soon). */
      shown: ShownMode
    }
  }
}

