import { TOTALS, type Total } from '../core/dice.ts'
import { issue, type ConfigIssue } from './issues.ts'

/**
 * How a come-out roll is decided, for both supported games. Crapless is the default variant; the
 * user plays it on Interblock heads-up machines in Las Vegas.
 */
export const VARIANTS = ['crapless', 'traditional'] as const
export type Variant = (typeof VARIANTS)[number]

/** Every total that can be a point: anything but 7. Crapless uses all ten, traditional 4–10. */
export const POINT_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] as const
export type PointNumber = (typeof POINT_NUMBERS)[number]

/** `POINT_NUMBERS` as JSON object keys, for pay tables written as `{ "6": "7:6" }`. */
export const POINT_KEYS = ['2', '3', '4', '5', '6', '8', '9', '10', '11', '12'] as const
export type PointKey = (typeof POINT_KEYS)[number]

/** The numbers a hardway can be made on: 4, 6, 8 and 10, each as a pair. */
export const HARD_NUMBERS = [4, 6, 8, 10] as const
export type HardNumber = (typeof HARD_NUMBERS)[number]
export const HARD_KEYS = ['4', '6', '8', '10'] as const

/**
 * The come-out total on which a don't bet pushes instead of winning: 12 almost everywhere, 2 under
 * Reno rules, and none in crapless, which offers no don't bets.
 */
export const DONT_BARS = [2, 12] as const
export type DontBar = (typeof DONT_BARS)[number] | null

/**
 * How the first roll of a pass or come bet is decided. Every total from 2 to 12 is in exactly one
 * list, and 7 is always a natural.
 */
export interface ComeOutRules {
  readonly naturals: readonly Total[]
  readonly craps: readonly Total[]
  readonly points: readonly PointNumber[]
}

/** The game rules a round runs on (plan §4.3): the come-out partition plus the don't bar. */
export interface Ruleset extends ComeOutRules {
  readonly variant: Variant
  readonly dontBar: DontBar
}

/** The two supported games (rules spec §2.1). Crapless: 7 wins, everything else is a point. */
export const COME_OUT_RULES: Readonly<Record<Variant, ComeOutRules>> = Object.freeze({
  crapless: Object.freeze({
    naturals: Object.freeze([7] as const),
    craps: Object.freeze([] as const),
    points: Object.freeze([2, 3, 4, 5, 6, 8, 9, 10, 11, 12] as const),
  }),
  traditional: Object.freeze({
    naturals: Object.freeze([7, 11] as const),
    craps: Object.freeze([2, 3, 12] as const),
    points: Object.freeze([4, 5, 6, 8, 9, 10] as const),
  }),
})

/** The ruleset for a variant. Call it only with a config that passed validation. */
export function makeRuleset(variant: Variant, dontBar: DontBar): Ruleset {
  return Object.freeze({ variant, dontBar, ...COME_OUT_RULES[variant] })
}

export function isPointNumber(value: number): value is PointNumber {
  return (POINT_NUMBERS as readonly number[]).includes(value)
}

type Lists = { readonly [K in keyof ComeOutRules]: readonly number[] }
const LIST_NAMES = ['naturals', 'craps', 'points'] as const

/**
 * Problems with a come-out partition, with paths relative to the lists' parent: each total from 2
 * to 12 must appear exactly once across `naturals`, `craps` and `points`, and 7 must be a natural.
 * The values themselves are assumed to be totals (the schema checks that).
 */
export function partitionIssues(lists: Lists): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const seen = new Map<number, string>()
  for (const name of LIST_NAMES) {
    lists[name].forEach((total, index) => {
      const earlier = seen.get(total)
      if (earlier === undefined) {
        seen.set(total, name)
      } else {
        const where = earlier === name ? `earlier in ${name}` : `in ${earlier}`
        issues.push(issue([name, index], `${total} is listed twice: it is already ${where}`))
      }
    })
  }
  if (!lists.naturals.includes(7)) {
    issues.push(issue(['naturals'], '7 must be a natural: it wins every come-out in both games'))
  }
  const missing = TOTALS.filter((total) => !seen.has(total))
  if (missing.length > 0) {
    issues.push(
      issue([], `every total must be a natural, craps or a point; missing ${missing.join(', ')}`),
    )
  }
  return issues
}

const CHOICE: Readonly<Record<Variant, Record<keyof ComeOutRules, string>>> = {
  crapless: {
    naturals: 'in crapless craps 7 is the only natural; 11 is a point',
    craps: 'crapless craps has no craps totals: 2, 3 and 12 are points',
    points: 'crapless points are 2, 3, 4, 5, 6, 8, 9, 10, 11 and 12',
  },
  traditional: {
    naturals: 'traditional naturals are 7 and 11',
    craps: 'traditional craps totals are 2, 3 and 12',
    points: 'traditional points are 4, 5, 6, 8, 9 and 10',
  },
}

/**
 * Problems with a valid partition that does not match its variant: the come-out lists must be
 * exactly the variant's (in any order), so a crapless config cannot carry craps totals.
 */
export function variantIssues(variant: Variant, lists: Lists): ConfigIssue[] {
  const expected = COME_OUT_RULES[variant]
  return LIST_NAMES.filter((name) => !sameSet(lists[name], expected[name])).map((name) =>
    issue([name], CHOICE[variant][name]),
  )
}

function sameSet(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value))
}
