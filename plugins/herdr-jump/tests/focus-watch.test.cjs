'use strict'
// The Node focus watcher (bin/focus-watch.cjs): what herdr-jump runs on Windows, where herdr's API is a named pipe.
// It is driven as a subprocess against a local server: a named pipe on Windows, a Unix socket elsewhere.
// Run with: node --test plugins/herdr-jump/tests/focus-watch.test.cjs
const test = require('node:test')
const assert = require('node:assert')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')

const WATCHER = path.join(__dirname, '..', 'bin', 'focus-watch.cjs')
const IS_WINDOWS = process.platform === 'win32'
const PIPE_PREFIX = '\\\\.\\pipe\\'
const TIMEOUT_MS = 15_000

let counter = 0
/** The path herdr would put in HERDR_SOCKET_PATH, and where a server must listen for the watcher to reach it. */
function endpoint() {
  const sock = path.join(os.tmpdir(), `wb-focus-${process.pid}-${Date.now()}-${counter++}.sock`)
  return { sock, listenOn: IS_WINDOWS ? PIPE_PREFIX + sock : sock }
}

/** The test runner's environment minus any HERDR_* it was started under, plus `extra` (an undefined value leaves the name unset). */
function childEnv(extra) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('HERDR_')))
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v
  return env
}

const within =(promise, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), TIMEOUT_MS).unref())])

/** Runs the watcher against a fresh server. `serve(conn, request)` is called once the watcher's subscription arrives. */
async function harness(env, serve) {
  const { sock, listenOn } = endpoint()
  const conns = []
  let onRequest
  const requested = new Promise(resolve => { onRequest = resolve })
  const server = net.createServer(conn => {
    conns.push(conn)
    let buf = ''
    conn.on('data', chunk => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      onRequest(line)
      if (serve) serve(conn, line)
    })
    conn.on('error', () => {})
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(listenOn, resolve) })
  const child = spawn(process.execPath, [WATCHER], { env: childEnv({ HERDR_SOCKET_PATH: sock, ...env }), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', d => { stdout += d })
  child.stderr.on('data', d => { stderr += d })
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })))
  const done = async () => {
    child.kill()
    server.close()
    for (const c of conns) c.destroy()
    try { fs.unlinkSync(sock) } catch { /* not a file here */ }
  }
  return { child, conns, requested, exited, out: () => stdout, err: () => stderr, done }
}

const ev = (type, data) => JSON.stringify({ event: type, data }) + '\n'
const lines = text => text.split(/\r?\n/).filter(Boolean)

test('sends a subscription for pane and tab focus', async () => {
  const h = await harness({ HERDR_PANE_ID: 'wJ:p3', HERDR_TAB_ID: 'wJ:t1' })
  try {
    const request = JSON.parse(await within(h.requested, 'subscription'))
    assert.strictEqual(request.method, 'events.subscribe')
    assert.deepStrictEqual(request.params.subscriptions, [{ type: 'pane.focused' }, { type: 'tab.focused' }])
  } finally { await h.done() }
})

test('with a tab known: one focused line per matching tab event; other tabs, panes and junk are ignored; exits on close', async () => {
  const h = await harness({ HERDR_PANE_ID: 'wJ:p3', HERDR_TAB_ID: 'wJ:t1' }, conn => {
    conn.write('{"id":"focus-watch","result":{"type":"subscription_started"}}\n')
    conn.write('this is not json\n')
    conn.write(ev('tab.focused', { tab_id: 'wJ:t2', workspace_id: 'wJ' }))
    conn.write(ev('pane.focused', { pane_id: 'wJ:p3', workspace_id: 'wJ' }))
    conn.write(ev('tab.focused', { tab_id: 'wJ:t1', workspace_id: 'wJ' }))
    conn.write('{broken\n')
    conn.write(ev('tab.focused', { tab_id: 'wJ:t1', workspace_id: 'wJ' }))
    conn.end()
  })
  try {
    const { code } = await within(h.exited, 'exit on close')
    assert.strictEqual(code, 0)
    assert.deepStrictEqual(lines(h.out()), ['focused', 'focused'])
  } finally { await h.done() }
})

test('with no tab known: matches the pane', async () => {
  const h = await harness({ HERDR_PANE_ID: 'wJ:p3', HERDR_TAB_ID: '' }, conn => {
    conn.write(ev('pane.focused', { pane_id: 'wJ:p9', workspace_id: 'wJ' }))
    conn.write(ev('tab.focused', { tab_id: 'wJ:t1', workspace_id: 'wJ' }))
    conn.write(ev('pane.focused', { pane_id: 'wJ:p3', workspace_id: 'wJ' }))
    conn.end()
  })
  try {
    await within(h.exited, 'exit on close')
    assert.deepStrictEqual(lines(h.out()), ['focused'])
  } finally { await h.done() }
})

test('with HERDR_TAB_ID unset: matches the pane too', async () => {
  const h = await harness({ HERDR_PANE_ID: 'wJ:p3', HERDR_TAB_ID: undefined }, conn => {
    conn.write(ev('pane.focused', { pane_id: 'wJ:p3', workspace_id: 'wJ' }))
    conn.end()
  })
  try {
    await within(h.exited, 'exit on close')
    assert.deepStrictEqual(lines(h.out()), ['focused'])
  } finally { await h.done() }
})

test('an event split across two chunks still counts once', async () => {
  const whole = ev('tab.focused', { tab_id: 'wJ:t1', workspace_id: 'wJ' })
  const h = await harness({ HERDR_PANE_ID: 'wJ:p3', HERDR_TAB_ID: 'wJ:t1' }, conn => {
    conn.write(whole.slice(0, 10))
    setTimeout(() => { conn.write(whole.slice(10)); conn.end() }, 50)
  })
  try {
    await within(h.exited, 'exit on close')
    assert.deepStrictEqual(lines(h.out()), ['focused'])
  } finally { await h.done() }
})

test('exits on a termination signal while the pipe is still open', async () => {
  const h = await harness({ HERDR_PANE_ID: 'wJ:p3', HERDR_TAB_ID: 'wJ:t1' })
  try {
    await within(h.requested, 'subscription')
    h.child.kill('SIGTERM')
    await within(h.exited, 'exit on SIGTERM')
  } finally { await h.done() }
})

for (const [name, env, mentions] of [
  ['the socket path is missing', { HERDR_SOCKET_PATH: '', HERDR_PANE_ID: 'wJ:p3' }, 'HERDR_SOCKET_PATH'],
  ['the pane id is missing', { HERDR_PANE_ID: '' }, 'HERDR_PANE_ID'],
]) {
  test(`exits non-zero with a clear message when ${name}`, async () => {
    const h = await harness(env)
    try {
      const { code } = await within(h.exited, 'exit')
      assert.notStrictEqual(code, 0)
      assert.ok(h.err().includes(mentions), `stderr should name ${mentions}, got: ${h.err()}`)
      assert.strictEqual(h.out(), '')
    } finally { await h.done() }
  })
}

test('exits non-zero with a clear message when the connection fails', async () => {
  const { sock } = endpoint()
  const child = spawn(process.execPath, [WATCHER], { env: childEnv({ HERDR_SOCKET_PATH: sock, HERDR_PANE_ID: 'wJ:p3' }), stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', d => { stderr += d })
  const { code } = await within(new Promise(resolve => child.on('exit', (c, s) => resolve({ code: c, signal: s }))), 'exit')
  assert.notStrictEqual(code, 0)
  assert.match(stderr, /cannot connect/i)
  assert.ok(stderr.includes(sock), `stderr should name the socket path, got: ${stderr}`)
})
