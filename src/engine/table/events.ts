import type { PointNumber } from '../config/rulesets.ts'
import type { Dice, Total } from '../core/dice.ts'
import type { Cents } from '../core/money.ts'
import type { Hand } from '../round/round.ts'
import type { BetId, BetInstance } from '../bets/types.ts'
import type { SettlementTrace } from '../settle/trace.ts'

/**
 * What an action did, in order, for the UI, the recap and the coach (plan §4.9). Events describe
 * changes the new state already holds; nothing replays them. Some are emitted only by later
 * milestones: commission (`vigCharged`, `vigRefunded`) by buy and lay, `betProgress` by the side
 * bets.
 *
 * A roll emits `diceRolled`, then the round's own event (`natural`, `crapsOut`,
 * `pointEstablished`, `pointMade` or `sevenOut`; nothing for a point-phase roll that misses), then
 * one `betResolved`, `betTraveled` or `betProgress` per bet the roll decided, in settlement order.
 * Once every bet is settled, each buy or lay that won and stays up has its commission re-collected,
 * in the same order: a `vigCharged` (`rearm`) (two of them, from the win and from credit, when the
 * win did not cover it all), or, when the credit the roll left could not pay, a `vigRefunded` of
 * what the win paid toward it, if anything, and a `betRemoved` (`vigDeclined`). Then `newShooter`
 * after a seven-out. The machine's own post-roll switches (lays back ON, Interblock's
 * after-seven-out OFF ending at the point) come last, as `workingChanged` with `by` set.
 */
export type GameEvent =
  | BetPlaced
  | BetAdjusted
  | BetRemoved
  | WorkingChanged
  | VigCharged
  | VigRefunded
  | DiceRolled
  | Natural
  | CrapsOut
  | PointEstablished
  | PointMade
  | SevenOut
  | NewShooter
  | BetResolved
  | BetTraveled
  | BetProgress
  | Deposited

/** A new bet, as placed. */
export interface BetPlaced {
  readonly type: 'betPlaced'
  readonly bet: BetInstance
}

/** A bet pressed or reduced. */
export interface BetAdjusted {
  readonly type: 'betAdjusted'
  readonly betId: BetId
  readonly from: Cents
  readonly to: Cents
}

/**
 * A bet taken down by the player, its amount back to credit. `withParent`: odds that came down
 * because the line bet they back was taken down. `vigDeclined`: a winner that was to stay up, taken
 * down by the machine because the credit its roll left could not pay its re-collected commission
 * (M4b; judged after all of the roll's settlements).
 */
export interface BetRemoved {
  readonly type: 'betRemoved'
  readonly betId: BetId
  readonly typeId: string
  readonly amount: Cents
  readonly reason: 'takenDown' | 'withParent' | 'vigDeclined'
}

/**
 * One bet (`scope: 'bet'`) or the whole layout (`scope: 'global'`) switched ON or OFF. The player
 * makes these, except where `by` names the machine rule that switched a bet (M4b): `layAutoOn`
 * (Interblock lays back ON after a point is made or a 7) or `afterSevenOut` (Interblock's
 * after-seven-out hold ending when the point is established, where `until: pointEstablished`: the
 * bet goes back to its own setting and defaults, `working: null`). The hold itself starts with the
 * bet (`TableState.heldOff`, `workingStatus` source `afterSevenOut`), and a global press that sets
 * bets ON ends it.
 */
export type WorkingChanged =
  | {
      readonly type: 'workingChanged'
      readonly scope: 'bet'
      readonly betId: BetId
      readonly working: boolean | null
      readonly by?: 'layAutoOn' | 'afterSevenOut'
    }
  | { readonly type: 'workingChanged'; readonly scope: 'global'; readonly off: boolean | null }

/**
 * Commission charged (M4b): on placement or an increase, from credit; or re-collected from a winner
 * that stays up (`rearm`), either from the win (`from: 'win'`: the settlement's `vigRearm` already
 * holds it, so this only announces it) or from credit (`from: 'credit'`).
 */
export interface VigCharged {
  readonly type: 'vigCharged'
  readonly betId: BetId
  readonly amount: Cents
  readonly reason: 'placement' | 'increase' | 'rearm'
  /** Where a `rearm` came from; placement and increases always come from credit. */
  readonly from?: 'win' | 'credit'
}

/**
 * Up-front commission refunded on a take-down or a cut (M4b), or what a win paid toward a
 * re-collection that credit could not complete, when the bet comes down instead (M4d).
 */
export interface VigRefunded {
  readonly type: 'vigRefunded'
  readonly betId: BetId
  readonly amount: Cents
}

export interface DiceRolled {
  readonly type: 'diceRolled'
  readonly dice: Dice
  readonly total: Total
  /** Dice given by a test or an e2e build rather than drawn from the RNG. */
  readonly scripted: boolean
  /** The roll's 0-based index in the session. */
  readonly rollIndex: number
}

/** A come-out total in the ruleset's naturals: 7, and 11 in traditional craps. */
export interface Natural {
  readonly type: 'natural'
  readonly total: Total
}

/** A come-out total in the ruleset's craps: 2, 3 or 12 in traditional craps; crapless has none. */
export interface CrapsOut {
  readonly type: 'crapsOut'
  readonly total: Total
}

export interface PointEstablished {
  readonly type: 'pointEstablished'
  readonly point: PointNumber
}

export interface PointMade {
  readonly type: 'pointMade'
  readonly point: PointNumber
}

/** A 7 with the point on. `endedHand` holds the hand's final counts, the seven-out included. */
export interface SevenOut {
  readonly type: 'sevenOut'
  readonly point: PointNumber
  readonly endedHand: Hand
}

/**
 * A new hand begins after a seven-out. The plan calls it a new shooter; on a heads-up machine the
 * player shoots again, and side bets key on the hand (rules spec §0.1).
 */
export interface NewShooter {
  readonly type: 'newShooter'
  readonly handIndex: number
}

/** A bet won, lost or pushed; `trace` is the full settlement. */
export interface BetResolved {
  readonly type: 'betResolved'
  readonly trace: SettlementTrace
}

/** A come or don't come bet (or a line bet on the come-out) moved to its number. */
export interface BetTraveled {
  readonly type: 'betTraveled'
  readonly betId: BetId
  readonly typeId: string
  readonly number: PointNumber
}

/** A side bet's progress changed (M11). */
export interface BetProgress {
  readonly type: 'betProgress'
  readonly betId: BetId
  readonly progress: number
}

export interface Deposited {
  readonly type: 'deposited'
  readonly amount: Cents
}
