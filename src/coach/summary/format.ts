import { Fraction } from '../../engine/index.ts'
import { formatCoachNumber } from '../format.ts'
import type { CoachNumber } from '../types.ts'

/**
 * Signed money for the session summary's result lines (plan §5.7): a gain reads "+$70.00" and a
 * loss "-$4.13", an approximate figure "≈ +$69.18", always through `formatCoachNumber`, so the
 * value shown is the computed `CoachNumber` and nothing else. Kept apart from the summary itself
 * so the UI can import it without loading the solver.
 */
export function formatSignedMoney(n: CoachNumber): string {
  const text = formatCoachNumber(n)
  const value = typeof n.exact === 'number' ? Fraction.of(n.exact) : n.exact
  if (value.compare(Fraction.ZERO) <= 0) return text
  return text.startsWith('≈ ') ? `≈ +${text.slice(2)}` : `+${text}`
}

/** The sign of a money number, for styling: up, down or even. */
export function trendOf(n: CoachNumber): 'up' | 'down' | 'even' {
  const value = typeof n.exact === 'number' ? Fraction.of(n.exact) : n.exact
  const sign = value.compare(Fraction.ZERO)
  return sign > 0 ? 'up' : sign < 0 ? 'down' : 'even'
}
