import { describe, expect, it } from 'vitest'
import { rollDice, totalOf, type Total } from '../../src/engine/core/dice.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import { seedRng } from '../../src/engine/core/rng.ts'
import {
  NATURALS,
  POINT_NUMBERS,
  chanceBeforeSeven,
  expectedRollsPerLineDecision,
  expectedRollsPerShooter,
  expectedRollsToResolve,
  passLineWinChance,
  sevenOutChancePerDecision,
  type Variant,
} from './closedForm.ts'

const edge = (win: Fraction) => Fraction.ONE.sub(win).sub(win)
/** Come-out rolls as a share of all rolls: one per decision, by the renewal theorem. */
const comeOutShare = (variant: Variant) => Fraction.ONE.div(expectedRollsPerLineDecision(variant))
/** The pass line's edge per roll: its edge per decision spread over the rolls a decision takes. */
const edgePerRoll = (variant: Variant) =>
  edge(passLineWinChance(variant)).div(expectedRollsPerLineDecision(variant))

describe('point probabilities', () => {
  it('matches ways / (ways + 6)', () => {
    expect(chanceBeforeSeven(4).equals(Fraction.of(1, 3))).toBe(true)
    expect(chanceBeforeSeven(5).equals(Fraction.of(2, 5))).toBe(true)
    expect(chanceBeforeSeven(6).equals(Fraction.of(5, 11))).toBe(true)
    expect(chanceBeforeSeven(2).equals(Fraction.of(1, 7))).toBe(true)
    expect(chanceBeforeSeven(11).equals(Fraction.of(1, 4))).toBe(true)
    expect(expectedRollsToResolve(6).equals(Fraction.of(36, 11))).toBe(true)
    expect(() => chanceBeforeSeven(7)).toThrow(RangeError)
  })
})

describe('pass line', () => {
  it('has the published traditional numbers', () => {
    expect(passLineWinChance('traditional').equals(Fraction.of(244, 495))).toBe(true)
    expect(edge(passLineWinChance('traditional')).equals(Fraction.of(7, 495))).toBe(true) // 1.414%
    expect(expectedRollsPerLineDecision('traditional').equals(Fraction.of(557, 165))).toBe(true)
    expect(comeOutShare('traditional').equals(Fraction.of(165, 557))).toBe(true)
    expect(edgePerRoll('traditional').equals(Fraction.of(7, 1671))).toBe(true)
    expect(sevenOutChancePerDecision('traditional').equals(Fraction.of(196, 495))).toBe(true)
    expect(expectedRollsPerShooter('traditional').equals(Fraction.of(1671, 196))).toBe(true) // 8.53
  })

  it('has the published crapless numbers', () => {
    expect(passLineWinChance('crapless').equals(Fraction.of(6557, 13860))).toBe(true)
    expect(edge(passLineWinChance('crapless')).equals(Fraction.of(373, 6930))).toBe(true) // 5.38%
    expect(expectedRollsPerLineDecision('crapless').equals(Fraction.of(9613, 2310))).toBe(true)
    expect(comeOutShare('crapless').equals(Fraction.of(2310, 9613))).toBe(true)
    expect(edgePerRoll('crapless').equals(Fraction.of(373, 28839))).toBe(true)
    // 2·(1/7 + 1/4 + 1/3 + 2/5 + 5/11)/6: the points' seven-before-point odds, weighted by ways.
    expect(sevenOutChancePerDecision('crapless').equals(Fraction.of(7303, 13860))).toBe(true)
    expect(expectedRollsPerShooter('crapless').equals(Fraction.of(57678, 7303))).toBe(true) // 7.90
  })

  it.each<Variant>(['traditional', 'crapless'])(
    'agrees with a seeded simulation (%s)',
    (variant) => {
      let state = seedRng(`pass-${variant}`)
      const roll = (): Total => {
        const [dice, next] = rollDice(state)
        state = next
        return totalOf(dice)
      }
      const decisions = 200_000
      let wins = 0
      for (let i = 0; i < decisions; i++) {
        const comeOut = roll()
        if (NATURALS[variant].includes(comeOut)) wins++
        else if (POINT_NUMBERS[variant].includes(comeOut)) {
          for (;;) {
            const next = roll()
            if (next === comeOut) {
              wins++
              break
            }
            if (next === 7) break
          }
        }
      }
      // 200k decisions: standard error ~0.0011, so 0.005 is a > 4-sigma band.
      expect(Math.abs(wins / decisions - passLineWinChance(variant).toNumber())).toBeLessThan(0.005)
    },
  )
})
