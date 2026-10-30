import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import { traditionalBubble } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../../src/engine/config/schema.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import type { RoundState } from '../../../src/engine/round/round.ts'
import { requireBet } from '../../../src/engine/bets/registry.ts'
import { handLengthCount, handLengthCounted } from '../../../src/engine/bets/families/handLength.ts'
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

// The Hot Shooter Jackpot rule table (family handLength), written from docs/rules/rules-spec.md
// §2.6 and §6.2: the bet counts the hand's rolls and is paid at the seven-out for the highest tier
// reached, "for 1": 1x (a push) at 8 rolls, 3x at 16, 5x at 24, 7x at 32, 12x at 40, 30x at 45
// and 100x at 50 or more (§0.2 #7); fewer than 8 rolls lose. Definition A counts every roll, the
// come-out and the seven-out included; B leaves out the seven-out; C neither the hand's first
// come-out nor the seven-out (§9 #10). The counter is the hand's (`hand.rolls`, §2.6): the bet's
// progress is the rolls its hand has made so far, whenever it was placed, and the definition is
// applied to the whole hand at the seven-out. Constants are this file's own.

type Definition = 'allRolls' | 'exceptSevenOut' | 'exceptComeOutAndSevenOut'

/** §6.2: the tiers, net "to 1"; null is the 1-for-1 push. */
const TIERS: readonly { minRolls: number; pays: readonly [bigint, bigint] | null }[] = [
  { minRolls: 8, pays: null },
  { minRolls: 16, pays: [2n, 1n] },
  { minRolls: 24, pays: [4n, 1n] },
  { minRolls: 32, pays: [6n, 1n] },
  { minRolls: 40, pays: [11n, 1n] },
  { minRolls: 45, pays: [29n, 1n] },
  { minRolls: 50, pays: [99n, 1n] },
]

const BOX: readonly PointNumber[] = [4, 5, 6, 8, 9, 10]
const COUNTS = [0, 1, 6, 7, 8, 9, 15, 16, 23, 24, 31, 32, 39, 40, 44, 45, 49, 50, 51, 153]

/** The rolls a definition counts in a hand of `rolls` rolls, the seven-out included (§6.2). */
function countOf(definition: Definition, rolls: number): number {
  switch (definition) {
    case 'allRolls':
      return rolls
    case 'exceptSevenOut':
      return rolls - 1
    case 'exceptComeOutAndSevenOut':
      return rolls - 2
  }
}

/**
 * A roll with the point on that is a 7 ends the hand at `progress + 1` rolls and settles at the
 * tier its count reaches. Any other roll is one more roll of the hand, whatever the definition:
 * C leaves the hand's first come-out out of the count at the seven-out, not out of the hand.
 */
function expected(
  definition: Definition,
  progress: number,
  point: PointNumber | null,
  dice: Dice,
): string {
  const total = sumOf(dice)
  if (point !== null && total === 7) {
    const count = countOf(definition, progress + 1)
    const tier = TIERS.filter((t) => t.minRolls <= count).at(-1)
    if (tier === undefined) return 'lose'
    return tier.pays === null ? 'push:zeroNet' : 'win:return'
  }
  return `progress:${progress + 1}`
}

function withDefinition(definition: Definition): MachineConfig {
  if (definition === 'allRolls') return machine(traditionalBubble)
  const input: MachineConfigInput = structuredClone(traditionalBubble)
  input.id = `stw-${definition}`
  const hot = input.sideBets.hotShooter
  if (hot?.family !== 'handLength') throw new Error('traditionalBubble has no Hot Shooter')
  hot.countDefinition = definition
  return machine(input)
}

/** The round after `rolls` rolls of the hand: before its first roll, or a later one. */
function before(point: PointNumber | null, rolls: number): RoundState {
  const start = roundAt(point)
  return { ...start, rollIndex: rolls, hand: { index: 0, rolls, pointsMadeMask: 0 } }
}

const DEFINITIONS: readonly Definition[] = [
  'allRolls',
  'exceptSevenOut',
  'exceptComeOutAndSevenOut',
]

