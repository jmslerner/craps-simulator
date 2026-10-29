import { describe, expect, it } from 'vitest'
import { craplessBubble } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { requireType } from '../../../src/engine/bets/registry.ts'
import { newTable } from '../../../src/engine/table/state.ts'
import { ALL_DICE, bet, decide, machine, outcome, rollContext, roundAt, sumOf } from './support.ts'

// The hardway rule table, written from docs/rules/rules-spec.md §2.2 (the Hard N column), §2.4
// (come-out defaults by machine), §3.3 (hard N wins on its pair and loses on the easy way or any 7;
// 7:1 on 4 and 10, 9:1 on 6 and 8; the same in crapless) and §0.2 #11 (the standard multi-roll
// rule, not CW §16c's one-roll wording). Its constants are its own.

const HARD = [4, 6, 8, 10] as const
type Hard = (typeof HARD)[number]

/** §3.3: net to 1. */
const PAYS: Readonly<Record<Hard, readonly [bigint, bigint]>> = {
  4: [7n, 1n],
  6: [9n, 1n],
  8: [9n, 1n],
  10: [7n, 1n],
}

const CRAPLESS_POINTS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] as const
const BOX_NUMBERS = [4, 5, 6, 8, 9, 10] as const

/**
 * Each machine's hardways on the come-out (§2.4, §5.2): Interblock ON [A], Shoot To Win OFF (its
 * come-out auto-OFF) [V], a Las Vegas live table ON [V]. Winners stay up everywhere (§5.2).
 */
const MACHINES = [
  { name: 'craplessBubble', comeOut: true, points: CRAPLESS_POINTS },
  { name: 'traditionalBubble', comeOut: false, points: BOX_NUMBERS },
  { name: 'strictBubble', comeOut: true, points: BOX_NUMBERS },
  { name: 'traditionalLive345', comeOut: true, points: BOX_NUMBERS },
] as const

/** Hard n on a roll while it works: its pair wins, the easy way and any 7 lose, the rest nothing. */
function expected(n: Hard, dice: Dice, stake: 'stay' | 'return' = 'stay'): string {
  const total = sumOf(dice)
  if (total === 7) return 'lose'
  if (total !== n) return 'none'
  return dice.d1 === dice.d2 ? `win:${stake}` : 'lose'
}

/** Every one of the 36 rolls on which `actual` departs from `want`, as readable lines. */
function departures(want: (dice: Dice) => string, actual: (dice: Dice) => string): string[] {
  return ALL_DICE.flatMap((dice) => {
    const [w, a] = [want(dice), actual(dice)]
    return w === a ? [] : [`${dice.d1}-${dice.d2}: expected ${w}, got ${a}`]
  })
}

describe.each(MACHINES)('hardways on $name', ({ name, comeOut, points }) => {
  const cfg = machine(name)
  const phases: readonly (PointNumber | null)[] = [null, ...points]

  it.each(HARD)(
    'hard %i: the pair wins and stays up, the easy way and any 7 lose, in every phase',
    (n) => {
      for (const point of phases) {
        const subject = bet('hard', n)
        const got = departures(
          (dice) => expected(n, dice),
          (dice) => outcome(decide(cfg, subject, rollContext(cfg, roundAt(point), dice))),
        )
        expect(got, `point ${String(point)}`).toEqual([])
      }
    },
  )

  it.each(HARD)('hard %i: switched OFF, no roll decides it', (n) => {
    for (const point of phases) {
      const subject = bet('hard', n, { working: false })
      const got = departures(
        () => 'none',
        (dice) =>
          outcome(decide(cfg, subject, rollContext(cfg, roundAt(point), dice, { working: false }))),
      )
      expect(got, `point ${String(point)}`).toEqual([])
    }
  })

  it('pays 7:1 on 4 and 10 and 9:1 on 6 and 8 (§3.3)', () => {
    const { family, type } = requireType(cfg, 'hard')
    for (const n of HARD) {
      const decision = decide(cfg, bet('hard', n), rollContext(cfg, roundAt(null), pair(n)))
      expect(decision.kind, `hard ${n}`).toBe('win')
      if (decision.kind !== 'win') continue
      const ratio = family.payout(type, decision.payKey)
      expect([ratio.num, ratio.den], `hard ${n}`).toEqual([...PAYS[n]])
    }
  })

  it(`works on the come-out: ${comeOut ? 'yes' : 'no'}; with a point on: always (§2.4)`, () => {
    const { family, type } = requireType(cfg, 'hard')
    expect(family.toggleable).toBe(true)
    expect(family.defaultWorking({ kind: 'comeOut' }, type, cfg)).toBe(comeOut)
    for (const point of points) {
      expect(family.defaultWorking({ kind: 'point', point }, type, cfg), `point ${point}`).toBe(
        true,
      )
    }
  })
})

