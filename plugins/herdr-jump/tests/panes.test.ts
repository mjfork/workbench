import { expect, test } from 'claude-code/testing'

import { findPanes, isPaneId, paneById, placeOf, rowsOf, workspaceByIdOrNumber } from '../hooks/panes'

const WORKSPACES = [
  { workspace_id: 'w8R', number: 22, label: 'Login timeout 148' },
  { workspace_id: 'w8N', number: 27, label: 'Legacy export' },
]
const TABS = [
  { tab_id: 'w8N:t1', label: 'api' },
  { tab_id: 'w8N:t2', label: 'build' },
  { tab_id: 'w8R:t1', label: 'main' },
]
const PANES = [
  { pane_id: 'w8N:p2', workspace_id: 'w8N', tab_id: 'w8N:t2', cwd: '/work/build' },
  { pane_id: 'w8N:p1', workspace_id: 'w8N', tab_id: 'w8N:t1', cwd: '/work/api' },
  { pane_id: 'w8R:p1', workspace_id: 'w8R', tab_id: 'w8R:t1', cwd: '/work/login' },
]
const AGENTS = [
  { pane_id: 'w8N:p2', terminal_title_stripped: 'Fix the export bug', agent_status: 'blocked' },
  { pane_id: 'w8R:p1', terminal_title_stripped: 'Timeout warning', agent_status: 'working' },
]
const ROWS = rowsOf(WORKSPACES, TABS, PANES, AGENTS)

test('one row per pane, in workspace, tab and pane order, with workspace and tab names', () => {
  expect(ROWS.map(r => r.pane_id)).toEqual(['w8R:p1', 'w8N:p1', 'w8N:p2'])
  expect(ROWS.map(placeOf)).toEqual(['Login timeout 148 › main', 'Legacy export › api', 'Legacy export › build'])
})

test('an agent shows its title and status; a plain terminal shows its folder and "shell"', () => {
  const [login, api, build] = ROWS
  expect([login?.title, login?.status, login?.isAgent]).toEqual(['Timeout warning', 'working', true])
  expect([api?.title, api?.status, api?.isAgent]).toEqual(['api', 'shell', false])
  expect([build?.title, build?.status]).toEqual(['Fix the export bug', 'blocked'])
})

test('a pane with no tab or workspace name known still gets a row, named by its ids', () => {
  const [row] = rowsOf([], [], [{ pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1' }], [])
  expect([row?.workspace_label, row?.tab_label, row?.title]).toEqual(['w1', 'w1:t1', 'terminal'])
})

test('findPanes: every word must appear, in any of workspace, tab, pane, title, folder or status', () => {
  const ids = (text: string) => findPanes(ROWS, text).map(r => r.pane_id)
  expect(ids('')).toEqual(['w8R:p1', 'w8N:p1', 'w8N:p2'])
  expect(ids('build')).toEqual(['w8N:p2'])
  expect(ids('legacy')).toEqual(['w8N:p1', 'w8N:p2'])
  expect(ids('legacy api')).toEqual(['w8N:p1'])
  expect(ids('BLOCKED')).toEqual(['w8N:p2'])
  expect(ids('shell')).toEqual(['w8N:p1'])
  expect(ids('27')).toEqual(['w8N:p1', 'w8N:p2'])
  expect(ids('p2')).toEqual(['w8N:p2'])
  expect(ids('nothing here')).toEqual([])
})

test('pane IDs and workspace names given exactly', () => {
  expect(paneById(ROWS, 'w8n:P2')?.pane_id).toBe('w8N:p2')
  expect(paneById(ROWS, '/W8N:p1')?.pane_id).toBe('w8N:p1')
  expect(paneById(ROWS, 'wZZ:p1')).toBeUndefined()
  expect([isPaneId('w8n:p2'), isPaneId('/w8N:p2'), isPaneId('w8n'), isPaneId('build')]).toEqual([true, true, false, false])
  expect(workspaceByIdOrNumber(WORKSPACES, 'W8n')?.workspace_id).toBe('w8N')
  expect(workspaceByIdOrNumber(WORKSPACES, '22')?.workspace_id).toBe('w8R')
  expect(workspaceByIdOrNumber(WORKSPACES, 'login')).toBeUndefined()
  expect(workspaceByIdOrNumber(WORKSPACES, '')).toBeUndefined()
})
