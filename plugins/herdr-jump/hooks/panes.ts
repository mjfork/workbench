// The pure part of /jump: herdr's lists of workspaces, tabs, panes and agents joined into one row per pane, and the
// text match over those rows.

import type { PaneRow } from '../types'
import { plainText } from './text'

export type WorkspaceJson = { workspace_id: string; number: number; label: string; agent_status?: string }
export type TabJson = { tab_id: string; label: string }
export type PaneJson = { pane_id: string; workspace_id: string; tab_id: string; cwd?: string }
export type AgentJson = { pane_id: string; terminal_title_stripped?: string; agent_status?: string }

const last = (path: string) => path.split('/').filter(Boolean).at(-1) ?? ''

/** A row per pane, in workspace order, then tab order, then herdr's pane order. */
export function rowsOf(workspaces: readonly WorkspaceJson[], tabs: readonly TabJson[], panes: readonly PaneJson[], agents: readonly AgentJson[]): PaneRow[] {
  const workspaceOf = new Map(workspaces.map(w => [w.workspace_id, w]))
  const tabIndex = new Map(tabs.map((t, i) => [t.tab_id, i]))
  const tabOf = new Map(tabs.map(t => [t.tab_id, t]))
  const agentOf = new Map(agents.map(a => [a.pane_id, a]))
  const rows = panes.map((p, order) => {
    const w = workspaceOf.get(p.workspace_id)
    const agent = agentOf.get(p.pane_id)
    const cwd = plainText(p.cwd)
    const row: PaneRow = {
      pane_id: p.pane_id,
      workspace_id: p.workspace_id,
      workspace_label: plainText(w?.label ?? p.workspace_id),
      workspace_number: w?.number ?? Number.MAX_SAFE_INTEGER,
      tab_id: p.tab_id,
      tab_label: plainText(tabOf.get(p.tab_id)?.label ?? p.tab_id),
      title: plainText(agent?.terminal_title_stripped).trim() || last(cwd) || 'terminal',
      cwd,
      status: agent ? plainText(agent.agent_status ?? 'unknown') : 'shell',
      isAgent: agent !== undefined,
    }
    return { row, order, tab: tabIndex.get(p.tab_id) ?? Number.MAX_SAFE_INTEGER }
  })
  rows.sort((a, b) => a.row.workspace_number - b.row.workspace_number || a.tab - b.tab || a.order - b.order)
  return rows.map(r => r.row)
}

const haystack = (r: PaneRow) =>
  [r.workspace_id, String(r.workspace_number), r.workspace_label, r.tab_label, r.pane_id, r.title, r.cwd, r.status].join(' ').toLowerCase()

/** The rows every word of `text` appears in (any case), across workspace, tab, pane, title, folder and status. */
export function findPanes(rows: readonly PaneRow[], text: string): PaneRow[] {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...rows]
  return rows.filter(r => {
    const h = haystack(r)
    return words.every(w => h.includes(w))
  })
}

/** The row for a pane ID (any case), `w8N:p2` or `/w8N:p2`. */
export function paneById(rows: readonly PaneRow[], text: string): PaneRow | undefined {
  const m = /^\/?(w[0-9a-z]+:p\d+)$/i.exec(text.trim())
  if (!m) return undefined
  const id = m[1]!.toLowerCase()
  return rows.find(r => r.pane_id.toLowerCase() === id)
}

/** Whether the text names a pane ID, found or not. */
export const isPaneId = (text: string) => /^\/?w[0-9a-z]+:p\d+$/i.test(text.trim())

/** A workspace named exactly by its ID (any case) or its sidebar number. */
export function workspaceByIdOrNumber(workspaces: readonly WorkspaceJson[], text: string): WorkspaceJson | undefined {
  const q = text.trim().toLowerCase()
  if (q === '') return undefined
  const byId = workspaces.find(w => w.workspace_id.toLowerCase() === q)
  if (byId) return byId
  return /^\d+$/.test(q) ? workspaces.find(w => w.number === Number(q)) : undefined
}

/** `workspace › tab`, the place a pane is in. */
export const placeOf = (r: PaneRow) => `${r.workspace_label} › ${r.tab_label}`
