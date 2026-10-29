/**
 * The reference oracle for single bets: a naive, plain if/else reading of the rules spec.
 * - `refTransition`: round transitions (rules spec §2.1).
 * - `refDecide`: what a bet does on a roll (§2.2, §3.1-§3.4; composites per plan §0 amendment 15).
 * - `refSettle`: the money of a decision (§4.1-§4.3), with this file's own BigInt rounding.
 * - `refUpfrontVig`, `refMaxOdds`: commission charged up front (§4.3) and odds caps (§4.4).
 *
 * Written from docs/rules/rules-spec.md alone; see machineFacts.ts for the independence rules.
 * Amounts are integer cents; exact amounts are `Fraction`s of a cent.
 */
import { Fraction } from '../../src/engine/core/rational.ts'
import {
  diceKey,
  incrementOf,
  oneRollPay,
  payoutRoundingOf,
  typeFacts,
  type CommissionFacts,
  type LineFacts,
  type MachineFacts,
  type OddsFacts,
  type RefRounding,
  type TypeFacts,
} from './machineFacts.ts'

export type RefPhase = 'comeOut' | 'point'

/** The round before a roll: bets decide against this, never the state after (rules spec §2.3). */
export interface RefBefore {
  readonly phase: RefPhase
  readonly point: number | null
}

export interface RefDice {
  readonly d1: number
  readonly d2: number
}

/** A bet as `refDecide` sees it: its type and its number (null for a line bet in its box). */
export interface RefBetSpec {
  readonly typeId: string
  readonly number: number | null
}

/**
 * A decision (rules spec §2.2). A win carries its net pay per unit staked and whether the stake
 * stays up or comes back; so does a push. Push reasons: `bar` (the don't bar), `offReturned`
 * (odds that were OFF when they had to come down) and `zeroNet` (a composite netting 0, the world
 * bet on a 7).
 */
export type RefDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'travel'; readonly number: number }
  | { readonly kind: 'win'; readonly ratio: Fraction; readonly stake: 'return' | 'stay' }
  | { readonly kind: 'lose' }
  | {
      readonly kind: 'push'
      readonly reason: 'bar' | 'offReturned' | 'zeroNet'
      readonly stake: 'return' | 'stay'
    }

export type RefTransition =
  | { readonly kind: 'natural'; readonly total: number }
  | { readonly kind: 'craps'; readonly total: number }
  | { readonly kind: 'pointEstablished'; readonly point: number }
  | { readonly kind: 'pointMade'; readonly point: number }
  | { readonly kind: 'sevenOut'; readonly point: number }
  | { readonly kind: 'none' }

const NONE: RefDecision = { kind: 'none' }
const LOSE: RefDecision = { kind: 'lose' }

/**
 * The round transition of a roll (rules spec §2.1). Come-out: naturals and craps leave the
 * come-out in place, anything else is the point. Point phase: the point is made, a 7 sevens out,
 * and anything else changes nothing.
 */
export function refTransition(
  facts: MachineFacts,
  before: RefBefore,
  total: number,
): { readonly transition: RefTransition; readonly after: RefBefore } {
  if (before.phase === 'comeOut') {
    if (facts.naturals.includes(total))
      return { transition: { kind: 'natural', total }, after: before }
    if (facts.craps.includes(total)) return { transition: { kind: 'craps', total }, after: before }
    if (!facts.points.includes(total)) throw new RangeError(`${total} is not a point`)
    return {
      transition: { kind: 'pointEstablished', point: total },
      after: { phase: 'point', point: total },
    }
  }
  const point = before.point
  if (point === null) throw new RangeError('The point phase needs a point')
  const comeOut: RefBefore = { phase: 'comeOut', point: null }
  if (total === point) return { transition: { kind: 'pointMade', point }, after: comeOut }
  if (total === 7) return { transition: { kind: 'sevenOut', point }, after: comeOut }
  return { transition: { kind: 'none' }, after: before }
}

