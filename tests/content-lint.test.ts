import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The coach content lint (plan §5.3, §10 M9a): every displayed number is a computed `CoachNumber`,
 * so the shipped content under `src/coach/content/` may not contain a literal percentage, dollar
 * amount or pay ratio anywhere — comments and string literals included — and, since M9's audit
 * showed how easily a typed number slips past three patterns (split concatenation, fullwidth
 * signs, "percent" in words, escapes, "seven to six", "583 cents"), **no digit at all inside any
 * string literal** there. A second, wider scan covers the code that renders coach text — the coach
 * modules and the UI components and state — where a string literal or a JSX text node carrying a
 * percentage, dollar amount or pay ratio would reach the screen just as surely. Tests of the
 * templates live outside these directories because they assert rendered literals.
 */

const CONTENT_DIR = join('src', 'coach', 'content')
/** Code that renders coach words: its literals and JSX text are scanned for typed-in numbers. */
const TEXT_DIRS = [
  join('src', 'coach'),
  join('src', 'ui', 'components'),
  join('src', 'ui', 'state'),
]

interface Offence {
  readonly line: number
  readonly match: string
  readonly rule: string
}

/** The number spellings no coach text may carry literally. */
const NUMBER_RULES: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: 'percentage', pattern: /\d\s*%/g },
  { rule: 'dollar amount', pattern: /\$\s*\d/g },
  { rule: 'pay ratio', pattern: /\d+\s*(?::|to|for)\s*\d+/g },
]

const NUMBER_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|thirty-one'

/** Spellings that evade the number rules, rejected anywhere in a content file. */
const CONTENT_RULES: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: 'fullwidth sign', pattern: /[％＄﹩]/g },
  {
    rule: 'spelled-out ratio',
    pattern: new RegExp(`\\b(?:${NUMBER_WORDS})\\s+(?:to|for)\\s+(?:${NUMBER_WORDS})\\b`, 'gi'),
  },
  { rule: 'encoded sign', pattern: /\\x25|\\u0025|&#37;|fromCharCode/g },
  { rule: 'percent word', pattern: /\bper\s?cents?\b/gi },
]

/** A digit, ASCII or fullwidth, inside a string literal (interpolations stripped). */
const DIGIT = /[0-9０-９]/g

interface Literal {
  readonly line: number
  /** The literal's text without its quotes, template interpolations removed. */
  readonly text: string
}

interface Scan {
  readonly literals: readonly Literal[]
  /** JSX text nodes (text between a `>` and a `<` in code), with their lines. */
  readonly jsxText: readonly Literal[]
}

/**
 * A small scanner over TypeScript source: string and template literals (with `${…}` cut out), and
 * the JSX text nodes of the code between them. Comments are skipped, so an apostrophe in a comment
 * never opens a string. Good enough for the shipped files, which it is run on.
 */
export function scanSource(source: string): Scan {
  const literals: Literal[] = []
  const jsxText: Literal[] = []
  let code = ''
  let line = 1
  let i = 0
  const flushCode = (): void => {
    for (const match of code.matchAll(/>([^<>{}\n]+)</g)) {
      const text = match[1] ?? ''
      if (text.trim() !== '') jsxText.push({ line, text })
    }
    code = ''
  }
  while (i < source.length) {
    const ch = source[i] ?? ''
    const next = source[i + 1] ?? ''
    if (ch === '\n') {
      flushCode()
      line += 1
      i += 1
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      for (let k = i; k < stop; k += 1) if (source[k] === '\n') line += 1
      i = stop
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      const start = line
      let text = ''
      i += 1
      while (i < source.length && source[i] !== quote) {
        const c = source[i] ?? ''
        if (c === '\\') {
          text += c + (source[i + 1] ?? '')
          i += 2
          continue
        }
        if (quote === '`' && c === '$' && source[i + 1] === '{') {
          let depth = 0
          while (i < source.length) {
            const d = source[i] ?? ''
            if (d === '{') depth += 1
            if (d === '}') {
              depth -= 1
              if (depth === 0) {
                i += 1
                break
              }
            }
            if (d === '\n') line += 1
            i += 1
          }
          continue
        }
        if (c === '\n') line += 1
        text += c
        i += 1
      }
      i += 1 // the closing quote
      literals.push({ line: start, text })
      code += ' '
      continue
    }
    code += ch
    i += 1
  }
  flushCode()
  return { literals, jsxText }
}

/** Every offence in a coach content file: number spellings anywhere, digits in any literal. */
export function contentOffences(source: string): Offence[] {
  const offences: Offence[] = []
  source.split('\n').forEach((text, index) => {
    for (const { rule, pattern } of [...NUMBER_RULES, ...CONTENT_RULES]) {
      for (const match of text.matchAll(pattern)) {
        offences.push({ line: index + 1, match: match[0], rule })
      }
    }
  })
  for (const literal of scanSource(source).literals) {
    for (const match of literal.text.matchAll(DIGIT)) {
      offences.push({ line: literal.line, match: match[0], rule: 'digit in a string literal' })
    }
  }
  return offences
}

/** Every offence in rendering code: number spellings inside string literals and JSX text. */
export function textOffences(source: string): Offence[] {
  const offences: Offence[] = []
  const scan = scanSource(source)
  for (const { line, text } of [...scan.literals, ...scan.jsxText]) {
    for (const { rule, pattern } of NUMBER_RULES) {
      for (const match of text.matchAll(pattern)) offences.push({ line, match: match[0], rule })
    }
  }
  return offences
}

