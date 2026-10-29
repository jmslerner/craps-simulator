import fc from 'fast-check'
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

describe('min, max and abs', () => {
  const third = Fraction.of(1, 3)
  const half = Fraction.of(1, 2)

  it('pick the smaller or larger value', () => {
    expect(third.min(half)).toBe(third)
    expect(half.min(third)).toBe(third)
    expect(third.max(half)).toBe(half)
    expect(half.max(third)).toBe(half)
    expect(half.neg().max(Fraction.ZERO)).toBe(Fraction.ZERO)
    expect(Fraction.of(2, 4).min(half).equals(half)).toBe(true)
  })

  it('takes the absolute value', () => {
    expect(half.neg().abs().equals(half)).toBe(true)
    expect(half.abs()).toBe(half)
    expect(Fraction.ZERO.abs().isZero()).toBe(true)
  })
})

describe('floorDiv', () => {
  const f = (num: number, den = 1) => Fraction.of(num, den)

  it('rounds the quotient toward minus infinity', () => {
    expect(f(7).floorDiv(f(2))).toBe(3n)
    expect(f(-7).floorDiv(f(2))).toBe(-4n)
    expect(f(7).floorDiv(f(-2))).toBe(-4n)
    expect(f(-7).floorDiv(f(-2))).toBe(3n)
    expect(f(6).floorDiv(f(3))).toBe(2n)
    expect(f(-6).floorDiv(f(3))).toBe(-2n)
    expect(f(0).floorDiv(f(5))).toBe(0n)
  })

  it('divides fractions by fractions', () => {
    expect(f(7, 3).floorDiv(f(1, 3))).toBe(7n)
    expect(f(45, 2).floorDiv(Fraction.ONE)).toBe(22n) // a $22.50 cap floors to 22 whole units
    expect(f(-1, 3).floorDiv(Fraction.ONE)).toBe(-1n)
  })

  it('agrees with the definition q <= a/b < q + 1', () => {
    fc.assert(
      fc.property(
        fc.bigInt(-(10n ** 12n), 10n ** 12n),
        fc.bigInt(1n, 10n ** 6n),
        fc.bigInt(-(10n ** 6n), 10n ** 6n).filter((n) => n !== 0n),
        fc.bigInt(1n, 10n ** 6n),
        (an, ad, bn, bd) => {
          const a = Fraction.of(an, ad)
          const b = Fraction.of(bn, bd)
          const q = Fraction.of(a.floorDiv(b))
          const exact = a.div(b)
          expect(q.compare(exact)).toBeLessThanOrEqual(0)
          expect(q.add(Fraction.ONE).compare(exact)).toBe(1)
        },
      ),
      { seed: 20261028, numRuns: 1000 },
    )
  })

  it('rejects division by zero', () => {
    expect(() => Fraction.ONE.floorDiv(Fraction.ZERO)).toThrow(RangeError)
  })
})

describe('formatPercent', () => {
  it('formats the published edges exactly', () => {
    expect(Fraction.of(1, 66).formatPercent(2)).toBe('1.52') // place 6/8
    expect(Fraction.of(373, 6930).formatPercent(2)).toBe('5.38') // crapless pass line
    expect(Fraction.of(7, 495).formatPercent(3)).toBe('1.414') // traditional pass line
    expect(Fraction.of(373, 6930).formatPercent(4)).toBe('5.3824')
  })

  it('rounds exact halves away from zero', () => {
    expect(Fraction.of(1, 800).formatPercent(2)).toBe('0.13') // 0.125%
    expect(Fraction.of(-1, 800).formatPercent(2)).toBe('-0.13')
    expect(Fraction.of(1, 200).formatPercent(0)).toBe('1') // 0.5%
    expect(Fraction.of(1, 66).formatPercent(0)).toBe('2')
  })

  it('handles zero, negatives and whole values', () => {
    expect(Fraction.ZERO.formatPercent(2)).toBe('0.00')
    expect(Fraction.of(-1, 66).formatPercent(2)).toBe('-1.52')
    expect(Fraction.of(-1, 100_000).formatPercent(2)).toBe('0.00') // no "-0.00"
    expect(Fraction.ONE.formatPercent(1)).toBe('100.0')
    expect(Fraction.of(-3).formatPercent(0)).toBe('-300')
    expect(Fraction.of(1, 20).formatPercent(2)).toBe('5.00')
    expect(Fraction.of(1, 3000).formatPercent(2)).toBe('0.03')
  })

  it('is within half a unit in the last place, ties away from zero (exact check)', () => {
    fc.assert(
      fc.property(
        fc.bigInt(-(10n ** 9n), 10n ** 9n),
        fc.bigInt(1n, 10n ** 9n),
        fc.integer({ min: 0, max: 6 }),
        (num, den, digits) => {
          const value = Fraction.of(num, den)
          const text = value.formatPercent(digits)
          expect(text).toMatch(digits === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+\\.\\d{${digits}}$`))
          const scale = 10n ** BigInt(digits)
          const shown = Fraction.of(BigInt(text.replace('.', '')), scale)
          const percent = value.mul(Fraction.of(100))
          const error = shown
            .sub(percent)
            .abs()
            .compare(Fraction.of(1n, 2n * scale))
          expect(error).toBeLessThanOrEqual(0)
          if (error === 0) expect(shown.abs().compare(percent.abs())).toBe(1)
        },
      ),
      { seed: 20261028, numRuns: 2000 },
    )
  })

  it('rejects a bad digit count', () => {
    expect(() => Fraction.ONE.formatPercent(-1)).toThrow(RangeError)
    expect(() => Fraction.ONE.formatPercent(1.5)).toThrow(RangeError)
  })
})

describe('wire codec', () => {
  const samples = [
    Fraction.ZERO,
    Fraction.ONE,
    Fraction.of(-373, 6930),
    Fraction.of(10n ** 40n, 3n),
    Fraction.of(-(2n ** 70n) - 1n, 2n ** 64n),
  ]

  it('round-trips through JSON', () => {
    for (const value of samples) {
      const wire = value.toWire()
      const restored = Fraction.fromWire(JSON.parse(JSON.stringify(wire)) as [string, string])
      expect(restored.equals(value)).toBe(true)
      expect(restored).toBeInstanceOf(Fraction)
    }
    expect(Fraction.of(-1, 3).toWire()).toEqual(['-1', '3'])
  })

  it('survives a structured clone, which drops the class itself', () => {
    const value = Fraction.of(373, 6930)
    expect(structuredClone(value)).not.toBeInstanceOf(Fraction)
    expect(Fraction.fromWire(structuredClone(value.toWire())).equals(value)).toBe(true)
  })

  it('normalizes wire values that were not written by toWire', () => {
    expect(Fraction.fromWire(['2', '4']).equals(Fraction.of(1, 2))).toBe(true)
    expect(Fraction.fromWire(['1', '-3']).toWire()).toEqual(['-1', '3'])
  })

  it('rejects anything but two integer strings with a non-zero denominator', () => {
    const bad: unknown[] = [
      ['1'],
      ['1', '2', '3'],
      ['1.5', '2'],
      ['0x10', '1'],
      ['', '1'],
      [' 1', '1'],
      ['1e3', '1'],
      [1, 2],
      [1n, 2n],
      '1/2',
      null,
      { num: '1', den: '2' },
    ]
    for (const wire of bad) {
      expect(() => Fraction.fromWire(wire as [string, string])).toThrow(TypeError)
    }
    expect(() => Fraction.fromWire(['1', '0'])).toThrow(RangeError)
  })
})
