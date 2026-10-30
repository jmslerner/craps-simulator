import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { pointRunProgress } from '../../../src/engine/bets/families/pointRun.ts'
import { isSettled, type BetInstance, type Settled } from '../../../src/engine/bets/types.ts'
import { settle } from '../../../src/engine/settle/settle.ts'
import { bet, decide, machine, rollContext, roundAt } from '../rules/support.ts'

// The Lucky Shooter settlement table, written from docs/rules/rules-spec.md §4.1 ("for 1" pays
// return the stake inside the multiple) and §6.3, pay table D as Interblock's screen shows it: 500
// for 1 at 5 hits plus the point, 100 at 5 hits, 10 at 4, 5 at 3, 2 at 2; fewer hits lose; a
// come-out 7 or 11 pushes with the bet staying up (§0.2 #8). Pays and labels are this file's own.

const OTHERS: readonly PointNumber[] = [4, 5, 8, 9, 10]
const bit = (n: number) => 1 << n
const maskOf = (points: readonly PointNumber[]) => points.reduce((m, n) => m | bit(n), 0)

/** Pay table D by hits: the label and the net win to 1. */
const PAYS: Readonly<Record<string, { label: string; net: bigint }>> = {
  '2': { label: '2 for 1', net: 1n },
  '3': { label: '5 for 1', net: 4n },
  '4': { label: '10 for 1', net: 9n },
  '5': { label: '100 for 1', net: 99n },
  top: { label: '500 for 1', net: 499n },
}

/** A Lucky Shooter on point 6 with `hits` of the other box numbers, decided by `dice`. */
function withHits(
  cfg: MachineConfig,
  hits: number,
  stake: number,
  dice: Dice,
): { subject: BetInstance; decision: Settled } {
  const progress = pointRunProgress(6, maskOf(OTHERS.slice(0, hits)))
  const subject = bet('luckyShooter', null, { amount: stake, progress })
  const decision = decide(cfg, subject, rollContext(cfg, roundAt(6), dice))
  if (!isSettled(decision))
    throw new Error(`the Lucky Shooter was not decided by ${dice.d1}-${dice.d2}`)
  return { subject, decision }
}

describe('Lucky Shooter settlements on the strict machine (pay table D)', () => {
  const cfg = machine('strictBubble')

  it('$1 with 3 hits, then the point: $4 and the $1 back, "5 for 1"', () => {
    const { subject, decision } = withHits(cfg, 3, 100, { d1: 3, d2: 3 })
    expect(settle(subject, decision, cfg)).toMatchObject({
      outcome: 'win',
      typeId: 'luckyShooter',
      number: null,
      payKey: '3',
      ratioLabel: '5 for 1',
      winExact: '400',
      winPaid: 400,
      rounding: { mode: 'floor', increment: 1 },
      breakage: '0',
      credited: 500,
      stakeDisposition: 'returned',
    })
  })

  it('5 hits then the point is the top award, 500 for 1; 5 hits then anything else 100 for 1', () => {
    const top = withHits(cfg, 5, 100, { d1: 3, d2: 3 })
    expect(settle(top.subject, top.decision, cfg)).toMatchObject({
      payKey: 'top',
      ratioLabel: '500 for 1',
      winPaid: 49_900,
      credited: 50_000,
    })
    const five = withHits(cfg, 5, 500, { d1: 5, d2: 6 })
    expect(settle(five.subject, five.decision, cfg)).toMatchObject({
      payKey: '5',
      ratioLabel: '100 for 1',
      winPaid: 49_500,
      credited: 50_000,
    })
  })

  it('a seven-out or a repeat settles by the hits: 4 and 2 hits pay, 1 and 0 lose', () => {
    const four = withHits(cfg, 4, 100, { d1: 3, d2: 4 })
    expect(settle(four.subject, four.decision, cfg)).toMatchObject({
      payKey: '4',
      ratioLabel: '10 for 1',
      winPaid: 900,
      credited: 1_000,
    })
    const two = withHits(cfg, 2, 100, { d1: 2, d2: 2 })
    expect(settle(two.subject, two.decision, cfg)).toMatchObject({
      payKey: '2',
      ratioLabel: '2 for 1',
      winPaid: 100,
      credited: 200,
    })
    for (const hits of [0, 1]) {
      const { subject, decision } = withHits(cfg, hits, 100, { d1: 3, d2: 4 })
      expect(settle(subject, decision, cfg), `${hits} hits`).toMatchObject({
        outcome: 'lose',
        winPaid: 0,
        credited: 0,
        stakeDisposition: 'lost',
      })
    }
  })

  it('a come-out 7 or 11 pushes: nothing is paid and the stake stays up', () => {
    for (const dice of [
      { d1: 3, d2: 4 },
      { d1: 5, d2: 6 },
    ] as const) {
      const subject = bet('luckyShooter', null, { amount: 300 })
      const decision = decide(cfg, subject, rollContext(cfg, roundAt(null), dice))
      if (!isSettled(decision)) throw new Error('the come-out did not decide the Lucky Shooter')
      expect(settle(subject, decision, cfg), `${dice.d1}-${dice.d2}`).toMatchObject({
        outcome: 'push',
        pushReason: 'bar',
        winPaid: 0,
        credited: 0,
        stakeDisposition: 'stays',
      })
    }
  })

  it('every pay from $1 to $100 is exactly stake × net, the stake returned on top', () => {
    for (const [key, { label, net }] of Object.entries(PAYS)) {
      const hits = key === 'top' ? 5 : Number(key)
      const dice: Dice = key === 'top' ? { d1: 3, d2: 3 } : { d1: 3, d2: 4 }
      for (let stake = 100; stake <= 10_000; stake += 100) {
        const { subject, decision } = withHits(cfg, hits, stake, dice)
        const trace = settle(subject, decision, cfg)
        const won = BigInt(stake) * net
        expect(
          [
            trace.payKey,
            trace.ratioLabel,
            trace.winExact,
            trace.winPaid,
            trace.breakage,
            trace.credited,
          ],
          `${key} at ${stake}¢`,
        ).toEqual([key, label, String(won), Number(won), '0', Number(won) + stake])
      }
    }
  })
})
