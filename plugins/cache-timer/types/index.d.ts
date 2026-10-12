/** When the main conversation's last response landed, in ms since the epoch; null: no cache to lose yet. */
export type CacheAt = number | null

/** The TTL the last main response's cache was written with, from the transcript; null: unknown. */
export type CacheTtl = number | null

/** The prompt held while the person decides what to do with an expired cache; null: none. */
export type HeldPrompt = string | null

/** A handoff note, kept for a new session: its text, when it was written (ms since the epoch), how many minutes into the idle (null: unknown), about how many tokens it is, and its first lines (shown on the card). Neither text nor preview goes to the state file. */
export type Handoff = { text: string; at: number; ageMin: number | null; tokens: number; preview: string[] }

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      cacheAt: CacheAt
      /** Whether a turn is running (the cache is in use). */
      isWorking: boolean
      /** The clock the countdown is drawn against, in ms. */
      clockMs: number
      held: HeldPrompt
      cacheTtl: CacheTtl
      /** When this idle stretch's handoff was tried (ms); null: not yet. Tried once per stretch. */
      handoffAt: number | null
      /** The handoff note; null: none, or the conversation has moved on since. */
      handoff: Handoff | null
    }
  }
}
