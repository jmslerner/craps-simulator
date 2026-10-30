import type {
  CompiledBetType,
  CompiledSideBet,
  CompositeBet,
  MachineConfig,
} from '../config/compile.ts'
import type { Ratio } from '../config/ratio.ts'
import type { PointKey, PointNumber, Ruleset } from '../config/rulesets.ts'
import type { Dice, Total } from '../core/dice.ts'
import type { Cents, Rounding } from '../core/money.ts'
import type { Fraction } from '../core/rational.ts'
import type { Phase, RoundState, RoundTransition } from '../round/round.ts'
import type { TableState } from '../table/state.ts'

/**
 * Bets on the table, the decisions a roll makes about them, and the interface every bet family
 * implements (plan §4.5, rules spec §2.2–§2.3). A family is the code for one kind of bet: line
 * bets, odds, number bets, hardways, one-roll bets, composites and the side bets. The roll
 * pipeline (`table/roll.ts`), the validator and the exact solver all reach a bet's rules only
 * through its family, found by `registry.ts`.
 */

/** A bet's id: `b1`, `b2`, … in placement order, so replays reproduce them. */
export type BetId = string & { readonly __brand: 'BetId' }

/** The id of the `seq`th bet placed in a session. */
export function betId(seq: number): BetId {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new RangeError(`Bad bet sequence: ${seq}`)
  return `b${seq}` as BetId
}

/** The placement sequence number in a bet id; NaN for anything that is not one. */
export function betSeq(id: string): number {
  return /^b[1-9]\d*$/.test(id) ? Number(id.slice(1)) : Number.NaN
}

/**
 * One bet on the table. Plain JSON, so table states can be hashed, stored and replayed.
 *
 * - `number`: the number the bet is on. For a line bet that is its own point: null while it waits
 *   on the line or in the come box, and N once it has travelled to N. For odds it is the parent's
 *   number. Bets with no number (one-roll bets) keep null.
 * - `working`: the player's own ON/OFF for this bet, null to follow the global button and the
 *   machine's defaults (`bets/working.ts` decides what actually works).
 * - `placedAtRoll`: the round's `rollIndex` when the bet was placed, which is the index of the first
 *   roll it faces. A bet with `placedAtRoll` below the round's `rollIndex` was carried over from an
 *   earlier betting window.
 */
export interface BetInstance {
  readonly id: BetId
  readonly typeId: string
  readonly number: PointNumber | null
  /** For odds: the line bet they back. Null for every other bet. */
  readonly parentId: BetId | null
  readonly amount: Cents
  /** Commission paid up front and still held, for a refund on take-down (M4b). */
  readonly vigHeld: Cents
  readonly working: boolean | null
  /**
   * A side bet's progress (M11), in its family's own encoding: Lucky Roller's mask of target
   * totals rolled and the Fire Bet's mask of points made (`totalBit`), the Hot Shooter's rolls
   * counted, the Lucky Shooter's point and hits (`pointRunProgress`). 0 for every other bet.
   */
  readonly progress: number
  readonly placedAtRoll: number
}

/**
 * The main game's bet types: the catalog's types, and the composites (C&E, horn, world, horn high),
 * each one bet whose type id is the composite's id (plan §0 #15). These are the types the exact
 * solver prices (`resolveType` in `registry.ts`).
 */
export type MainBetType = CompiledBetType | CompositeBet

/**
 * Every bet type a family can handle: the main game's types and the side bets (M11), each resolved
 * in `registry.ts` (`resolveBet`).
 */
export type BetType = MainBetType | CompiledSideBet

/** The family names, in roll and settlement order (plan §4.8 step 3; `registry.ts`). */
export type FamilyKey = BetType['family']

/**
 * Why a bet pushed: a push that leaves the bet up (`bar`: a don't bet's barred come-out total, or
 * the Lucky Shooter's come-out 7 or 11), odds that were OFF when their parent was decided
 * (`offReturned`), or a settlement that nets exactly 0 (`zeroNet`: a composite whose parts net 0,
 * the world bet on a 7, or a side-bet tier that pays "1 for 1", the Hot Shooter at 8 to 15 rolls).
 */
export type PushReason = 'bar' | 'offReturned' | 'zeroNet'

/**
 * What one roll does to one bet (plan §4.5). A decision never depends on the bet's amount.
 *
 * - `progress`: a side bet moved on without being decided; `progress` replaces the bet's own.
 * - `travel`: a come or don't come bet in its box (or a line bet before the come-out) moves to N.
 * - `win`: `payKey` names the pay the bet wins at (`payout()` turns it into a ratio); `stake` says
 *   whether the stake comes back (`return`) or stays up for the next decision (`stay`).
 * - `push`: no money changes hands. A `bar` push leaves the bet where it is; an `offReturned` push
 *   gives the stake back and takes the bet down. A `zeroNet` push (a composite that nets 0, a side
 *   bet's 1-for-1 tier) does with its stake what a win would: `stake` says whether it comes back or
 *   stays up.
 */
