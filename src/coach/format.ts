import { Fraction, cents, formatCents, type Cents } from '../engine/index.ts'
import type { CoachNumber, TemplatePart } from './types.ts'

/**
 * How a `CoachNumber` reads on screen (plan §5.3). Formatting is presentation only — the exact
 * value stays inside the number — and it never touches floats: percents go through
 * `Fraction.formatPercent` and money through bigint rounding into `formatCents`. An expectation
 * that is not a whole number of cents is marked approximate ("≈ $2.86"), so the UI never claims
 * an exact dollar amount the machine would not pay.
 */

export function formatCoachNumber(n: CoachNumber): string {
  switch (n.kind) {
    case 'percent':
      return `${frac(n).formatPercent(2)}%`
    case 'probability':
      return `${frac(n).formatPercent(1)}%`
    case 'money':
      return typeof n.exact === 'number' ? formatCents(n.exact) : formatMoneyFraction(n.exact)
    case 'perHour':
      return `${typeof n.exact === 'number' ? formatCents(n.exact) : formatMoneyFraction(n.exact)}/hr`
    case 'rolls':
      return formatDecimal(frac(n), 1)
    case 'ratio':
      return frac(n).toString()
    case 'count':
      return formatDecimal(frac(n), 0)
  }
}

/** A template part as text: literal strings pass through, numbers are formatted by kind. */
export function formatPart(part: TemplatePart): string {
  if (typeof part === 'string') return part
  if (isStyled(part)) return formatMoneyExact(frac(part.n))
  return formatCoachNumber(part)
}

/** A styled part is `{ n, style }`; a `CoachNumber` itself never carries a `style` key. */
function isStyled(
  part: TemplatePart,
): part is { readonly n: CoachNumber; readonly style: 'exact' } {
  return typeof part === 'object' && 'style' in part
}

/** The number's value as a `Fraction` (cents stay what they are, as a fraction over 1). */
function frac(n: CoachNumber): Fraction {
  return typeof n.exact === 'number' ? Fraction.of(n.exact) : n.exact
}

/**
 * An exact money `Fraction` (cents), shown to the cent: whole cents print plainly ("$5.00"),
 * anything else is approximate ("≈ $2.86"), rounded half away from zero in bigint arithmetic.
 */
export function formatMoneyFraction(value: Fraction): string {
  const rounded = roundedCents(value)
  const exact = value.equals(Fraction.of(rounded))
  return exact ? formatCents(rounded) : `≈ ${formatCents(rounded)}`
}

/**
 * Money unrounded, for derivations: "$5.833…" for 35/6 dollars — three decimals of a dollar, an
 * ellipsis when more follow, trailing mill dropped when the cent is exact ("$5.83", "$5.835").
 */
export function formatMoneyExact(value: Fraction): string {
  const sign = value.isNegative() ? '-' : ''
  const abs = value.abs()
  // abs is in cents; print dollars with 3 decimals (cent + mill) and mark any remainder.
  const mills = abs.mul(Fraction.of(10))
  const whole = mills.floorDiv(Fraction.of(1))
  const remainder = !mills.equals(Fraction.of(whole))
  const text = whole.toString().padStart(4, '0')
  const dollars = text.slice(0, -3)
  const centsPart = text.slice(-3, -1)
  const mill = text.slice(-1)
  const tail = mill === '0' && !remainder ? '' : mill
  return `${sign}$${dollars}.${centsPart}${tail}${remainder ? '…' : ''}`
}

/** A money `Fraction` of cents rounded half away from zero to whole cents. */
export function roundedCents(value: Fraction): Cents {
  const sign = value.isNegative() ? -1 : 1
  const abs = value.abs().add(Fraction.of(1, 2))
  const units = abs.floorDiv(Fraction.of(1))
  return cents(sign * Number(units))
}

/** A `Fraction` as a plain decimal with exactly `digits` decimals, half away from zero. */
export function formatDecimal(value: Fraction, digits: number): string {
  const sign = value.isNegative() ? '-' : ''
  const scale = Fraction.of(10n ** BigInt(digits))
  const scaled = value.abs().mul(scale).add(Fraction.of(1, 2))
  const units = scaled.floorDiv(Fraction.of(1))
  const text = units.toString().padStart(digits + 1, '0')
  if (digits === 0) return `${sign}${text}`
  return `${sign}${text.slice(0, -digits)}.${text.slice(-digits)}`
}
