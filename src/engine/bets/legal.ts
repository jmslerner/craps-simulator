import type { MachineConfig } from '../config/compile.ts'
import type { PointNumber } from '../config/rulesets.ts'
import { cents, type Cents } from '../core/money.ts'
import type { PlaceAction } from '../table/actions.ts'
import type { TableState } from '../table/state.ts'
import { availableCredit, smallestBet, typeLimits } from './limits.ts'
import { resolveBet, type ResolvedBet } from './registry.ts'
import {
  isRejection,
  reject,
  type BetId,
  type BetInstance,
  type BetType,
  type Rejection,
} from './types.ts'
import { validatePlace, validateSetAmount, type BetChange } from './validate.ts'

/**
 * What the player may bet now, spot by spot (plan §4.6 `legalBets`), for the layout's zones, the
 * next-step guide and the coach (plan §0 #18). It decides nothing itself: every answer is what
 * `validatePlace` or `validateSetAmount` says about the actual action, so it cannot disagree with
 * `validateAction` (tests/properties/legal.prop.test.ts checks it on random tables).
 *
 * The spots, for each type the machine offers and the engine implements, in config order:
 *
 * - line bets: the line (pass and don't pass, one bet wherever it is), or the box (come and don't
 *   come) plus each come or don't come bet already on a number;
 * - odds: one spot behind each bet of the parent type, or one with no parent when there is none
 *   (`NO_PARENT`);
 * - number bets and hardways: one per number the type offers;
 * - one-roll bets and composites: one each;
 * - side bets (M11): one each, listed after the main game and only with `{ sideBets: true }`. The
 *   layout asks for them; the coach's surfaces and the random drivers price and play the main game
 *   until the exact solver prices side bets too, so the default leaves them out.
 *
 * Every bet on the table is on exactly one spot. Adding to a spot presses its bet when it has one
 * (`setAmount`, which a `place` on the spot also does) and places a new bet when it is empty.
 * `minAdd` to `maxAdd` is the range of additions the table accepts now: every multiple of the
 * spot's increment in it is accepted and nothing outside it is, because every check that depends
 * on the amount is a floor (the minimum) or a ceiling (the maximum, the odds cap, the table
 * maximum, and credit with any up-front commission). The increment is the type's, or its unit on
 * the spot's number (`typeLimits`): a live table's odds on 6 go up in $5, so a new odds bet there
 * starts at $5 even though the type's minimum is $1.
 */
export interface LegalBet {
  readonly typeId: string
  /**
   * The spot's number: a number bet's or a hardway's, the number of the come or don't come bet it
   * holds, or for odds their parent's. Null for the line, the box, one-roll bets and composites.
   */
  readonly number: PointNumber | null
  /** Odds only: the bet they go behind; null for every other spot and for odds with no parent. */
  readonly parentId: BetId | null
  /** The bet on the spot, if any, and its amount (0 when the spot is empty). */
  readonly betId: BetId | null
  readonly amount: Cents
  /** Null when some amount can be added now; otherwise why not, as the smallest addition is refused. */
  readonly canAdd: Rejection | null
  /** The smallest and largest additions the table accepts now; both 0 when `canAdd` refuses. */
  readonly minAdd: Cents
  readonly maxAdd: Cents
  /** Null when the bet can be taken down; otherwise why not (`BET_NOT_FOUND` on an empty spot). */
  readonly canRemove: Rejection | null
}

export interface LegalBetsOptions {
  /** Also list the side bets' spots, after the main game's (default false). */
  readonly sideBets?: boolean
}

export function legalBets(
  state: TableState,
  cfg: MachineConfig,
  options: LegalBetsOptions = {},
): LegalBet[] {
  const legal: LegalBet[] = []
  const typeIds = [
    ...cfg.catalog.keys(),
    ...cfg.composites.keys(),
    ...(options.sideBets === true ? cfg.sideBets.keys() : []),
  ]
  for (const typeId of typeIds) {
    const resolved = resolveBet(cfg, typeId)
    if (resolved === null) continue
    for (const spot of spotsOf(state, resolved.type)) {
      legal.push(legalAt(state, cfg, resolved, spot))
    }
  }
  return legal
}

