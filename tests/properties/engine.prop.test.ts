import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../src/engine/config/rulesets.ts'
import { DICE_CLASSES, isDoubles, totalOf, type Dice } from '../../src/engine/core/dice.ts'
import { cents } from '../../src/engine/core/money.ts'
import { advanceRound, initialRound, type RoundState } from '../../src/engine/round/round.ts'
import { decideBet, requireType, type ResolvedType } from '../../src/engine/bets/registry.ts'
import {
  betId,
  type BetInstance,
  type Decision,
  type RollContext,
} from '../../src/engine/bets/types.ts'
import { offeredTypes } from './actions.ts'
import { checkSessions } from './session.ts'

// The M4d engine properties (plan §9 item 6), quick subset: seeded random sessions on every preset
// (tests/properties/session.ts lists what is checked after every action), and decide(d1, d2) ≡
// decide(d2, d1) for every bet type, spot, phase, working status and parent decision. The full
// run is tests/slow/engine.slow.test.ts.

describe.each(PRESET_IDS)('random sessions on %s (quick subset)', (id) => {
  it('conserve money, keep contracts and odds caps, round-trip, and replay from the seed', () => {
    const report = checkSessions(id, 40, 120)
    // The sessions play rather than collect refusals; and they reach the checks they exist for.
    expect(report.accepted).toBeGreaterThan(report.actions / 2)
    expect(report.coverage.accepted.get('roll:point') ?? 0).toBeGreaterThan(200)
    expect(report.coverage.accepted.get('roll:comeOut') ?? 0).toBeGreaterThan(100)
    expect(report.contractRefusals).toBeGreaterThan(50)
    expect(report.oddsChecked).toBeGreaterThan(20)
    expect(report.unscripted).toBeGreaterThan(100)
    expect(report.coverage.accepted.get('takenDown') ?? 0).toBeGreaterThan(20)
    expect(report.coverage.accepted.get('press') ?? 0).toBeGreaterThan(20)
  })
})

/** A bet of `typeId` on `number` (behind a parent bet `b1` for odds). */
function betOn(typeId: string, number: PointNumber | null, odds: boolean): BetInstance {
  return {
    id: betId(odds ? 2 : 1),
    typeId,
    number,
    parentId: odds ? betId(1) : null,
    amount: cents(1_000),
    vigHeld: cents(0),
    working: null,
    progress: 0,
    placedAtRoll: 0,
  }
}

function contextFor(
  cfg: MachineConfig,
  before: RoundState,
  dice: Dice,
  working: boolean,
  parentDecision: Decision | null,
): RollContext {
  return {
    dice,
    total: totalOf(dice),
    isPair: isDoubles(dice),
    before,
    transition: advanceRound(before, dice, cfg.ruleset).transition,
    rules: cfg.ruleset,
    cfg,
    working,
    parentDecision,
  }
}

/** The numbers a bet of this type can sit on: its own, or (line bets, odds) any point or none. */
function spots(cfg: MachineConfig, { type }: ResolvedType): (PointNumber | null)[] {
  switch (type.family) {
    case 'numberVsSeven':
    case 'hardway':
      return [...type.numbers]
    case 'line':
      return [null, ...cfg.ruleset.points]
    case 'odds':
      return [...cfg.ruleset.points]
    case 'oneRoll':
    case 'composite':
      return [null]
  }
}

describe.each(PRESET_IDS)('decide(d1, d2) ≡ decide(d2, d1) on %s', (id) => {
  const cfg = compileConfig(PRESETS[id])
  const rounds: RoundState[] = [
    initialRound(),
    ...cfg.ruleset.points.map((point) => ({
      ...initialRound(),
      phase: { kind: 'point' as const, point },
    })),
  ]
  const splits = DICE_CLASSES.filter((dice) => dice.d1 !== dice.d2)

  it('for every bet type, spot, phase, working status and parent decision', () => {
    let compared = 0
    for (const typeId of offeredTypes(cfg)) {
      const resolved = requireType(cfg, typeId)
      const odds = resolved.type.family === 'odds'
      const parentType =
        resolved.type.family === 'odds' ? requireType(cfg, resolved.type.parent) : null
      for (const number of spots(cfg, resolved)) {
        const bet = betOn(typeId, number, odds)
        const parent = parentType === null ? null : betOn(parentType.type.typeId, number, false)
        for (const before of rounds) {
          for (const working of [true, false]) {
            for (const { d1, d2 } of splits) {
              const decision = (dice: Dice) => {
                // Odds get their parent's decision on the same dice, as the roll gives them.
                const parentDecision =
                  parent === null || parentType === null
                    ? null
                    : decideBet(parent, contextFor(cfg, before, dice, true, null), parentType)
                const ctx = contextFor(cfg, before, dice, working, parentDecision)
                return decideBet(bet, ctx, resolved)
              }
              expect(decision({ d1, d2 }), `${typeId} ${String(number)} ${d1}-${d2}`).toEqual(
                decision({ d1: d2, d2: d1 }),
              )
              compared++
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(5_000)
  })
})
