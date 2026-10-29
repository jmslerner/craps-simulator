import type { MachineConfig } from '../config/compile.ts'
import { isPointNumber, type PointNumber } from '../config/rulesets.ts'
import { cents, type Cents } from '../core/money.ts'
import type {
  DepositAction,
  PlaceAction,
  RollAction,
  SetAmountAction,
  SetGlobalWorkingAction,
  SetWorkingAction,
} from '../table/actions.ts'
import { findBet, oddsOf, type TableState } from '../table/state.ts'
import {
  availableCredit,
  checkAmount,
  checkLedgerRoom,
  checkMinTotal,
  checkRollLimits,
  checkTableMax,
  depositRoom,
  maxOdds,
  typeLimits,
} from './limits.ts'
import { EXCLUSIONS, ROLL_CHECKS, startsOff } from './policies.ts'
import { resolveType, type ResolvedType } from './registry.ts'
import {
  betId,
  isRejection,
  reject,
  type BetInstance,
  type Rejection,
  type VigChange,
} from './types.ts'
import { canToggle, effectiveWorking } from './working.ts'

/**
 * Action validation (plan §4.6). A `place` is checked in this order, and the first failure is the
 * rejection:
 *
 * 1. The type is offered (and implemented), and the parameters are valid.
 * 2. Phase and window: the family's `locate` (pass on the come-out unless put bets are allowed,
 *    come with a point on, no re-bet of a don't type until the next come-out).
 * 3. Limits and increments on the bet's new total (the increment on its number where the type sets
 *    one: `typeLimits`), then the table maximum.
 * 4. The family's own checks (`canPlace`): odds need a parent on a number, within the cap.
 * 5. Credit covers the increase, plus any up-front commission.
 * 6. Exclusive groups and the machine's exclusions, for a new bet and for an addition alike: no
 *    money goes on a spot that a bet now up excludes. Only Interblock's `excludeLineVsLayBuy` can
 *    leave a bet up beside one it excludes, when the dice take a pass or don't pass bet to the
 *    number of a lay or buy already up; the player may then no longer wager on that lay or buy
 *    (IB221: the setting "will prevent the player from wagering on the Buy bet of the established
 *    Point"), though it may be cut or taken down. A `place` on a bet already up needs no
 *    mutability check: `locate` lands it only on a bet that may grow. A pass bet on its point is
 *    out of its window (`WRONG_PHASE`) unless put bets are allowed, when it may grow; every other
 *    bet a `place` reaches (a line bet before its first roll, odds, number bets, hardways, one-roll
 *    bets and composites) may always grow. M11's locked side bets will need the check back.
 *
 * A `setAmount` checks the bet's mutability right after its parameters, so a contract bet answers
 * `CONTRACT_BET` to every change, whatever the amount (plan §9 item 6); then the re-bet window (an
 * increase of a type blocked until the next come-out), limits, the odds caps, credit and, for an
 * increase, exclusivity as above.
 *
 * Malformed or extreme actions are refused, never thrown (plan §4.6): amounts are whole, safe
 * cents, and an addition is checked before it is summed, so no total leaves that range; a deposit,
 * or a roll's largest possible payout, may not carry the ledger past it (`ABOVE_MAX`, `scope:
 * 'ledger'`); scripted dice must be an object with two faces from 1 to 6.
 *
 * Validators never change anything. A valid `place` or `setAmount` comes back as a `BetChange` for
 * the reducer to apply.
 */

/** A valid change to one bet: the reducer applies exactly this. */
export interface BetChange {
  readonly resolved: ResolvedType
  /** The bet before the change; null for a new bet. */
  readonly before: BetInstance | null
  /** The bet after it; an amount of 0 takes it down. */
  readonly after: BetInstance
  /** Odds that come down with it when it is taken down. */
  readonly children: readonly BetInstance[]
  /** Commission charged or refunded by the change (M4b). */
  readonly vig: VigChange
  /** Whether the change stops the type being bet again until the next come-out. */
  readonly blocksRebet: boolean
  /**
   * Whether the machine holds the new bet OFF (`TableState.heldOff`): Interblock's place and buy
   * bets placed right after a seven-out (`startsOff`).
   */
  readonly heldOff: boolean
}

const NO_VIG: VigChange = Object.freeze({ charge: cents(0), refund: cents(0) })

