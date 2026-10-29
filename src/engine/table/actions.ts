import type { PointNumber } from '../config/rulesets.ts'
import type { Dice } from '../core/dice.ts'
import type { Cents } from '../core/money.ts'
import type { BetId } from '../bets/types.ts'

/**
 * What a player (or a test) can do at the table (plan §4.9). Actions are plain JSON: the session
 * log stores them, and replay feeds them back through `applyAction`.
 *
 * - `place`: bet `amount` more on a type. If the player already has that bet (the same type,
 *   number and parent; a line bet's own spot), this adds to it.
 * - `setAmount`: press or reduce a bet to `amount`; 0 takes it down, with any odds on it.
 * - `setWorking`: switch one bet ON or OFF, or back to its default (null).
 * - `setGlobalWorking`: the machine's BETS ON/OFF button; null goes back to the defaults.
 * - `batch`: several actions that succeed or fail together (repeat, one-tap switches).
 * - `roll`: roll the dice. `dice` is for tests and e2e builds only, and is logged as scripted.
 */
export type Action =
  | PlaceAction
  | SetAmountAction
  | SetWorkingAction
  | SetGlobalWorkingAction
  | DepositAction
  | BatchAction
  | RollAction

export interface PlaceAction {
  readonly type: 'place'
  readonly typeId: string
  readonly number?: PointNumber
  readonly parentId?: BetId
  readonly amount: Cents
}

export interface SetAmountAction {
  readonly type: 'setAmount'
  readonly betId: BetId
  readonly amount: Cents
}

export interface SetWorkingAction {
  readonly type: 'setWorking'
  readonly betId: BetId
  readonly working: boolean | null
}

export interface SetGlobalWorkingAction {
  readonly type: 'setGlobalWorking'
  readonly off: boolean | null
}

export interface DepositAction {
  readonly type: 'deposit'
  readonly amount: Cents
}

export interface BatchAction {
  readonly type: 'batch'
  readonly actions: readonly Action[]
}

export interface RollAction {
  readonly type: 'roll'
  readonly dice?: Dice
}
