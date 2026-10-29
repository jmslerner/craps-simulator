import type { MachineConfig, OddsBetType, TypeLimits } from '../config/compile.ts'
import type { PointNumber } from '../config/rulesets.ts'
import { cents, roundCents, type Cents } from '../core/money.ts'
import { Fraction } from '../core/rational.ts'
import { onTable } from '../table/ledger.ts'
import type { TableState } from '../table/state.ts'
import { reject, type BetInstance, type Rejection } from './types.ts'

/**
 * Money limits (plan §4.6 steps 3–5): per-type minimums, maximums and increments, the table
 * maximum, the odds cap and the credit a bet can draw on; and the checks a roll makes on the table
 * it is about to roll (rules spec §2.3 step 9): the round's minimum, credit and limits.
 */

/**
 * The limits for a bet of `typeId` on `number`, with the config's defaults for a type that sets
 * none. On a number with a unit of its own (`/limits/perType/<t>/incrementByNumber`; for odds, the
 * parent's point) the increment is that unit: a live table takes odds on 6 in $5 units. Leave out
 * the number for the type's own increment.
 */
export function typeLimits(
  cfg: MachineConfig,
  typeId: string,
  number: PointNumber | null = null,
): TypeLimits {
  const limits = cfg.limits.byType.get(typeId) ?? {
    min: cfg.limits.min,
    max: cfg.limits.max,
    increment: cfg.betIncrement,
  }
  const unit = number === null ? undefined : cfg.limits.incrementByNumber.get(typeId)?.get(number)
  return unit === undefined ? limits : { ...limits, increment: unit }
}

/**
 * The smallest amount `limits` take for a new bet: the minimum, rounded up to the increment (a
 * per-number unit can be coarser than the type's minimum).
 */
export function smallestBet(limits: TypeLimits): Cents {
  const { min, increment } = limits
  return cents(min + ((increment - (min % increment)) % increment))
}

/** A bet's total amount against its type's limits: at least the minimum, at most the maximum, on the increment. */
export function checkAmount(amount: Cents, limits: TypeLimits, typeId: string): Rejection | null {
  if (amount < limits.min) return reject('BELOW_MIN', { typeId, amount, min: limits.min })
  if (amount > limits.max) return reject('ABOVE_MAX', { typeId, amount, max: limits.max })
  if (amount % limits.increment !== 0) {
    return reject('BAD_INCREMENT', { typeId, amount, increment: limits.increment })
  }
  return null
}

/** Adding `delta` to the table must keep everything on it within `/limits/tableMax`, if set. */
export function checkTableMax(
  state: TableState,
  delta: number,
  cfg: MachineConfig,
): Rejection | null {
  const { tableMax } = cfg.limits
  if (tableMax === null || delta <= 0) return null
  const total = onTable(state.bets) + delta
  return total > tableMax ? reject('TABLE_MAX', { total, tableMax }) : null
}

/**
 * The most odds of `type` that `parent` allows on its number (rules spec §4.4):
 * - basis `stake`: multiple × flat (take odds, and Shoot To Win's don't pass lay);
 * - basis `win`: the lay whose win is at most multiple × flat, i.e. multiple × flat ÷ the lay ratio
 *   (the standard don't-side rule);
 *
 * then rounded down to the odds type's bet increment on that number (research §4.4 [A]; a live
 * table's $5 unit on 6 and 8). A parent with no number allows none.
 */
export function oddsCap(type: OddsBetType, parent: BetInstance, cfg: MachineConfig): Cents {
  const n = parent.number
  if (n === null) return cents(0)
  const multiple = type.limit.multiple.get(n) ?? 0
  let cap = Fraction.of(parent.amount).mul(Fraction.of(multiple))
  if (type.limit.basis === 'win') {
    const pays = type.pays.get(n)
    if (pays === undefined) return cents(0)
    cap = cap.div(Fraction.of(pays.num, pays.den))
  }
  return roundCents(cap, { mode: 'floor', increment: typeLimits(cfg, type.typeId, n).increment })
}

