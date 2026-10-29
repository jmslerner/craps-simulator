import { describe, expect, it } from 'vitest'
import {
  ALL_ROLLS,
  TOTALS,
  isDoubles,
  makeRoll,
  probabilityOf,
  rollDice,
  totalOf,
  waysToRoll,
  type Total,
} from './dice.ts'
import { Fraction } from './rational.ts'
import { createSeededRng } from './rng.ts'

describe('dice outcomes', () => {
  it('enumerates the 36 distinct ordered rolls', () => {
    expect(ALL_ROLLS).toHaveLength(36)
    expect(new Set(ALL_ROLLS.map((r) => `${r.d1}-${r.d2}`)).size).toBe(36)
  })

  it('counts ways per total consistently with enumeration', () => {
    for (const total of TOTALS) {
      const enumerated = ALL_ROLLS.filter((r) => totalOf(r) === total).length
      expect(waysToRoll(total)).toBe(enumerated)
    }
    expect(TOTALS.reduce((sum, t) => sum + waysToRoll(t), 0)).toBe(36)
  })

  it('has the textbook probabilities', () => {
    expect(probabilityOf(7).equals(Fraction.of(1, 6))).toBe(true)
    expect(probabilityOf(2).equals(Fraction.of(1, 36))).toBe(true)
    expect(probabilityOf(6).equals(Fraction.of(5, 36))).toBe(true)
    expect(Fraction.sum(TOTALS.map(probabilityOf)).equals(Fraction.ONE)).toBe(true)
  })

  it('identifies doubles', () => {
    expect(isDoubles(makeRoll(3, 3))).toBe(true)
    expect(isDoubles(makeRoll(4, 2))).toBe(false)
  })

  it('validates faces', () => {
    expect(() => makeRoll(0, 3)).toThrow(RangeError)
    expect(() => makeRoll(3, 7)).toThrow(RangeError)
    expect(() => makeRoll(2.5, 3)).toThrow(RangeError)
  })

  it('rolls totals with the 2d6 distribution (chi-square, 10 dof)', () => {
    const rng = createSeededRng('dice-distribution')
    const n = 72_000
    const counts = new Map<Total, number>()
    for (let i = 0; i < n; i++) {
      const total = totalOf(rollDice(rng))
      counts.set(total, (counts.get(total) ?? 0) + 1)
    }
    const chiSquare = TOTALS.reduce((sum, total) => {
      const expected = (n * waysToRoll(total)) / 36
      return sum + ((counts.get(total) ?? 0) - expected) ** 2 / expected
    }, 0)
    expect(chiSquare).toBeLessThan(29.59) // p = 0.001
  })
})
