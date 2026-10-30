import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import { traditionalBubble } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../../src/engine/config/schema.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import type { RoundState } from '../../../src/engine/round/round.ts'
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

// The Hot Shooter Jackpot rule table (family handLength), written from docs/rules/rules-spec.md
// §2.6 and §6.2: the bet counts the hand's rolls and is paid at the seven-out for the highest tier
// reached, "for 1": 1x (a push) at 8 rolls, 3x at 16, 5x at 24, 7x at 32, 12x at 40, 30x at 45
// and 100x at 50 or more (§0.2 #7); fewer than 8 rolls lose. Definition A counts every roll, the
// come-out and the seven-out included; B leaves out the seven-out; C neither the first come-out
// nor the seven-out (§9 #10). Constants are this file's own.

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

/**
 * A roll with the point on that is a 7 settles: the rolls counted so far plus this one under A.
 * Any other roll counts one more, except the bet's first roll under C.
 */
function expected(
  definition: Definition,
  progress: number,
  first: boolean,
  point: PointNumber | null,
  dice: Dice,
): string {
  const total = sumOf(dice)
  if (point !== null && total === 7) {
    const rolls = progress + (definition === 'allRolls' ? 1 : 0)
    const tier = TIERS.filter((t) => t.minRolls <= rolls).at(-1)
    if (tier === undefined) return 'lose'
    return tier.pays === null ? 'push:zeroNet' : 'win:return'
  }
  const counted = definition !== 'exceptComeOutAndSevenOut' || !first
  return counted ? `progress:${progress + 1}` : 'none'
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

/** The round before the bet's `rolls`th roll of the hand: its first, or a later one. */
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

  it('counts each roll and settles at the seven-out for the highest tier reached', () => {
    for (const point of [null, ...BOX]) {
      for (const progress of COUNTS) {
        for (const first of [true, false]) {
          if (first && progress !== 0) continue
          const subject = bet('hotShooter', null, { progress })
          const round = first ? before(point, 0) : before(point, progress + 1)
          const got = departures(
            (dice) => expected(definition, progress, first, point, dice),
            (dice) => outcome(decide(cfg, subject, rollContext(cfg, round, dice))),
          )
          expect(got, `point ${String(point)} progress ${progress} first ${first}`).toEqual([])
        }
      }
    }
  })

  it('the push tier returns the stake: a zero-net push, the bet coming down', () => {
    const subject = bet('hotShooter', null, { progress: definition === 'allRolls' ? 7 : 8 })
    const decision = decide(cfg, subject, rollContext(cfg, before(6, 8), { d1: 3, d2: 4 }))
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

  it('flags a count beyond the rolls since placement or beyond the hand', () => {
    const table = { ...newTable(cfg, 'hot'), round: before(6, 5) }
    expect(family.invariants?.(bet('hotShooter', null, { progress: 5 }), table, type, cfg)).toEqual(
      [],
    )
    expect(family.invariants?.(bet('hotShooter', null, { progress: 6 }), table, type, cfg)).toEqual(
      [expect.stringMatching(/more rolls than/)],
    )
    const later = bet('hotShooter', null, { progress: 3, placedAtRoll: 3 })
    expect(family.invariants?.(later, table, type, cfg)).toEqual([
      expect.stringMatching(/more rolls than/),
    ])
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