export type Decision =
  | { readonly kind: 'none' }
  | { readonly kind: 'progress'; readonly progress: number }
  | { readonly kind: 'travel'; readonly number: PointNumber }
  | { readonly kind: 'win'; readonly payKey: string; readonly stake: 'return' | 'stay' }
  | { readonly kind: 'lose' }
  | { readonly kind: 'push'; readonly reason: 'bar' | 'offReturned' }
  | { readonly kind: 'push'; readonly reason: 'zeroNet'; readonly stake: 'return' | 'stay' }

export type WinDecision = Extract<Decision, { kind: 'win' }>

/** A decision that settles money: a win, a loss or a push. */
export type Settled = Extract<Decision, { kind: 'win' | 'lose' | 'push' }>

export const NO_DECISION: Decision = Object.freeze({ kind: 'none' })

export function isSettled(decision: Decision): decision is Settled {
  return decision.kind === 'win' || decision.kind === 'lose' || decision.kind === 'push'
}

/**
 * Everything a family may read when it decides a bet. Bets decide against the round *before* the
 * roll plus the transition the roll makes (rules spec §2.3 step 3), never against other bets'
 * results, except that odds receive their parent's decision.
 */
export interface RollContext {
  readonly dice: Dice
  readonly total: Total
  readonly isPair: boolean
  readonly before: RoundState
  readonly transition: RoundTransition
  readonly rules: Ruleset
  readonly cfg: MachineConfig
  /** Whether the bet works on this roll (`effectiveWorking`). */
  readonly working: boolean
  /** Odds only: their parent's decision on this roll. Null for every other bet. */
  readonly parentDecision: Decision | null
}

/**
 * Rejection codes (plan §4.6). The validator's order decides which code a bad action gets.
 * `BELOW_MIN_TOTAL` is the roll-time minimum for the round (`/limits/minTotal`, rules spec §2.3
 * step 9, §2.5; Interblock's "BETS ARE NOT VALID YET! – Must bet N credits more!"), which the
 * plan's list predates (plan §0 #7, #12).
 */
export const REJECTION_CODES = [
  'NOT_OFFERED',
  'BAD_PARAMS',
  'WRONG_PHASE',
  'WINDOW_CLOSED',
  'BELOW_MIN',
  'ABOVE_MAX',
  'BAD_INCREMENT',
  'TABLE_MAX',
  'INSUFFICIENT_CREDIT',
  'CONTRACT_BET',
  'NO_PARENT',
  'PARENT_NOT_ON_POINT',
  'ODDS_LIMIT',
  'EXCLUSIVE_CONFLICT',
  'BET_NOT_FOUND',
  'NOT_TOGGLEABLE',
  'BELOW_MIN_TOTAL',
] as const

export type RejectionCode = (typeof REJECTION_CODES)[number]

/** Why an action was refused. `details` is plain JSON for the UI and the coach. */
export interface Rejection {
  readonly code: RejectionCode
  readonly details: Readonly<Record<string, string | number>>
}

export function reject(
  code: RejectionCode,
  details: Readonly<Record<string, string | number>> = {},
): Rejection {
  return { code, details }
}

/** Which changes a bet allows now; the validator turns a refused change into `CONTRACT_BET`. */
export interface Mutability {
  readonly increase: boolean
  readonly decrease: boolean
  readonly remove: boolean
  /** Whether the family lets a player switch it ON and OFF; the config must allow it too. */
  readonly toggle: boolean
}

/** A `place` action as a family sees it, before limits and credit are checked. */
export interface PlaceRequest<T extends BetType> {
  readonly state: TableState
  readonly cfg: MachineConfig
  readonly type: T
  /** The number the action names, if any. */
  readonly number: PointNumber | null
  /** The parent the action names, if any (odds). */
  readonly parentId: BetId | null
}

/** Where a `place` action lands: the bet it adds to, or the number and parent a new bet takes. */
export interface Located {
  readonly existing: BetInstance | null
  readonly number: PointNumber | null
  readonly parentId: BetId | null
}

/** A bet as it would be after an action, for the family's own checks (validation step 4). */
export interface PlaceCheck<T extends BetType> {
  readonly state: TableState
  readonly cfg: MachineConfig
  readonly type: T
  readonly bet: BetInstance
}

/** The settlement mode's rounding: `roundCents` as a fraction, or the identity in exact mode. */
export type RoundFn = (exact: Fraction, rounding: Rounding) => Fraction

/** Commission taken when a bet wins (M4b): from the win, and re-collected when it stays up. */
export interface WinCommission {
  readonly onWin: Fraction
  readonly rearm: Fraction
}

