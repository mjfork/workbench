import { expect, test } from 'claude-code/testing'

import { chipsOf, FOOTER_COLS, reservedCols } from '../hooks/footer'

const item = (pane: string) => ({ pane, workspace: pane.split(':')[0]!, label: pane, kind: 'ask', ask: 'x', ts: 1 }) as never
const labels = (r: { chips: { label: string }[] }) => r.chips.map(c => c.label)

test('a pane alone in another workspace is named by the workspace; others by pane ID; your own pane is "here"', () => {
  const items = [item('wT:p1'), item('w8:p1'), item('w8:p2'), item('w9:p1'), item('w9:p4')]
  const r = chipsOf(items, 'w8', 'w8:p2', 100)
  expect(labels(r)).toEqual(['wT', 'w8:p1', 'here', 'w9:p1', 'w9:p4'])
  expect(r.more).toBe(0)
})

test('the three you have waiting all show, where only one used to', () => {
  const r = chipsOf([item('wT:p1'), item('w8:p1'), item('w8:p2')], 'w8', 'w8:p2', FOOTER_COLS - reservedCols('w8', 3))
  expect(labels(r)).toEqual(['wT', 'w8:p1', 'here'])
  expect(r.more).toBe(0)
})

test('as many as fit in the width, then +N for the rest, with room kept for the +N', () => {
  const items = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(w => item(`${w}:p1`))
  // 3 columns each (2 + the gap). 14 columns would hold four, but then the +2 has no room: three stay, and the count says 3.
  const r = chipsOf(items, 'w0', null, 14)
  expect(labels(r)).toEqual(['w1', 'w2', 'w3'])
  expect(r.more).toBe(3)
  // At 11, three chips (9) leave no room for the +3 (3 more): two stay, and the count says 4.
  const tight = chipsOf(items, 'w0', null, 11)
  expect(labels(tight)).toEqual(['w1', 'w2'])
  expect(tight.more).toBe(4)
})

test('no room at all leaves just the +N', () => {
  const r = chipsOf([item('w1:p1'), item('w2:p1')], 'w0', null, 3)
  expect(r.chips).toEqual([])
  expect(r.more).toBe(2)
})

test('the budget is the context bar row less what the row already holds', () => {
  expect(FOOTER_COLS).toBe(38)
  // toggle 10 + "herdr w8" 8 + gap + "⚑ 3" 3 + gap = 23
  expect(reservedCols('w8', 3)).toBe(23)
  // The label is the pane ID when there is one: "herdr w8:p2" is 11.
  expect(reservedCols('w8:p2', 3)).toBe(26)
})
