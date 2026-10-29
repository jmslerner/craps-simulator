import {
  Fraction,
  commissionRule,
  heldOffOf,
  requireType,
  type BetId,
  type BetInstance,
  type Cents,
  type MachineConfig,
  type TableState,
} from '../engine/index.ts'
import { ExactError, type BetSpec, type StartContext } from './chain.ts'
import { distribution, price } from './price.ts'
import { startAt } from './start.ts'

/**
 * Equity: what a bet already on the table is worth (plan §5.1, glossary "Equity"):
 *
 *   V(bet, table) = E[cash the bet's current decision still returns]
 *
 * under the policy "leave it up until it is decided", with a stake left up after a win counted as
 * returned (it is wagered again as a new decision). A $10 crapless pass on point 2 is worth
 * 2 × $10 × 1/7 = $20/7: it wins $10 plus its stake with P = 1/7, which is why it cannot come down.
 * The decision cost of an action is its outlay − ΔV.
 *
 * The analysis starts from the table as it is: the phase, the bet's own ON/OFF, the button, the
 * machine's hold (`heldOff`), and whether it was carried from an earlier window. A bet that would
 * never be decided from there (Interblock's place bet held OFF after a seven-out, with no Set bets
 * On to come) is worth what taking it down returns.
 */

export interface ExistingAnalysis {
  readonly betId: BetId
  readonly spec: BetSpec
  readonly amount: Cents
  /** Whether the bet will be decided if nothing is switched from now on. */
  readonly resolves: boolean
  /** V: E[cash its current decision returns], a stake left up counted as returned; in cents. */
  readonly equity: Fraction
  /** amount − V: the expected loss the bet locks in from now, in cents. */
  readonly expectedLossFromNow: Fraction
  /**
   * E[loss from now until the bet comes down for good], winners left up and commission collected
   * again included; in cents. Null when it may never be decided.
   */
  readonly lifetimeLossFromNow: Fraction | null
}

/** The equity of bet `betId` on table `state`. Throws a `RangeError` for a bet not on it. */
export function analyzeExisting(
  betId: BetId,
  state: TableState,
  cfg: MachineConfig,
): ExistingAnalysis {
  const bet = state.bets.find((b) => b.id === betId)
  if (bet === undefined) throw new RangeError(`No bet ${betId} on the table`)
  const spec: BetSpec = { typeId: bet.typeId, number: bet.number }
  const start = startOfBet(bet, state)
  try {
    const now = distribution(spec, start, 'decision', cfg)
    const equity = price(now, bet.amount, cfg, 'rounded').credited
    const life = distribution(spec, start, 'lifetime', cfg)
    const priced = price(life, bet.amount, cfg, 'rounded')
    return {
      betId,
      spec,
      amount: bet.amount,
      resolves: true,
      equity,
      expectedLossFromNow: Fraction.of(bet.amount).sub(equity),
      lifetimeLossFromNow: Fraction.of(bet.amount).add(priced.rearmed).sub(priced.credited),
    }
  } catch (error) {
    if (!(error instanceof ExactError) || error.code !== 'NEVER_RESOLVES') throw error
    const equity = takeDownValue(bet, state, cfg)
    return {
      betId,
      spec,
      amount: bet.amount,
      resolves: false,
      equity,
      expectedLossFromNow: Fraction.of(bet.amount).sub(equity),
      lifetimeLossFromNow: null,
    }
  }
}

/** Where a bet on the table starts: its phase and working inputs as they stand. */
export function startOfBet(bet: BetInstance, state: TableState): StartContext {
  return startAt(state.round.phase, {
    carried: bet.placedAtRoll < state.round.rollIndex,
    working: bet.working,
    globalOff: state.globalOff,
    held: heldOffOf(state).includes(bet.id),
  })
}

/**
 * What taking `bet` down returns now: its stake, and the up-front vig it holds where the machine
 * refunds it; nothing for a bet that cannot come down.
 */
export function takeDownValue(bet: BetInstance, state: TableState, cfg: MachineConfig): Fraction {
  const { family, type } = requireType(cfg, bet.typeId)
  if (!family.mutability(bet, state, type, cfg).remove) return Fraction.ZERO
  const rule = type.family === 'numberVsSeven' ? commissionRule(type, bet.number) : null
  const refund = rule?.refundOnTakeDown === true ? bet.vigHeld : 0
  return Fraction.of(bet.amount + refund)
}