interface Spot {
  readonly number: PointNumber | null
  readonly parentId: BetId | null
  readonly bet: BetInstance | null
}

function spotsOf(state: TableState, type: BetType): Spot[] {
  const mine = state.bets.filter((bet) => bet.typeId === type.typeId)
  const one = (number: PointNumber | null, bet: BetInstance | undefined): Spot => ({
    number,
    parentId: null,
    bet: bet ?? null,
  })
  switch (type.family) {
    case 'line': {
      if (type.window === 'comeOut') return [one(null, mine[0])]
      const box = mine.find((bet) => bet.number === null)
      const onNumbers = mine.filter((bet) => bet.number !== null)
      return [one(null, box), ...onNumbers.map((bet) => one(bet.number, bet))]
    }
    case 'odds': {
      const parents = state.bets.filter((bet) => bet.typeId === type.parent)
      if (parents.length === 0) return [one(null, undefined)]
      return parents.map((parent) => ({
        number: parent.number,
        parentId: parent.id,
        bet: mine.find((bet) => bet.parentId === parent.id) ?? null,
      }))
    }
    case 'numberVsSeven':
    case 'hardway': {
      const on = (n: PointNumber) => mine.find((bet) => bet.number === n)
      return type.numbers.map((n) => one(n, on(n)))
    }
    case 'oneRoll':
    case 'composite':
    case 'collectSet':
    case 'uniquePointsMade':
    case 'handLength':
    case 'pointRun':
      return [one(null, mine[0])]
  }
}

function legalAt(
  state: TableState,
  cfg: MachineConfig,
  { type }: ResolvedBet,
  spot: Spot,
): LegalBet {
  const { bet } = spot
  const limits = typeLimits(cfg, type.typeId, spot.number)
  const held = bet?.amount ?? 0
  const add = (amount: number): Rejection | null =>
    bet === null
      ? refusal(validatePlace(state, placeOn(type.typeId, spot, amount), cfg))
      : refusal(
          validateSetAmount(
            state,
            { type: 'setAmount', betId: bet.id, amount: cents(held + amount) },
            cfg,
          ),
        )
  const canRemove =
    bet === null
      ? reject('BET_NOT_FOUND', { typeId: type.typeId })
      : refusal(
          validateSetAmount(state, { type: 'setAmount', betId: bet.id, amount: cents(0) }, cfg),
        )
  const base = {
    typeId: type.typeId,
    number: spot.number,
    parentId: spot.parentId,
    betId: bet?.id ?? null,
    amount: cents(held),
    canRemove,
  }
  // A new bet starts at the type's minimum, rounded up to the increment on its number; a bet
  // already up grows by that increment.
  const first = bet === null ? smallestBet(limits) : limits.increment
  const canAdd = add(first)
  if (canAdd !== null) return { ...base, canAdd, minAdd: cents(0), maxAdd: cents(0) }
  // The accepted additions are first, first + increment, … up to the largest the checks allow,
  // which is at most the type's maximum and the credit: find it by bisection.
  const ceiling = Math.min(limits.max - held, availableCredit(state)) - first
  let lo = 0
  let hi = ceiling <= 0 ? 0 : (ceiling - (ceiling % limits.increment)) / limits.increment
  while (lo < hi) {
    const span = hi - lo
    const mid = lo + (span + (span % 2)) / 2
    if (add(first + mid * limits.increment) === null) lo = mid
    else hi = mid - 1
  }
  return {
    ...base,
    canAdd: null,
    minAdd: cents(first),
    maxAdd: cents(first + lo * limits.increment),
  }
}

/** The `place` action for `amount` on an empty spot. */
function placeOn(typeId: string, spot: Spot, amount: number): PlaceAction {
  const action: PlaceAction = { type: 'place', typeId, amount: cents(amount) }
  if (spot.parentId !== null) return { ...action, parentId: spot.parentId }
  return spot.number === null ? action : { ...action, number: spot.number }
}

function refusal(result: BetChange | Rejection): Rejection | null {
  return isRejection(result) ? result : null
}
