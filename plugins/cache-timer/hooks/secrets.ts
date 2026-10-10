// Masks credentials in text with the gitleaks rule set (generated into ./secret-rules.ts). Best effort: it finds secrets that
// have a recognisable shape, not every secret.
import { SECRET_RULES } from './secret-rules'

/**
 * Text is scanned in slices this long, each overlapping the next by OVERLAP, so a credential up to OVERLAP characters long is
 * whole in at least one slice; a longer one is masked from where a slice finds its start on to the end of its run of token
 * characters (a PEM private key is masked separately, in redact). A few of the patterns slow down badly on crafted text (a long unbroken run of the word that switches one on can
 * keep it busy for seconds, and a hooks module blocks the session while it runs). Short slices keep any one step small, and
 * BUDGET_MS caps the whole scan: past it the scan throws, because a note that was only partly scanned is not safe to write.
 */
const SLICE = 4_000
const OVERLAP = 1_500
/** The characters a token is made of: a match cut off at a slice's end is masked on to the end of its run. */
const TOKEN_CHAR = /[A-Za-z0-9+/=_\-.~%:]/
const BUDGET_MS = 1_000

type Rule = { rx: RegExp; entropy: number; group: number; keywords: string[]; hasIndices: boolean }

let rules: Rule[] | null = null

/**
 * Compiled on first use. Every rule must compile: one this engine reads differently from gitleaks' (Go) engine would
 * otherwise drop out unseen and the masking would quietly weaken, so a rule that fails stops the scan, like the budget.
 */
function compiled(): Rule[] {
  if (rules !== null) return rules
  const out: Rule[] = []
  for (const [id, source, flags, entropy, group, keywords] of SECRET_RULES) {
    const keys = keywords.map(k => k.toLowerCase())
    try {
      // The `d` flag gives the exact place of the secret within the match.
      out.push({ rx: new RegExp(source, flags + 'd'), entropy, group, keywords: keys, hasIndices: true })
    } catch {
      throw new Error(`the secret rule ${id} does not compile here: the text is not safe to save`)
    }
  }
  rules = out
  return rules
}

/** Shannon entropy in bits per character: a real key is random, a word or a path is not. */
export function entropyOf(text: string): number {
  const counts = new Map<string, number>()
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let bits = 0
  for (const n of counts.values()) bits -= (n / text.length) * Math.log2(n / text.length)
  return bits
}

/**
 * Adds the spans of the secrets found in one slice, at their place in the whole text. A secret that runs to the slice's
 * end may go on past it, longer than the overlap, where no later slice sees its start: its span runs on through the
 * token characters that follow in the whole text.
 */
function spansIn(whole: string, base: number, spans: [number, number][], deadline: number): void {
  const text = whole.slice(base, base + SLICE)
  const isCut = base + SLICE < whole.length
  const lower = text.toLowerCase()
  for (const rule of compiled()) {
    if (Date.now() > deadline) throw new Error('the secret scan took too long: the text is not safe to save')
    if (rule.keywords.length > 0 && !rule.keywords.some(k => lower.includes(k))) continue
    for (const m of text.matchAll(rule.rx)) {
      const which = rule.group > 0 ? rule.group : m.findIndex((g, i) => i > 0 && g)
      const index = which > 0 ? which : 0
      const secret = m[index]
      if (!secret || (rule.entropy > 0 && entropyOf(secret) < rule.entropy)) continue
      // Where the secret sits in this slice: exactly, when the engine reports it (an index into the slice), else by searching the match.
      const reported = rule.hasIndices ? (m as RegExpMatchArray & { indices?: ([number, number] | undefined)[] }).indices?.[index]?.[0] : undefined
      const at = base + (reported ?? (m.index ?? 0) + m[0].indexOf(secret))
      let end = at + secret.length
      if (isCut && end >= base + SLICE - 1) while (end < whole.length && TOKEN_CHAR.test(whole[end]!)) end++
      spans.push([at, end])
    }
  }
}

export function maskSecrets(text: string, budgetMs = BUDGET_MS): string {
  const spans: [number, number][] = []
  const deadline = Date.now() + budgetMs
  for (let at = 0; ; at += SLICE - OVERLAP) {
    spansIn(text, at, spans, deadline)
    if (at + SLICE >= text.length) break
  }
  // One secret can be found in two slices, or by two rules: join overlapping spans and mask each once.
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  let out = ''
  let from = 0
  let end = -1
  let start = 0
  const flush = () => {
    if (end > from) {
      out += text.slice(from, Math.max(from, start)) + '[redacted]'
      from = end
    }
  }
  for (const [s, e] of spans) {
    if (end >= 0 && s <= end) {
      end = Math.max(end, e)
      continue
    }
    flush()
    start = s
    end = e
  }
  flush()
  return out + text.slice(from)
}

/** How many rules compiled in this engine (all of them, or compiling throws). */
export const ruleCount = () => compiled().length
