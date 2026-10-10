// Text from outside this session made safe to draw. The queue's asks are other sessions' replies, and herdr's labels
// and titles are whatever a workspace, tab or terminal was named: any of them can carry escape sequences, which a
// terminal acts on (move the cursor, retitle the window, rewrite what is on screen), or characters that hide or
// reorder text.

const ESCAPES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g
/** Controls, plus the characters that draw nothing or reorder text: soft hyphen, zero-width and direction marks, line and paragraph separators, word joiner and invisible operators, BOM. */
const INVISIBLE = '\\u00ad\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u206f\\ufeff'
const CONTROLS = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${INVISIBLE}]`, 'g')
const BLOCK_CONTROLS = new RegExp(`[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f${INVISIBLE}]`, 'g')

/** One line: escape sequences removed, every control (line breaks too) a space. */
export const plainText = (text: unknown): string => String(text ?? '').replace(ESCAPES, '').replace(CONTROLS, ' ')

/** Several lines: as plainText, but line breaks kept. */
export const plainBlock = (text: unknown): string =>
  String(text ?? '').replace(ESCAPES, '').replace(/\r\n?/g, '\n').replace(BLOCK_CONTROLS, ' ')
