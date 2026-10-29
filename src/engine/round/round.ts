import type { PointNumber, Ruleset } from '../config/rulesets.ts'
import { TOTALS, makeRoll, totalOf, type Dice, type Total } from '../core/dice.ts'

/**
 * The round state machine (plan §4.3, rules spec §2.1): what each roll does to the come-out and
 * point cycle, and to the counters that bet placement windows and side bets read.
 *
 * - **Hand, not shooter.** The rules research calls a shooter's turn a *hand* (rules spec §0.1):
 *   every roll from the first come-out after a seven-out (or the session start) through the next
 *   seven-out, inclusive. The plan's `shooter` counters are `hand` here. A machine's cosmetic
 *   shooter button (`flow.shooter`) plays no part.
 * - **Before plus transition.** Bets decide against the round *before* a roll plus the transition
 *   that roll makes; `next` is the round the following bets are placed into.
 * - **Data, not variant.** The come-out is decided by the ruleset's lists (`/rules/naturals`,
 *   `/craps`, `/points`), never by the variant's name. The point phase is the same in every game.
 * - **Pure and JSON-safe.** Inputs are never changed, and states and transitions are plain objects
 *   of numbers and strings.
 */

/** The next roll is a come-out, or it is trying to repeat a point (puck ON). */
export type Phase =
  { readonly kind: 'comeOut' } | { readonly kind: 'point'; readonly point: PointNumber }

/**
 * The current hand (the plan's `shooter`). Masks use bit `1 << n` for number n (`totalBit`).
 */
export interface Hand {
  /** Hands finished before this one: 0 for the session's first hand. */
  readonly index: number
  /** Rolls in this hand so far, come-outs included: 0 until its first roll. */
  readonly rolls: number
  /** The points made in this hand, one bit each however often they are made. */
  readonly pointsMadeMask: number
}

/** Counted from the last 7 of any kind (or the session start), for side-bet windows. */
export interface SinceSeven {
  /** Rolls since the last 7: 0 right after any 7, which opens Lucky Roller's window. */
  readonly rolls: number
  /** The totals rolled since the last 7, one bit each; bit 7 is never set. */
  readonly totalsMask: number
}

export interface RoundState {
  readonly phase: Phase
  /** Rolls so far this session, which is also the 0-based index of the next roll. */
  readonly rollIndex: number
  readonly hand: Hand
  readonly sinceSeven: SinceSeven
}

/** What one roll did to the round. */
export type RoundTransition =
  /** A come-out total in `naturals`: 7, plus 11 in traditional. */
  | { readonly kind: 'natural'; readonly total: Total }
  /** A come-out total in `craps`: 2, 3 or 12 in traditional; crapless has none. */
  | { readonly kind: 'craps'; readonly total: Total }
  /** A come-out total in `points` became the point. */
  | { readonly kind: 'pointEstablished'; readonly point: PointNumber }
  /** The point was rolled again: back to the come-out, same hand. */
  | { readonly kind: 'pointMade'; readonly point: PointNumber }
  /**
   * A 7 while `point` was on. It ends the hand, and `endedHand` holds that hand's final counts,
   * the seven-out included: side bets that read the hand settle on these, before the reset.
   */
  | { readonly kind: 'sevenOut'; readonly point: PointNumber; readonly endedHand: Hand }
  /** A point-phase roll that is neither the point nor 7. */
  | { readonly kind: 'none' }

export interface RoundStep {
  /** The round after the roll. */
  readonly next: RoundState
  readonly transition: RoundTransition
}

const SEVEN = 7

const COME_OUT: Phase = Object.freeze({ kind: 'comeOut' })
const NONE: Extract<RoundTransition, { kind: 'none' }> = Object.freeze({ kind: 'none' })

/** The round at the session start: the first hand's come-out, nothing counted yet. */
export function initialRound(): RoundState {
  return {
    phase: COME_OUT,
    rollIndex: 0,
    hand: { index: 0, rolls: 0, pointsMadeMask: 0 },
    sinceSeven: { rolls: 0, totalsMask: 0 },
  }
}

