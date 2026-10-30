import { describe, expect, it } from 'vitest'
import { Fraction } from '../engine/core/rational.ts'
import { gradeOf } from './policy.ts'

describe('gradeOf', () => {
  it('grades edges at the plan §5.4 thresholds, inclusive at each bound', () => {
    expect(gradeOf(Fraction.of(0))).toBe('excellent')
    expect(gradeOf(Fraction.of(1, 200))).toBe('excellent') // exactly 0.5%
    expect(gradeOf(Fraction.of(1, 199))).toBe('good')
    expect(gradeOf(Fraction.of(1, 66))).toBe('good') // place 6/8
    expect(gradeOf(Fraction.of(1, 50))).toBe('good') // exactly 2%
    expect(gradeOf(Fraction.of(1, 21))).toBe('fair') // buy, upfront re-collected
    expect(gradeOf(Fraction.of(373, 6930))).toBe('fair') // crapless pass
    expect(gradeOf(Fraction.of(11, 200))).toBe('fair') // exactly 5.5%
    expect(gradeOf(Fraction.of(1, 18))).toBe('poor') // the 2:1 field
    expect(gradeOf(Fraction.of(1, 10))).toBe('poor') // exactly 10%
    expect(gradeOf(Fraction.of(1, 9))).toBe('awful')
    expect(gradeOf(Fraction.of(1, 6))).toBe('awful')
  })
})
