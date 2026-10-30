import type { MachineConfig } from '../config/compile.ts'
import { cents, roundCents, type Cents, type Rounding } from '../core/money.ts'
import { Fraction } from '../core/rational.ts'
import { requireBet } from '../bets/registry.ts'
import {
  payoutRoundingFor,
  type BetInstance,
  type RoundFn,
  type Settled,
  type WinCommission,
} from '../bets/types.ts'
import type { SettlementTrace } from './trace.ts'

/**
 * Settles one decided bet (plan §4.7, rules spec §4.1–§4.2):
 *
 * - **Win:** `winExact = stake × num/den` exactly; `winPaid` rounds it once, by the rounding for
 *   the bet's type and number (`payoutRoundingFor`: a per-number rounding, the type's own, or
 *   `/money/payoutRounding`). The stake comes back or stays up, as the decision says. Commission
 *   on the win comes from the family's `winCommission` hook (buy and lay, M4b); line and odds
 *   bets have none.
 * - **Lose:** the stake goes to the house.
 * - **Push:** a `bar` push leaves the stake on the bet; an `offReturned` push gives it back; a
 *   `zeroNet` push (a composite netting 0, the world bet on a 7) returns it or leaves it up, as its
 *   decision says.
 *
 * `credited` is what reaches the player's credit: `(stake if returned) + winPaid − vigOnWin −
 * vigRearm`.
 *
 * In `exact` mode nothing is rounded and the amounts are `Fraction`s: the nominal edge and the cost
 * of breakage are priced from it.
 */
export function settle(
  bet: BetInstance,
  decision: Settled,
  cfg: MachineConfig,
  mode?: 'rounded',
): SettlementTrace
export function settle(
  bet: BetInstance,
  decision: Settled,
  cfg: MachineConfig,
  mode: 'exact',
): SettlementTrace<Fraction>
export function settle(
  bet: BetInstance,
  decision: Settled,
  cfg: MachineConfig,
  mode: 'rounded' | 'exact' = 'rounded',
): SettlementTrace | SettlementTrace<Fraction> {
  const exact = settleExactly(bet, decision, cfg, mode === 'exact' ? EXACT : ROUNDED)
  if (mode === 'exact') return { ...exact, rounding: null }
  return {
    ...exact,
    winPaid: toCents(exact.winPaid),
    vigOnWin: toCents(exact.vigOnWin),
    vigRearm: toCents(exact.vigRearm),
    credited: toCents(exact.credited),
  }
}

/** Exact mode: amounts pass through unrounded. */
const EXACT: RoundFn = (amount) => amount

/** Rounded mode: `roundCents`, kept as a fraction until the trace is built. */
const ROUNDED: RoundFn = (amount, rounding) => Fraction.of(roundCents(amount, rounding))

const NO_COMMISSION: WinCommission = Object.freeze({ onWin: Fraction.ZERO, rearm: Fraction.ZERO })

function settleExactly(
  bet: BetInstance,
  decision: Settled,
  cfg: MachineConfig,
  round: RoundFn,
): SettlementTrace<Fraction> {
  const { family, type } = requireBet(cfg, bet.typeId)
  const stake = Fraction.of(bet.amount)
  const base = {
    betId: bet.id,
    typeId: bet.typeId,
    number: bet.number,
    stake: bet.amount,
    vigOnWin: Fraction.ZERO,
    vigRearm: Fraction.ZERO,
  }
  const nothing = {
    ...base,
    payKey: null,
    ratioLabel: '',
    winExact: '0',
    winPaid: Fraction.ZERO,
    rounding: null,
    breakage: '0',
  }
  switch (decision.kind) {
    case 'lose':
      return {
        ...nothing,
        outcome: 'lose',
        pushReason: null,
        credited: Fraction.ZERO,
        stakeDisposition: 'lost',
      }
    case 'push': {
      // A composite netting 0 does with its stake what a win would (`afterWin`).
      const returned =
        decision.reason === 'zeroNet'
          ? decision.stake === 'return'
          : decision.reason === 'offReturned'
      return {
        ...nothing,
        outcome: 'push',
        pushReason: decision.reason,
        credited: returned ? stake : Fraction.ZERO,
        stakeDisposition: returned ? 'returned' : 'stays',
      }
    }
    case 'win': {
      const ratio = family.payout(type, decision.payKey)
      const rounding = payoutRoundingFor(type, bet.number)
      const winExact = stake.mul(Fraction.of(ratio.num, ratio.den))
      const winPaid = round(winExact, rounding)
      const vig = family.winCommission?.(bet, decision, winPaid, type, round) ?? NO_COMMISSION
      const returned = decision.stake === 'return'
      return {
        ...base,
        outcome: 'win',
        pushReason: null,
        payKey: decision.payKey,
        ratioLabel: ratio.label,
        winExact: winExact.toString(),
        winPaid,
        rounding: roundingOf(rounding),
        breakage: winExact.sub(winPaid).toString(),
        vigOnWin: vig.onWin,
        vigRearm: vig.rearm,
        credited: (returned ? stake : Fraction.ZERO).add(winPaid).sub(vig.onWin).sub(vig.rearm),
        stakeDisposition: returned ? 'returned' : 'stays',
      }
    }
  }
}

/** A plain copy of a rounding rule, so the trace stays plain JSON. */
function roundingOf(rounding: Rounding): Rounding {
  return { mode: rounding.mode, increment: rounding.increment }
}

/** A rounded amount as cents; the rounding already made it whole. */
function toCents(amount: Fraction): Cents {
  if (amount.den !== 1n)
    throw new RangeError(`${amount.toString()}¢ is not a whole number of cents`)
  return cents(Number(amount.num))
}
