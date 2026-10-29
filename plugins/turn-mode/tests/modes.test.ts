import { expect, test } from 'claude-code/testing'

import { keyOf, nextMode, parseMode, textFor } from '../hooks/modes'

test('the mode file: missing or malformed is async; a driver only counts for agentic', () => {
  expect(parseMode('')).toEqual({ mode: 'async', driver: null, driverName: null })
  expect(parseMode('{"mode":"bogus"}')).toEqual({ mode: 'async', driver: null, driverName: null })
  expect(parseMode('{"mode":"realtime","driver":"w1:p1"}')).toEqual({ mode: 'realtime', driver: null, driverName: null })
  expect(parseMode('{"mode":"agentic","driver":"w1:p1"}')).toEqual({ mode: 'agentic', driver: 'w1:p1', driverName: null })
  expect(keyOf('agentic', 'w1:p1', false)).toBe('agentic:w1:p1')
  expect(keyOf('realtime', null, true)).toBe('peer')
  expect(textFor('realtime')).not.toContain('**Ask:**')
  expect(textFor('agentic:')).toContain('your driver')
  expect([nextMode('async'), nextMode('realtime'), nextMode('agentic')]).toEqual(['realtime', 'async', 'async'])
})

test('every mode that may end with a Needs-you section carries its whole shape, not just its name', () => {
  for (const key of ['async', 'peer', 'agentic:w1:p1', 'agentic:']) {
    for (const field of ['## ⚑ Needs you', '**Ask:**', '**Options:**', '**Reply with:**', '**Unblocks:**', '## ✓ Resolved']) {
      expect(textFor(key)).toContain(field)
    }
  }
  expect(textFor('agentic:w1:p1')).toContain('queues this pane for your driver')
})

test('the driver is named for SendMessage by its session name, never a pane id', () => {
  expect(parseMode('{"mode":"agentic","driver":"w1:p1","driverName":"lead-driver"}')).toEqual({ mode: 'agentic', driver: 'w1:p1', driverName: 'lead-driver' })
  // A name only counts with a driver, and only in a shape SendMessage takes.
  expect(parseMode('{"mode":"agentic","driverName":"lead-driver"}').driverName).toBeNull()
  expect(parseMode('{"mode":"agentic","driver":"w1:p1","driverName":"w1:p1"}').driverName).toBeNull()
  expect(parseMode('{"mode":"agentic","driver":"w1:p1","driverName":"a b"}').driverName).toBeNull()
  expect(keyOf('agentic', 'w1:p1', false, 'lead-driver')).toBe('agentic:w1:p1|lead-driver')
  expect(keyOf('agentic', 'w1:p1', false)).toBe('agentic:w1:p1')
  expect(keyOf('agentic', 'w1:p1', true, 'lead-driver')).toBe('peer')
  const named = textFor('agentic:w1:p1|lead-driver')
  expect(named).toContain('SendMessage (to: "lead-driver")')
  expect(named).toContain('the driver (lead-driver)')
  const unnamed = textFor('agentic:w1:p1')
  expect(unnamed).toContain('ListAgents')
  expect(unnamed).toContain('never a pane id')
  expect(unnamed).not.toContain('to: "w1:p1"')
})

test('agentic: two separate layouts, so "nothing else" never forbids the Needs-you section', () => {
  const lines = textFor('agentic:w1:p1|lead-driver').split('\n')
  const done = lines.find(l => l.startsWith('- DONE, BLOCKED or WAITING:')) ?? ''
  const needs = lines.find(l => l.startsWith('- NEEDS-INPUT')) ?? ''
  expect(done).toContain('one status line, then one plain sentence')
  expect(done).toContain('Nothing else.')
  expect(done).not.toContain('section')
  expect(needs).toContain('one status line, then one plain sentence, then this section, and nothing after it')
  expect(needs).not.toContain('Nothing else')
  // The only "nothing else" in the text is the DONE/BLOCKED layout's.
  expect(lines.filter(l => /nothing else/i.test(l))).toEqual([done])
  // The section's shape follows the layouts.
  expect(lines.indexOf('## ⚑ Needs you')).toBeGreaterThan(lines.indexOf(needs))
})

test('agentic: WAITING is a turn end that is not the end of the task, and only a driven worker gets it', () => {
  const agentic = textFor('agentic:w1:p1|lead-driver')
  expect(agentic).toContain('`WAITING: <the job and how you will know it ended>`')
  expect(agentic).toContain("WAITING means the task isn't finished")
  expect(agentic).toContain('stop every monitor and background wait you started for it')
  expect(textFor('peer')).not.toContain('WAITING')
  expect(textFor('async')).not.toContain('WAITING')
})