/**
 * What `bet` does on this roll. `working` is the bet's effective ON/OFF status for the roll
 * (rules spec §2.4); a bet that is not working gets `none`. Odds instead follow `parent`, the
 * decision of the bet they sit behind (§2.3 step 4).
 */
export function refDecide(
  facts: MachineFacts,
  bet: RefBetSpec,
  before: RefBefore,
  dice: RefDice,
  working: boolean,
  parent?: RefDecision,
): RefDecision {
  if (!isDie(dice.d1) || !isDie(dice.d2)) throw new RangeError('Dice must show 1 to 6')
  const type = typeFacts(facts, bet.typeId)
  const total = dice.d1 + dice.d2
  if (type.family === 'odds') return decideOdds(facts, type, bet, before, total, working, parent)
  if (!working) return NONE
  switch (type.family) {
    case 'line':
      return decideLine(facts, type, bet.number, total)
    case 'numberVsSeven': {
      const n = numberOf(bet)
      const pays = payOf(type.pays, n)
      const winner = type.winsOn === 'number' ? total === n : total === 7
      const loser = type.winsOn === 'number' ? total === 7 : total === n
      if (winner) return { kind: 'win', ratio: pays, stake: type.afterWin }
      return loser ? LOSE : NONE
    }
    case 'hardway': {
      // Wins on the pair, loses on the easy way or any 7 (rules spec §3.3, §0.2 #11).
      const n = numberOf(bet)
      if (total === 7) return LOSE
      if (total !== n) return NONE
      return dice.d1 === dice.d2
        ? { kind: 'win', ratio: payOf(type.pays, n), stake: type.afterWin }
        : LOSE
    }
    case 'oneRoll': {
      const pay = oneRollPay(type, dice.d1, dice.d2)
      return pay === null ? LOSE : { kind: 'win', ratio: pay, stake: type.afterWin }
    }
    case 'composite': {
      const net = type.netByDice.get(diceKey(dice.d1, dice.d2))
      if (net === undefined) throw new RangeError(`No net for ${diceKey(dice.d1, dice.d2)}`)
      if (net.isZero()) return { kind: 'push', reason: 'zeroNet', stake: type.afterWin }
      if (net.isNegative()) return LOSE
      return { kind: 'win', ratio: net, stake: type.afterWin }
    }
  }
}

/**
 * Line bets (rules spec §2.2, §3.1). In its box (pass before its point, come and don't come
 * before their first roll) a bet is decided like a come-out: naturals and craps settle it, the
 * don't bar pushes, and any other total takes it to that number. On a number it is the number
 * against 7. The decision depends only on the bet's own number, never on the table's phase, so a
 * come bet on N wins on the same roll the box come bet travels to N (§0.2 #12).
 */
function decideLine(
  facts: MachineFacts,
  type: LineFacts,
  number: number | null,
  total: number,
): RefDecision {
  if (number === null) {
    const natural = facts.naturals.includes(total)
    const craps = facts.craps.includes(total)
    if (type.side === 'do') {
      if (natural) return lineWin(type, number, total)
      if (craps) return LOSE
    } else {
      if (natural) return LOSE
      if (craps) {
        return total === facts.dontBar
          ? { kind: 'push', reason: 'bar', stake: 'stay' }
          : lineWin(type, number, total)
      }
    }
    if (!facts.points.includes(total)) throw new RangeError(`${total} is not a point`)
    return { kind: 'travel', number: total }
  }
  const winner = type.side === 'do' ? total === number : total === 7
  const loser = type.side === 'do' ? total === 7 : total === number
  if (winner) return lineWin(type, number, total)
  return loser ? LOSE : NONE
}

/**
 * A line win and where its stake goes (rules spec §5.1 `afterWin`): `stayIfFirstRoll` keeps a
 * don't bet that wins in its box, `stayIf11` keeps a come bet that wins on 11 in its box.
 */
