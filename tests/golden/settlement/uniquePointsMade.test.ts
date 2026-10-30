import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import { Fraction } from '../../../src/engine/core/rational.ts'
import { isSettled, type BetInstance, type Settled } from '../../../src/engine/bets/types.ts'
import { settle } from '../../../src/engine/settle/settle.ts'
import { bet, decide, machine, rollContext, roundAt } from '../rules/support.ts'

// The Fire Bet settlement table, written from docs/rules/rules-spec.md §4.1–§4.2 (the live table
// floors payouts to $1) and §6.6 (pay table A: 24, 249 and 999 to 1 at 4, 5 and 6 unique points,
// paid once at the seven-out, the stake coming back with a win and lost otherwise). Pays and the
// rounding unit are this file's own.

const PAYS: Readonly<Record<number, bigint>> = { 4: 24n, 5: 249n, 6: 999n }
const BOX: readonly PointNumber[] = [4, 5, 6, 8, 9, 10]
const bit = (n: number) => 1 << n
const maskOf = (points: readonly PointNumber[]) => points.reduce((m, n) => m | bit(n), 0)

/** A Fire Bet with `count` unique points, decided by the seven-out with the point on 10. */
function atSevenOut(
  cfg: MachineConfig,
  count: number,
  stake: number,
): { subject: BetInstance; decision: Settled } {
  const subject = bet('fire', null, { amount: stake, progress: maskOf(BOX.slice(0, count)) })
  const decision = decide(cfg, subject, rollContext(cfg, roundAt(10), { d1: 3, d2: 4 }))
  if (!isSettled(decision)) throw new Error(`the Fire Bet was not decided by the seven-out`)
  return { subject, decision }
}

describe('Fire Bet settlements on the live table', () => {
  const cfg = machine('traditionalLive345')

  it('$10 at 4 points pays $240 and the $10 comes back', () => {
    const { subject, decision } = atSevenOut(cfg, 4, 1_000)
    expect(settle(subject, decision, cfg)).toMatchObject({
      outcome: 'win',
      typeId: 'fire',
      number: null,
      payKey: '4',
      ratioLabel: '24 to 1',
      winExact: '24000',
      winPaid: 24_000,
      rounding: { mode: 'floor', increment: 100 },
      breakage: '0',
      credited: 25_000,
      stakeDisposition: 'returned',
    })
  })

  it('5 points pay 249 to 1 and 6 points 999 to 1', () => {
    const five = atSevenOut(cfg, 5, 1_000)
    expect(settle(five.subject, five.decision, cfg)).toMatchObject({
      payKey: '5',
      ratioLabel: '249 to 1',
      winPaid: 249_000,
      credited: 250_000,
    })
    const six = atSevenOut(cfg, 6, 500)
    expect(settle(six.subject, six.decision, cfg)).toMatchObject({
      payKey: '6',
      ratioLabel: '999 to 1',
      winPaid: 499_500,
      credited: 500_000,
    })
  })

  it('fewer than 4 points lose the stake', () => {
    for (const count of [0, 1, 2, 3]) {
      const { subject, decision } = atSevenOut(cfg, count, 1_000)
      expect(settle(subject, decision, cfg), `${count} points`).toMatchObject({
        outcome: 'lose',
        winPaid: 0,
        credited: 0,
        stakeDisposition: 'lost',
      })
    }
  })

  it('every whole-dollar stake from $1 to $100 pays exactly stake × ratio', () => {
    for (const [count, pay] of Object.entries(PAYS)) {
      for (let stake = 100; stake <= 10_000; stake += 100) {
        const { subject, decision } = atSevenOut(cfg, Number(count), stake)
        const trace = settle(subject, decision, cfg)
        const won = BigInt(stake) * pay
        expect(
          [trace.winExact, trace.winPaid, trace.breakage, trace.credited],
          `${stake}¢`,
        ).toEqual([String(won), Number(won), '0', Number(won) + stake])
      }
    }
  })

  it('a stake off the dollar grid is floored to the dollar; exact mode keeps the cents', () => {
    const { subject, decision } = atSevenOut(cfg, 5, 150)
    expect(settle(subject, decision, cfg)).toMatchObject({
      winExact: '37350',
      winPaid: 37_300,
      breakage: '50',
      credited: 37_450,
    })
    const exact = settle(subject, decision, cfg, 'exact')
    expect(exact.winPaid.equals(Fraction.of(37_350))).toBe(true)
    expect(exact.credited.equals(Fraction.of(37_500))).toBe(true)
    expect(exact.rounding).toBeNull()
  })
})
