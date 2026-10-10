// The pure part of the footer's "who is waiting" list: which waiting panes get a button in the row, and how each is named,
// so the row stays as wide as the context bar beneath it.

import type { QueueItem } from '../types'

/**
 * How wide the footer block is: the context bar's row, a cost like "$1.60 " (6), the 20-cell bar and the 12-column
 * "359k/1000k" tail. herdr-jump cannot ask ctx-bar, so the figure is copied here.
 */
export const FOOTER_COLS = 38

/** The widest toggle label turn-mode draws (`real-time`) and its gap: reserved whether or not turn-mode is there. */
const TOGGLE_COLS = 10

export type Chip = { item: QueueItem; label: string }

/** Columns the row spends before the list: the toggle, `herdr <pane>` and the `⚑ N` count, with their gaps. */
export const reservedCols = (here: string, depth: number) => TOGGLE_COLS + `herdr ${here}`.length + 1 + `⚑ ${depth}`.length + 1

/**
 * The waiting panes to show, in queue order, as many as fit in `budget` columns, and how many did not fit (a `+N` button
 * stands for them). A pane is named by its workspace when it is the only one waiting there and not in this workspace;
 * otherwise by its pane ID; this session's own pane is `here`.
 */
export function chipsOf(items: readonly QueueItem[], workspace: string, ownPane: string | null, budget: number): { chips: Chip[]; more: number } {
  const perWorkspace = new Map<string, number>()
  for (const i of items) perWorkspace.set(i.workspace, (perWorkspace.get(i.workspace) ?? 0) + 1)
  const all = items.map(item => ({
    item,
    label: item.pane === ownPane ? 'here' : item.workspace !== workspace && perWorkspace.get(item.workspace) === 1 ? item.workspace : item.pane,
  }))
  const cost = (c: Chip) => c.label.length + 1
  const shown: Chip[] = []
  let used = 0
  for (const c of all) {
    if (used + cost(c) > budget) break
    shown.push(c)
    used += cost(c)
  }
  let more = all.length - shown.length
  // The `+N` needs room too: give up the last pane before dropping the count.
  while (more > 0 && shown.length > 0 && used + `+${more}`.length + 1 > budget) {
    used -= cost(shown.pop()!)
    more++
  }
  return { chips: shown, more }
}
