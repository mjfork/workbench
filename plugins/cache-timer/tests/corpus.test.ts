import { expect, test } from 'claude-code/testing'

import { redact } from '../hooks/cache'

// A corpus of secrets in the places they turn up: built once, deterministic, and every case must come out without the secret.
// New ways a secret can sit in a note belong here first; a redaction change is judged by this, not by one example.

const rnd = (n: number, seed = 7) => {
  let x = seed
  let s = ''
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    s += alphabet[x % alphabet.length]
  }
  return s
}
const symbols = (n: number) => Array.from({ length: n }, (_, i) => 'aB3$xY9!kZ2#mQ7%pL4&'[(i * 7 + 3) % 20]).join('')

type Case = { cat: string; text: string; secret: string }
const cases: Case[] = []
const add = (cat: string, text: string, secret: string) => cases.push({ cat, text, secret })

const VALUES = ['ab', 'hunter2', 'p@ssw0rd!', rnd(32), `${rnd(44)}==`, rnd(200), rnd(1000), symbols(3000)]

// Keyed assignments: names of every length and style, every separator, values of every shape.
const NAMES = ['token', 'TOKEN', 'api_key', 'password', 'secret', 'client_secret', 'access_key', 'SECRET_KEY', 'PRIVATE_KEY', 'MY_APP_DB_PASSWORD', `${'a'.repeat(30)}_PASSWORD`, `${'a'.repeat(60)}_PASSWORD`, 'x-api-key', 'X-Auth-Token', `x-${'a'.repeat(50)}-token`, `x-${'a'.repeat(120)}-token`, 'AWS_SECRET_ACCESS_KEY', 'db.password', 'session_token', 'refresh_token', 'AccountKey', 'SharedAccessKey', 'credentials', 'DB_PASS']
for (const name of NAMES) {
  for (const sep of [': ', '=', ' = ', '": "', '":"']) {
    for (const value of VALUES) add('keyed', sep.startsWith('"') ? `{"${name}${sep}${value}"}` : `run: ${name}${sep}${value} done`, value)
  }
}

// Logins in URLs.
for (const scheme of ['postgres', 'https', 'postgresql+psycopg2', 'mongodb+srv', 'redis']) {
  for (const password of ['pw1', `${rnd(150)}%40x`, rnd(300), rnd(1500)]) {
    for (const user of ['u', 'u'.repeat(150)]) add('url', `DB=${scheme}://${user}:${password}@host:5432/db now`, password)
  }
}
for (const token of [rnd(24, 11), rnd(40, 13), `${rnd(20, 17)}-${rnd(20, 19)}`]) add('url-token-as-user', `git clone https://${token}@host.example.com/org/repo.git`, token)

