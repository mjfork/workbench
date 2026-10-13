import { expect, test } from 'claude-code/testing'
import type { ContextCategory, SessionMessage } from 'claude-code'

import { measure, measurer } from '../hooks/measure'

const categories: ContextCategory[] = [
  { name: 'System prompt', tokens: 20_000, color: 'x', isDeferred: false, kind: 'used' },
  { name: 'Messages', tokens: 999, color: 'x', isDeferred: false, kind: 'used' },
]

const TOOLS = ['Bash', 'Read', 'Agent', 'mcp__a__b', 'Edit', 'Grep']

// A call and its result; equal sizes recur, so ties must keep their order.
const call = (i: number, tool = TOOLS[i % TOOLS.length]!, size = 400 * ((i * 7) % 5 + 1)): SessionMessage[] => [
  { role: 'assistant', text: `step ${i}`, toolUses: [{ tool_use_id: `t${i}`, tool, input: { command: `cmd ${i}`, description: `call ${i}` } }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: `t${i}`, text: 'r'.repeat(size), isError: false }] },
]

const transcript = (from: number, to: number): SessionMessage[] => {
  const out: SessionMessage[] = [{ role: 'user', text: 'go', toolUses: [] }]
  for (let i = from; i < to; i++) out.push(...call(i))
  return out
}

test('appending messages gives what a full measure of the whole transcript gives', () => {
  const next = measurer()
  const all = transcript(0, 30)
  for (const n of [1, 3, 4, 11, 12, 40, all.length]) {
    const seen = all.slice(0, n)
    expect(next(seen, 80_000, 200_000, categories)).toEqual(measure(seen, 80_000, 200_000, categories))
  }
  // The same transcript again, with nothing new.
  expect(next(all, 90_000, 200_000, undefined)).toEqual(measure(all, 90_000, 200_000, undefined))
})

test('a result whose call is not in the transcript counts as other, as a full measure counts it', () => {
  const next = measurer()
  const orphan: SessionMessage = { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'gone', text: 'o'.repeat(9_000), isError: false }] }
  const all = [...transcript(0, 4), orphan, ...call(9)]
  next(all.slice(0, 3), 50_000, 200_000, categories)
  expect(next(all, 50_000, 200_000, categories)).toEqual(measure(all, 50_000, 200_000, categories))
})

test('after a compaction or a rewind the result is a fresh full measure', () => {
  const next = measurer()
  const long = transcript(0, 20)
  next(long, 100_000, 200_000, categories)

  // Rewind: shorter.
  const rewound = long.slice(0, 9)
  expect(next(rewound, 40_000, 200_000, categories)).toEqual(measure(rewound, 40_000, 200_000, categories))

  // Compaction: a summary and a few messages, as long as or longer than before.
  const compacted: SessionMessage[] = [{ role: 'user', text: 'summary '.repeat(500), toolUses: [] }, ...transcript(30, 40)]
  expect(next(compacted, 30_000, 200_000, categories)).toEqual(measure(compacted, 30_000, 200_000, categories))

  // Same count, a message in the middle rewritten (an old tool result cleared).
  const cleared = compacted.map((m, i) => i === 4
    ? { ...m, toolResults: m.toolResults?.map(r => ({ ...r, text: '[cleared]' })) }
    : m)
  expect(next(cleared, 30_000, 200_000, categories)).toEqual(measure(cleared, 30_000, 200_000, categories))

  // Then appends again.
  const grown = [...cleared, ...call(50, 'Bash', 30_000)]
  expect(next(grown, 60_000, 200_000, categories)).toEqual(measure(grown, 60_000, 200_000, categories))

  // The window slides: the oldest messages fall off the front.
  const slid = grown.slice(3)
  expect(next(slid, 60_000, 200_000, categories)).toEqual(measure(slid, 60_000, 200_000, categories))
})

test('a tool input already measured is not stringified again, even after a full recompute', () => {
  let count = 0
  const counted = (i: number): SessionMessage[] => {
    const [use, result] = call(i)
    const input = { command: `cmd ${i}`, toJSON: () => { count++; return { command: `cmd ${i}` } } }
    return [{ ...use!, toolUses: [{ ...use!.toolUses[0]!, input }] }, result!]
  }
  const next = measurer()
  const first = [...counted(0), ...counted(1)]
  next(first, 10_000, 200_000, undefined)
  expect(count).toBe(2)

  // New arrays and objects, as each read of the transcript hands back.
  const more = [...first.map(m => ({ ...m })), ...counted(2)]
  next(more, 12_000, 200_000, undefined)
  expect(count).toBe(3)

  // A rewind recomputes the totals from what each call measured before.
  next(more.slice(0, 2), 8_000, 200_000, undefined)
  expect(count).toBe(3)
})

test('over many random appends, rewinds and slides it always equals a full measure', () => {
  let seed = 7
  const rand = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n
  const next = measurer()
  let all: SessionMessage[] = transcript(0, 3)
  for (let step = 0; step < 300; step++) {
    const move = rand(10)
    if (move < 6) for (let k = rand(4); k >= 0; k--) all = [...all, ...call(100 + step * 5 + k, TOOLS[rand(6)], 400 * (rand(4) + 1))]
    else if (move === 6) all = all.slice(0, rand(all.length + 1))
    else if (move === 7) all = all.slice(rand(3))
    else if (move === 8) all = [...all, { role: 'user', text: 'x'.repeat(rand(900)), toolUses: [], toolResults: [{ tool_use_id: `none${step}`, text: 'n'.repeat(400 * rand(4)), isError: false }] }]
    const used = 20_000 + rand(180_000)
    expect(next(all, used, 200_000, categories)).toEqual(measure(all, used, 200_000, categories))
  }
})
