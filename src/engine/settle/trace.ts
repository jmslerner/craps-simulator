import type { PointNumber } from '../config/rulesets.ts'
import type { Cents, Rounding } from '../core/money.ts'
import type { BetId, PushReason } from '../bets/types.ts'

/**
 * Where a settled bet's stake goes: back to the player's credit, left up on the layout for the
 * next decision, or to the house.
 */
export type StakeDisposition = 'returned' | 'stays' | 'lost'

/**
 * The full working of one settlement (plan §4.7), for recaps, drills and tests: what the stake won
 * exactly, what the machine paid after rounding, the commission, and what reached the player's
 * credit. One trace per decided bet per roll.
 *
 * `M` is the type of the money amounts that can be fractional. A table settles in `rounded` mode,
 * where they are whole `Cents` and the trace is plain JSON. The exact solver settles in `exact`
 * mode, with `M = Fraction` and no rounding anywhere.
 *
 * - `winExact`: stake × ratio in cents, as a fraction ("1750/3"), whatever the mode.
 * - `breakage`: `winExact − winPaid`, the part of the exact win the rounding kept ("1/3").
 * - `credited`: the money moved to the player's credit, `(stake if returned) + winPaid − vigOnWin
 *   − vigRearm`. A loss credits 0; odds returned while OFF credit their stake.
 */
export interface SettlementTrace<M = Cents> {
  readonly betId: BetId
  readonly typeId: string
  readonly number: PointNumber | null
  readonly outcome: 'win' | 'lose' | 'push'
  /** Why a push pushed; null for a win or a loss. */
  readonly pushReason: PushReason | null
  readonly stake: Cents
  /** The pay entry a win was paid at; null unless the bet won. */
  readonly payKey: string | null
  /** The ratio a win was paid at, as the machine writes it ("6:1", "9 to 5"); '' unless it won. */
  readonly ratioLabel: string
  readonly winExact: string
  readonly winPaid: M
  /** The rounding applied to the win; null in exact mode or when nothing was won. */
  readonly rounding: Rounding | null
  readonly breakage: string
  /** Commission taken from the win. */
  readonly vigOnWin: M
  /**
   * Up-front commission collected again from the win of a bet that stays up: as much of the vig
   * due as the win covers. The roll charges the rest to credit (`vigCharged`, `from: 'credit'`),
   * or takes the bet down when credit cannot pay it (`settle/commission.ts`, `rearmAfterWin`).
   */
  readonly vigRearm: M
  readonly credited: M
  readonly stakeDisposition: StakeDisposition
}
