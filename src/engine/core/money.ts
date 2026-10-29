import { Fraction } from './rational.ts'

/** Whole cents. Every bankroll, bet and payout amount is an integer number of cents. */
export type Cents = number

/** `num : den`, e.g. a 7:6 place-6 payout or a 1:20 (5%) commission rate. */
export interface Ratio {
  readonly num: number
  readonly den: number
}

export function ratio(num: number, den: number): Ratio {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num < 0 || den <= 0) {
    throw new RangeError(`Invalid ratio ${num}:${den}`)
  }
  return { num, den }
}

export function ratioToFraction(r: Ratio): Fraction {
  return Fraction.of(r.num, r.den)
}

/**
 * How a machine turns an exact amount into something it can pay.
 * Bubble machines pay "to the penny" (`increment: 1`); live tables pay in chip
 * units and drop the remainder (e.g. `increment: 100` floors to whole dollars).
 */
export interface Rounding {
  readonly mode: 'floor' | 'nearest'
  readonly increment: Cents
}

export const TO_THE_PENNY: Rounding = { mode: 'floor', increment: 1 }

export function assertCents(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be whole cents, got ${value}`)
}

export function dollarsToCents(dollars: number): Cents {
  const cents = Math.round(dollars * 100)
  if (!Number.isSafeInteger(cents) || Math.abs(cents - dollars * 100) > 1e-6) {
    throw new RangeError(`${dollars} is not a whole number of cents`)
  }
  return cents
}

/** Rounds a non-negative exact amount of cents to a payable amount. Halves round up in `nearest` mode. */
export function roundCents(amount: Fraction, rounding: Rounding): Cents {
  if (amount.isNegative()) throw new RangeError(`Cannot round a negative amount: ${amount}`)
  assertCents(rounding.increment, 'rounding increment')
  if (rounding.increment <= 0) throw new RangeError('Rounding increment must be positive')
  const increment = BigInt(rounding.increment)
  const units =
    rounding.mode === 'floor'
      ? amount.num / (amount.den * increment)
      : (2n * amount.num + amount.den * increment) / (2n * amount.den * increment)
  return Number(units * increment)
}

/** Profit on a winning wager: `stake × payout`, rounded per the machine's rule. The stake itself is returned separately. */
export function winnings(stake: Cents, payout: Ratio, rounding: Rounding): Cents {
  assertCents(stake, 'stake')
  return roundCents(Fraction.of(stake).mul(ratioToFraction(payout)), rounding)
}

export interface Commission {
  /** Share of the base that is charged, e.g. 1:20 for the standard 5% vig. */
  readonly rate: Ratio
  readonly rounding: Rounding
  /** Smallest commission ever charged, e.g. $1 on many live tables; 0 on machines that charge exact 5%. */
  readonly minimum: Cents
}

/** Commission owed on `base` (the bet for buy bets, the potential win for lay bets). */
export function commissionOn(base: Cents, commission: Commission): Cents {
  assertCents(base, 'commission base')
  if (base === 0) return 0
  const exact = roundCents(Fraction.of(base).mul(ratioToFraction(commission.rate)), commission.rounding)
  return Math.max(exact, commission.minimum)
}

export function formatCents(cents: Cents, options: { trimWholeDollars?: boolean } = {}): string {
  assertCents(cents)
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const dollars = Math.floor(absolute / 100).toLocaleString('en-US')
  const remainder = absolute % 100
  if (options.trimWholeDollars && remainder === 0) return `${sign}$${dollars}`
  return `${sign}$${dollars}.${String(remainder).padStart(2, '0')}`
}
