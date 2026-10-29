import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { requireType } from '../../../src/engine/bets/registry.ts'
import type { Decision } from '../../../src/engine/bets/types.ts'
import { bet, decide, machine, mismatches, outcome, rollContext, roundAt } from './support.ts'

// The odds rule table, written from docs/rules/rules-spec.md §2.2 (the take and lay odds columns),
// §2.3 step 4 (odds that are OFF are returned when their parent is decided), §2.4 (come-out
// defaults) and §3.1 (ODDS_TAKE and ODDS_LAY pays). Its constants are its own.

const TOTALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

/** True odds, net to 1 (§3.1): crapless adds 6:1 on 2/12 and 3:1 on 3/11. */
const TAKE: Readonly<Record<PointNumber, readonly [bigint, bigint]>> = {
  2: [6n, 1n],
  3: [3n, 1n],
  4: [2n, 1n],
  5: [3n, 2n],
  6: [6n, 5n],
  8: [6n, 5n],
  9: [3n, 2n],
  10: [2n, 1n],
  11: [3n, 1n],
  12: [6n, 1n],
}

/** Lay odds pay the reverse (§3.1): 1:2 on 4/10, 2:3 on 5/9, 5:6 on 6/8. */
const LAY: Readonly<Partial<Record<PointNumber, readonly [bigint, bigint]>>> = {
  4: [1n, 2n],
  5: [2n, 3n],
  6: [5n, 6n],
  8: [5n, 6n],
  9: [2n, 3n],
  10: [1n, 2n],
}

interface OddsCase {
  readonly odds: string
  readonly parent: string
  readonly side: 'take' | 'lay'
  /** Placed on a come or don't come bet, so it can face a come-out roll. */
  readonly facesComeOut: boolean
}

const DO_SIDE: readonly OddsCase[] = [
  { odds: 'passOdds', parent: 'pass', side: 'take', facesComeOut: false },
  { odds: 'comeOdds', parent: 'come', side: 'take', facesComeOut: true },
]
const DONT_SIDE: readonly OddsCase[] = [
  { odds: 'dontPassOdds', parent: 'dontPass', side: 'lay', facesComeOut: false },
  { odds: 'dontComeOdds', parent: 'dontCome', side: 'lay', facesComeOut: true },
]

const MACHINES = [
  { name: 'craplessBubble', points: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12], cases: DO_SIDE },
  {
    name: 'traditionalBubble',
    points: [4, 5, 6, 8, 9, 10],
    cases: [...DO_SIDE, ...DONT_SIDE],
  },
  { name: 'strictBubble', points: [4, 5, 6, 8, 9, 10], cases: [...DO_SIDE, ...DONT_SIDE] },
  {
    name: 'traditionalLive345',
    points: [4, 5, 6, 8, 9, 10],
    cases: [...DO_SIDE, ...DONT_SIDE],
  },
] as const satisfies readonly {
  name: string
  points: readonly PointNumber[]
  cases: readonly OddsCase[]
}[]

/** The Interblock machines, whose OFF odds come down when the point is made (§2.3 step 8). */
const INTERBLOCK: ReadonlySet<string> = new Set(['craplessBubble', 'strictBubble'])

/**
 * Odds on N follow their parent when working; when OFF, they are returned if it is decided, and on
 * Interblock also when the pass point (`madePoint`) is made (§2.3 step 8,
 * `/oddsOffReturnedAtPointMade`, added in M4b).
 */
function oddsTable(
  side: 'take' | 'lay',
  n: PointNumber,
  working: boolean,
  madePoint: PointNumber | null = null,
): Record<number, string> {
  const wins = side === 'take' ? n : 7
  const loses = side === 'take' ? 7 : n
  return Object.fromEntries(
    TOTALS.map((t) => {
      if (!working && t === madePoint) return [t, 'push:offReturned']
      if (t !== wins && t !== loses) return [t, 'none']
      if (!working) return [t, 'push:offReturned']
      return [t, t === wins ? 'win:return' : 'lose']
    }),
  )
}

/** The rolls on which the odds bet departs from the table, deciding the parent first. */
function check(
  cfg: MachineConfig,
  c: OddsCase,
  n: PointNumber,
  point: PointNumber | null,
  working: boolean,
): string[] {
  const parent = bet(c.parent, n, { seq: 1 })
  const odds = bet(c.odds, n, { seq: 2, parent })
  const before = roundAt(point)
  const madePoint = INTERBLOCK.has(cfg.id) ? point : null
  return mismatches(oddsTable(c.side, n, working, madePoint), (dice) => {
    const parentDecision = decide(cfg, parent, rollContext(cfg, before, dice))
    return outcome(decide(cfg, odds, rollContext(cfg, before, dice, { working, parentDecision })))
  })
}