/**
 * Applies one roll to the round (rules spec §2.1). Throws a `RangeError` for dice that are not two
 * faces from 1 to 6, for a point the ruleset does not have, and for a come-out total that is in
 * none of the ruleset's lists (which a compiled config rules out).
 *
 * | Phase | Roll | Transition | Next phase |
 * |---|---|---|---|
 * | come-out | in `naturals` | natural | come-out |
 * | come-out | in `craps` | craps | come-out |
 * | come-out | in `points` | pointEstablished | point |
 * | point p | p | pointMade | come-out |
 * | point p | 7 | sevenOut | come-out, next hand |
 * | point p | other | none | point p |
 *
 * Every roll counts toward its hand, the seven-out included; the seven-out then starts the next
 * hand from zero. Any 7, on the come-out too, resets `sinceSeven`.
 */
export function advanceRound(r: RoundState, dice: Dice, rules: Ruleset): RoundStep {
  const total = totalOf(makeRoll(dice.d1, dice.d2))
  const outcome = decide(r.phase, total, rules)
  const counted: Hand = {
    index: r.hand.index,
    rolls: r.hand.rolls + 1,
    pointsMadeMask:
      outcome.kind === 'pointMade'
        ? r.hand.pointsMadeMask | totalBit(outcome.point)
        : r.hand.pointsMadeMask,
  }
  const sinceSeven: SinceSeven =
    total === SEVEN
      ? { rolls: 0, totalsMask: 0 }
      : { rolls: r.sinceSeven.rolls + 1, totalsMask: r.sinceSeven.totalsMask | totalBit(total) }
  const base = { rollIndex: r.rollIndex + 1, sinceSeven }
  switch (outcome.kind) {
    case 'sevenOut':
      return {
        next: {
          ...base,
          phase: COME_OUT,
          hand: { index: counted.index + 1, rolls: 0, pointsMadeMask: 0 },
        },
        transition: { ...outcome, endedHand: counted },
      }
    case 'pointEstablished':
      return {
        next: { ...base, phase: { kind: 'point', point: outcome.point }, hand: counted },
        transition: outcome,
      }
    case 'none':
      return { next: { ...base, phase: r.phase, hand: counted }, transition: outcome }
    case 'natural':
    case 'craps':
    case 'pointMade':
      return { next: { ...base, phase: COME_OUT, hand: counted }, transition: outcome }
  }
}

/** The bit for number `total` in a round mask. */
export function totalBit(total: Total): number {
  return 1 << total
}

/** The totals whose bits are set in `mask`, ascending. */
export function totalsInMask(mask: number): Total[] {
  return TOTALS.filter((total) => (mask & totalBit(total)) !== 0)
}

/** A transition before the seven-out's hand counts are attached. */
type Outcome =
  | Exclude<RoundTransition, { readonly kind: 'sevenOut' }>
  | { readonly kind: 'sevenOut'; readonly point: PointNumber }

function decide(phase: Phase, total: Total, rules: Ruleset): Outcome {
  switch (phase.kind) {
    case 'comeOut': {
      if (rules.naturals.includes(total)) return { kind: 'natural', total }
      if (rules.craps.includes(total)) return { kind: 'craps', total }
      const point = rules.points.find((p) => p === total)
      if (point !== undefined) return { kind: 'pointEstablished', point }
      throw new RangeError(`The come-out total ${total} is in none of the ruleset's lists`)
    }
    case 'point': {
      const { point } = phase
      if (!rules.points.includes(point)) {
        const points = rules.points.join(', ')
        throw new RangeError(`${point} is not a point in ${rules.variant} craps (${points})`)
      }
      if (total === point) return { kind: 'pointMade', point }
      if (total === SEVEN) return { kind: 'sevenOut', point }
      return NONE
    }
  }
}
