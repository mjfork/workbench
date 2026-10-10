import { expect, test } from 'claude-code/testing'

import { cacheLabel, cacheState, cardLines, lastResponse, paramsOf, plainText, rebuildCost, withTtl } from '../hooks/cache'

const P = paramsOf()
const cents = (n: number | undefined) => Math.round((n ?? NaN) * 100)
const MIN = 60_000

test('state and label: warm, yellow in the last 15 minutes, red once expired', () => {
  expect(cacheState(0, 10 * MIN, P)).toEqual({ state: 'warm', leftMs: 50 * MIN })
  expect(cacheLabel(50 * MIN)).toBe('cache 50m')
  expect(cacheState(0, 45 * MIN, P).state).toBe('warn')
  expect(cacheState(0, 59.5 * MIN, P).state).toBe('warn')
  expect(cacheLabel(30_000)).toBe('cache <1m')
  expect(cacheState(0, 60 * MIN, P).state).toBe('expired')
  expect(cacheLabel(-1)).toBe('cache expired')
  expect(paramsOf()).toEqual({ ttlMs: 60 * MIN, warnMs: 15 * MIN })
})

const reply = (timestamp: string, h1: number, m5: number, extra: object = {}) =>
  JSON.stringify({ type: 'assistant', timestamp, ...extra, message: { usage: { cache_creation: { ephemeral_1h_input_tokens: h1, ephemeral_5m_input_tokens: m5 } } } })

test('the last main-thread response and its TTL from a transcript tail, skipping cut lines and sidechains', () => {
  const tail = [
    'cut-off line "type":"assistant"',
    reply('2026-10-04T09:00:00.000Z', 900, 0),
    reply('2026-10-04T10:00:00.000Z', 0, 0),
    JSON.stringify({ type: 'user', timestamp: '2026-10-04T10:05:00.000Z' }),
    reply('2026-10-04T10:06:00.000Z', 0, 500, { isSidechain: true }),
  ].join('\n')
  // The last response wrote nothing: its TTL is the latest one that did (1h).
  expect(lastResponse(tail)).toEqual({ at: Date.parse('2026-10-04T10:00:00.000Z'), ttlMs: 60 * MIN })
  expect(lastResponse(reply('2026-10-04T10:00:00.000Z', 100, 200)).ttlMs).toBe(5 * MIN)
  expect(lastResponse('')).toEqual({ at: null, ttlMs: null })
})

test('the transcript TTL replaces the 1-hour fallback; yellow is at most its last quarter', () => {
  expect(withTtl(P, 5 * MIN)).toEqual({ ttlMs: 5 * MIN, warnMs: 1.25 * MIN })
  expect(withTtl(P, null)).toEqual(P)
  expect(cacheState(0, 4 * MIN, withTtl(P, 5 * MIN)).state).toBe('warn')
  expect(cacheState(0, 6 * MIN, withTtl(P, 5 * MIN)).state).toBe('expired')
})

test('rebuild cost at list prices: 1-hour writes cost 2x input, 5-minute 1.25x; unknown models say so', () => {
  const opus = rebuildCost('claude-opus-5-5', 200_000, 60 * MIN)!
  expect([opus.name, opus.writeRate]).toEqual(['Opus 5.5', 8])
  expect(cents(opus.usd)).toBe(cents(1.6))
  expect(cents(opus.warmUsd)).toBe(cents(0.04))
  expect(cents(rebuildCost('claude-sonnet-5-5[1m]', 1_000_000, 5 * MIN)?.usd)).toBe(cents(2.5))
  expect(cents(rebuildCost('claude-fable-5-1', 100_000, 60 * MIN)?.usd)).toBe(cents(2))
  expect(rebuildCost('gpt-x', 1, MIN)).toBeNull()
  expect(cardLines(-12 * MIN, 200_000, 'mystery', 60 * MIN)[1]).toContain('unknown for mystery')
})

test('plainText removes escape sequences and direction-changing characters', () => {
  expect(plainText('\u001b[31mred\u001b[0m')).toBe('red')
  expect(plainText('a\u001b]0;title\u0007b')).toBe('ab')
  expect(plainText('a\u001b]8;;http://x\u001b\\link\u001b]8;;\u001b\\')).toBe('alink')
  expect(plainText('x\u202ey\u2066z\r\u0008')).toBe('x y z  ')
  expect(plainText('plain `text` with unicode: café, 日本')).toBe('plain `text` with unicode: café, 日本')
})
