// The pure part of turn-mode: the per-pane mode file and what each mode tells the model.

export const MODE_REL = 'ctx/mode'

export type Mode = 'async' | 'realtime' | 'agentic'

/** ~/.claude/ctx/mode/<pane>.json, written by the footer toggle (ctx-heavy) and turn-mode.sh. */
export type ModeFile = { pane: string; mode: Mode; driver: string | null; setBy: string; at: number }

const MODES: readonly Mode[] = ['async', 'realtime', 'agentic']

/** The file's mode; anything missing or malformed reads as async, the default. */
export function parseMode(text: string): { mode: Mode; driver: string | null } {
  try {
    const raw = JSON.parse(text) as Partial<ModeFile>
    const mode = MODES.includes(raw.mode as Mode) ? (raw.mode as Mode) : 'async'
    const driver = mode === 'agentic' && typeof raw.driver === 'string' && raw.driver !== '' ? raw.driver : null
    return { mode, driver }
  } catch {
    return { mode: 'async', driver: null }
  }
}

/** The instructions a turn needs: its session mode, or `peer` for a turn a peer session's message started. */
export function keyOf(mode: Mode, driver: string | null, isPeerTurn: boolean): string {
  if (isPeerTurn) return 'peer'
  return mode === 'agentic' ? `agentic:${driver ?? ''}` : mode
}

/** Who the instructions refer to. */
const PERSON = 'the user'

const needsYou = () => [
  'When the turn waits on a person (a decision, an approval, an action only they can take), end with this section and nothing after it:',
  '## ⚑ Needs you',
  '**Ask:** <one sentence: the exact question or action, answerable as written>',
  '**Options:**     ← omit for a plain action',
  '1. <option> (recommended)',
  '2. <option>',
  '**Reply with:** <exactly what to type: `1`, `yes`, or `! <command>`>',
  '**Unblocks:** <what proceeds once it is answered>',
  `- The heading is machine-read (a Stop hook queues this pane for ${PERSON}); spell it exactly. The section stands alone: ${PERSON} reads only it, cold, so name files, PRs and tickets by ID or link, in plain words. One option per numbered line. Several asks: **Ask 1** / **Ask 2**, each with its own **Reply with**.`,
  `- An ask settled some other way (a peer's message, another pane, you found the answer): end the next turn with a \`## ✓ Resolved\` line saying how, and no ⚑ section. It takes the ask off ${PERSON}'s queue.`,
]

const STATUS = 'exactly one of `DONE`, `BLOCKED: <reason>`, `NEEDS-INPUT: <reason>`'

/** What the model is told for a mode key; it holds until the next change. */
export function textFor(key: string): string {
  if (key === 'async') {
    return [
      `[turn mode: async] ${PERSON} reads this session later, from a queue. End every turn with a terse summary of what just happened (a few lines), then one of:`,
      ...needsYou(),
      `Otherwise, when nothing is needed, end with bold **Possible next steps**: two or three numbered steps that follow from this turn, each a reply away, none already done or declined; no ⚑ heading; start none until ${PERSON} picks one.`,
    ].join('\n')
  }
  if (key === 'realtime') {
    return `[turn mode: real-time] ${PERSON} is watching this session live. When the work is done, the turn just ends: no summary, no ⚑ Needs you section, no Possible next steps. If you need ${PERSON}, ask in one plain sentence.`
  }
  if (key === 'peer') {
    return `[this turn: a peer session's message] Answer it with SendMessage (to = its \`from\`). Begin your final message with one status line, ${STATUS}. If only ${PERSON} can decide, add the ## ⚑ Needs you section below the status line, as usual. This holds for this turn only.`
  }
  const driver = key.slice('agentic:'.length)
  return [
    `[turn mode: agentic${driver ? `, driver ${driver}` : ''}] Another agent drives this session. Your final message is one status line, ${STATUS}, then one plain sentence saying what happened, for a person glancing at the pane; nothing else.`,
    'Put the substance where the driver reads it: send it to the driver with SendMessage.',
    `A question only the driver can answer: after a NEEDS-INPUT line, add a ## ⚑ Needs you section; it goes to ${driver ? `the driver (${driver})` : 'your driver'}, not to ${PERSON}.`,
  ].join('\n')
}

/** A click on the toggle: async and real-time swap; agentic (a driver's) goes back to async. */
export const nextMode = (mode: Mode): Mode => (mode === 'async' ? 'realtime' : 'async')

/** Origins of a peer session's message: those turns run as `peer` whatever the session mode. */
export const isPeerOrigin = (kind: string) => kind === 'peer' || kind === 'peer-send-message'