/** Commission moved when a bet's amount changes (M4b): charged on an increase, refunded on a cut. */
export interface VigChange {
  readonly charge: Cents
  readonly refund: Cents
}

/**
 * The rules of one family of bets (plan §4.5). `T` is the compiled bet type it handles.
 *
 * - `projection`: whether the exact solver must track the round's phase and point for this bet.
 * - `toggleable`: false for bets that always work (line flats, come points, one-roll bets).
 * - `decidesWhenOff`: whether `decide` runs while the bet is OFF. Only odds need it: they are
 *   returned when their parent is decided while they are OFF. Every other family gets `none`.
 * - `locate`: where a `place` action lands (validation steps 1–2: parameters, phase and window).
 * - `canPlace`: the family's own checks on the bet as it would be (step 4: parents, odds caps).
 * - `decide` is pure and never reads money; `apply` returns the bet after the decision, or null
 *   when it comes down.
 * - `payout`: the ratio a win at `payKey` pays.
 * - `configPaths`: every JSON pointer the bet's math reads, for "assumed" chips and the
 *   config-path invariance property. `/money/payoutRounding` is listed when the type has no rounding
 *   of its own.
 * - `vigOnChange`, `winCommission`: commission hooks for buy and lay (M4b). A family without them
 *   charges none.
 * - `blocksRebet`: whether changing `bet` to `to` stops its type being bet again until the next
 *   come-out (`rebetAfterRemove: nextCycle`).
 * - `invariants`: the family's own checks on a bet in a table state, as messages (none when it is
 *   sound); `table/invariants.ts` adds them to the generic ones.
 */
export interface BetFamily<T extends BetType> {
  readonly projection: 'none' | 'round'
  readonly toggleable: boolean
  readonly decidesWhenOff: boolean
  locate(req: PlaceRequest<T>): Located | Rejection
  canPlace(check: PlaceCheck<T>): Rejection | null
  mutability(bet: BetInstance, state: TableState, type: T, cfg: MachineConfig): Mutability
  defaultWorking(phase: Phase, type: T, cfg: MachineConfig): boolean
  decide(bet: BetInstance, ctx: RollContext, type: T): Decision
  apply(bet: BetInstance, decision: Decision, ctx: RollContext, type: T): BetInstance | null
  payout(type: T, payKey: string): Ratio
  configPaths(type: T, number: PointNumber | null, cfg: MachineConfig): readonly string[]
  vigOnChange?(bet: BetInstance, to: Cents, type: T, cfg: MachineConfig): VigChange
  winCommission?(
    bet: BetInstance,
    decision: WinDecision,
    win: Fraction,
    type: T,
    round: RoundFn,
  ): WinCommission
  blocksRebet?(bet: BetInstance, to: Cents, type: T): boolean
  invariants?(bet: BetInstance, state: TableState, type: T, cfg: MachineConfig): string[]
}

/** Tells a rejection from the result an operation returns when it succeeds. */
export function isRejection<T extends object>(value: T | Rejection): value is Rejection {
  return 'code' in value
}

/**
 * The rounding that applies to the winnings of a bet of `type` on `number` (rules spec §4.1,
 * §4.2): a number bet's own rounding on that number (`/catalog/<t>/payoutRoundingByNumber/<n>`;
 * Shoot To Win rounds place 6/8 up), else the type's `payoutRounding`, which is the config's
 * `/money/payoutRounding` when the type sets none. Settlement, a lay's commission base and the
 * exact solver all round winnings through this one function.
 */
export function payoutRoundingFor(type: BetType, number: PointNumber | null): Rounding {
  if (type.family === 'numberVsSeven' && number !== null) {
    return type.payoutRoundingByNumber.get(number) ?? type.payoutRounding
  }
  return type.payoutRounding
}

/**
 * The pointer of the rounding that applies to the winnings of a bet of `typeId` on `number`
 * (`payoutRoundingFor`): its per-number rounding, its own `payoutRounding`, or the config's
 * `/money/payoutRounding` when it has neither. With no number, the type's own or the config's. A
 * composite rounds like its parts, which validation makes agree, so it answers for its first part.
 */
export function roundingPointer(
  cfg: MachineConfig,
  typeId: string,
  number: PointNumber | null = null,
): string {
  const id = cfg.composites.get(typeId)?.parts[0]?.typeId ?? typeId
  const input = cfg.input.catalog[id]
  if (input?.family === 'numberVsSeven' && number !== null) {
    const key = String(number) as PointKey
    if (input.payoutRoundingByNumber?.[key] !== undefined) {
      return `/catalog/${id}/payoutRoundingByNumber/${key}`
    }
  }
  return input?.payoutRounding === undefined
    ? '/money/payoutRounding'
    : `/catalog/${id}/payoutRounding`
}
