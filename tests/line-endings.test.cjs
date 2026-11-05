'use strict'
// Repo hygiene: shell, markdown and CommonJS files must be LF in the index, whatever a
// contributor's core.autocrlf says. Run with: node --test tests/
const test = require('node:test')
const assert = require('node:assert')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const PINNED = /\.(sh|md|cjs)$/

/** Tracked files of the pinned types whose index copy contains a carriage return. */
function crlfInIndex(files) {
  return files.filter(f => {
    const blob = execFileSync('git', ['show', `:${f}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    return blob.includes(0x0d)
  })
}

const tracked = () =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(f => PINNED.test(f))

test('every tracked .sh, .md and .cjs file is LF in the index', () => {
  assert.deepStrictEqual(crlfInIndex(tracked()), [])
})

test('a CRLF file in the index is caught', () => {
  const name = '.crlf-fixture.sh'
  // Write the blob raw (no attribute filters) so the CR really reaches the index.
  const sha = execFileSync('git', ['hash-object', '-w', '--no-filters', '--stdin'], { cwd: root, input: 'echo hi\r\n' }).toString().trim()
  execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${sha},${name}`], { cwd: root })
  try {
    assert.deepStrictEqual(crlfInIndex(tracked()), [name])
  } finally {
    execFileSync('git', ['update-index', '--force-remove', '--', name], { cwd: root })
  }
})
