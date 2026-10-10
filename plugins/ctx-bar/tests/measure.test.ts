import { expect, test } from 'claude-code/testing'
import type { ContextCategory, SessionMessage } from 'claude-code'

import { cells, kindOf, measure } from '../hooks/measure'

const bash = (id: string, command: string, output: string, description?: string): SessionMessage[] => [
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool: 'Bash', input: { command, description } }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text: output, isError: false }] },
]

const categories: ContextCategory[] = [
  { name: 'System prompt', tokens: 20_000, color: 'x', isDeferred: false, kind: 'used' },
  { name: 'Messages', tokens: 999, color: 'x', isDeferred: false, kind: 'used' },
  { name: 'Free space', tokens: 100_000, color: 'x', isDeferred: false, kind: 'free' },
]

test('kinds tools by name', () => {
  expect(kindOf('Bash')).toBe('Bash')
  expect(kindOf('mcp__artifacts__get_artifact')).toBe('mcp')
  expect(kindOf('Edit')).toBe('edit')
  expect(kindOf('Grep')).toBe('other')
})

test('a big Bash output dominates the transcript share and sums to used', () => {
  const messages: SessionMessage[] = [
    { role: 'user', text: 'run the tests', toolUses: [] },
    ...bash('t1', 'npm test', 'x'.repeat(40_000)),
  ]
  const snap = measure(messages, 50_000, 200_000, categories)

  expect(snap.tokens.fixed).toBe(20_000)
  expect(snap.tokens.Bash).toBeGreaterThan(29_000)
  const sum = Object.values(snap.tokens).reduce((a, b) => a + b, 0)
  expect(Math.abs(sum - 50_000)).toBeLessThanOrEqual(8)
  expect(snap.largest[0]?.tool).toBe('Bash')
  expect(snap.largest[0]?.label).toBe('npm test')
})

test('with no breakdown, all of used is attributed to the transcript', () => {
  const snap = measure(bash('t1', 'ls', 'y'.repeat(4000)), 10_000, 200_000, undefined)
  expect(snap.tokens.fixed).toBe(0)
  expect(snap.tokens.Bash).toBeGreaterThan(9_000)
})

test('every non-zero kind gets at least one cell', () => {
  const snap = measure(bash('t1', 'ls', 'z'.repeat(40)), 30_000, 200_000, categories)
  const n = cells(snap, 50)
  expect(n.Bash).toBeGreaterThanOrEqual(1)
  expect(n.fixed).toBe(5)
})

test('labels a Bash result by its description, else the command past leading assignments', () => {
  const described = measure(bash('t1', 'D=/tmp/x; grep foo $D', 'q'.repeat(4000), 'Find foo'), 5_000, 200_000, undefined)
  expect(described.largest[0]?.label).toBe('Find foo')

  const bare = measure(bash('t2', 'D=/tmp/x T=/tmp/y\ngrep foo $D', 'q'.repeat(4000)), 5_000, 200_000, undefined)
  expect(bare.largest[0]?.label).toBe('grep foo $D')
})

test('a label is drawn as text: escape sequences, controls and invisible characters in a command or file name are gone', () => {
  const snap = measure(bash('t1', 'cat x', 'q'.repeat(4000), 'Read \u001b]0;pwned\u0007the\u001b[2J log\u202e'), 5_000, 200_000, undefined)
  expect(snap.largest[0]?.label).toBe('Read the log ')
})
