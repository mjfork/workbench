import { expect, test } from 'claude-code/testing'
import { drawable } from '../hooks/register'

// Saved state outlives a code update: a session that loads a new version may still hold rows in the old shape (0.4.1
// kept a built `card`, not the `report`). Drawing skips them until the next poll replaces them, rather than throwing.
test('rows saved by an older version, or cut short, are not drawn', () => {
  const report = { pane: 'w6A:p2', workspace: 'w6A', tokens: 1, window: 2, at: 0, isEnded: false }
  const rows = [
    { pane: 'w6A:p1', workspace: 'w6A', tokens: 704_000, card: ['w6A:p1  704k/1000k (70%)'] },
    { pane: 'w6A:p2', workspace: 'w6A', tokens: 1, report },
    null,
    { pane: 'w6A:p3', report: null },
  ]
  expect(drawable(rows).map(r => r.pane)).toEqual(['w6A:p2'])
  expect(drawable(undefined)).toEqual([])
  expect(drawable({ rows })).toEqual([])
})
