import { expect, test } from 'claude-code/testing'

import { redact } from '../hooks/cache'
import { SECRET_RULES } from '../hooks/secret-rules'
import { maskSecrets, ruleCount } from '../hooks/secrets'

// Built from parts so no scanner mistakes this file for a leak.
const join = (...parts: string[]) => parts.join('')
const GITHUB = join('gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ')
const AWS = join('AK', 'IA', 'IOSFODNN7EXAMPLE')
const SLACK = join('https://hooks.slack.com/services/', 'T00000000/', 'B00000000/', 'XXXXXXXXXXXXXXXXXXXXXXXX')
const JWT = join('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')
const STRIPE = join('sk', '_live_', '4eC39HqLyjWDarjtT1zdp7dc')
const GOOGLE = join('AI', 'zaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe')
const NPM = join('np', 'm_', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5')
const OPENAI = join('OPENAI_API_KEY=sk-', 'proj-', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH')

test('the gitleaks rules all load: every one compiles, none is dropped', () => {
  expect(ruleCount()).toBeGreaterThan(200)
  expect(ruleCount()).toBe(SECRET_RULES.length)
})

test('gitleaks POSIX classes are spelled out, so a rule that uses one matches as it does in gitleaks', () => {
  for (const [id, source] of SECRET_RULES) expect(`${id} ${/\[:\w+:\]/.test(source)}`).toBe(`${id} false`)
  const AIRTABLE = join('pat', 'AbCdEf1234567X', '.', 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2')
  expect(maskSecrets(`airtable key ${AIRTABLE} here`)).toBe('airtable key [redacted] here')
})

test('a credential longer than the slice overlap is masked to its end wherever it crosses a slice edge', () => {
  // A 1Password service account token: a prefix, then any number of base64 characters, here 3,000 of them.
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let seed = 7
  const body = Array.from({ length: 3_000 }, () => B64[((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) % 64]).join('')
  const long = join('op', 's_eyJ', body)
  for (const offset of [0, 1_000, 2_400, 3_990, 6_000]) {
    const out = maskSecrets(`${'x '.repeat(offset / 2)}saw ${long} then more`)
    for (let at = 0; at < long.length; at += 500) expect(out).not.toContain(long.slice(at, at + 40))
    expect(out).toContain('then more')
  }
})

const CASES: [string, string, string][] = [
  ['an AWS access key', `export AWS_ACCESS_KEY_ID=${AWS} in us-east-1`, AWS],
  ['a GitHub token', `push with ${GITHUB} then retry`, GITHUB],
  ['a Slack webhook', `post to ${SLACK}`, SLACK.split('/').slice(-3).join('/')],
  ['a Stripe live key', `charge with ${STRIPE} in prod`, STRIPE],
  ['a Google API key', `maps key ${GOOGLE}`, GOOGLE],
  ['an npm token', `publish with ${NPM}`, NPM],
  ['a bearer token in a curl', `curl -H "Authorization: Bearer ${JWT}" https://api.example.com`, JWT],
  ['an API key assignment', `set ${OPENAI} before running`, OPENAI.split('=')[1]!],
  ['a password inside a URL', 'DATABASE_URL=postgres://admin:Sup3rS3cret!@db.internal:5432/app', 'Sup3rS3cret!'],
  ['a password given in words', 'the password is hunter2 for the staging box', 'hunter2'],
]
for (const [name, text, secret] of CASES) {
  test(`${name} is masked`, () => {
    const out = redact(text)
    expect(out).not.toContain(secret)
    expect(out).toContain('[redacted]')
  })
}

test('an ordinary note comes back unchanged: hashes, ids, paths and the words token and key', () => {
  const note = [
    '# Handoff',
    '- git: feat/x @ a3f9c2e1b7d4, 2 changed files; PR #412; commit 9fceb02d0ae598e95dc970b74767f19372d61af8',
    '- session 3b241101-e2bb-4255-8caf-4136c566a962, run `bun test plugins/cache-timer`',
    '- file /Users/me/projects/app/src/auth/token.ts (the token refresh), key name apiKey, see .env for secrets',
    '- id 0x7f3a9b2c, build 20261007.4, sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '- the password is required for staging, and the URL is https://example.com:8080/path',
  ].join('\n')
  expect(redact(note)).toBe(note)
})

test('a secret deep in a long note is still found, and the rest is untouched', () => {
  const filler = 'ordinary line of notes about the work in progress\n'.repeat(5000)
  const out = redact(`${filler}token ${GITHUB}\n${filler}`)
  expect(out).not.toContain(GITHUB)
  expect(out.length).toBeGreaterThan(filler.length * 2 - 100)
})

test('a secret across the edge of a scan slice is still masked, once', () => {
  for (const offset of [3880, 3990, 3999, 4000, 4010, 7380, 7490]) {
    const out = redact(`${'x '.repeat(offset / 2)}${GITHUB} tail`)
    expect(out).not.toContain(GITHUB.slice(0, 12))
    expect(out.match(/\[redacted\]/g)?.length).toBe(1)
  }
})

const SLOW = ['cisco-meraki-api-key', 'cohere-api-token', 'okta-access-token', 'sumologic-access-id', 'privateai-api-token', 'curl-auth-user', 'curl-auth-header']

test('the patterns that crafted text can slow to seconds are not in the rule set', () => {
  const ids = SECRET_RULES.map(rule => rule[0])
  for (const id of SLOW) expect(ids).not.toContain(id)
})

test('crafted text cannot keep the scan busy: the words that switched the slow patterns on now scan in well under a second', () => {
  for (const word of ['okta', 'cohere', 'meraki', 'sumo', 'privateai', 'curl']) {
    for (const text of [word.repeat(Math.ceil(100_000 / word.length)), `${word} `.repeat(Math.ceil(100_000 / (word.length + 1)))]) {
      const t0 = Date.now()
      redact(text)
      expect(Date.now() - t0).toBeLessThan(1000)
    }
  }
})

test('a scan that runs past its budget throws, so a note that was only partly scanned is never written', () => {
  expect(() => maskSecrets(`token ${GITHUB}`, -1)).toThrow('took too long')
  expect(maskSecrets(`token ${GITHUB}`)).toContain('[redacted]')
})

// What the gitleaks curl rules used to mask, and a little more: every form must lose the secret and keep the command readable.
const CURL: [string, string][] = [
  ['curl -u admin:Sup3rS3cret https://api.example.com', 'Sup3rS3cret'],
  ['curl -uadmin:Sup3rS3cret https://api.example.com', 'Sup3rS3cret'],
  ['curl --user admin:Sup3rS3cret https://x.example.com', 'Sup3rS3cret'],
  ['curl --user=admin:Sup3rS3cret https://x.example.com', 'Sup3rS3cret'],
  ['curl -u "admin:Sup3rS3cret" https://x.example.com', 'Sup3rS3cret'],
  ["curl -u 'admin:Sup3rS3cret' https://x.example.com", 'Sup3rS3cret'],
  ['curl -u "admin:my pass phrase" https://x.example.com', 'pass phrase'],
  ["curl -u 'admin:pa\"ss' https://x.example.com", 'pa"ss'],
  ["curl -u admin:pa'ss https://x.example.com", "pa'ss"],
  ['curl -s -X POST -u deploy:hunter22 https://x.example.com/api', 'hunter22'],
  ['curl -H "Authorization: Bearer abcdef1234567890abcdef" https://x.example.com', 'abcdef1234567890'],
  ["curl -H 'Authorization: Bearer abcdef1234567890abcdef' https://x.example.com", 'abcdef1234567890'],
  ['curl -H "Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==" https://x.example.com', 'dXNlcjpwYXNzd29yZDEyMw'],
  ['curl --header "Authorization: Token abcdef1234567890" https://x.example.com', 'abcdef1234567890'],
  ['curl --header="Authorization: Token abcdef1234567890" https://x.example.com', 'abcdef1234567890'],
  ['curl -H "X-API-Key: abcdef1234567890abcdef" https://x.example.com', 'abcdef1234567890'],
  ['curl -H "Api-Token: abcdef1234567890abcdef" https://x.example.com', 'abcdef1234567890'],
  ['curl -H "PRIVATE-TOKEN: abcdef1234567890abcdef" https://x.example.com', 'abcdef1234567890'],
  ['curl -H "X-Auth-Token: abcdef1234567890abcdef" https://x.example.com', 'abcdef1234567890'],
  ['curl -H "Authorization: abcdef1234567890abcdef" https://x.example.com', 'abcdef1234567890'],
  ['curl -X POST \\\n  -H "Authorization: Bearer abcdef1234567890abcdef" \\\n  https://x.example.com', 'abcdef1234567890'],
]
for (const [command, secret] of CURL) {
  test(`curl: ${command.replace(/\n/g, ' ').slice(0, 60)} loses its secret`, () => {
    const out = redact(command)
    expect(out).not.toContain(secret)
    expect(out).toContain('curl')
    expect(out).toContain('https://')
  })
}

test('a -u that is not a login is left alone', () => {
  for (const command of ['sudo -u root make install', 'git push -u origin main', 'tar -uf backup.tar src', 'curl --user-agent mytool/1.0 https://x.example.com', 'curl --username=build https://x.example.com']) {
    expect(redact(command)).toBe(command)
  }
  expect(redact('curl -u admin:Sup3rS3cret https://api.example.com')).toBe('curl -u admin:[redacted] https://api.example.com')
})

test('a secret broken up with escape codes or invisible characters is joined and masked, in the text and in the saved file', () => {
  for (const hidden of ['​', '­', '‮', '⁠', '﻿', '\u001b[0m', '\u001b]0;t\u0007', '\u0007', '‍']) {
    const split = `${GITHUB.slice(0, 9)}${hidden}${GITHUB.slice(9)}`
    const out = redact(`token seen: ${split} done`)
    expect(out).not.toContain(GITHUB.slice(0, 9))
    expect(out).not.toContain(GITHUB.slice(9))
    expect(out).toContain('[redacted]')
  }
})

test('a credential of several hundred characters is masked wherever it falls among the scan slices', () => {
  const longJwt = join('ey', 'JhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9', '.', 'ey', Array.from({ length: 11 }, (_, i) => `JzdWIiOiIxMjM0NTY3ODkw${i}aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgcGF5bG9hZA`).join(''), '.', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c')
  expect(longJwt.length).toBeGreaterThan(600)
  for (let offset = 3000; offset < 9000; offset += 173) {
    const out = redact(`${'x '.repeat(offset / 2)}saw ${longJwt} in the log ${'y '.repeat(200)}`)
    expect(out).not.toContain(longJwt.slice(40, 100))
    expect(out).not.toContain(longJwt.slice(-40))
  }
})

test('the same secret twice, and one that repeats text from earlier in its match, is masked everywhere', () => {
  const out = redact(`${GITHUB} and again ${GITHUB}`)
  expect(out.match(/\[redacted\]/g)?.length).toBe(2)
  const keyed = `api_key = "a1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"; api_key = "a1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"`
  expect(redact(keyed)).not.toContain('a1b2C3d4E5f6G7h8')
})

// Authorization in many shapes: every secret goes, and what follows stays readable. Checked against what the previous pattern masked.
const AUTH: [string, string][] = [
  ['Authorization: Bearer ab12', 'ab12'],
  ['Authorization: Basic user:pass', 'user:pass'],
  ['Authorization: Token a$b#c!defgh', 'a$b#c!defgh'],
  ['Authorization: NTLM TlRMTVNTUAAB', 'TlRMTVNTUAAB'],
  ['Authorization: abcdef1234567890', 'abcdef1234567890'],
  ['authorization=Bearer abcdef1234567890', 'abcdef1234567890'],
  ['Proxy-Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
  ['{"Authorization": "Bearer abcdef1234567890"}', 'abcdef1234567890'],
  ['"authorization":"Bearer abcdef1234567890","x":1', 'abcdef1234567890'],
  ['Authorization:Bearer abcdef1234567890', 'abcdef1234567890'],
  ['Authorization: ApiKey abc', 'abc'],
  ['Authorization: Custom abcdef!ghi', 'abcdef!ghi'],
  ['Authorization: ab', 'ab'],
  ['curl -H "Authorization: Bearer ab12" https://x.example.com', 'ab12'],
  ["curl -H 'Authorization: Basic user:pass' https://x.example.com", 'user:pass'],
  ['Authorization: Bearer abc"def', 'def'],
  ["Authorization: Bearer abc'def", 'def'],
  ['Authorization: Bearer abc,def', 'abc,def'],
  ['Authorization: Bearer abcdef;ghi', 'abcdef;ghi'],
]
for (const [header, secret] of AUTH) {
  test(`authorization: ${header.slice(0, 64)} loses its secret`, () => {
    expect(redact(header)).not.toContain(secret)
  })
}

test('what follows an Authorization value stays: the URL, the closing quote and the brackets', () => {
  expect(redact('curl -H "Authorization: abcdef1234567890abcdef" https://x.example.com')).toBe('curl -H "Authorization: [redacted]" https://x.example.com')
  expect(redact('curl -H "Authorization: Bearer abcdef1234567890" https://x.example.com')).toBe('curl -H "Authorization: [redacted]" https://x.example.com')
  expect(redact('{"Authorization": "Bearer abcdef1234567890"}')).toBe('{"Authorization": "[redacted]"}')
})

// Where a secret sits decides whether it can be found: every keyed form, with secrets of many shapes. (The placeholder is @@ so
// a name like X-Api-Key is never the thing replaced.)
const CONTEXTS = ['token: @@', 'TOKEN=@@', 'password=@@', 'api_key: "@@"', 'export SECRET_KEY=@@', 'export PRIVATE_KEY=@@', 'ENCRYPTION_KEY=@@', 'Authorization: Bearer @@', 'x-api-key: @@', 'X-Api-Key=@@', 'postgres://u:@@@h/db', 'curl -u u:@@ https://h', 'curl -H "X-Auth-Token: @@" https://h', '{"password":"@@"}', '{"api_key": "@@"}', 'password: @@', '--password @@', '--token=@@', '--api-key @@', 'access_key = @@', 'client_secret: @@', 'PGPASSWORD=@@ psql']
const VALUES = ['0123456789abcdef0123456789abcdef', 'dGhpcyBpcyBhIHNlY3JldCB2YWx1ZQ==', 'Zx9Qw3Er7Ty1Ui5Op2As', 'p@ssw0rd!', 'hunter2', 'S3cr3t#Value$1', 'abc123', 'a'.repeat(40)]
test('a secret of any shape is masked in every keyed form', () => {
  const leaks: string[] = []
  for (const context of CONTEXTS) {
    for (const value of VALUES) {
      const text = `run: ${context.replace('@@', value).replace('@@', value)} done`
      // "u:@@@h" has the value between the colon and the at sign; the second replace is for contexts that name it twice.
      if (redact(text).includes(value)) leaks.push(`${context} <- ${value.slice(0, 12)}`)
    }
  }
  expect(leaks).toEqual([])
})

test('names that are not secrets are left alone: tokens counts, key names, flags without a value', () => {
  for (const text of ['tests pass: 12', 'compass: north', 'bypass=1', 'mysql -p db', 'cookie recipe: flour', 'git clone https://github.com/org/repo.git', 'ssh://git@host/repo', 'context tokens: 250000', 'token budget is large', 'the key idea: reuse', 'run with --password-stdin', 'npm run build --token-count', 'secret_santa signup page']) {
    expect(redact(text)).toBe(text)
  }
})

test('redact stays fast on 100,000 characters of crafted text: no pattern retries an unbounded run from every starting point', () => {
  const rep = (s: string) => s.repeat(Math.ceil(100_000 / s.length))
  const slow: string[] = []
  for (const unit of ['a-', 'x-key', 'secret_key', 'authorization', '--password ', 'bearer ', 'password:', 'token=', '-----BEGIN PRIVATE KEY-----', 'http://a:', 'sk-', 'x-', 'api_key', 'passwd is ', 'curl -u a:', 'authorization: bearer ', '-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----\n', 'http://a:b@', 'password=a&', 'token=a&b=', 'secret&', 'x-api-key: a', 'cookie: ', 'set-cookie: a=', 'mysql -p', 'mysql x -u r ', 'sshpass -p ', 'a_pass:', 'https://aaaaaaaaaaaaaaaaaaaa', 'git://a_', 'credentials: ']) {
    const t0 = Date.now()
    redact(rep(unit))
    const ms = Date.now() - t0
    if (ms > 1000) slow.push(`${unit} ${ms}ms`)
  }
  expect(slow).toEqual([])
})

// ---- Coverage that must not narrow: found by comparing with every earlier version on long names, long values, big keys and odd headers.

test('a name of any length is found; the value may hold & and runs to the end of the word', () => {
  const longName = `${'a'.repeat(120)}_PASSWORD`
  expect(redact(`${longName}=p&ss$9&word`)).not.toContain('word')
  expect(redact(`x-${'a'.repeat(120)}-token: ab$2&9cd!`)).not.toContain('9cd')
  expect(redact('https://api.example.com/v1?api_key=ABC123&user=bob&limit=5')).toBe('https://api.example.com/v1?api_key=[redacted]&user=bob&limit=5')
})

test('a login in a URL is masked at any length, user or password', () => {
  for (const [user, password] of [['u', 'x'.repeat(150)], ['u', 'y'.repeat(1500)], ['z'.repeat(150), 'pw1'], ['u', 'p%40ss']]) {
    const out = redact(`DB=postgresql+psycopg2://${user}:${password}@host:5432/db now`)
    expect(out).not.toContain(password)
    expect(out).toContain('@host:5432/db')
  }
})

test('private keys are masked at any size, of every type, with either line ending, and one that is cut off is masked to the end', () => {
  const body = (n: number, eol: string) => 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC'.repeat(Math.ceil(n / 50)).match(/.{1,64}/g)!.join(eol)
  for (const type of ['RSA PRIVATE KEY', 'PRIVATE KEY', 'EC PRIVATE KEY', 'OPENSSH PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'DSA PRIVATE KEY', 'PGP PRIVATE KEY BLOCK']) {
    for (const [size, eol] of [[200, '\n'], [3000, '\r\n'], [40_000, '\n']] as const) {
      const text = `key:\n-----BEGIN ${type}-----${eol}${body(size, eol)}${eol}-----END ${type}-----\nafter`
      const out = redact(text)
      expect(out).not.toContain('MIIEvQIBADANBgkq')
      expect(out).toContain('after')
    }
  }
  const cut = redact(`before\n-----BEGIN RSA PRIVATE KEY-----\n${body(500, '\n')}`)
  expect(cut).toBe('before\n[redacted private key]')
})

test('after any first word, the second word of an Authorization header goes too; a URL, a flag or the next line stays', () => {
  for (const scheme of ['Custom', 'Hawk', 'OAuth', 'SSWS', 'Bot', 'Splunk', 'GenieKey']) {
    for (const secret of ['ab', 'abc12', 'abcdef123456']) {
      expect(redact(`Authorization: ${scheme} ${secret} -X POST`)).not.toContain(secret)
      expect(redact(`curl -H "Authorization: ${scheme} ${secret}" https://x.example.com`)).not.toContain(secret)
    }
  }
  expect(redact('Authorization: abc123\nContent-Type: json')).toBe('Authorization: [redacted]\nContent-Type: json')
  expect(redact('curl -H "Authorization: abc123" -X POST')).toBe('curl -H "Authorization: [redacted]" -X POST')
})