// Private keys.
const pem = (type: string, size: number, eol: string) => {
  const body = rnd(size).match(/.{1,64}/g)!.join(eol)
  return { text: `key:${eol}-----BEGIN ${type}-----${eol}${body}${eol}-----END ${type}-----${eol}after`, secret: body.replace(/\r?\n/g, '').slice(10, 50) }
}
for (const type of ['RSA PRIVATE KEY', 'PRIVATE KEY', 'EC PRIVATE KEY', 'OPENSSH PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'DSA PRIVATE KEY', 'PGP PRIVATE KEY BLOCK']) {
  for (const size of [200, 3000, 13_000, 40_000]) for (const eol of ['\n', '\r\n']) {
    const { text, secret } = pem(type, size, eol)
    add('pem', text, secret)
  }
}
add('pem-json', `{"private_key": "-----BEGIN PRIVATE KEY-----\\n${rnd(1600)}\\n-----END PRIVATE KEY-----\\n"}`, rnd(1600).slice(100, 140))

// Authorization headers: every scheme, short and long credentials, on one line, quoted in curl, as JSON, with trailing flags.
for (const scheme of ['Bearer', 'Basic', 'Token', 'Custom', 'Hawk', 'OAuth', 'SSWS', 'Bot', 'Splunk', 'GenieKey', 'Digest', 'Negotiate', 'ApiKey']) {
  for (const secret of ['ab', 'abc12', 'abcdef123456', rnd(300), `-${rnd(40, 23)}`, `_${rnd(40, 29)}`]) {
    add('auth', `Authorization: ${scheme} ${secret} -X POST`, secret)
    add('auth-curl', `curl -H "Authorization: ${scheme} ${secret}" https://x.example.com`, secret)
    add('auth-json', `{"Authorization": "${scheme} ${secret}"}`, secret)
  }
}
for (const secret of ['ab', 'abc12', 'abcdef123456', rnd(300), `-${rnd(40, 31)}`]) {
  add('auth-bare', `Authorization: ${secret}`, secret)
  add('auth-nextline', `Authorization: Bearer ${secret}\nContent-Type: json`, secret)
}

// Flags and commands.
for (const flag of ['--password', '--token', '--secret', '--api-key', '--client-secret', '-token']) for (const value of VALUES.slice(1, 6)) add('flag', `tool ${flag} ${value} --other`, value)
for (const [command, secret] of [['curl -u admin:Sup3rS3cret https://h', 'Sup3rS3cret'], ['curl -uadmin:Sup3rS3cret https://h', 'Sup3rS3cret'], ['curl -u "admin:my pass phrase" https://h', 'pass phrase'], ["curl -u 'admin:pa\"ss' https://h", 'pa"ss'], ['sshpass -p Sup3rS3cret ssh host', 'Sup3rS3cret'], ['sshpass -p "my pass phrase" ssh host', 'pass phrase'], ['mysql -u root -pSup3rS3cret mydb', 'Sup3rS3cret'], ['mysqldump --user=root -pSup3rS3cret db', 'Sup3rS3cret'], ['mysql -h host -u root -p"Sup3r S3cret" db', 'S3cret']] as const) add('command', command, secret)

// Cookies, connection strings and sentences.
for (const value of [rnd(32, 37), `${rnd(20, 41)}.${rnd(20, 43)}`, symbols(80)]) {
  add('cookie', `curl -H "Cookie: sid=${value}; theme=dark" https://h`, value)
  add('cookie', `Set-Cookie: session=${value}; Path=/; HttpOnly`, value)
  add('cookie', `Cookie: ${value}`, value)
}
for (const value of ['Sup3rS3cret', rnd(44, 47)]) {
  add('connection-string', `Server=tcp:db.example.net,1433;Initial Catalog=app;User ID=svc;Password=${value};Encrypt=yes`, value)
  add('connection-string', `DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=${value}==;EndpointSuffix=core.windows.net`, value)
}
for (const value of ['hunter2', 'p@ssw0rd!', `${rnd(150)}9${rnd(40)}`]) add('prose', `the password is ${value} for staging`, value)
add('envblock', `DB_PASSWORD=${rnd(24, 3)}\nAPI_TOKEN=${rnd(40, 5)}\nNAME=app`, rnd(24, 3))
add('envblock', `DB_PASSWORD=${rnd(24, 3)}\nAPI_TOKEN=${rnd(40, 5)}\nNAME=app`, rnd(40, 5))
add('quoted-spaces', `export API_KEY="${rnd(10, 53)} ${rnd(10, 59)}"`, rnd(10, 59))

// A secret shows up as itself, or as a piece of it: the start, the middle or the end of a long one.
const leaks = (out: string, secret: string) => (secret.length < 24 ? out.includes(secret) : [secret.slice(0, 24), secret.slice(Math.floor(secret.length / 2), Math.floor(secret.length / 2) + 24), secret.slice(-24)].some(piece => out.includes(piece)))
const shorten = (text: string) => text.replace(/([a-z0-9]{12})[a-z0-9]{20,}/gi, '$1…').slice(0, 100)

test('the corpus has more than a thousand cases', () => {
  expect(cases.length).toBeGreaterThan(1000)
})

test('no secret in the corpus survives redact', () => {
  const survivors = new Map<string, string[]>()
  for (const c of cases) if (leaks(redact(c.text), c.secret)) survivors.set(c.cat, [...(survivors.get(c.cat) ?? []), shorten(c.text)])
  expect([...survivors].map(([cat, texts]) => `${cat} (${texts.length}): ${[...new Set(texts)].slice(0, 3).join(' // ')}`)).toEqual([])
})
