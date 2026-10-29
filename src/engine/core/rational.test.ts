import { describe, expect, it } from 'vitest'
import { Fraction } from './rational.ts'

describe('Fraction', () => {
  it('normalizes sign and common factors', () => {
    expect(Fraction.of(2, 4).toString()).toBe('1/2')
    expect(Fraction.of(3, -6).toString()).toBe('-1/2')
    expect(Fraction.of(-3, -6).toString()).toBe('1/2')
    expect(Fraction.of(0, 5).toString()).toBe('0')
    expect(Fraction.of(6, 3).toString()).toBe('2')
  })

  it('does exact arithmetic', () => {
    const half = Fraction.of(1, 2)
    const third = Fraction.of(1, 3)
    expect(half.add(third).toString()).toBe('5/6')
    expect(half.sub(third).toString()).toBe('1/6')
    expect(Fraction.of(2, 3).mul(Fraction.of(3, 4)).toString()).toBe('1/2')
    expect(half.div(Fraction.of(1, 4)).toString()).toBe('2')
    expect(half.neg().toString()).toBe('-1/2')
    expect(Fraction.sum([third, third, third]).equals(Fraction.ONE)).toBe(true)
    expect(Fraction.sum([]).isZero()).toBe(true)
  })

  it('compares and converts', () => {
    expect(Fraction.of(1, 3).compare(Fraction.of(1, 2))).toBe(-1)
    expect(Fraction.of(2, 4).compare(Fraction.of(1, 2))).toBe(0)
    expect(Fraction.of(3, 4).compare(Fraction.of(1, 2))).toBe(1)
    expect(Fraction.of(-1, 8).isNegative()).toBe(true)
    expect(Fraction.of(7, 495).toNumber()).toBeCloseTo(0.014141, 6)
  })

  it('rejects invalid input', () => {
    expect(() => Fraction.of(1, 0)).toThrow(RangeError)
    expect(() => Fraction.of(1.5)).toThrow(RangeError)
    expect(() => Fraction.ONE.div(Fraction.ZERO)).toThrow(RangeError)
  })
})
