import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import type { RoundState } from '../../../src/engine/round/round.ts'
import { isSettled, type BetInstance, type Settled } from '../../../src/engine/bets/types.ts'
import { settle } from '../../../src/engine/settle/settle.ts'
import { bet, decide, machine, rollContext, roundAt } from '../rules/support.ts'

// The Hot Shooter Jackpot settlement table, written from docs/rules/rules-spec.md §4.1 (a "for 1"
// pay returns the stake inside the multiple: "3 for 1" nets 2 to 1) and §6.2 (1x at 8 rolls is a
// push that returns the stake; 3x at 16, 5x at 24, 7x at 32, 12x at 40, 30x at 45, 100x at 50 or
// more; fewer than 8 lose). Pays and labels are this file's own.

/** The tiers: the first roll count, the multiple "for 1", and the net win to 1 (0 for the push). */
const TIERS: readonly { minRolls: number; label: string; net: bigint }[] = [
  { minRolls: 8, label: '', net: 0n },
  { minRolls: 16, label: '3 for 1', net: 2n },
  { minRolls: 24, label: '5 for 1', net: 4n },
  { minRolls: 32, label: '7 for 1', net: 6n },
  { minRolls: 40, label: '12 for 1', net: 11n },
  { minRolls: 45, label: '30 for 1', net: 29n },
  { minRolls: 50, label: '100 for 1', net: 99n },
]

/** The round before a hand's `rolls`th roll, with the point on 6. */
function before(rolls: number): RoundState {
  return { ...roundAt(6), rollIndex: rolls, hand: { index: 0, rolls, pointsMadeMask: 0 } }
}

/** A Hot Shooter that has counted `rolls − 1` rolls, decided by a seven-out as the `rolls`th. */
function atSevenOut(
  cfg: MachineConfig,
  rolls: number,
  stake: number,
): { subject: BetInstance; decision: Settled } {
  const subject = bet('hotShooter', null, { amount: stake, progress: rolls - 1 })
  const decision = decide(cfg, subject, rollContext(cfg, before(rolls - 1), { d1: 3, d2: 4 }))
  if (!isSettled(decision)) throw new Error('the Hot Shooter was not decided by the seven-out')
  return { subject, decision }
}

describe('Hot Shooter Jackpot settlements on Shoot To Win', () => {
  const cfg = machine('traditionalBubble')

  it('$1 on a 16-roll hand pays $2 and the $1 comes back: "3 for 1"', () => {
    const { subject, decision } = atSevenOut(cfg, 16, 100)
    expect(settle(subject, decision, cfg)).toMatchObject({
      outcome: 'win',
      typeId: 'hotShooter',
      number: null,
      payKey: '16',
      ratioLabel: '3 for 1',
      winExact: '200',
      winPaid: 200,
      rounding: { mode: 'floor', increment: 1 },
      breakage: '0',
      credited: 300,
      stakeDisposition: 'returned',
    })
  })

  it('an 8-roll hand returns the stake and nothing more: a zero-net push', () => {
    for (const rolls of [8, 9, 15]) {
      const { subject, decision } = atSevenOut(cfg, rolls, 700)
      expect(settle(subject, decision, cfg), `${rolls} rolls`).toMatchObject({
        outcome: 'push',
        pushReason: 'zeroNet',
        payKey: null,
        ratioLabel: '',
        winPaid: 0,
        credited: 700,
        stakeDisposition: 'returned',
      })
    }
  })

  it('a hand of 7 rolls or fewer loses the stake', () => {
    for (const rolls of [1, 2, 7]) {
      const { subject, decision } = atSevenOut(cfg, rolls, 700)
      expect(settle(subject, decision, cfg), `${rolls} rolls`).toMatchObject({
        outcome: 'lose',
        winPaid: 0,
        credited: 0,
        stakeDisposition: 'lost',
      })
    }
  })

  it('every tier from $1 to $1,000, at its first roll count and just below the next', () => {
    for (const [index, tier] of TIERS.entries()) {
      if (tier.net === 0n) continue
      const next = TIERS[index + 1]?.minRolls ?? tier.minRolls + 1
      for (const rolls of [tier.minRolls, next - 1]) {
        for (const stake of [100, 700, 2_500, 100_000]) {
          const { subject, decision } = atSevenOut(cfg, rolls, stake)
          const trace = settle(subject, decision, cfg)
          const won = BigInt(stake) * tier.net
          expect(
            [trace.payKey, trace.ratioLabel, trace.winExact, trace.winPaid, trace.credited],
            `${rolls} rolls at ${stake}¢`,
          ).toEqual([
            String(tier.minRolls),
            tier.label,
            String(won),
            Number(won),
            Number(won) + stake,
          ])
        }
      }
    }
  })

  it('the Grand tier: $7 on a 50-roll hand returns $700, 100 for 1', () => {
    const { subject, decision } = atSevenOut(cfg, 50, 700)
    expect(settle(subject, decision, cfg)).toMatchObject({
      payKey: '50',
      ratioLabel: '100 for 1',
      winPaid: 69_300,
      credited: 70_000,
    })
    const longer = atSevenOut(cfg, 153, 700)
    expect(settle(longer.subject, longer.decision, cfg)).toMatchObject({ credited: 70_000 })
  })
})