/** Every file under `dir`, relative to the repo root. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
}

const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file)
const isCode = (file: string): boolean => /\.tsx?$/.test(file)
/**
 * The money-input dialogs (New game, Add credit) validate the player's own typed amount and say
 * the whole-dollar rule ("at least $1"): form copy about the input, not coach content about a bet.
 */
const isInputDialog = (file: string): boolean => /Dialog\.tsx$/.test(file)

function report(files: readonly string[], offencesOf: (source: string) => Offence[]): string[] {
  return files.flatMap((file) =>
    offencesOf(readFileSync(file, 'utf8')).map(
      (offence) => `${file}:${offence.line} ${offence.rule} "${offence.match}"`,
    ),
  )
}

describe('the coach content lint', () => {
  it('rejects a literal percentage (the §10 M9a fixture: "1.52%")', () => {
    const fixture = 'export const bad = () => ["Place 6 costs only 1.52% here"]'
    const offences = contentOffences(fixture)
    expect(offences.some((o) => o.rule === 'percentage' && o.match === '2%')).toBe(true)
    expect(offences.length).toBeGreaterThan(0)
  })

  it('rejects literal dollar amounts', () => {
    expect(contentOffences('const t = ["pays $5.83 on a win"]')).not.toHaveLength(0)
    expect(contentOffences('const t = ["$ 12 per hour"]')).not.toHaveLength(0)
  })

  it('rejects literal pay ratios in every spelling', () => {
    expect(contentOffences('["pays 7:6"]').some((o) => o.rule === 'pay ratio')).toBe(true)
    expect(contentOffences('["pays 7 to 6"]').some((o) => o.rule === 'pay ratio')).toBe(true)
    expect(contentOffences('["30 for 1 props"]').some((o) => o.rule === 'pay ratio')).toBe(true)
    expect(contentOffences('const n = 2 // a multiplier is not a ratio')).toHaveLength(0)
  })

  it('rejects them in comments too: content files carry no example numbers at all', () => {
    expect(contentOffences('// like "1.52%" on place 6')).not.toHaveLength(0)
  })

  it('rejects every evasion the M9 audit probed, as a digit in a literal or a spelled sign', () => {
    const probes: readonly [string, string][] = [
      ['split concat', 'return ["costs " + "1.52" + "%"]'],
      ['separate parts', 'return ["costs 1.52", "%"]'],
      ['fullwidth percent', 'return ["costs 1.52％"]'],
      ['percent word', 'return ["costs 1.52 percent"]'],
      ['x25 escape', String.raw`return ["costs 1.52\x25"]`],
      ['fromCharCode', 'return ["costs 1.52" + String.fromCharCode(37)]'],
      ['dollar split', 'return ["$" + "5.83"]'],
      ['fullwidth dollar', 'return ["＄5.83"]'],
      ['small dollar', 'return ["﹩5.83"]'],
      ['dollar word', 'return ["5.83 dollars"]'],
      ['ratio hyphen', 'return ["pays 7-6"]'],
      ['ratio words', 'return ["pays seven to six"]'],
      ['ratio x', 'return ["pays 7x6"]'],
      ['ratio unicode colon', 'return ["pays 7∶6"]'],
      ['entity', 'return ["costs 1.52&#37;"]'],
      ['cents word', 'return ["pays 583 cents"]'],
      ['fullwidth digits', 'return ["pays ７ to ６"]'],
      ['template', 'return [`costs ${n.edge} of 100`]'],
      ['words only, no digits', "return ['per cent of the stake']"],
    ]
    for (const [name, source] of probes) {
      expect(contentOffences(source).length, name).toBeGreaterThan(0)
    }
  })

  it('accepts text whose numbers are CoachNumber placeholders, and code numbers outside literals', () => {
    const clean = "export function edgeLine(n) { return ['House edge ', n.edge] }"
    expect(contentOffences(clean)).toHaveLength(0)
    expect(contentOffences('formatPercent(2)')).toHaveLength(0)
    expect(contentOffences('const parts = [`Keeping ${n.perRoll} a roll`]')).toHaveLength(0)
    // The scanner skips comments, so an apostrophe there opens no string.
    expect(contentOffences("// the player's own words\nconst t = ['stake stays up']")).toHaveLength(
      0,
    )
  })

  it('scans rendering code for typed-in numbers in literals and JSX text, not in comments', () => {
    expect(textOffences('<p className="x">House edge 1.52%</p>')).toHaveLength(1)
    expect(textOffences("const label = 'pays 7 to 6'")).toHaveLength(1)
    expect(textOffences('aria-label={`${formatCents(amount)} chip (${index + 1})`}')).toHaveLength(
      0,
    )
    expect(textOffences('// the $631 run\nconst grade = `grade-${grade}`')).toHaveLength(0)
    expect(textOffences('<span>{formatCents(amount)}</span>')).toHaveLength(0)
  })

  it('passes on every shipped content file', () => {
    const files = filesUnder(CONTENT_DIR)
    expect(files.length).toBeGreaterThan(0)
    expect(report(files, contentOffences)).toEqual([])
  })

  it('passes on every shipped coach, component and state module (literals and JSX text)', () => {
    const files = TEXT_DIRS.flatMap((dir) => filesUnder(dir)).filter(
      (file) =>
        isCode(file) && !isTest(file) && !isInputDialog(file) && !file.startsWith(CONTENT_DIR),
    )
    expect(files.length).toBeGreaterThan(20)
    expect(report(files, textOffences)).toEqual([])
  })
})
