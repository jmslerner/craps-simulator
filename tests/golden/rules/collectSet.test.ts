import { describe, expect, it } from 'vitest'
import { craplessBubble, type PresetId } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { Dice, Total } from '../../../src/engine/core/dice.ts'
import { requireBet } from '../../../src/engine/bets/registry.ts'
import { newTable } from '../../../src/engine/table/state.ts'
import {
  bet,
  decide,
  departures,
  machine,
  outcome,
  rollContext,
  roundAt,
  sumOf,
} from './support.ts'

// The Lucky Roller rule table (Low Rolls / All Small, High Rolls / All Tall, Roll 'Em All / Make
// 'Em All; family collectSet), written from docs/rules/rules-spec.md §2.6 and §6.4: every target
// total before a 7 wins at once; repeats and order do not matter; any 7 loses, a come-out 7
// included; tracking starts fresh at placement. Interblock pays 30/30/155 to 1 [R] (§0.2 #10), the
// strict machine 30/30/150 [A], Shoot To Win 30/30/155 [A] (§5.2). Constants are this file's own.

const SMALL: readonly Total[] = [2, 3, 4, 5, 6]
const TALL: readonly Total[] = [8, 9, 10, 11, 12]
const ALL: readonly Total[] = [...SMALL, ...TALL]

const bit = (total: number) => 1 << total
const maskOf = (totals: readonly Total[]) => totals.reduce((mask, total) => mask | bit(total), 0)

const BETS = [
  { typeId: 'luckyRollerLow', targets: SMALL },
  { typeId: 'luckyRollerHigh', targets: TALL },
  { typeId: 'luckyRollerAll', targets: ALL },
] as const

/** Progress states worth a table: nothing yet, one target, all but one, and a middle subset. */
function states(targets: readonly Total[]): number[] {
  const first = targets[0] ?? 2
  const last = targets.at(-1) ?? 12
  return [
    0,
    bit(first),
    maskOf(targets.filter((t) => t !== last)),
    maskOf(targets.filter((t) => t !== first)),
    maskOf(targets.filter((_, index) => index % 2 === 0)),
  ]
}

/** §6.4: any 7 loses; a new target adds to the set, the last one wins; anything else is nothing. */
function expected(targets: readonly Total[], progress: number, dice: Dice): string {
  const total = sumOf(dice)
  if (total === 7) return 'lose'
  if (!targets.includes(total)) return 'none'
  const next = progress | bit(total)
  if (next === progress) return 'none'
  return next === maskOf(targets) ? 'win:return' : `progress:${next}`
}

const MACHINES: readonly {
  name: PresetId
  points: readonly PointNumber[]
  pays: readonly [bigint, bigint][]
}[] = [
  {
    name: 'craplessBubble',
    points: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
    pays: [
      [30n, 1n],
      [30n, 1n],
      [155n, 1n],
    ],
  },
  {
    name: 'traditionalBubble',
    points: [4, 5, 6, 8, 9, 10],
    pays: [
      [30n, 1n],
      [30n, 1n],
      [155n, 1n],
    ],
  },
  {
    name: 'strictBubble',
    points: [4, 5, 6, 8, 9, 10],
    pays: [
      [30n, 1n],
      [30n, 1n],
      [150n, 1n],
    ],
  },
]

describe.each(MACHINES)('Lucky Roller on $name', ({ name, points, pays }) => {
  const cfg = machine(name)
  const phases: readonly (PointNumber | null)[] = [null, ...points]

  it.each(BETS)(
    '$typeId: each new target progresses, the last one wins at once, any 7 loses, in every phase',
    ({ typeId, targets }) => {
      for (const point of phases) {
        for (const progress of states(targets)) {
          const subject = bet(typeId, null, { progress })
          const got = departures(
            (dice) => expected(targets, progress, dice),
            (dice) => outcome(decide(cfg, subject, rollContext(cfg, roundAt(point), dice))),
          )
          expect(got, `${typeId} point ${String(point)} progress ${progress}`).toEqual([])
        }
      }
    },
  )

  it('pays Low, High and All as the preset says (§5.2), on the one pay key, and nothing else', () => {
    BETS.forEach(({ typeId }, index) => {
      const { family, type } = requireBet(cfg, typeId)
      const decision = decide(
        cfg,
        bet(typeId, null, { progress: maskOf(BETS[index]!.targets.slice(1)) }),
        rollContext(cfg, roundAt(null), diceFor(BETS[index]!.targets[0]!)),
      )
      expect(decision.kind, typeId).toBe('win')
      if (decision.kind !== 'win') return
      const ratio = family.payout(type, decision.payKey)
      expect([ratio.num, ratio.den], typeId).toEqual([...pays[index]!])
      expect(() => family.payout(type, 'nope')).toThrow(RangeError)
    })
  })

  it('always works, cannot be switched OFF, and follows the round (§2.6)', () => {
    for (const { typeId } of BETS) {
      const { family, type } = requireBet(cfg, typeId)
      expect(family.toggleable, typeId).toBe(false)
      expect(family.decidesWhenOff, typeId).toBe(false)
      expect(family.projection, typeId).toBe('round')
      expect(family.defaultWorking({ kind: 'comeOut' }, type, cfg), typeId).toBe(true)
      for (const point of points) {
        expect(family.defaultWorking({ kind: 'point', point }, type, cfg), typeId).toBe(true)
      }
    }
  })
})