/** The most odds the config lets `parent` carry (plan §4.6 `maxOdds`); 0 when it takes none. */
export function maxOdds(parent: BetInstance, cfg: MachineConfig): Cents {
  const oddsId = cfg.oddsFor.get(parent.typeId)
  const type = oddsId === undefined ? undefined : cfg.catalog.get(oddsId)
  return type?.family === 'odds' ? oddsCap(type, parent, cfg) : cents(0)
}

/**
 * The credit a bet or an increase can draw on. Every bet on the table has already taken its amount
 * out of the bankroll, ON or OFF, so this is the bankroll on every machine. Shoot To Win's OFF chips
 * "do not consume a player's credit" (`/offBets/consumeCredit: false`, rules spec §4.5), but
 * letting a player bet an OFF chip's stake elsewhere would leave that chip unfunded when it comes
 * back ON, which the ledger cannot hold (bankroll ≥ 0, every stake on the table); so the knob does
 * not change credit yet (M4b reading, an open item for the integrator).
 */
export function availableCredit(state: TableState): Cents {
  return state.ledger.bankroll
}

/**
 * Whether `bet` counts toward the round's minimum (`/limits/minTotal`, rules spec §2.3 step 9,
 * §2.5): only a bet that works on the roll, unless `countOff` (Interblock: OFF bets "don't satisfy
 * it"; Shoot To Win: OFF chips "do not contribute to the minimum bet"), and a side bet only where
 * `countSideBets` (§9 #11: no [A]). `isWorking` is `effectiveWorking` for this table; it is passed
 * in so that this file need not import the registry, which imports the families, which import it.
 */
export function countsTowardMinimum(
  bet: BetInstance,
  cfg: MachineConfig,
  isWorking: (bet: BetInstance) => boolean,
): boolean {
  const rule = cfg.limits.minTotal
  if (rule === null) return false
  if (cfg.sideBets.has(bet.typeId)) return rule.countSideBets
  return rule.countOff || isWorking(bet)
}

/**
 * The round's minimum, checked when the dice are rolled (`/limits/minTotal`; rules spec §2.3 step 9,
 * §2.5): the bets that count must add up to `amount` (`totalRound`), or each be at least `amount`
 * (`perBet`). An empty table fails a `totalRound` minimum, as Interblock's round "will not start
 * until bets are valid" (research sidebets.md). The rejection says how much more is needed, `short`
 * in cents: Interblock shows it as "BETS ARE NOT VALID YET! – Must bet N credits more!".
 */
export function checkMinTotal(
  state: TableState,
  cfg: MachineConfig,
  isWorking: (bet: BetInstance) => boolean,
): Rejection | null {
  const rule = cfg.limits.minTotal
  if (rule === null) return null
  const counted = state.bets.filter((bet) => countsTowardMinimum(bet, cfg, isWorking))
  const min = rule.amount
  if (rule.scope === 'totalRound') {
    const total = onTable(counted)
    if (total >= min) return null
    return reject('BELOW_MIN_TOTAL', { scope: 'totalRound', min, total, short: min - total })
  }
  const small = counted.find((bet) => bet.amount < min)
  if (small === undefined) return null
  const { id, typeId, amount } = small
  return reject('BELOW_MIN_TOTAL', {
    scope: 'perBet',
    min,
    betId: id,
    typeId,
    amount,
    short: min - amount,
  })
}

/**
 * The rest of a roll's checks on the table (rules spec §2.3 step 9, "credit and limits"): the
 * credit is not overdrawn, every bet is within its type's limits, and the table within its
 * maximum. Play through the reducer always passes them, since every placement and change checks
 * them and a roll never adds to a bet (the table invariants say so too); a table restored from
 * storage or an import is checked here before its dice are rolled.
 */