export function validatePlace(
  state: TableState,
  action: PlaceAction,
  cfg: MachineConfig,
): BetChange | Rejection {
  // 1. Offered, and the parameters are valid.
  const resolved = resolveType(cfg, action.typeId)
  if (resolved === null) return reject('NOT_OFFERED', { typeId: String(action.typeId) })
  const { family, type } = resolved
  const at = { typeId: type.typeId }
  if (!isWholeCents(action.amount, 1)) return reject('BAD_PARAMS', { ...at, field: 'amount' })
  if (action.number !== undefined && !isPointNumber(action.number)) {
    return reject('BAD_PARAMS', { ...at, field: 'number' })
  }
  if (action.parentId !== undefined && typeof action.parentId !== 'string') {
    return reject('BAD_PARAMS', { ...at, field: 'parentId' })
  }
  // 2. Phase and window, which also find where the bet lands.
  const located = family.locate({
    state,
    cfg,
    type,
    number: action.number ?? null,
    parentId: action.parentId ?? null,
  })
  if (isRejection(located)) return located
  const before = located.existing
  // 3. Limits and increments. A total past the safe-integer range is above any maximum, so it is
  // refused before it is formed.
  const limits = typeLimits(cfg, type.typeId, located.number)
  const held = before?.amount ?? 0
  if (!Number.isSafeInteger(held + action.amount)) {
    return reject('ABOVE_MAX', { ...at, held, added: action.amount, max: limits.max })
  }
  const amount = cents(held + action.amount)
  const over = checkAmount(amount, limits, type.typeId) ?? checkTableMax(state, action.amount, cfg)
  if (over !== null) return over
  const after: BetInstance =
    before === null
      ? {
          id: betId(state.nextBetSeq),
          typeId: type.typeId,
          number: located.number,
          parentId: located.parentId,
          amount,
          vigHeld: cents(0),
          working: null,
          progress: 0,
          placedAtRoll: state.round.rollIndex,
        }
      : { ...before, amount }
  // 4. The family's own checks.
  const own = family.canPlace({ state, cfg, type, bet: after })
  if (own !== null) return own
  // 5. Credit.
  const vig = family.vigOnChange?.(before ?? { ...after, amount: cents(0) }, amount, type, cfg)
  const short = creditShortfall(state, action.amount, vig ?? NO_VIG)
  if (short !== null) return short
  // 6. Exclusivity, for a new bet or an addition (M6 reconciliation: additions were let through).
  const clash = exclusiveConflict(state, type.typeId, after.number, cfg)
  if (clash !== null) return clash
  return {
    resolved,
    before,
    after,
    children: [],
    vig: vig ?? NO_VIG,
    blocksRebet: false,
    // Interblock holds new place and buy bets OFF right after a seven-out (M4b).
    heldOff: before === null && startsOff(state, type.typeId, cfg),
  }
}

export function validateSetAmount(
  state: TableState,
  action: SetAmountAction,
  cfg: MachineConfig,
): BetChange | Rejection {
  const bet = findBet(state, action.betId)
  if (bet === undefined) return reject('BET_NOT_FOUND', { betId: String(action.betId) })
  const at = { typeId: bet.typeId, betId: bet.id }
  if (!isWholeCents(action.amount, 0)) return reject('BAD_PARAMS', { ...at, field: 'amount' })
  const resolved = resolveType(cfg, bet.typeId)
  if (resolved === null) return reject('NOT_OFFERED', at)
  const { family, type } = resolved
  const to = action.amount
  const after = { ...bet, amount: to }
  const unchanged = {
    resolved,
    before: bet,
    after,
    children: [],
    vig: NO_VIG,
    blocksRebet: false,
    heldOff: false,
  }
  if (to === bet.amount) return unchanged
  const change = to === 0 ? 'remove' : to > bet.amount ? 'increase' : 'decrease'
  if (!family.mutability(bet, state, type, cfg)[change]) {
    return reject('CONTRACT_BET', { ...at, change })
  }
  // Pressing a bet of a type that cannot be bet again until the next come-out (step 2's window).
  if (change === 'increase' && state.rebetBlocked.includes(bet.typeId)) {
    return reject('WINDOW_CLOSED', { ...at, reason: 'rebetAfterRemove', until: 'nextComeOut' })
  }
  if (to > 0) {
    const limits =
      checkAmount(to, typeLimits(cfg, bet.typeId, bet.number), bet.typeId) ??
      checkTableMax(state, to - bet.amount, cfg)
    if (limits !== null) return limits
    const own = family.canPlace({ state, cfg, type, bet: after })
    if (own !== null) return own
    // The odds on a line bet must still fit under its cap once the line bet is cut.
    const max = maxOdds(after, cfg)
    const over = oddsOf(state, bet.id).find((odds) => odds.amount > max)
    if (over !== undefined) {
      return reject('ODDS_LIMIT', { typeId: over.typeId, betId: over.id, amount: over.amount, max })
    }
  }
  const vig = family.vigOnChange?.(bet, to, type, cfg) ?? NO_VIG
  const short = creditShortfall(state, to - bet.amount, vig)
  if (short !== null) return short
  // More money on a spot that a bet now up excludes (step 6 of `validatePlace`).
  if (change === 'increase') {
    const clash = exclusiveConflict(state, bet.typeId, bet.number, cfg)
    if (clash !== null) return clash
  }
  return {
    ...unchanged,
    children: to === 0 ? oddsOf(state, bet.id) : [],
    vig,
    blocksRebet: family.blocksRebet?.(bet, to, type) ?? false,
  }
}

