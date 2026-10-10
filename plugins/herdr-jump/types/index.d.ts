/** One herdr pane, with the names of the workspace and tab it sits in (the rows of the /jump picker). */
export type PaneRow = {
  pane_id: string
  workspace_id: string
  workspace_label: string
  workspace_number: number
  tab_id: string
  tab_label: string
  /** What the pane is doing: an agent's terminal title, else the folder it is in. */
  title: string
  cwd: string
  /** An agent's status (idle, working, blocked, done), or "shell" for a pane with no agent. */
  status: string
  isAgent: boolean
}

/** One row of `needs-you.sh list`: an agent's "⚑ Needs you" ask, or a pane blocked on a dialog. */
export type QueueItem = {
  pane: string
  workspace: string
  label: string
  kind: 'ask' | 'blocked'
  ask: string
  ts: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'herdr-jump': { query: string; panes: PaneRow[]; queue: QueueItem[]; now: number }
  }
}
