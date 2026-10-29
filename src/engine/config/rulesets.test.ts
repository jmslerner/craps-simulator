import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { TOTALS } from '../core/dice.ts'
import { validateConfig } from './compile.ts'
import { craplessBubble, traditionalBubble } from './presets/index.ts'
import {
  COME_OUT_RULES,
  HARD_KEYS,
  HARD_NUMBERS,
  POINT_KEYS,
  POINT_NUMBERS,
  VARIANTS,
  isPointNumber,
  makeRuleset,
  partitionIssues,
  variantIssues,
} from './rulesets.ts'
import type { MachineConfigInput } from './schema.ts'

type Lists = { naturals: number[]; craps: number[]; points: number[] }

/** Independent statement of the rule: every total exactly once, and 7 a natural. */
function isPartition({ naturals, craps, points }: Lists): boolean {
  const all = [...naturals, ...craps, ...points]
  return (
    naturals.includes(7) &&
    all.length === TOTALS.length &&
    TOTALS.every((total) => all.filter((value) => value === total).length === 1)
  )
}

const NAMES = ['naturals', 'craps', 'points'] as const
type Name = (typeof NAMES)[number]

/** The standard lists of a variant, as mutable copies. */
const standard = (variant: keyof typeof COME_OUT_RULES): Lists => ({
  naturals: [...COME_OUT_RULES[variant].naturals],
  craps: [...COME_OUT_RULES[variant].craps],
  points: [...COME_OUT_RULES[variant].points],
})

/** A partition: each total in one list (7 always a natural), each list in a random order. */
const partition = fc.oneof(
  fc.constant(standard('crapless')),
  fc.constant(standard('traditional')),
  fc
    .tuple(
      fc.tuple(
        ...TOTALS.map((t) => fc.constantFrom<Name>(...(t === 7 ? (['naturals'] as const) : NAMES))),
      ),
      fc.array(fc.nat(), { minLength: TOTALS.length, maxLength: TOTALS.length }),
    )
    .map(([names, order]): Lists => {
      const placed: Lists = { naturals: [], craps: [], points: [] }
      const byOrder = TOTALS.map((total, i) => ({ total, name: names[i]!, key: order[i]! }))
      byOrder.sort((a, b) => a.key - b.key)
      for (const { total, name } of byOrder) placed[name].push(total)
      return placed
    }),
)

/**
 * Come-out lists near a partition: up to three edits that each break it or leave it intact, such
 * as listing a total again (possibly in the same list), dropping one, or moving 7 to craps.
 */
const lists = fc
  .tuple(
    partition,
    fc.array(
      fc.record({
        kind: fc.constantFrom('duplicate', 'drop', 'moveSeven'),
        total: fc.constantFrom(...TOTALS),
        into: fc.constantFrom(...NAMES),
      }),
      { maxLength: 3 },
    ),
  )
  .map(([base, edits]): Lists => {
    const out: Lists = {
      naturals: [...base.naturals],
      craps: [...base.craps],
      points: [...base.points],
    }
    for (const { kind, total, into } of edits) {
      if (kind === 'duplicate') out[into].push(total)
      if (kind === 'drop') {
        for (const name of NAMES) out[name] = out[name].filter((t) => t !== total)
      }
      if (kind === 'moveSeven' && out.naturals.includes(7)) {
        out.naturals = out.naturals.filter((t) => t !== 7)
        out.craps.push(7)
      }
    }
    return out
  })

describe('point numbers', () => {
  it('are every total except 7, and the keys spell them', () => {
    expect([...POINT_NUMBERS]).toEqual(TOTALS.filter((total) => total !== 7))
    expect([...POINT_KEYS]).toEqual(POINT_NUMBERS.map(String))
    expect([...HARD_KEYS]).toEqual(HARD_NUMBERS.map(String))
  })

  it('are recognized by isPointNumber, and nothing else is', () => {
    expect(TOTALS.filter(isPointNumber)).toEqual([...POINT_NUMBERS])
    for (const other of [0, 1, 7, 13, 6.5, -6])
      expect(isPointNumber(other), String(other)).toBe(false)
  })
})

