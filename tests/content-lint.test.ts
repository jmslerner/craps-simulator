import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The coach content lint (plan §5.3, §10 M9a): every displayed number is a computed `CoachNumber`,
 * so the shipped content under `src/coach/content/` may not contain a literal percentage, dollar
 * amount or pay ratio anywhere — comments and string literals included. It scans every file in the
 * directory, so a typed-in "1.52%" can never ship as coach copy; tests of the templates live
 * outside `content/` because they assert rendered literals.
 */

const CONTENT_DIR = join('src', 'coach', 'content')

interface Offence {
  readonly line: number
  readonly match: string
  readonly rule: string
}

const RULES: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: 'percentage', pattern: /\d\s*%/g },
  { rule: 'dollar amount', pattern: /\$\s*\d/g },
  { rule: 'pay ratio', pattern: /\d+\s*(?::|to|for)\s*\d+/g },
]

/** Every literal-number offence in one file's source, with its line for the report. */
export function contentOffences(source: string): Offence[] {
  const offences: Offence[] = []
  source.split('\n').forEach((text, index) => {
    for (const { rule, pattern } of RULES) {
      for (const match of text.matchAll(pattern)) {
        offences.push({ line: index + 1, match: match[0], rule })
      }
    }
  })
  return offences
}

/** Every file under `src/coach/content/`, relative to the repo root. */
function contentFiles(): string[] {
  return readdirSync(CONTENT_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
}

describe('the coach content lint', () => {
  it('rejects a literal percentage (the §10 M9a fixture: "1.52%")', () => {
    const fixture = 'export const bad = () => ["Place 6 costs only 1.52% here"]'
    const offences = contentOffences(fixture)
    expect(offences).toHaveLength(1)
    expect(offences[0]?.rule).toBe('percentage')
    expect(offences[0]?.match).toBe('2%')
  })

  it('rejects literal dollar amounts', () => {
    expect(contentOffences('const t = ["pays $5.83 on a win"]')).toHaveLength(1)
    expect(contentOffences('const t = ["$ 12 per hour"]')).toHaveLength(1)
  })

  it('rejects literal pay ratios in every spelling', () => {
    expect(contentOffences('["pays 7:6"]')).toHaveLength(1)
    expect(contentOffences('["pays 7 to 6"]')).toHaveLength(1)
    expect(contentOffences('["30 for 1 props"]')).toHaveLength(1)
    expect(contentOffences('["2x odds"]')).toHaveLength(0) // a multiplier is not a ratio
  })

  it('rejects them in comments too: content files carry no example numbers at all', () => {
    expect(contentOffences('// like "1.52%" on place 6')).toHaveLength(1)
  })

  it('accepts text whose numbers are CoachNumber placeholders', () => {
    const clean = "export function edgeLine(n) { return ['House edge ', n.edge] }"
    expect(contentOffences(clean)).toHaveLength(0)
    expect(contentOffences('formatPercent(2)')).toHaveLength(0)
  })

  it('passes on every shipped content file', () => {
    const files = contentFiles()
    expect(files.length).toBeGreaterThan(0)
    const report = files.flatMap((file) =>
      contentOffences(readFileSync(file, 'utf8')).map(
        (offence) => `${file}:${offence.line} ${offence.rule} "${offence.match}"`,
      ),
    )
    expect(report).toEqual([])
  })
})