function lineWin(type: LineFacts, number: number | null, total: number): RefDecision {
  const stays =
    type.afterWin === 'stay' ||
    (type.afterWin === 'stayIfFirstRoll' && number === null) ||
    (type.afterWin === 'stayIf11' && number === null && total === 11)
  return { kind: 'win', ratio: type.pays, stake: stays ? 'stay' : 'return' }
}

/**
 * Odds follow their parent and come down with it (rules spec §2.3 step 4, §3.1). Odds that are
 * OFF when the parent is decided are returned. With `oddsOffReturnedAtPointMade` (Interblock),
 * every odds bet that is OFF on the roll that makes the point is returned too, whichever number
 * its parent is on (schema: "when the point is made, odds bets that are OFF are taken down").
 */
function decideOdds(
  facts: MachineFacts,
  type: OddsFacts,
  bet: RefBetSpec,
  before: RefBefore,
  total: number,
  working: boolean,
  parent: RefDecision | undefined,
): RefDecision {
  if (parent === undefined) throw new RangeError(`${type.id} needs its parent's decision`)
  const n = numberOf(bet)
  if (parent.kind === 'travel' || parent.kind === 'push') {
    throw new RangeError(`A parent on a number cannot ${parent.kind}`)
  }
  const decided = parent.kind === 'win' || parent.kind === 'lose'
  if (!working) {
    const pointMade = before.phase === 'point' && total === before.point
    if (decided || (pointMade && facts.working.oddsOffReturnedAtPointMade)) {
      return { kind: 'push', reason: 'offReturned', stake: 'return' }
    }
    return NONE
  }
  if (parent.kind === 'win') return { kind: 'win', ratio: payOf(type.pays, n), stake: 'return' }
  return parent.kind === 'lose' ? LOSE : NONE
}

/** A bet on the table, as `refSettle` needs it. */
export interface RefStake {
  readonly typeId: string
  readonly number: number | null
  readonly amount: number
  /** Upfront commission held against the bet (rules spec §4.3). */
  readonly vigHeld: number
}

/**
 * The money of one decision (rules spec §4.1-§4.3):
 * - `winExact`: stake × pay, in cents, unrounded; `winPaid`: it rounded once by the type's rule
 *   (per number where the machine gives one).
 * - `vigOnWin`: commission taken from the win (`timing: onWin`). It is "deducted from the win"
 *   (§4.3), so it never takes more than the win: a minimum above the win takes the whole win.
 * - `vigRearm`: upfront commission due again in full because a winner stays up (`rearm`; §4.3
 *   LIVE: "re-paid on every win"). `recollectFromWin` takes what the win (after `vigOnWin`) covers,
 *   `vigRearmFromWin`, and credit pays the rest, `vigRearmFromCredit`; `recollectFromCredit` takes
 *   it all from credit. The credit part is judged after all of the roll's payouts: when credit
 *   cannot pay it, the bet comes down instead (see `referenceTable.ts`, §4.5).
 * - `credited`: paid into the bankroll: the stake if returned, plus winPaid − vigOnWin −
 *   vigRearmFromWin. `debited`: `vigRearmFromCredit`, taken from the bankroll if it can pay.
 * - `stakeDisposition`: where the stake goes; `vigHeldAfter`: the upfront vig the bet still holds
 *   (the re-collected vig once it is paid; a winner under `rearm: none` keeps what it held).
 */
export interface RefSettlement {
  readonly outcome: RefDecision['kind']
  readonly winExact: Fraction
  readonly winPaid: number
  readonly vigOnWin: number
  readonly vigRearm: number
  readonly vigRearmFrom: 'win' | 'credit' | null
  readonly vigRearmFromWin: number
  readonly vigRearmFromCredit: number
  readonly credited: number
  readonly debited: number
  readonly stakeDisposition: 'returned' | 'stays' | 'lost'
  readonly vigHeldAfter: number
}

