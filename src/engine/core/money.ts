import { Fraction } from './rational.ts'

/**
 * Whole cents. Every bankroll, bet and payout amount is an integer number of cents. The brand
 * makes the compiler insist that a plain number passes through `cents()` before it counts as money.
 */
export type Cents = number & { readonly __brand: 'Cents' }

/** Brands `value` as money, or throws if it is not a whole, safe number of cents. */
export function cents(value: number): Cents {
  assertCents(value)
  return value
}

export function assertCents(value: number, label = 'amount'): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be whole cents, got ${value}`)
  }
}

/**
 * An exact, non-negative rate `num / den`: a 7:6 payout or a 1:20 (5%) commission. A parsed
 * `Ratio` from `config/ratio.ts` fits, and so does a `Fraction`.
 */
export interface RatioLike {
  readonly num: bigint
  readonly den: bigint
}

/**
 * Every way an exact amount can become payable money. `halfUp` sends an exact half to the larger
 * amount; `halfEven` sends it to the even number of increments, so ties don't all lean one way.
 * The machine-config schema validates rounding modes against this list.
 */
export const ROUNDING_MODES = ['floor', 'ceil', 'halfUp', 'halfEven'] as const

export type RoundingMode = (typeof ROUNDING_MODES)[number]

/**
 * How a machine turns an exact amount into one it can pay: a whole number of `increment`s.
 * Bubble machines pay to the penny (`increment: 1`); live tables pay in chip units and drop the
 * remainder (`{ mode: 'floor', increment: 100 }` floors to whole dollars).
 */
export interface Rounding {
  readonly mode: RoundingMode
  readonly increment: Cents
}

export const TO_THE_PENNY: Rounding = { mode: 'floor', increment: cents(1) }

/** Digits, then optionally a point and one or two more digits: "12", "12.5", "12.34". */
const DOLLARS = /^(\d+)(?:\.(\d{1,2}))?$/

/**
 * Reads a dollar amount the user typed, such as "12", "12.5" or "0.01", as whole cents. It uses
 * integer arithmetic only, so no binary-float rounding can creep in. Signs, spaces, "$",
 * thousands separators, exponents and a third decimal are all rejected rather than guessed at.
 */
export function parseDollars(text: string): Cents {
  const match = DOLLARS.exec(text)
  if (match === null) {
    throw new RangeError(`"${text}" is not a dollar amount such as 12, 12.5 or 12.34`)
  }
  const [, whole = '', fraction = ''] = match
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`"${text}" is too large to hold as whole cents`)
  }
  return cents(Number(amount))
}

/** Converts typed-in dollars, refusing anything that is not a whole number of cents. */
export function dollarsToCents(dollars: number): Cents {
  const amount = Math.round(dollars * 100)
  if (!Number.isSafeInteger(amount) || Math.abs(amount - dollars * 100) > 1e-6) {
    throw new RangeError(`${dollars} is not a whole number of cents`)
  }
  return cents(amount)
}

/**
 * Rounds a non-negative exact amount of cents to a whole number of `rounding.increment`s. This is
 * the one place a settlement's exact value becomes payable money, so it uses bigint only.
 */
export function roundCents(exact: Fraction, rounding: Rounding): Cents {
  if (exact.isNegative()) throw new RangeError(`Cannot round a negative amount: ${exact}`)
  assertCents(rounding.increment, 'rounding increment')
  if (rounding.increment <= 0) throw new RangeError('Rounding increment must be positive')
  const increment = BigInt(rounding.increment)
  const unit = exact.den * increment // one increment, in the same denominator as `exact`
  const whole = exact.num / unit
  const twiceRest = 2n * (exact.num % unit)
  return cents(Number(roundUnits(whole, twiceRest, unit, rounding.mode) * increment))
}

/** `whole` increments plus a remainder of `twiceRest / 2` out of `unit`, rounded by `mode`. */
function roundUnits(whole: bigint, twiceRest: bigint, unit: bigint, mode: RoundingMode): bigint {
  switch (mode) {
    case 'floor':
      return whole
    case 'ceil':
      return twiceRest === 0n ? whole : whole + 1n
    case 'halfUp':
      return twiceRest < unit ? whole : whole + 1n
    case 'halfEven':
      if (twiceRest === unit) return whole % 2n === 0n ? whole : whole + 1n
      return twiceRest < unit ? whole : whole + 1n
    default:
      // Configs arrive as JSON, so an unknown mode can reach here despite the type.
      throw new RangeError(`Unknown rounding mode: ${String(mode)}`)
  }
}

/**
 * Profit on a winning wager: `stake × pays`, rounded by the machine's rule. The stake itself is
 * returned separately.
 */
export function winnings(stake: Cents, pays: RatioLike, rounding: Rounding): Cents {
  assertCents(stake, 'stake')
  return roundCents(Fraction.of(stake).mul(Fraction.of(pays.num, pays.den)), rounding)
}

export interface Commission {
  /** Share of the base that is charged, e.g. 1:20 for the standard 5% vig. */
  readonly rate: RatioLike
  readonly rounding: Rounding
  /** Smallest commission charged: $1 on many live tables, 0 on machines that charge exact 5%. */
  readonly minimum: Cents
}

/** Commission owed on `base` (the bet for buy bets, the potential win for lay bets). */
export function commissionOn(base: Cents, commission: Commission): Cents {
  assertCents(base, 'commission base')
  if (base === 0) return cents(0)
  const rate = Fraction.of(commission.rate.num, commission.rate.den)
  const exact = roundCents(Fraction.of(base).mul(rate), commission.rounding)
  return cents(Math.max(exact, commission.minimum))
}

export function formatCents(amount: Cents, options: { trimWholeDollars?: boolean } = {}): string {
  assertCents(amount)
  const sign = amount < 0 ? '-' : ''
  const absolute = Math.abs(amount)
  const dollars = Math.floor(absolute / 100).toLocaleString('en-US')
  const remainder = absolute % 100
  if (options.trimWholeDollars && remainder === 0) return `${sign}$${dollars}`
  return `${sign}$${dollars}.${String(remainder).padStart(2, '0')}`
}
