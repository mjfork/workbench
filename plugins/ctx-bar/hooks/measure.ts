import type { ContextCategory, SessionMessage } from 'claude-code'

import type { Chunk, Kind, Snapshot } from '../types'

export const KINDS: readonly Kind[] = ['fixed', 'chat', 'Bash', 'Read', 'Agent', 'mcp', 'edit', 'other']

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export const kindOf = (tool: string): Kind => {
  if (tool === 'Bash' || tool === 'Read' || tool === 'Agent') return tool
  if (tool.startsWith('mcp__')) return 'mcp'
  if (EDIT_TOOLS.has(tool)) return 'edit'

  return 'other'
}

/** Rough token estimate; scaled against the engine's figure afterwards. */
const estimate = (chars: number) => chars / 4

// Escape sequences, controls and the characters that draw nothing or reorder text. A label is drawn on a hover card and
// by /ctxbar, and a file name or command can hold any of them; a terminal would act on an escape sequence.
const ESCAPES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g

// Bash's `description` says what a command is for; the command itself often
// opens with variable assignments that all look alike. Then the file or pattern.
const labelOf = (tool: string, input: Record<string, unknown>): string => {
  const command = typeof input.command === 'string'
    ? input.command.replace(/^(\s*\w+=("[^"]*"|'[^']*'|\S*)\s*[;\n]?)+/, '')
    : undefined
  const raw = input.description ?? input.file_path ?? input.pattern ?? command ?? ''
  const text = typeof raw === 'string' ? raw : ''

  return text.replace(ESCAPES, '').replace(CONTROLS, ' ').replace(/\s+/g, ' ').slice(0, 60)
}

const empty = (): Record<Kind, number> => ({
  fixed: 0, chat: 0, Bash: 0, Read: 0, Agent: 0, mcp: 0, edit: 0, other: 0,
})

/** A tool call as measured once: what owns its result, and its input's size. */
type Call = { tool: string; label: string; kind: Kind; chars: number }

/** What tells a message read again from a changed one, without reading its text. */
type Seen = { role: string; chars: number; uses: number; results: number; id: string | undefined }

const charsOf = (m: SessionMessage) => {
  let chars = m.text.length
  for (const r of m.toolResults ?? []) chars += r.text.length

  return chars
}

const idOf = (m: SessionMessage) => m.toolUses[0]?.tool_use_id ?? m.toolResults?.[0]?.tool_use_id

const seenOf = (m: SessionMessage): Seen => ({
  role: m.role,
  chars: charsOf(m),
  uses: m.toolUses.length,
  results: m.toolResults?.length ?? 0,
  id: idOf(m),
})

// Read on every refresh for every message counted, so it builds nothing.
const isSame = (s: Seen, m: SessionMessage) =>
  s.role === m.role && s.uses === m.toolUses.length && s.results === (m.toolResults?.length ?? 0)
  && s.id === idOf(m) && s.chars === charsOf(m)

/**
 * Adds `chunk` to `list`, biggest first, keeping at most `max`. An equal one
 * already there stays ahead: what a stable sort of every chunk would give.
 */
const rank = (list: Chunk[], chunk: Chunk, max: number) => {
  let i = list.length
  while (i > 0 && list[i - 1]!.tokens < chunk.tokens) i--
  if (i >= max) return
  list.splice(i, 0, chunk)
  if (list.length > max) list.pop()
}

const LARGEST = 5
const PER_KIND = 2

/**
 * A measure that remembers the transcript it last measured. Called again with
 * that transcript plus new messages, it measures only the new ones; when any
 * message it counted is gone or changed (a compaction, a rewind, a cleared
 * result, the oldest falling out of the read), it counts them all again. Each
 * tool input is sized once, by its tool_use_id, either way.
 *
 * Counts are kept in characters, whole numbers, so the totals equal a single
 * pass's sum of quarter-tokens exactly.
 */
export const measurer = () => {
  let calls = new Map<string, Call>()
  let seen: Seen[] = []
  let chars = empty()
  let toolOf = new Map<string, Call>()
  let largest: Chunk[] = []
  let top = {} as Record<Kind, Chunk[]>

  const reset = () => {
    seen = []
    chars = empty()
    toolOf = new Map()
    largest = []
    top = {} as Record<Kind, Chunk[]>
    for (const k of KINDS) top[k] = []
  }
  reset()

  const add = (m: SessionMessage, before: Map<string, Call>) => {
    seen.push(seenOf(m))
    chars.chat += m.text.length

    for (const use of m.toolUses) {
      let call = calls.get(use.tool_use_id) ?? before.get(use.tool_use_id)
      if (call === undefined) {
        call = {
          tool: use.tool,
          label: labelOf(use.tool, use.input),
          kind: kindOf(use.tool),
          chars: JSON.stringify(use.input).length,
        }
      }
      calls.set(use.tool_use_id, call)
      toolOf.set(use.tool_use_id, call)
      chars[call.kind] += call.chars
    }

    for (const r of m.toolResults ?? []) {
      const owner = toolOf.get(r.tool_use_id) ?? { tool: 'other', label: '' }
      const kind = kindOf(owner.tool)
      chars[kind] += r.text.length
      const chunk = { tool: owner.tool, label: owner.label, tokens: estimate(r.text.length) }
      rank(largest, chunk, LARGEST)
      rank(top[kind], chunk, PER_KIND)
    }
  }

  return (
    messages: readonly SessionMessage[],
    used: number,
    window: number,
    categories: readonly ContextCategory[] | undefined,
  ): Snapshot => {
    let isPrefix = messages.length >= seen.length
    for (let i = 0; isPrefix && i < seen.length; i++) isPrefix = isSame(seen[i]!, messages[i]!)

    try {
      if (isPrefix) {
        for (let i = seen.length; i < messages.length; i++) add(messages[i]!, calls)
      } else {
        // Keep only the calls still in the transcript; the rest are read from the old map once.
        const before = calls
        calls = new Map()
        reset()
        for (const m of messages) add(m, before)
      }
    } catch (error) {
      // Half counted: the next call counts everything again.
      reset()
      throw error
    }

    return snapshotOf(chars, largest, top, used, window, categories)
  }
}

/**
 * Splits the used context by kind. `used` is the engine's own figure for the
 * window's fill; `fixed` is the breakdown's non-message rows (system prompt,
 * tool schemas, memory, skills). The transcript's char-based estimates are
 * scaled to fill what is left, so the bar sums to `used` exactly.
 */
export const measure = (
  messages: readonly SessionMessage[],
  used: number,
  window: number,
  categories: readonly ContextCategory[] | undefined,
): Snapshot => measurer()(messages, used, window, categories)

const snapshotOf = (
  chars: Record<Kind, number>,
  largest: readonly Chunk[],
  top: Record<Kind, Chunk[]>,
  used: number,
  window: number,
  categories: readonly ContextCategory[] | undefined,
): Snapshot => {
  const raw = empty()
  for (const k of KINDS) raw[k] = estimate(chars[k])

  // Fixed overhead: every row in the window except the conversation itself.
  // The breakdown has no kind for Messages, so its label is the only handle.
  const fixed = (categories ?? [])
    .filter(c => c.kind === 'used' && c.name !== 'Messages')
    .reduce((sum, c) => sum + c.tokens, 0)

  const fixedClamped = Math.min(fixed, used)
  const pool = used - fixedClamped
  const rawTotal = KINDS.reduce((sum, k) => sum + raw[k], 0)
  const scale = rawTotal > 0 ? pool / rawTotal : 0

  const tokens = empty()
  for (const k of KINDS) tokens[k] = Math.round(raw[k] * scale)
  tokens.fixed = Math.round(fixedClamped + (rawTotal > 0 ? 0 : pool))

  // Scaling keeps the order: the biggest before it are the biggest after.
  const scaled = (c: Chunk) => ({ ...c, tokens: Math.round(c.tokens * scale) })

  const byKind = {} as Record<Kind, Chunk[]>
  for (const k of KINDS) byKind[k] = top[k].map(scaled)

  return { tokens, used, window, largest: largest.map(scaled), byKind }
}

/** Cells per kind in a bar `width` wide; every non-zero kind gets at least one. */
export const cells = (snap: Snapshot, width: number): Record<Kind, number> => {
  const out = empty()
  const per = snap.window / width

  for (const k of KINDS) {
    const n = snap.tokens[k] / per
    out[k] = n > 0 ? Math.max(1, Math.round(n)) : 0
  }

  return out
}

export const fmt = (tokens: number): string =>
  tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : `${tokens}`
