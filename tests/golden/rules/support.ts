import { compileConfig, type MachineConfig } from '../../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../../src/engine/config/schema.ts'
import type { Dice, DieFace, Total } from '../../../src/engine/core/dice.ts'
import { cents } from '../../../src/engine/core/money.ts'
import { advanceRound, initialRound, type RoundState } from '../../../src/engine/round/round.ts'
import { decideBet, requireBet } from '../../../src/engine/bets/registry.ts'
import {
  betId,
  type BetInstance,
  type Decision,
  type RollContext,
} from '../../../src/engine/bets/types.ts'

/**
 * Shared helpers for the rule tables (plan §9 item 1, §0 #16): build a bet and a roll context by
 * hand, decide the bet, and print the decision compactly. The tables themselves hold their own
 * expectations, written from docs/rules/rules-spec.md.
 */

const FACES: readonly DieFace[] = [1, 2, 3, 4, 5, 6]

/** All 36 ordered rolls, so a table checks every way to roll each total. */
export const ALL_DICE: readonly Dice[] = FACES.flatMap((d1) => FACES.map((d2) => ({ d1, d2 })))

export const sumOf = ({ d1, d2 }: Dice) => (d1 + d2) as Total

export function machine(id: PresetId | MachineConfigInput): MachineConfig {
  return compileConfig(typeof id === 'string' ? PRESETS[id] : id)
}

/** A preset with some top-level parts replaced: a new object, so the frozen preset is untouched. */
export function variant(id: PresetId, change: Partial<MachineConfigInput>): MachineConfig {
  return compileConfig({ ...PRESETS[id], ...change })
}

/** The live preset under Reno rules: don't bets push on 2 instead of 12. */
export function renoMachine(): MachineConfig {
  const live = PRESETS.traditionalLive345
  return compileConfig({ ...live, id: 'reno', rules: { ...live.rules, dontBar: 2 } })
}

/** A round in the come-out phase, or with `point` on. */
export function roundAt(point: PointNumber | null): RoundState {
  const start = initialRound()
  return point === null ? start : { ...start, phase: { kind: 'point', point } }
}

/** A bet as a table would hold it. `progress` is a side bet's mask or count (M11). */
export function bet(
  typeId: string,
  number: PointNumber | null,
  options: {
    seq?: number
    parent?: BetInstance
    amount?: number
    working?: boolean | null
    progress?: number
    placedAtRoll?: number
  } = {},
): BetInstance {
  return {
    id: betId(options.seq ?? (options.parent === undefined ? 1 : 2)),
    typeId,
    number,
    parentId: options.parent?.id ?? null,
    amount: cents(options.amount ?? 1_000),
    vigHeld: cents(0),
    working: options.working ?? null,
    progress: options.progress ?? 0,
    placedAtRoll: options.placedAtRoll ?? 0,
  }
}

/** The context a roll of `dice` from `before` gives a bet. */
export function rollContext(
  cfg: MachineConfig,
  before: RoundState,
  dice: Dice,
  options: { working?: boolean; parentDecision?: Decision | null } = {},
): RollContext {
  return {
    dice,
    total: sumOf(dice),
    isPair: dice.d1 === dice.d2,
    before,
    transition: advanceRound(before, dice, cfg.ruleset).transition,
    rules: cfg.ruleset,
    cfg,
    working: options.working ?? true,
    parentDecision: options.parentDecision ?? null,
  }
}

/** Decides `subject` on a roll through the registry, as the roll pipeline does. */
export function decide(cfg: MachineConfig, subject: BetInstance, ctx: RollContext): Decision {
  return decideBet(subject, ctx, requireBet(cfg, subject.typeId))
}

/**
 * A decision as a short string: `win:return`, `win:stay`, `lose`, `push:bar`,
 * `push:offReturned`, `travel:6`, `none`. Tables compare these.
 */
export function outcome(decision: Decision): string {
  switch (decision.kind) {
    case 'win':
      return `win:${decision.stake}`
    case 'push':
      return `push:${decision.reason}`
    case 'travel':
      return `travel:${decision.number}`
    case 'progress':
      return `progress:${decision.progress}`
    case 'lose':
    case 'none':
      return decision.kind
  }
}

/**
 * Every roll whose outcome differs from `expected[total]`, as readable lines; an empty list means
 * the bet follows the table on all 36 rolls.
 */
export function mismatches(
  expected: Readonly<Record<number, string>>,
  actual: (dice: Dice) => string,
): string[] {
  return ALL_DICE.flatMap((dice) => {
    const want = expected[sumOf(dice)]
    const got = actual(dice)
    return got === want ? [] : [`${dice.d1}-${dice.d2}: expected ${want}, got ${got}`]
  })
}

/** Every one of the 36 rolls on which `actual` departs from `want`, as readable lines. */
export function departures(want: (dice: Dice) => string, actual: (dice: Dice) => string): string[] {
  return ALL_DICE.flatMap((dice) => {
    const [w, a] = [want(dice), actual(dice)]
    return w === a ? [] : [`${dice.d1}-${dice.d2}: expected ${w}, got ${a}`]
  })
}