describe('standard rulesets', () => {
  it('are partitions of 2..12 with 7 a natural, and match only their own variant', () => {
    for (const variant of VARIANTS) {
      const own = standard(variant)
      expect(partitionIssues(own)).toEqual([])
      expect(variantIssues(variant, own)).toEqual([])
      const other = VARIANTS.find((v) => v !== variant)!
      expect(variantIssues(other, own).length).toBeGreaterThan(0)
    }
  })

  it('are crapless [7] / [] / ten points and traditional [7, 11] / [2, 3, 12] / 4–10', () => {
    expect(makeRuleset('crapless', null)).toEqual({
      variant: 'crapless',
      dontBar: null,
      naturals: [7],
      craps: [],
      points: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
    })
    expect(makeRuleset('traditional', 12)).toEqual({
      variant: 'traditional',
      dontBar: 12,
      naturals: [7, 11],
      craps: [2, 3, 12],
      points: [4, 5, 6, 8, 9, 10],
    })
    expect(Object.isFrozen(makeRuleset('crapless', null))).toBe(true)
  })
})

describe('partitionIssues', () => {
  it('locates a duplicate at its second listing', () => {
    const lists = standard('traditional')
    lists.points.push(11)
    expect(partitionIssues(lists)).toEqual([
      { path: ['points', 6], message: '11 is listed twice: it is already in naturals' },
    ])
  })

  it('requires 7 to be a natural', () => {
    const lists = { naturals: [11], craps: [2, 3, 7, 12], points: [4, 5, 6, 8, 9, 10] }
    expect(partitionIssues(lists).map((i) => i.path)).toEqual([['naturals']])
  })

  it('names the totals left out', () => {
    const lists = standard('crapless')
    lists.points = lists.points.filter((n) => n !== 10 && n !== 2)
    expect(partitionIssues(lists)).toEqual([
      { path: [], message: 'every total must be a natural, craps or a point; missing 2, 10' },
    ])
  })

  it('is empty exactly for a partition of 2..12 with 7 a natural (property)', () => {
    fc.assert(
      fc.property(lists, (candidate) => {
        expect(partitionIssues(candidate).length === 0).toBe(isPartition(candidate))
      }),
      { seed: 20261028, numRuns: 2000 },
    )
  })

  it('accepts every partition, not only the standard two (property)', () => {
    fc.assert(
      fc.property(partition, (candidate) => {
        expect(isPartition(candidate)).toBe(true)
        expect(partitionIssues(candidate)).toEqual([])
      }),
      { seed: 20261028, numRuns: 500 },
    )
  })
})

describe('the come-out partition inside a config', () => {
  /** A preset with its come-out lists replaced; the rest stays valid. */
  const withRules = (base: MachineConfigInput, candidate: Lists): unknown => ({
    ...base,
    rules: { ...base.rules, ...candidate },
  })
  const ruleIssues = (input: unknown) =>
    validateConfig(input).filter((issue) => issue.path[0] === 'rules')

  it('is rejected under /rules exactly when it is not the variant’s partition (property)', () => {
    fc.assert(
      fc.property(lists, fc.constantFrom(craplessBubble, traditionalBubble), (candidate, base) => {
        const issues = ruleIssues(withRules(base, candidate))
        const expected = standard(base.variant)
        const same = (a: number[], b: number[]) =>
          a.length === b.length && a.every((value) => b.includes(value))
        const matches =
          isPartition(candidate) &&
          same(candidate.naturals, expected.naturals) &&
          same(candidate.craps, expected.craps) &&
          same(candidate.points, expected.points)
        expect(issues.length === 0).toBe(matches)
      }),
      { seed: 20261028, numRuns: 300 },
    )
  })

  it('accepts the standard lists in any order', () => {
    const shuffled = { naturals: [7], craps: [], points: [12, 2, 11, 3, 10, 4, 9, 5, 8, 6] }
    expect(validateConfig(withRules(craplessBubble, shuffled))).toEqual([])
  })
})
