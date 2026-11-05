#!/usr/bin/env node
'use strict'
// Prints "focused" each time herdr focuses this pane or its tab: the Windows counterpart of focus-watch.sh, which needs
// `nc -U`, `ps -o pgid=` and a real AF_UNIX socket. On Windows herdr's API is a named pipe named `\\.\pipe\` followed
// by the socket path; elsewhere it is the Unix socket at that path. The herdr-jump mod runs one per session and redraws
// its footer on each line. A blocked read: nothing runs between focus changes.
//
// Every click emits pane.focused, tab.focused and workspace.focused, each with workspace_id: matching the workspace
// would wake every session in it. Matching the tab gives one line per click (pane.focused carries no tab_id); the pane
// is the fallback when herdr gives no tab.
//
// Exits 0 when the connection closes or on a termination signal; non-zero with a message on stderr when the socket path
// or pane id is missing, or the connection fails.
const net = require('node:net')

const PIPE_PREFIX = '\\\\.\\pipe\\'
const SUBSCRIBE = JSON.stringify({
  id: 'focus-watch',
  method: 'events.subscribe',
  params: { subscriptions: [{ type: 'pane.focused' }, { type: 'tab.focused' }] },
})

const die = (message, code) => {
  process.stderr.write(`focus-watch: ${message}\n`)
  process.exit(code)
}

const sock = process.env.HERDR_SOCKET_PATH
const pane = process.env.HERDR_PANE_ID
const tab = process.env.HERDR_TAB_ID || ''
if (!sock) die('HERDR_SOCKET_PATH is not set', 2)
if (!pane) die('HERDR_PANE_ID is not set', 2)

const target = process.platform === 'win32' ? PIPE_PREFIX + sock : sock
const conn = net.connect(target)

/** True when `line` is a herdr event for this pane's tab (or, with no tab known, for this pane). */
function isMine(line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return false
  }
  const data = msg !== null && typeof msg === 'object' ? msg.data : undefined
  if (data === null || typeof data !== 'object') return false
  return tab !== '' ? data.tab_id === tab : data.pane_id === pane
}

let pending = ''
conn.setEncoding('utf8')
let isConnected = false
conn.on('connect', () => {
  isConnected = true
  conn.write(SUBSCRIBE + '\n')
})
conn.on('data', chunk => {
  pending += chunk
  let nl
  while ((nl = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, nl)
    pending = pending.slice(nl + 1)
    if (isMine(line)) process.stdout.write('focused\n')
  }
})
conn.on('error', err => die(isConnected ? `lost the connection to herdr at ${sock}: ${err.message}` : `cannot connect to herdr at ${sock}: ${err.message}`, 1))
// The write callback runs once earlier output is flushed, so a last event is not lost to the exit.
conn.on('close', () => process.stdout.write('', () => process.exit(0)))

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => process.exit(0))