describe('the acceptance cases (plan §10 M4c)', () => {
  it('hard 6 wins on 3-3, loses on 5-1 and on 7, on every machine', () => {
    for (const { name } of MACHINES) {
      const cfg = machine(name)
      const hard6 = bet('hard', 6)
      const on = (d1: Dice['d1'], d2: Dice['d2'], point: PointNumber | null = 8) =>
        outcome(decide(cfg, hard6, rollContext(cfg, roundAt(point), { d1, d2 })))
      expect([on(3, 3), on(5, 1), on(1, 5), on(4, 2), on(3, 4), on(6, 1)], name).toEqual([
        'win:stay',
        'lose',
        'lose',
        'lose',
        'lose',
        'lose',
      ])
      // A come-out 3-3 sets the point and wins hard 6 too, when it works.
      expect(on(3, 3, null), name).toBe('win:stay')
    }
  })

  it('a machine that returns winning hardways takes them down after the win', () => {
    const input = structuredClone(craplessBubble)
    const hard = input.catalog.hard
    if (hard?.family !== 'hardway') throw new Error('craplessBubble has no hardways')
    hard.afterWin = 'return'
    input.id = 'craplessHardReturned'
    const cfg = machine(input)
    for (const n of HARD) {
      const got = departures(
        (dice) => expected(n, dice, 'return'),
        (dice) => outcome(decide(cfg, bet('hard', n), rollContext(cfg, roundAt(5), dice))),
      )
      expect(got, `hard ${n}`).toEqual([])
    }
  })

  it('an Atlantic City style machine has its hardways OFF on the come-out', () => {
    const input = structuredClone(craplessBubble)
    const hard = input.catalog.hard
    if (hard?.family !== 'hardway') throw new Error('craplessBubble has no hardways')
    hard.comeOutDefault = 'off'
    input.id = 'craplessHardOff'
    const cfg = machine(input)
    const { family, type } = requireType(cfg, 'hard')
    expect(family.defaultWorking({ kind: 'comeOut' }, type, cfg)).toBe(false)
    expect(family.defaultWorking({ kind: 'point', point: 6 }, type, cfg)).toBe(true)
  })
})

describe("the family's own checks", () => {
  const cfg = machine('craplessBubble')
  const { family, type } = requireType(cfg, 'hard')

  it('pays only on its numbers, and flags a hardway off them or behind another bet', () => {
    expect(() => family.payout(type, '5')).toThrow(RangeError)
    const table = newTable(cfg, 'hard')
    expect(family.invariants?.(bet('hard', 6), table, type, cfg)).toEqual([])
    expect(family.invariants?.(bet('hard', 5), table, type, cfg)).toEqual([
      expect.stringMatching(/on 5, not a hard number/),
    ])
    const backing = bet('hard', 6, { parent: bet('pass', 6) })
    expect(family.invariants?.(backing, table, type, cfg)).toEqual([
      expect.stringMatching(/backs b1/),
    ])
  })

  it('leaves an undecided or riding hardway up, and takes down one that is decided otherwise', () => {
    const subject = bet('hard', 8)
    const ctx = rollContext(cfg, roundAt(8), { d1: 4, d2: 4 })
    const after = (decision: Parameters<typeof family.apply>[1]) =>
      family.apply(subject, decision, ctx, type)
    expect(after({ kind: 'none' })).toBe(subject)
    expect(after({ kind: 'win', payKey: '8', stake: 'stay' })).toBe(subject)
    expect(after({ kind: 'win', payKey: '8', stake: 'return' })).toBeNull()
    expect(after({ kind: 'lose' })).toBeNull()
    expect(after({ kind: 'push', reason: 'offReturned' })).toBeNull()
  })
})

describe('what a hardway reads from the config', () => {
  it('its number list, the pay on its number, after-win, come-out rules and rounding', () => {
    const cfg = machine('traditionalBubble')
    const { family, type } = requireType(cfg, 'hard')
    expect(family.configPaths(type, 6, cfg)).toEqual([
      '/catalog/hard/numbers',
      '/catalog/hard/pays/6',
      '/catalog/hard/afterWin',
      '/catalog/hard/comeOutDefault',
      '/comeOut/autoOff/carried',
      '/comeOut/autoOff/newlyPlaced',
      '/comeOut/autoOff/reOnAt',
      '/afterSevenOut/newPlacedOff',
      '/money/payoutRounding',
    ])
    expect(family.configPaths(type, null, cfg)).toContain('/catalog/hard/pays')
  })
})

/** The pair that makes hard n. */
function pair(n: Hard): Dice {
  const face = (n / 2) as Dice['d1']
  return { d1: face, d2: face }
}
