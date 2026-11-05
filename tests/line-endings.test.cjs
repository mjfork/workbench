'use strict'
// Repo hygiene: shell, markdown and CommonJS files must be LF in the index, whatever a
// contributor's core.autocrlf says. Keep PINNED in step with .gitattributes.
// Run with: node --test "tests/*.test.cjs"
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const PINNED = /\.(sh|md|cjs)$/

const git = (args, opts = {}) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, ...opts })

/** Tracked files of the pinned types whose index copy contains a carriage return. `env` selects the index. */
function crlfInIndex(env = process.env) {
  const files = git(['ls-files', '-z'], { env }).toString().split('\0').filter(f => PINNED.test(f))
  return files.filter(f => git(['show', `:${f}`], { env }).includes(0x0d))
}

test('every tracked .sh, .md and .cjs file is LF in the index', () => {
  assert.deepStrictEqual(crlfInIndex(), [])
})

test('a CRLF file in the index is caught', () => {
  const name = '.crlf-fixture.sh'
  // A scratch copy of the index, so the real one is never touched; the blob is written raw
  // (no attribute filters) so the CR really reaches it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crlf-index-'))
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') }
  try {
    git(['read-tree', 'HEAD'], { env })
    const sha = git(['hash-object', '-w', '--no-filters', '--stdin'], { input: 'echo hi\r\n' }).toString().trim()
    git(['update-index', '--add', '--cacheinfo', `100644,${sha},${name}`], { env })
    assert.deepStrictEqual(crlfInIndex(env), [name])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