export function checkRollLimits(state: TableState, cfg: MachineConfig): Rejection | null {
  const { bankroll } = state.ledger
  if (bankroll < 0) return reject('INSUFFICIENT_CREDIT', { scope: 'roll', bankroll })
  for (const bet of state.bets) {
    const over = checkAmount(bet.amount, typeLimits(cfg, bet.typeId, bet.number), bet.typeId)
    if (over !== null) return { code: over.code, details: { ...over.details, betId: bet.id } }
  }
  const { tableMax } = cfg.limits
  const total = onTable(state.bets)
  if (tableMax !== null && total > tableMax) {
    return reject('TABLE_MAX', { scope: 'roll', total, tableMax })
  }
  return null
}

/**
 * The most cents any amount of the ledger, or any sum the engine forms from it, may reach: money is
 * whole, safe cents (plan §4.1), about $90 trillion.
 */
const LEDGER_CEILING = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * The most a deposit can add now (plan §4.6: extreme input is refused, never thrown): the deposits
 * and the player's money, credit plus stakes, must both stay whole, safe cents.
 */
export function depositRoom(state: TableState): Cents {
  const { deposits, bankroll } = state.ledger
  const money = BigInt(bankroll) + staked(state)
  const most = money > BigInt(deposits) ? money : BigInt(deposits)
  return cents(most >= LEDGER_CEILING ? 0 : Number(LEDGER_CEILING - most))
}

/**
 * Whether the ledger can take whatever this roll might do to it (plan §4.6). A roll moves money
 * between the player and the house, and every amount of the ledger, and every sum the engine forms
 * from them, must stay whole, safe cents. After the roll the player's money is at most their credit
 * and stakes now plus every bet's largest win (`mostWon`); the house's net, the commission paid and
 * the amount wagered move by no more than that money and the stakes. So the roll may go ahead when
 * the ledger's amounts plus twice that money fit; otherwise it is refused with `ABOVE_MAX`, `scope:
 * 'ledger'`, rather than thrown. Only a deposit in the tens of trillions of dollars, or a machine
 * with limits to match, comes near it.
 */
export function checkLedgerRoom(state: TableState, cfg: MachineConfig): Rejection | null {
  const { deposits, bankroll, houseNet, vigPaid, wagered } = state.ledger
  const won = state.bets.reduce((sum, bet) => sum + mostWon(bet, cfg), 0n)
  const money = BigInt(bankroll) + staked(state) + won
  const house = BigInt(houseNet < 0 ? -houseNet : houseNet)
  const held = BigInt(deposits) + house + BigInt(vigPaid) + BigInt(wagered)
  if (held + 2n * money <= LEDGER_CEILING) return null
  return reject('ABOVE_MAX', { scope: 'ledger', max: Number.MAX_SAFE_INTEGER })
}

/** Σ bet.amount, as a bigint, so a sum past safe cents is exact rather than thrown. */
function staked(state: TableState): bigint {
  return state.bets.reduce((sum, bet) => sum + BigInt(bet.amount), 0n)
}

/**
 * The most `bet` can win on one roll, in whole cents: its stake at its type's largest pay, rounded
 * up, plus the largest rounding step its type pays in. A type the config does not offer (a side bet
 * before M11) wins nothing.
 */
function mostWon(bet: BetInstance, cfg: MachineConfig): bigint {
  const type = cfg.catalog.get(bet.typeId) ?? cfg.composites.get(bet.typeId)
  if (type === undefined) return 0n
  const pays = type.family === 'line' ? [type.pays] : [...type.pays.values()]
  const steps = [
    type.payoutRounding,
    ...(type.family === 'numberVsSeven' ? type.payoutRoundingByNumber.values() : []),
  ].map((rounding) => BigInt(rounding.increment))
  const amount = BigInt(bet.amount)
  const won = pays.map(({ num, den }) => (amount * num + den - 1n) / den)
  return [...won, 0n].reduce((a, b) => (a > b ? a : b)) + steps.reduce((a, b) => (a > b ? a : b))
}
