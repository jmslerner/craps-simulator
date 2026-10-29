import type { CommissionRule, MachineConfig, NumberBetType } from '../config/compile.ts'
import type { PointNumber } from '../config/rulesets.ts'
import { cents, roundCents, type Cents } from '../core/money.ts'
import { Fraction } from '../core/rational.ts'
import {
  payoutRoundingFor,
  type BetInstance,
  type RoundFn,
  type VigChange,
  type WinCommission,
  type WinDecision,
} from '../bets/types.ts'
import type { GameEvent } from '../table/events.ts'
import { chargeVig, refundVig, stake, type Ledger } from '../table/ledger.ts'
import type { SettlementTrace } from './trace.ts'

/**
 * Commission (vig) on buy and lay bets (plan §4.7, rules spec §4.3), read from the compiled
 * `CommissionRule` for the bet's number (`/catalog/<t>/commission`, with
 * `/catalog/<t>/commissionByNumber/<n>` applied). Place, big and place-to-lose bets carry none.
 *
 * - **Amount.** `vig(base) = max(minimum, round(base × rate))` by the rule's own rounding (§4.3,
 *   "LIVE minimums: vig = max($1, floor$(r·base))"). The base is the stake (`basis: 'stake'`, buy)
 *   or what the bet wins (`basis: 'win'`, lay): on a win, the win as paid; up front, the win the bet
 *   would be paid at its number ("lay base = potential win": a $2 lay on 4 wins $1 and pays $0.05).
 *   The minimum applies whenever a bet is up, even when its win rounds to nothing: a $1 lay on 8 at
 *   a live table wins $0 (83¢, paid in whole dollars) and still pays the $1 minimum. No bet, no vig.
 * - **On the win** (`timing: 'onWin'`, Shoot To Win): taken from each win. Nothing is held,
 *   refunded or re-collected (config validation guarantees `refundOnTakeDown: false, rearm: none`).
 * - **Up front** (`timing: 'upfront'`, Interblock GV6.5, live tables): charged from credit when the
 *   bet is placed or increased, so that `vigHeld` covers the vig due on the new amount (an increase
 *   tops it up; it never charges the minimum twice). A cut or a take-down refunds what is held
 *   above the vig due on what is left, only where `refundOnTakeDown`. When a winner stays up,
 *   `rearm` takes the vig due on its stake again from the win (`recollectFromWin`), charges it to
 *   credit (`recollectFromCredit`), or charges nothing (`none`, the vig paid at placement covers
 *   the bet for as long as it rides). A winner that comes down, and a loser, use up what was held.
 * - **Re-collected in full.** Up-front vig is "re-paid on every win" (§4.3, HAR-PA): when the win
 *   is smaller than the vig due (a live $1 lay wins $0), the win pays what it can and credit the
 *   rest. Credit is judged after all of the roll's settlements, so the roll's other payouts pay it
 *   (§4.5); only when even they cannot does the bet come down instead, as declining the vig removes
 *   it (IB §3.3). Commission taken on the win (`onWin`) is cut to the win, so such a win never
 *   costs the player money; no preset comes near that.
 *
 * Exact mode (`round` = identity) skips the rounding but keeps the minimum, which is a rule of the
 * machine rather than a rounding.
 */

const NO_VIG: VigChange = Object.freeze({ charge: cents(0), refund: cents(0) })
const NO_COMMISSION: WinCommission = Object.freeze({ onWin: Fraction.ZERO, rearm: Fraction.ZERO })

/** Rounded mode, as the table settles: `roundCents`, as a fraction. */
const ROUNDED: RoundFn = (amount, rounding) => Fraction.of(roundCents(amount, rounding))

/** The commission rule for a bet of `type` on `n`; null for a type that charges none. */
export function commissionRule(type: NumberBetType, n: PointNumber | null): CommissionRule | null {
  return n === null ? null : (type.commission?.get(n) ?? null)
}

