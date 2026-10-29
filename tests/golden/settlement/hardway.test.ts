import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import { craplessBubble, type PresetId } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { Fraction } from '../../../src/engine/core/rational.ts'
import { isSettled, type BetInstance, type Settled } from '../../../src/engine/bets/types.ts'
import { settle } from '../../../src/engine/settle/settle.ts'
import { bet, decide, machine, rollContext, roundAt } from '../rules/support.ts'

// The hardway settlement table, written from docs/rules/rules-spec.md §3.3 (7:1 on 4 and 10, 9:1
// on 6 and 8), §4.1 (winExact = stake × num/den, rounded once into winPaid; credited = the stake
// if it comes back + winPaid) and §4.2 (bubble machines floor to the cent, the live table to $1),
// with exact cents. Pays, units and the rounding are this file's own.

const PAYS: Readonly<Record<4 | 6 | 8 | 10, readonly [bigint, bigint]>> = {
  4: [7n, 1n],
  6: [9n, 1n],
  8: [9n, 1n],
  10: [7n, 1n],
}
const HARD = [4, 6, 8, 10] as const

/** Each machine's payout rounding unit in cents, floored (§4.2, §5.2), and its pay wording. */
const MACHINES: readonly { name: PresetId; unit: bigint; label: (n: 4 | 6 | 8 | 10) => string }[] =
  [
    { name: 'craplessBubble', unit: 1n, label: (n) => `${PAYS[n][0]}:1` },
    { name: 'traditionalBubble', unit: 1n, label: (n) => `${PAYS[n][0]} to 1` },
    { name: 'strictBubble', unit: 1n, label: (n) => `${PAYS[n][0]}:1` },
    { name: 'traditionalLive345', unit: 100n, label: (n) => `${PAYS[n][0]} to 1` },
  ]

/** Hard n of `stake` cents decided by `dice` with the point on 5, as a roll would decide it. */
function decided(
  cfg: MachineConfig,
  n: PointNumber,
  stake: number,
  dice: Dice,
): { subject: BetInstance; decision: Settled } {
  const subject = bet('hard', n, { amount: stake })
  const decision = decide(cfg, subject, rollContext(cfg, roundAt(5), dice))
  if (!isSettled(decision)) throw new Error(`hard ${n} was not decided by ${dice.d1}-${dice.d2}`)
  return { subject, decision }
}

function hardPair(n: 4 | 6 | 8 | 10): Dice {
  const face = (n / 2) as Dice['d1']
  return { d1: face, d2: face }
}

/** ⌊stake × num/den ÷ unit⌋ × unit, in this file's own bigint arithmetic. */
function floored(stake: number, [num, den]: readonly [bigint, bigint], unit: bigint): number {
  return Number(((BigInt(stake) * num) / (den * unit)) * unit)
}

describe('hardway winners, to the cent', () => {
  it('$5 on hard 6 wins $45 and stays up; $1 on hard 4 wins $7 (Interblock)', () => {
    const cfg = machine('craplessBubble')
    const six = decided(cfg, 6, 500, { d1: 3, d2: 3 })
    expect(settle(six.subject, six.decision, cfg)).toMatchObject({
      outcome: 'win',
      typeId: 'hard',
      number: 6,
      payKey: '6',
      ratioLabel: '9:1',
      winExact: '4500',
      winPaid: 4_500,
      breakage: '0',
      credited: 4_500,
      stakeDisposition: 'stays',
    })
    const four = decided(cfg, 4, 100, { d1: 2, d2: 2 })
    expect(settle(four.subject, four.decision, cfg)).toMatchObject({
      winPaid: 700,
      credited: 700,
      stakeDisposition: 'stays',
    })
  })

  it('a machine that returns winners credits the stake too', () => {
    const input = structuredClone(craplessBubble)
    const hard = input.catalog.hard
    if (hard?.family !== 'hardway') throw new Error('craplessBubble has no hardways')
    hard.afterWin = 'return'
    input.id = 'craplessHardReturned'
    const cfg = machine(input)
    const { subject, decision } = decided(cfg, 8, 500, { d1: 4, d2: 4 })
    expect(settle(subject, decision, cfg)).toMatchObject({
      winPaid: 4_500,
      credited: 5_000,
      stakeDisposition: 'returned',
    })
  })

  it('the easy way and any 7 lose the stake', () => {
    const cfg = machine('traditionalBubble')
    for (const dice of [
      { d1: 5, d2: 1 },
      { d1: 3, d2: 4 },
    ] as const) {
      const { subject, decision } = decided(cfg, 6, 500, dice)
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
  'hardway pays on $name, every stake from 1¢ to 1200¢',
  ({ name, unit, label }) => {
    const cfg = machine(name)

    it.each(HARD)('hard %i', (n) => {
      for (let stake = 1; stake <= 1_200; stake += 1) {
        const { subject, decision } = decided(cfg, n, stake, hardPair(n))
        const trace = settle(subject, decision, cfg)
        const paid = floored(stake, PAYS[n], unit)
        const exact = BigInt(stake) * PAYS[n][0]
        expect(
          [trace.winExact, trace.winPaid, trace.breakage, trace.credited, trace.ratioLabel],
          `${stake}¢`,
        ).toEqual([String(exact), paid, String(exact - BigInt(paid)), paid, label(n)])
      }
    })
  },
)

describe('exact mode', () => {
  it('pays stake × ratio with no rounding at all', () => {
    const cfg = machine('traditionalLive345')
    const { subject, decision } = decided(cfg, 10, 150, { d1: 5, d2: 5 })
    const exact = settle(subject, decision, cfg, 'exact')
    expect(exact.winPaid.equals(Fraction.of(1_050))).toBe(true)
    expect(exact.credited.equals(Fraction.of(1_050))).toBe(true)
    expect(exact.rounding).toBeNull()
    // Rounded, the live table keeps the 50¢: $1.50 on hard 10 pays $10.
    expect(settle(subject, decision, cfg)).toMatchObject({ winPaid: 1_000, breakage: '50' })
  })
})