export function refSettle(
  facts: MachineFacts,
  bet: RefStake,
  decision: RefDecision,
): RefSettlement {
  const quiet = {
    outcome: decision.kind,
    winExact: Fraction.ZERO,
    winPaid: 0,
    vigOnWin: 0,
    vigRearm: 0,
    vigRearmFrom: null,
    vigRearmFromWin: 0,
    vigRearmFromCredit: 0,
    credited: 0,
    debited: 0,
    stakeDisposition: 'stays',
    vigHeldAfter: bet.vigHeld,
  } as const
  switch (decision.kind) {
    case 'none':
    case 'travel':
      return quiet
    case 'lose':
      return { ...quiet, stakeDisposition: 'lost', vigHeldAfter: 0 }
    case 'push':
      return decision.stake === 'stay'
        ? quiet
        : { ...quiet, credited: bet.amount, stakeDisposition: 'returned', vigHeldAfter: 0 }
    case 'win': {
      const type = typeFacts(facts, bet.typeId)
      const winExact = Fraction.of(bet.amount).mul(decision.ratio)
      const winPaid = roundRef(winExact, payoutRoundingOf(type, bet.number))
      const commission = commissionOf(type, bet.number)
      const stays = decision.stake === 'stay'
      const vigOnWin =
        commission?.timing === 'onWin'
          ? Math.min(
              winPaid,
              vigAmount(commission, commission.basis === 'stake' ? bet.amount : winPaid),
            )
          : 0
      // Upfront vig is charged again only when the winner stays up (rules spec §4.3, plan §4.7).
      const rearm =
        commission?.timing === 'upfront' && stays && commission.rearm !== 'none'
          ? commission.rearm
          : null
      const vigRearm = rearm === null ? 0 : refUpfrontVig(facts, bet.typeId, bet.number, bet.amount)
      const vigRearmFromWin =
        rearm === 'recollectFromWin' ? Math.min(vigRearm, winPaid - vigOnWin) : 0
      const vigRearmFromCredit = vigRearm - vigRearmFromWin
      return {
        outcome: 'win',
        winExact,
        winPaid,
        vigOnWin,
        vigRearm,
        vigRearmFrom: rearm === null ? null : rearm === 'recollectFromWin' ? 'win' : 'credit',
        vigRearmFromWin,
        vigRearmFromCredit,
        credited: (stays ? 0 : bet.amount) + winPaid - vigOnWin - vigRearmFromWin,
        debited: vigRearmFromCredit,
        stakeDisposition: stays ? 'stays' : 'returned',
        vigHeldAfter: !stays ? 0 : rearm === null ? bet.vigHeld : vigRearm,
      }
    }
  }
}

/**
 * The upfront commission due on a bet of `amount` (rules spec §4.3): rate × base, rounded by the
 * commission's rule, at least its minimum. The base is the stake (`basis: stake`) or the
 * potential win as it would be paid (`basis: win`, a lay). 0 when the type has no upfront vig.
 */
export function refUpfrontVig(
  facts: MachineFacts,
  typeId: string,
  number: number | null,
  amount: number,
): number {
  const type = typeFacts(facts, typeId)
  const commission = commissionOf(type, number)
  if (commission?.timing !== 'upfront' || type.family !== 'numberVsSeven' || amount === 0) return 0
  const n = numberOf({ typeId, number })
  const base =
    commission.basis === 'stake'
      ? amount
      : roundRef(Fraction.of(amount).mul(payOf(type.pays, n)), payoutRoundingOf(type, n))
  return vigAmount(commission, base)
}

/**
 * Upfront vig owed when a bet grows to `amount` (rules spec §4.3: "charged at placement and on
 * increases"): what tops the vig it holds up to the vig due on the new total, never negative.
 */
export function refVigTopUp(facts: MachineFacts, bet: RefStake, amount: number): number {
  return Math.max(0, refUpfrontVig(facts, bet.typeId, bet.number, amount) - bet.vigHeld)
}