describe.each(MACHINES)('odds on $name', ({ name, points, cases }) => {
  const cfg = machine(name)

  describe.each(cases)('$odds', (c) => {
    /** The pass point while the bet is on n: n itself for pass, another point for come. */
    const pointFor = (n: PointNumber): PointNumber =>
      c.facesComeOut ? points.find((p) => p !== n)! : n

    it('working: win and lose with the parent, nothing otherwise', () => {
      for (const n of points) expect(check(cfg, c, n, pointFor(n), true), `on ${n}`).toEqual([])
    })

    it('OFF: returned when the parent is decided (Interblock: or the point made), else untouched', () => {
      for (const n of points) expect(check(cfg, c, n, pointFor(n), false), `on ${n}`).toEqual([])
    })

    if (c.facesComeOut) {
      it('on the come-out: decided with the parent, working or OFF', () => {
        for (const n of points) {
          expect(check(cfg, c, n, null, true), `on ${n}, working`).toEqual([])
          expect(check(cfg, c, n, null, false), `on ${n}, OFF`).toEqual([])
        }
      })
    }

    it(`pays ${c.side === 'take' ? 'true odds' : 'the reverse of true odds'} on every point`, () => {
      const parent = bet(c.parent, null, { seq: 1 })
      const { family, type } = requireType(cfg, c.odds)
      for (const n of points) {
        const odds = bet(c.odds, n, { seq: 2, parent })
        const win: Decision = { kind: 'win', payKey: 'flat', stake: 'return' }
        const roll: Dice = c.side === 'take' ? splitTotal(n) : { d1: 3, d2: 4 }
        const decision = decide(
          cfg,
          odds,
          rollContext(cfg, roundAt(pointFor(n)), roll, { parentDecision: win }),
        )
        expect(decision.kind, `on ${n}`).toBe('win')
        if (decision.kind !== 'win') continue
        const expected = (c.side === 'take' ? TAKE : LAY)[n]!
        const ratio = family.payout(type, decision.payKey)
        expect([ratio.num, ratio.den], `on ${n}`).toEqual([...expected])
      }
    })
  })

  it("come-out defaults: come odds OFF, don't come odds ON (§2.4); all ON with a point", () => {
    const expected: Record<string, boolean> = {
      passOdds: true,
      comeOdds: false,
      dontPassOdds: true,
      dontComeOdds: true,
    }
    for (const c of cases) {
      const { family, type } = requireType(cfg, c.odds)
      expect(family.defaultWorking({ kind: 'comeOut' }, type, cfg), c.odds).toBe(expected[c.odds])
      for (const point of points) {
        expect(family.defaultWorking({ kind: 'point', point }, type, cfg), c.odds).toBe(true)
      }
    }
  })
})

describe('odds follow their parent decision, whatever it is', () => {
  const cfg = machine('traditionalLive345')
  const parent = bet('come', 6, { seq: 1 })
  const odds = bet('comeOdds', 6, { seq: 2, parent })
  const parentDecisions: readonly [Decision, string, string][] = [
    // [parent decision, odds working, odds OFF]
    [{ kind: 'win', payKey: 'flat', stake: 'return' }, 'win:return', 'push:offReturned'],
    [{ kind: 'win', payKey: 'flat', stake: 'stay' }, 'win:return', 'push:offReturned'],
    [{ kind: 'lose' }, 'lose', 'push:offReturned'],
    [{ kind: 'none' }, 'none', 'none'],
    // A parent on a number never pushes; if one did, its odds would come back unpaid.
    [{ kind: 'push', reason: 'bar' }, 'push:offReturned', 'push:offReturned'],
  ]

  it.each(parentDecisions)('parent %j: %s working, %s when OFF', (decision, on, off) => {
    const roll = { d1: 1, d2: 1 } as const
    const ctx = (working: boolean) =>
      rollContext(cfg, roundAt(8), roll, { working, parentDecision: decision })
    expect(outcome(decide(cfg, odds, ctx(true)))).toBe(on)
    expect(outcome(decide(cfg, odds, ctx(false)))).toBe(off)
  })
})

/** Two dice that make `n`. */
function splitTotal(n: PointNumber): Dice {
  return (n <= 7 ? { d1: 1, d2: n - 1 } : { d1: 6, d2: n - 6 }) as Dice
}
