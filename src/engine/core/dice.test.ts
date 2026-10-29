import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ALL_ROLLS,
  DICE_CLASSES,
  TOTALS,
  isDoubles,
  makeRoll,
  probabilityOf,
  rollDice,
  totalOf,
  waysToRoll,
  type Dice,
  type DiceRoll,
  type Die,
  type DieFace,
  type Total,
} from './dice.ts'
import { Fraction } from './rational.ts'
import { seedRng, type RngState } from './rng.ts'

/** `n` consecutive rolls from `seed`. */
function rollMany(seed: string, n: number): DiceRoll[] {
  let state: RngState = seedRng(seed)
  return Array.from({ length: n }, () => {
    const [roll, next] = rollDice(state)
    state = next
    return roll
  })
}

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
})

describe('DICE_CLASSES', () => {
  it('lists the 21 unordered outcomes once each, low face first', () => {
    expect(DICE_CLASSES).toHaveLength(21)
    expect(new Set(DICE_CLASSES.map((c) => `${c.d1}-${c.d2}`)).size).toBe(21)
    expect(DICE_CLASSES.every((c) => c.d1 <= c.d2)).toBe(true)
  })

  it('weighs each class by the ordered rolls that show it: doubles 1, others 2, 36 in all', () => {
    for (const diceClass of DICE_CLASSES) {
      const ordered = ALL_ROLLS.filter(
        (r) => Math.min(r.d1, r.d2) === diceClass.d1 && Math.max(r.d1, r.d2) === diceClass.d2,
      )
      expect(diceClass.weight).toBe(ordered.length)
      expect(diceClass.weight).toBe(isDoubles(diceClass) ? 1 : 2)
    }
    expect(DICE_CLASSES.reduce((sum, c) => sum + c.weight, 0)).toBe(36)
  })

  it('reproduces the distribution of totals', () => {
    for (const total of TOTALS) {
      const weight = DICE_CLASSES.filter((c) => totalOf(c) === total).reduce(
        (sum, c) => sum + c.weight,
        0,
      )
      expect(weight).toBe(waysToRoll(total))
    }
  })
})

describe('rollDice', () => {
  it('rolls totals with the 2d6 distribution (chi-square, 10 dof)', () => {
    const n = 72_000
    const counts = new Map<Total, number>()
    for (const roll of rollMany('dice-distribution', n)) {
      const total = totalOf(roll)
      counts.set(total, (counts.get(total) ?? 0) + 1)
    }
    const chiSquare = TOTALS.reduce((sum, total) => {
      const expected = (n * waysToRoll(total)) / 36
      return sum + ((counts.get(total) ?? 0) - expected) ** 2 / expected
    }, 0)
    expect(chiSquare).toBeLessThan(29.59) // p = 0.001
  })

  it('hits all 36 ordered outcomes evenly (chi-square, 35 dof)', () => {
    const n = 72_000
    const counts = new Array<number>(36).fill(0)
    for (const { d1, d2 } of rollMany('chi-square-36', n)) counts[(d1 - 1) * 6 + (d2 - 1)]! += 1
    const expected = n / 36
    const chiSquare = counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0)
    expect(chiSquare).toBeLessThan(66.62) // p = 0.001
  })
})

describe('plan-named aliases', () => {
  it('Die and Dice are DieFace and DiceRoll', () => {
    expectTypeOf<Die>().toEqualTypeOf<DieFace>()
    expectTypeOf<Dice>().toEqualTypeOf<DiceRoll>()
    const dice: Dice = makeRoll(2, 5)
    const die: Die = dice.d2
    expect(totalOf(dice)).toBe(7)
    expect(die).toBe(5)
  })
})
