import { expect, test } from 'claude-code/testing'

import { keyOf, nextMode, parseMode, textFor } from '../hooks/modes'

test('the mode file: missing or malformed is async; a driver only counts for agentic', () => {
  expect(parseMode('')).toEqual({ mode: 'async', driver: null })
  expect(parseMode('{"mode":"bogus"}')).toEqual({ mode: 'async', driver: null })
  expect(parseMode('{"mode":"realtime","driver":"w1:p1"}')).toEqual({ mode: 'realtime', driver: null })
  expect(parseMode('{"mode":"agentic","driver":"w1:p1"}')).toEqual({ mode: 'agentic', driver: 'w1:p1' })
  expect(keyOf('agentic', 'w1:p1', false)).toBe('agentic:w1:p1')
  expect(keyOf('realtime', null, true)).toBe('peer')
  expect(textFor('realtime')).not.toContain('**Ask:**')
  expect(textFor('agentic:')).toContain('your driver')
  expect([nextMode('async'), nextMode('realtime'), nextMode('agentic')]).toEqual(['realtime', 'async', 'async'])
})