describe.each(DEFINITIONS)('the Hot Shooter Jackpot under definition %s', (definition) => {
  const cfg = withDefinition(definition)

  it('counts each roll of the hand and settles at the seven-out for the highest tier reached', () => {
    for (const point of [null, ...BOX]) {
      for (const progress of COUNTS) {
        // A bet placed on the hand's first come-out, or later on, say, its third (it then carries
        // the two rolls before it): the decision is the hand's either way.
        for (const placedAtRoll of [0, Math.max(0, progress - 2)]) {
          const subject = bet('hotShooter', null, { progress, placedAtRoll })
          const round = before(point, progress)
          const got = departures(
            (dice) => expected(definition, progress, point, dice),
            (dice) => outcome(decide(cfg, subject, rollContext(cfg, round, dice))),
          )
          expect(got, `point ${String(point)} progress ${progress} from ${placedAtRoll}`).toEqual(
            [],
          )
        }
      }
    }
  })

  it("counts the hand's rolls so far as the machine's panel shows them", () => {
    const type = requireBet(cfg, 'hotShooter').type
    if (type.family !== 'handLength') throw new Error('not a Hot Shooter')
    // Mid-hand nothing is a seven-out yet: A and B count every roll, C all but the first come-out.
    for (const rolls of [0, 1, 2, 9]) {
      const seen = definition === 'exceptComeOutAndSevenOut' ? Math.max(0, rolls - 1) : rolls
      expect(handLengthCounted(type, rolls), `${rolls} rolls`).toBe(seen)
      // A seven-out needs a point, so it ends a hand of two rolls at least.
      if (rolls === 0) continue
      expect(handLengthCount(type, rolls + 1), `a seven-out after ${rolls}`).toBe(
        countOf(definition, rolls + 1),
      )
    }
  })

  it('the push tier returns the stake: a zero-net push, the bet coming down', () => {
    // The seven-out ends a hand whose count is 8: 8 rolls under A, 9 under B, 10 under C.
    const rolls = { allRolls: 8, exceptSevenOut: 9, exceptComeOutAndSevenOut: 10 }[definition]
    const subject = bet('hotShooter', null, { progress: rolls - 1 })
    const decision = decide(cfg, subject, rollContext(cfg, before(6, rolls - 1), { d1: 3, d2: 4 }))
    expect(decision).toEqual({ kind: 'push', reason: 'zeroNet', stake: 'return' })
  })
})

describe('pays and checks', () => {
  const cfg = machine(traditionalBubble)
  const { family, type } = requireBet(cfg, 'hotShooter')

  it('pays each tier "for 1" as net to 1, keyed by its first roll count; the push tier pays nothing', () => {
    for (const tier of TIERS) {
      const key = String(tier.minRolls)
      if (tier.pays === null) {
        expect(() => family.payout(type, key)).toThrow(RangeError)
        continue
      }
      const ratio = family.payout(type, key)
      expect([ratio.num, ratio.den], key).toEqual([...tier.pays])
    }
    expect(() => family.payout(type, '12')).toThrow(RangeError)
  })

  it('always works, follows the round, and is never switched OFF', () => {
    expect(family.toggleable).toBe(false)
    expect(family.decidesWhenOff).toBe(false)
    expect(family.projection).toBe('round')
    expect(family.defaultWorking({ kind: 'comeOut' }, type, cfg)).toBe(true)
    expect(family.defaultWorking({ kind: 'point', point: 6 }, type, cfg)).toBe(true)
  })

  it('keeps a counting bet up with its new count, and takes down a settled one', () => {
    const subject = bet('hotShooter', null, { progress: 3 })
    const ctx = rollContext(cfg, before(6, 3), { d1: 2, d2: 2 })
    const after = (decision: Parameters<typeof family.apply>[1]) =>
      family.apply(subject, decision, ctx, type)
    expect(after({ kind: 'none' })).toBe(subject)
    expect(after({ kind: 'progress', progress: 4 })).toMatchObject({ progress: 4 })
    expect(after({ kind: 'win', payKey: '16', stake: 'return' })).toBeNull()
    expect(after({ kind: 'push', reason: 'zeroNet', stake: 'return' })).toBeNull()
    expect(after({ kind: 'lose' })).toBeNull()
  })

  it('flags a count beyond the hand, and not one a bet placed later carries (§2.6)', () => {
    const table = { ...newTable(cfg, 'hot'), round: before(6, 5) }
    expect(family.invariants?.(bet('hotShooter', null, { progress: 5 }), table, type, cfg)).toEqual(
      [],
    )
    expect(family.invariants?.(bet('hotShooter', null, { progress: 6 }), table, type, cfg)).toEqual(
      [expect.stringMatching(/more rolls than/)],
    )
    // Placed on the hand's come-out after a point was made: it carries the hand's rolls.
    const later = bet('hotShooter', null, { progress: 5, placedAtRoll: 5 })
    expect(family.invariants?.(later, table, type, cfg)).toEqual([])
  })

  it("starts a new bet with the hand's rolls so far: none on a new hand's come-out (§2.6)", () => {
    const fresh = newTable(cfg, 'hot')
    expect(family.initialProgress?.(fresh, type)).toBe(0)
    expect(family.initialProgress?.({ ...fresh, round: before(null, 2) }, type)).toBe(2)
  })

  it('reads the count definition, the tiers, the window, the qualifier and the rounding', () => {
    expect(family.configPaths(type, null, cfg)).toEqual([
      '/sideBets/hotShooter/countDefinition',
      '/sideBets/hotShooter/tiers',
      '/sideBets/hotShooter/placement',
      '/sideBets/hotShooter/qualifyingBet',
      '/money/payoutRounding',
    ])
  })
})