describe('a Lucky Roller that ends only on a seven-out (endsOn: sevenOut)', () => {
  const input = structuredClone(craplessBubble)
  for (const id of ['luckyRollerLow', 'luckyRollerHigh', 'luckyRollerAll']) {
    const side = input.sideBets[id]
    if (side?.family !== 'collectSet') throw new Error(`craplessBubble has no ${id}`)
    side.endsOn = 'sevenOut'
  }
  input.id = 'craplessSevenOutRoller'
  const cfg = machine(input)

  it('survives a come-out 7 and loses on a seven-out', () => {
    for (const { typeId, targets } of BETS) {
      const subject = bet(typeId, null, { progress: bit(targets[0] ?? 2) })
      const got = departures(
        (dice) => {
          const total = sumOf(dice)
          return total === 7 ? 'none' : expected(targets, subject.progress, dice)
        },
        (dice) => outcome(decide(cfg, subject, rollContext(cfg, roundAt(null), dice))),
      )
      expect(got, `${typeId} on the come-out`).toEqual([])
      const onPoint = departures(
        (dice) => expected(targets, subject.progress, dice),
        (dice) => outcome(decide(cfg, subject, rollContext(cfg, roundAt(8), dice))),
      )
      expect(onPoint, `${typeId} with the point on`).toEqual([])
    }
  })
})

describe("the family's own checks", () => {
  const cfg = machine('craplessBubble')
  const { family, type } = requireBet(cfg, 'luckyRollerLow')

  it('keeps a progressing bet up with its new mask, and takes down a decided one', () => {
    const subject = bet('luckyRollerLow', null, { progress: bit(2) })
    const ctx = rollContext(cfg, roundAt(8), { d1: 1, d2: 2 })
    const after = (decision: Parameters<typeof family.apply>[1]) =>
      family.apply(subject, decision, ctx, type)
    expect(after({ kind: 'none' })).toBe(subject)
    expect(after({ kind: 'progress', progress: bit(2) | bit(3) })).toMatchObject({
      progress: bit(2) | bit(3),
    })
    expect(after({ kind: 'win', payKey: 'set', stake: 'return' })).toBeNull()
    expect(after({ kind: 'lose' })).toBeNull()
  })

  it('flags progress outside its targets, a set already complete, a number or a parent', () => {
    const table = newTable(cfg, 'roller')
    expect(family.invariants?.(bet('luckyRollerLow', null), table, type, cfg)).toEqual([])
    expect(
      family.invariants?.(bet('luckyRollerLow', null, { progress: bit(8) }), table, type, cfg),
    ).toEqual([expect.stringMatching(/not its targets/)])
    expect(
      family.invariants?.(
        bet('luckyRollerLow', null, { progress: maskOf(SMALL) }),
        table,
        type,
        cfg,
      ),
    ).toEqual([expect.stringMatching(/whole set/)])
    expect(family.invariants?.(bet('luckyRollerLow', 6), table, type, cfg)).toEqual([
      expect.stringMatching(/takes no number/),
    ])
    const backing = bet('luckyRollerLow', null, { parent: bet('pass', 6) })
    expect(family.invariants?.(backing, table, type, cfg)).toEqual([
      expect.stringMatching(/backs b1/),
    ])
  })

  it('reads its targets, pay, ending 7, window and the money rounding from the config', () => {
    expect(family.configPaths(type, null, cfg)).toEqual([
      '/sideBets/luckyRollerLow/targets',
      '/sideBets/luckyRollerLow/pays',
      '/sideBets/luckyRollerLow/endsOn',
      '/sideBets/luckyRollerLow/placement',
      '/money/payoutRounding',
    ])
  })
})

/** Any dice that add up to `total`. */
function diceFor(total: Total): Dice {
  const d1 = (total > 6 ? 6 : total - 1) as Dice['d1']
  return { d1, d2: (total - d1) as Dice['d2'] }
}