/**
 * The commission on `base`: the rule's rate of it, rounded, at least the minimum (§4.3). The
 * minimum applies even to a base of 0, a win that rounds to nothing; callers charge no vig when
 * there is no bet.
 */
export function vigOf(base: Fraction, rule: CommissionRule, round: RoundFn): Fraction {
  return round(base.mul(rule.rate), rule.rounding).max(Fraction.of(rule.minimum))
}

/**
 * What the commission on a bet of `amount` on `n` is a share of: the stake (`basis: 'stake'`), or
 * the win at the type's pay on `n`, rounded as the machine pays it (`basis: 'win'`).
 */
export function vigBase(
  amount: Fraction,
  type: NumberBetType,
  n: PointNumber,
  rule: CommissionRule,
  round: RoundFn,
): Fraction {
  if (rule.basis === 'stake') return amount
  const pays = type.pays.get(n)
  if (pays === undefined) throw new RangeError(`${type.typeId} pays nothing on ${n}`)
  return round(amount.mul(Fraction.of(pays.num, pays.den)), payoutRoundingFor(type, n))
}

/**
 * The up-front commission due on a bet of `amount` on `n`, in cents; 0 unless it is charged up front,
 * and 0 when there is no bet.
 */
export function upfrontVig(type: NumberBetType, n: PointNumber, amount: Cents): Cents {
  const rule = commissionRule(type, n)
  if (rule === null || rule.timing !== 'upfront' || amount === 0) return cents(0)
  return toCents(vigOf(vigBase(Fraction.of(amount), type, n, rule, ROUNDED), rule, ROUNDED))
}

/**
 * Up-front commission moved when `bet` goes from its amount to `to` (0 takes it down; a new bet
 * comes in with amount and `vigHeld` 0): an increase charges what tops `vigHeld` up to the vig due
 * on `to`; a cut refunds what is held above the vig due on `to`, where `refundOnTakeDown`.
 */
export function vigOnChange(bet: BetInstance, to: Cents, type: NumberBetType): VigChange {
  const n = bet.number
  const rule = commissionRule(type, n)
  if (n === null || rule === null || rule.timing !== 'upfront') return NO_VIG
  if (to > bet.amount) {
    return { charge: cents(Math.max(0, upfrontVig(type, n, to) - bet.vigHeld)), refund: cents(0) }
  }
  if (to < bet.amount && rule.refundOnTakeDown) {
    const kept = to === 0 ? 0 : upfrontVig(type, n, to)
    return { charge: cents(0), refund: cents(Math.max(0, bet.vigHeld - kept)) }
  }
  return NO_VIG
}

/**
 * Commission on a win, in the settlement's mode (`settle`'s hook): `win` is what the bet won, as
 * paid. On-win commission is taken from it; up-front commission is re-collected from it only when
 * the bet stays up under `rearm: recollectFromWin`, as much of it as the win covers (the roll takes
 * the rest from credit: `rearmAfterWin`).
 */
export function winCommission(
  bet: BetInstance,
  decision: WinDecision,
  win: Fraction,
  type: NumberBetType,
  round: RoundFn,
): WinCommission {
  const rule = commissionRule(type, bet.number)
  if (rule === null) return NO_COMMISSION
  const base = rule.basis === 'stake' ? Fraction.of(bet.amount) : win
  if (rule.timing === 'onWin') {
    return { onWin: vigOf(base, rule, round).min(win), rearm: Fraction.ZERO }
  }
  const again = decision.stake === 'stay' && rule.rearm === 'recollectFromWin'
  return { onWin: Fraction.ZERO, rearm: again ? vigOf(base, rule, round).min(win) : Fraction.ZERO }
}

/**
 * What `vigHeld` becomes when `bet` wins and stays up: the vig due on its stake where it is
 * re-collected (from the win and, for what the win does not cover, from credit; or all from
 * credit), and unchanged under `rearm: none` and for commission taken on the win (which holds
 * nothing). A bet whose re-collection credit cannot pay comes down instead (`rearmAfterWin`).
 */
