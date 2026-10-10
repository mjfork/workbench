import { expect, test } from 'claude-code/testing'

import { handoffMinTokensOf, isNoHandoff, isWorthHandoff, redact } from '../hooks/cache'

test('redact masks credentials and leaves ordinary text, hashes and "key" words alone', () => {
  expect(redact('Authorization: Bearer abc.def.ghi-123456')).not.toContain('abc.def')
  expect(redact('curl -H "X-Api-Token: 2f3cc223-f4bd-4624-aa88-02565f4c9226" https://x')).not.toContain('2f3cc223')
  expect(redact('api_key=XYZ123 and secret: s3cr3t')).toBe('api_key=[redacted] and secret: [redacted]')
  expect(redact('sk-abcdefghijklmnopqrstuvwxyz and AKIAABCDEFGHIJKLMNOP')).toBe('[redacted] and [redacted]')
  expect(redact('-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----')).toBe('[redacted private key]')
  const plain = 'Decided on commit 9f2c1ab; the primary key: id column stays; see docs/specs/auth.md#keys'
  expect(redact(plain)).toBe(plain)
})

test('only a short NO HANDOFF reply counts as nothing to write', () => {
  expect(isNoHandoff('NO HANDOFF')).toBe(true)
  expect(isNoHandoff('  no handoff.\n')).toBe(true)
  expect(isNoHandoff('## Goal\nNo handoff needed for the docs part')).toBe(false)
  expect(isNoHandoff('NO HANDOFF ' + 'x'.repeat(300))).toBe(false)
})

test('the context gate: 200K by default, 0 means any size, an unknown size does not count', () => {
  expect(handoffMinTokensOf(undefined)).toBe(200_000)
  expect(handoffMinTokensOf({ handoffMinTokens: 50_000 })).toBe(50_000)
  expect(handoffMinTokensOf({ handoffMinTokens: 0 })).toBe(0)
  expect(handoffMinTokensOf({ handoffMinTokens: -5 })).toBe(200_000)
  expect([isWorthHandoff(199_999, 200_000), isWorthHandoff(200_000, 200_000), isWorthHandoff(undefined, 200_000), isWorthHandoff(undefined, 0), isWorthHandoff(10, 0)]).toEqual([false, true, false, true, true])
})
