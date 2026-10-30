import { describe, expect, it } from 'vitest'
import { Fraction } from '../engine/core/rational.ts'
import { cents } from '../engine/core/money.ts'
import {
  formatCoachNumber,
  formatDecimal,
  formatMoneyExact,
  formatMoneyFraction,
  formatPart,
  roundedCents,
} from './format.ts'
import { coachNumber } from './numbers.ts'
import type { CoachNumberKind, CoachSource } from './types.ts'

const SOURCE: CoachSource = { fn: 'test', args: null, configHash: 'cfg' }

function n(kind: CoachNumberKind, exact: Fraction | ReturnType<typeof cents>) {
  return coachNumber(kind, exact, SOURCE)
}

describe('formatCoachNumber', () => {
  it('formats percents to two decimals, half away from zero', () => {
    expect(formatCoachNumber(n('percent', Fraction.of(17, 1100)))).toBe('1.55%')
    expect(formatCoachNumber(n('percent', Fraction.of(1, 66)))).toBe('1.52%')
    expect(formatCoachNumber(n('percent', Fraction.of(373, 6930)))).toBe('5.38%')
    expect(formatCoachNumber(n('percent', Fraction.of(1, 21)))).toBe('4.76%')
  })

  it('formats probabilities to one decimal', () => {
    expect(formatCoachNumber(n('probability', Fraction.of(5, 11)))).toBe('45.5%')
    expect(formatCoachNumber(n('probability', Fraction.of(1, 7)))).toBe('14.3%')
  })

  it('formats machine-paid money from integer cents, exactly', () => {
    expect(formatCoachNumber(n('money', cents(583)))).toBe('$5.83')
    expect(formatCoachNumber(n('money', cents(0)))).toBe('$0.00')
  })

  it('marks an expectation that is not whole cents as approximate', () => {
    expect(formatCoachNumber(n('money', Fraction.of(2000, 7)))).toBe('≈ $2.86')
    expect(formatCoachNumber(n('money', Fraction.of(500)))).toBe('$5.00')
  })

  it('formats rolls, counts, ratios and per-hour figures', () => {
    expect(formatCoachNumber(n('rolls', Fraction.of(27, 8)))).toBe('3.4')
    expect(formatCoachNumber(n('count', Fraction.of(5)))).toBe('5')
    expect(formatCoachNumber(n('ratio', Fraction.of(7, 6)))).toBe('7/6')
    expect(formatCoachNumber(n('perHour', Fraction.of(1_293)))).toBe('$12.93/hr')
  })
})

describe('formatPart', () => {
  it('passes strings through and formats numbers by kind', () => {
    expect(formatPart(' × ')).toBe(' × ')
    expect(formatPart(n('percent', Fraction.of(17, 1100)))).toBe('1.55%')
  })

  it('renders the exact style as unrounded money', () => {
    expect(formatPart({ n: n('money', Fraction.of(1750, 3)), style: 'exact' })).toBe('$5.833…')
  })
})

describe('formatMoneyExact', () => {
  it('shows three decimals with an ellipsis when more follow', () => {
    expect(formatMoneyExact(Fraction.of(1750, 3))).toBe('$5.833…') // 583.33…¢
    expect(formatMoneyExact(Fraction.of(583))).toBe('$5.83')
    expect(formatMoneyExact(Fraction.of(1167, 2))).toBe('$5.835') // 583.5¢
    expect(formatMoneyExact(Fraction.of(5))).toBe('$0.05')
    expect(formatMoneyExact(Fraction.of(-583))).toBe('-$5.83')
  })
})

describe('roundedCents', () => {
  it('rounds half away from zero in exact arithmetic', () => {
    expect(roundedCents(Fraction.of(2000, 7))).toBe(286) // 285.71…
    expect(roundedCents(Fraction.of(-2000, 7))).toBe(-286)
    expect(roundedCents(Fraction.of(1, 2))).toBe(1)
    expect(roundedCents(Fraction.of(-1, 2))).toBe(-1)
    expect(roundedCents(Fraction.of(583))).toBe(583)
  })
})

describe('formatDecimal', () => {
  it('prints exactly the asked decimals, half away from zero', () => {
    expect(formatDecimal(Fraction.of(27, 8), 1)).toBe('3.4')
    expect(formatDecimal(Fraction.of(1, 3), 2)).toBe('0.33')
    expect(formatDecimal(Fraction.of(5), 0)).toBe('5')
    expect(formatDecimal(Fraction.of(-27, 8), 1)).toBe('-3.4')
  })
})

describe('formatMoneyFraction', () => {
  it('is exact for whole cents, approximate otherwise', () => {
    expect(formatMoneyFraction(Fraction.of(600))).toBe('$6.00')
    expect(formatMoneyFraction(Fraction.of(100, 11))).toBe('≈ $0.09')
  })
})