export function vigHeldAfterWin(bet: BetInstance, type: NumberBetType): Cents {
  const n = bet.number
  const rule = commissionRule(type, n)
  if (n === null || rule === null || rule.timing !== 'upfront' || rule.rearm === 'none') {
    return bet.vigHeld
  }
  return upfrontVig(type, n, bet.amount)
}

/** The ledger and events after `rearmAfterWin`; `down` when the bet must come down instead. */
export interface RearmResult {
  readonly ledger: Ledger
  readonly events: readonly GameEvent[]
  readonly down: boolean
}

/**
 * The roll pipeline's re-collection step for one settled bet (plan §4.7): a buy or lay that won
 * and stays up has its up-front commission re-collected per `rearm`. The roll runs it for each
 * settled bet in settlement order once every bet of the roll is settled, so `ledger` holds the
 * whole roll's payouts (rules spec §4.5): a lay that wins $0 keeps its place when the roll's other
 * winners cover its vig.
 *
 * - `recollectFromWin`: the settlement already took it from the win (`trace.vigRearm`); this
 *   announces it with a `vigCharged` event, `from: 'win'`. When the win was smaller than the vig
 *   due, the rest is charged from credit (`vigCharged`, `from: 'credit'`).
 * - `recollectFromCredit`: charged here from credit (`vigCharged`, `from: 'credit'`).
 * - Either way, if the credit cannot cover its part, the bet comes down instead and nothing is
 *   re-collected: what the win paid is refunded (`vigRefunded`) and the stake goes back to credit,
 *   as Interblock removes a bet whose commission is declined (IB §3.3, rules spec §4.5): a
 *   `betRemoved` event, `vigDeclined`.
 * - `none`, commission on the win, and every other settlement: nothing.
 */
export function rearmAfterWin(
  ledger: Ledger,
  bet: BetInstance,
  trace: SettlementTrace,
  cfg: MachineConfig,
): RearmResult {
  const nothing: RearmResult = { ledger, events: [], down: false }
  const type = cfg.catalog.get(bet.typeId)
  if (type?.family !== 'numberVsSeven') return nothing
  if (trace.outcome !== 'win' || trace.stakeDisposition !== 'stays') return nothing
  const rule = commissionRule(type, bet.number)
  if (rule === null || rule.timing !== 'upfront' || bet.number === null) return nothing
  if (rule.rearm === 'none') return nothing
  const due = upfrontVig(type, bet.number, bet.amount)
  const fromWin = rule.rearm === 'recollectFromWin' ? trace.vigRearm : 0
  const fromCredit = due - fromWin
  const charge = (amount: Cents, from: 'win' | 'credit'): GameEvent => ({
    type: 'vigCharged',
    betId: bet.id,
    amount,
    reason: 'rearm',
    from,
  })
  if (fromCredit <= ledger.bankroll) {
    const events: GameEvent[] = []
    if (fromWin > 0) events.push(charge(cents(fromWin), 'win'))
    if (fromCredit > 0) events.push(charge(cents(fromCredit), 'credit'))
    const charged = fromCredit > 0 ? chargeVig(ledger, cents(fromCredit)) : ledger
    return { ledger: charged, events, down: false }
  }
  const events: GameEvent[] = []
  let declined = ledger
  if (fromWin > 0) {
    declined = refundVig(declined, cents(fromWin))
    events.push({ type: 'vigRefunded', betId: bet.id, amount: cents(fromWin) })
  }
  events.push({
    type: 'betRemoved',
    betId: bet.id,
    typeId: bet.typeId,
    amount: bet.amount,
    reason: 'vigDeclined',
  })
  return { ledger: stake(declined, -bet.amount), events, down: true }
}

/** A rounded amount as cents; the rounding already made it whole. */
function toCents(amount: Fraction): Cents {
  if (amount.den !== 1n)
    throw new RangeError(`${amount.toString()}¢ is not a whole number of cents`)
  return cents(Number(amount.num))
}
