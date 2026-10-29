import { cents, type Cents } from '../core/money.ts'
import type { BetInstance } from '../bets/types.ts'
import type { SettlementTrace } from '../settle/trace.ts'

/**
 * The session's money (plan §4.7). Every amount is whole cents, and every movement keeps
 *
 *   deposits = bankroll + Σ bet.amount + houseNet
 *
 * - `deposits`: money the player has put in, the starting bankroll included.
 * - `bankroll`: the player's credit, free to bet.
 * - `houseNet`: what the house has won so far, net of what it has paid; negative when the player is
 *   ahead. Commission goes to it the moment it is charged, and comes back out if it is refunded.
 * - `vigPaid`: all commission charged so far, net of refunds.
 * - `wagered`: the stakes of every decision so far (wins, losses and pushes). A stake that stays up
 *   after a decision counts again at its next one. The glossary's "amount risked" adds the
 *   commission paid up front (placement, increases, re-collection) but not commission taken from a
 *   win, which `vigPaid` also holds (plan §0 #22).
 */
export interface Ledger {
  readonly deposits: Cents
  readonly bankroll: Cents
  readonly houseNet: Cents
  readonly vigPaid: Cents
  readonly wagered: Cents
}

export function newLedger(bankroll: Cents): Ledger {
  const zero = cents(0)
  return { deposits: bankroll, bankroll, houseNet: zero, vigPaid: zero, wagered: zero }
}

/** The player adds credit. */
export function deposit(ledger: Ledger, amount: Cents): Ledger {
  return {
    ...ledger,
    deposits: cents(ledger.deposits + amount),
    bankroll: cents(ledger.bankroll + amount),
  }
}

/** `delta` moves from the player's credit onto a bet (or back, when it is negative). */
export function stake(ledger: Ledger, delta: number): Ledger {
  return { ...ledger, bankroll: cents(ledger.bankroll - delta) }
}

/** Commission charged from credit: it goes straight to the house. */
export function chargeVig(ledger: Ledger, amount: Cents): Ledger {
  return {
    ...ledger,
    bankroll: cents(ledger.bankroll - amount),
    houseNet: cents(ledger.houseNet + amount),
    vigPaid: cents(ledger.vigPaid + amount),
  }
}

/** Commission refunded to credit, reversing `chargeVig`. */
export function refundVig(ledger: Ledger, amount: Cents): Ledger {
  return chargeVig(ledger, cents(-amount))
}

/**
 * A settled bet: `credited` reaches the player's credit, and a stake that does not stay up leaves
 * the table. Whatever leaves the table without reaching the player went to the house, and whatever
 * the player receives beyond the stake came from it.
 */
export function settleInto(ledger: Ledger, trace: SettlementTrace): Ledger {
  const released = trace.stakeDisposition === 'stays' ? 0 : trace.stake
  return {
    ...ledger,
    bankroll: cents(ledger.bankroll + trace.credited),
    houseNet: cents(ledger.houseNet + released - trace.credited),
    vigPaid: cents(ledger.vigPaid + trace.vigOnWin + trace.vigRearm),
    wagered: cents(ledger.wagered + trace.stake),
  }
}

/** Σ bet.amount: the money on the table. */
export function onTable(bets: readonly BetInstance[]): Cents {
  return cents(bets.reduce((sum, bet) => sum + bet.amount, 0))
}

/** How far the ledger is from balancing against `bets`: 0 when the invariant holds. */
export function imbalance(ledger: Ledger, bets: readonly BetInstance[]): number {
  return ledger.deposits - (ledger.bankroll + onTable(bets) + ledger.houseNet)
}
