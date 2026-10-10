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
): Snapshot => {
  const raw = empty()
  const toolOf = new Map<string, { tool: string; label: string }>()
  const chunks: Chunk[] = []

  for (const m of messages) {
    raw.chat += estimate(m.text.length)

    for (const use of m.toolUses) {
      toolOf.set(use.tool_use_id, { tool: use.tool, label: labelOf(use.tool, use.input) })
      raw[kindOf(use.tool)] += estimate(JSON.stringify(use.input).length)
    }

    for (const r of m.toolResults ?? []) {
      const owner = toolOf.get(r.tool_use_id) ?? { tool: 'other', label: '' }
      const tokens = estimate(r.text.length)
      raw[kindOf(owner.tool)] += tokens
      chunks.push({ tool: owner.tool, label: owner.label, tokens })
    }
  }

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

  const scaled = chunks
    .sort((a, b) => b.tokens - a.tokens)
    .map(c => ({ ...c, tokens: Math.round(c.tokens * scale) }))
  const largest = scaled.slice(0, 5)

  const byKind = {} as Record<Kind, Chunk[]>
  for (const k of KINDS) byKind[k] = scaled.filter(c => kindOf(c.tool) === k).slice(0, 2)

  return { tokens, used, window, largest, byKind }
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
