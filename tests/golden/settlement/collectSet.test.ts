import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import type { PresetId } from '../../../src/engine/config/presets/index.ts'
import type { Dice, Total } from '../../../src/engine/core/dice.ts'
import { Fraction } from '../../../src/engine/core/rational.ts'
import { isSettled, type BetInstance, type Settled } from '../../../src/engine/bets/types.ts'
import { settle } from '../../../src/engine/settle/settle.ts'
import { bet, decide, machine, rollContext, roundAt } from '../rules/support.ts'

// The Lucky Roller settlement table, written from docs/rules/rules-spec.md §4.1 (winExact = stake ×
// num/den, rounded once; credited = the returned stake + winPaid), §4.2 (bubble machines floor to
// the cent) and §6.4 / §5.2 (Interblock 30/30/155 to 1 shown "for 1" [R]; Shoot To Win 30/30/155
// [A]; the strict machine 30/30/150 [A]). A completed set is paid at once and the bet comes down;
// any 7 loses the stake. Pays and labels are this file's own.

const SMALL: readonly Total[] = [2, 3, 4, 5, 6]
const TALL: readonly Total[] = [8, 9, 10, 11, 12]
const ALL: readonly Total[] = [...SMALL, ...TALL]
const bit = (total: number) => 1 << total
const maskOf = (totals: readonly Total[]) => totals.reduce((mask, t) => mask | bit(t), 0)

interface Machine {
  readonly name: PresetId
  /** Net pays to 1 for Low, High and All, and the label the machine shows for each. */
  readonly pays: readonly (readonly [bigint, string])[]
}

const MACHINES: readonly Machine[] = [
  {
    name: 'craplessBubble',
    pays: [
      [30n, '31 for 1'],
      [30n, '31 for 1'],
      [155n, '156 for 1'],
    ],
  },
  {
    name: 'traditionalBubble',
    pays: [
      [30n, '30:1'],
      [30n, '30:1'],
      [155n, '155:1'],
    ],
  },
  {
    name: 'strictBubble',
    pays: [
      [30n, '31 for 1'],
      [30n, '31 for 1'],
      [150n, '151 for 1'],
    ],
  },
]

const BETS = [
  { typeId: 'luckyRollerLow', targets: SMALL },
  { typeId: 'luckyRollerHigh', targets: TALL },
  { typeId: 'luckyRollerAll', targets: ALL },
] as const

/** Any dice that add up to `total`. */
function diceFor(total: Total): Dice {
  const d1 = (total > 6 ? 6 : total - 1) as Dice['d1']
  return { d1, d2: (total - d1) as Dice['d2'] }
}

/** The bet one target short of its set, decided by that target (a win) or by `dice`. */
function decided(
  cfg: MachineConfig,
  typeId: string,
  targets: readonly Total[],
  stake: number,
  dice: Dice = diceFor(targets[0]!),
): { subject: BetInstance; decision: Settled } {
  const subject = bet(typeId, null, { amount: stake, progress: maskOf(targets.slice(1)) })
  const decision = decide(cfg, subject, rollContext(cfg, roundAt(8), dice))
  if (!isSettled(decision)) throw new Error(`${typeId} was not decided by ${dice.d1}-${dice.d2}`)
  return { subject, decision }
}

describe('Lucky Roller winners, to the cent', () => {
  it('Interblock: $5 Low Rolls wins $150 and the $5 comes back; $1 Roll ’Em All wins $155', () => {
    const cfg = machine('craplessBubble')
    const low = decided(cfg, 'luckyRollerLow', SMALL, 500)
    expect(settle(low.subject, low.decision, cfg)).toMatchObject({
      outcome: 'win',
      typeId: 'luckyRollerLow',
      number: null,
      payKey: 'set',
      ratioLabel: '31 for 1',
      winExact: '15000',
      winPaid: 15_000,
      rounding: { mode: 'floor', increment: 1 },
      breakage: '0',
      vigOnWin: 0,
      credited: 15_500,
      stakeDisposition: 'returned',
    })
    const all = decided(cfg, 'luckyRollerAll', ALL, 100)
    expect(settle(all.subject, all.decision, cfg)).toMatchObject({
      ratioLabel: '156 for 1',
      winPaid: 15_500,
      credited: 15_600,
      stakeDisposition: 'returned',
    })
  })

  it('the strict machine pays Roll ’Em All 150 to 1', () => {
    const cfg = machine('strictBubble')
    const { subject, decision } = decided(cfg, 'luckyRollerAll', ALL, 100)
    expect(settle(subject, decision, cfg)).toMatchObject({
      ratioLabel: '151 for 1',
      winPaid: 15_000,
      credited: 15_100,
    })
  })

  it('any 7 loses the stake', () => {
    const cfg = machine('craplessBubble')
    for (const dice of [
      { d1: 3, d2: 4 },
      { d1: 1, d2: 6 },
    ] as const) {
      const { subject, decision } = decided(cfg, 'luckyRollerHigh', TALL, 500, dice)
      expect(settle(subject, decision, cfg)).toMatchObject({
        outcome: 'lose',
        winPaid: 0,
        credited: 0,
        stakeDisposition: 'lost',
      })
    }
  })
})

describe.each(MACHINES)(
  'Lucky Roller pays on $name, every stake from $1 to $500',
  ({ name, pays }) => {
    const cfg = machine(name)

    it.each(BETS)('$typeId', ({ typeId, targets }) => {
      const index = BETS.findIndex((b) => b.typeId === typeId)
      const [pay, label] = pays[index]!
      for (let stake = 100; stake <= 50_000; stake += 100) {
        const { subject, decision } = decided(cfg, typeId, targets, stake)
        const trace = settle(subject, decision, cfg)
        const won = BigInt(stake) * pay
        expect(
          [trace.winExact, trace.winPaid, trace.breakage, trace.credited, trace.ratioLabel],
          `${stake}¢`,
        ).toEqual([String(won), Number(won), '0', Number(won) + stake, label])
      }
    })
  },
)

describe('exact mode', () => {
  it('pays stake × ratio with no rounding, the same as the machine for whole dollars', () => {
    const cfg = machine('craplessBubble')
    const { subject, decision } = decided(cfg, 'luckyRollerLow', SMALL, 700)
    const exact = settle(subject, decision, cfg, 'exact')
    expect(exact.winPaid.equals(Fraction.of(21_000))).toBe(true)
    expect(exact.credited.equals(Fraction.of(21_700))).toBe(true)
    expect(exact.rounding).toBeNull()
    expect(settle(subject, decision, cfg)).toMatchObject({ winPaid: 21_000, credited: 21_700 })
  })
})