/**
 * Upfront vig when a bet shrinks to `amount`, 0 being a take-down (rules spec §4.3): with
 * `refundOnTakeDown` the vig held above what the remaining stake owes comes back (all of it on a
 * take-down); without it nothing is refunded and the bet keeps holding what it paid.
 */
export function refVigOnReduce(
  facts: MachineFacts,
  bet: RefStake,
  amount: number,
): { readonly vigHeld: number; readonly refund: number } {
  const commission = commissionOf(typeFacts(facts, bet.typeId), bet.number)
  if (commission?.timing !== 'upfront' || !commission.refundOnTakeDown) {
    return { vigHeld: bet.vigHeld, refund: 0 }
  }
  const vigHeld = Math.min(bet.vigHeld, refUpfrontVig(facts, bet.typeId, bet.number, amount))
  return { vigHeld, refund: bet.vigHeld - vigHeld }
}

/**
 * The largest odds bet behind a flat bet of `flat` on `number` (rules spec §4.4): the multiple ×
 * flat on the odds stake (`basis: stake`), or on what the odds would win (`basis: win`: lay ≤
 * multiple × flat ÷ pay), floored to the odds type's bet increment on that point
 * (`incrementByNumber` where the machine gives one; §4.4 "floor to the bet increment" [A]).
 */
export function refMaxOdds(
  facts: MachineFacts,
  oddsTypeId: string,
  number: number,
  flat: number,
): number {
  const type = typeFacts(facts, oddsTypeId)
  if (type.family !== 'odds') throw new RangeError(`${oddsTypeId} is not an odds type`)
  const multiple = type.limitMultiple.get(number)
  if (multiple === undefined) throw new RangeError(`${oddsTypeId} has no limit on ${number}`)
  const cap = Fraction.of(multiple * flat)
  const onStake = type.limitBasis === 'stake' ? cap : cap.div(payOf(type.pays, number))
  return roundRef(onStake, { mode: 'floor', increment: incrementOf(type, number) })
}

/**
 * Rounds a non-negative exact amount of cents to a multiple of `rule.increment` cents, in BigInt
 * (rules spec §4.2): floor, ceil, half up, or half to even.
 */
export function roundRef(exact: Fraction, rule: RefRounding): number {
  if (exact.isNegative()) throw new RangeError(`Cannot round a negative amount: ${exact}`)
  const increment = BigInt(rule.increment)
  const den = exact.den * increment
  const whole = exact.num / den
  const twiceRest = 2n * (exact.num % den)
  let units: bigint
  switch (rule.mode) {
    case 'floor':
      units = whole
      break
    case 'ceil':
      units = twiceRest === 0n ? whole : whole + 1n
      break
    case 'halfUp':
      units = twiceRest >= den ? whole + 1n : whole
      break
    case 'halfEven':
      units = twiceRest > den || (twiceRest === den && whole % 2n === 1n) ? whole + 1n : whole
      break
  }
  const cents = units * increment
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Amount out of range')
  return Number(cents)
}

/** The commission on a number bet's number; null for every other bet. */
export function commissionOf(type: TypeFacts, number: number | null): CommissionFacts | null {
  if (type.family !== 'numberVsSeven' || number === null) return null
  return type.commission.get(number) ?? null
}

function vigAmount(commission: CommissionFacts, base: number): number {
  const charged = roundRef(Fraction.of(base).mul(commission.rate), commission.rounding)
  return Math.max(commission.minimum, charged)
}

function payOf(pays: ReadonlyMap<number, Fraction>, n: number): Fraction {
  const pay = pays.get(n)
  if (pay === undefined) throw new RangeError(`No pay on ${n}`)
  return pay
}

function numberOf(bet: RefBetSpec): number {
  if (bet.number === null) throw new RangeError(`${bet.typeId} needs a number`)
  return bet.number
}

function isDie(face: number): boolean {
  return Number.isSafeInteger(face) && face >= 1 && face <= 6
}