export function validateSetWorking(
  state: TableState,
  action: SetWorkingAction,
  cfg: MachineConfig,
): Rejection | null {
  const bet = findBet(state, action.betId)
  if (bet === undefined) return reject('BET_NOT_FOUND', { betId: String(action.betId) })
  if (!isWorkingSetting(action.working)) {
    return reject('BAD_PARAMS', { betId: bet.id, field: 'working' })
  }
  return canToggle(bet, state, cfg)
    ? null
    : reject('NOT_TOGGLEABLE', { typeId: bet.typeId, betId: bet.id, scope: 'bet' })
}

export function validateSetGlobalWorking(
  action: SetGlobalWorkingAction,
  cfg: MachineConfig,
): Rejection | null {
  if (!isWorkingSetting(action.off)) return reject('BAD_PARAMS', { field: 'off' })
  return cfg.working.toggle.global ? null : reject('NOT_TOGGLEABLE', { scope: 'global' })
}

/**
 * A deposit is whole cents, more than none, and keeps the ledger in whole, safe cents: one that
 * would carry the deposits or the player's money past `Number.MAX_SAFE_INTEGER` is refused with
 * `ABOVE_MAX`, `scope: 'ledger'`, and `max` the most the ledger can still take (`depositRoom`).
 */
export function validateDeposit(state: TableState, action: DepositAction): Rejection | null {
  if (!isWholeCents(action.amount, 1)) return reject('BAD_PARAMS', { field: 'amount' })
  const room = depositRoom(state)
  if (action.amount <= room) return null
  return reject('ABOVE_MAX', { scope: 'ledger', field: 'amount', amount: action.amount, max: room })
}

/**
 * A roll (rules spec §2.3 step 9): scripted dice must be an object with two faces from 1 to 6;
 * then the round's minimum (`BELOW_MIN_TOTAL`), the credit and the limits of the table about to be
 * rolled (`checkRollLimits`), room in the ledger for whatever the roll pays (`checkLedgerRoom`), and
 * any machine checks in `ROLL_CHECKS`.
 */
export function validateRoll(
  state: TableState,
  action: RollAction,
  cfg: MachineConfig,
): Rejection | null {
  if (action.dice !== undefined && !isDice(action.dice)) {
    return reject('BAD_PARAMS', { field: 'dice' })
  }
  const short = checkMinTotal(state, cfg, (bet) => effectiveWorking(bet, state, cfg))
  if (short !== null) return short
  const overdrawn = checkRollLimits(state, cfg) ?? checkLedgerRoom(state, cfg)
  if (overdrawn !== null) return overdrawn
  for (const check of ROLL_CHECKS) {
    const rejection = check(state, cfg)
    if (rejection !== null) return rejection
  }
  return null
}

/** The increase plus net commission must fit in the credit available. */
function creditShortfall(state: TableState, delta: number, vig: VigChange): Rejection | null {
  const needed = delta + vig.charge - vig.refund
  const available = availableCredit(state)
  return needed > available ? reject('INSUFFICIENT_CREDIT', { needed, available }) : null
}

/**
 * A new bet of `typeId` may not share the layout with another type in one of its exclusive groups
 * (`/exclusiveGroups`): anywhere, for a `global` group, or on the same number for a `sameNumber`
 * group. Then any machine exclusions (`EXCLUSIONS`, M4b).
 */
function exclusiveConflict(
  state: TableState,
  typeId: string,
  number: PointNumber | null,
  cfg: MachineConfig,
): Rejection | null {
  for (const group of cfg.exclusiveGroups) {
    if (!group.types.includes(typeId)) continue
    const clash = state.bets.find(
      (b) =>
        b.typeId !== typeId &&
        group.types.includes(b.typeId) &&
        (group.scope === 'global' || (number !== null && b.number === number)),
    )
    if (clash !== undefined) {
      return reject('EXCLUSIVE_CONFLICT', {
        typeId,
        conflictsWith: clash.typeId,
        betId: clash.id,
        scope: group.scope,
      })
    }
  }
  for (const rule of EXCLUSIONS) {
    const rejection = rule(state, typeId, number, cfg)
    if (rejection !== null) return rejection
  }
  return null
}

function isWholeCents(value: unknown, min: number): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
}

function isWorkingSetting(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean'
}

/** Scripted dice: an object (not null) whose `d1` and `d2` are whole faces from 1 to 6. */
function isDice(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const { d1, d2 } = value as { readonly d1?: unknown; readonly d2?: unknown }
  return isFace(d1) && isFace(d2)
}

function isFace(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6
}
