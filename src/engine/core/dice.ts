import { Fraction } from './rational.ts'
import { rollDie, type RngState } from './rng.ts'

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6
export type Total = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

export interface DiceRoll {
  readonly d1: DieFace
  readonly d2: DieFace
}

/** The implementation plan's names for these: one die face, and the two dice of a roll. */
export type Die = DieFace
export type Dice = DiceRoll

/** An unordered pair of faces (`d1 <= d2`) and how many of the 36 ordered rolls show it. */
export interface DiceClass extends DiceRoll {
  readonly weight: 1 | 2
}

export const TOTALS: readonly Total[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const FACES: readonly DieFace[] = [1, 2, 3, 4, 5, 6]

/** The 36 equally likely ordered outcomes of two dice. */
export const ALL_ROLLS: readonly DiceRoll[] = FACES.flatMap((d1) => FACES.map((d2) => ({ d1, d2 })))

/**
 * The 21 unordered outcomes: doubles weigh 1 and the other 15 pairs weigh 2, for 36 in all.
 * Bets decide the same way whichever die shows which face, so the exact solver can walk these
 * instead of all 36 rolls.
 */
export const DICE_CLASSES: readonly DiceClass[] = FACES.flatMap((d1) =>
  FACES.filter((d2) => d2 >= d1).map((d2): DiceClass => ({ d1, d2, weight: d1 === d2 ? 1 : 2 })),
)

export function makeRoll(d1: number, d2: number): DiceRoll {
  if (!isDieFace(d1) || !isDieFace(d2)) {
    throw new RangeError(`Dice must show 1-6, got ${d1} and ${d2}`)
  }
  return { d1, d2 }
}

/** Two dice from the engine's RNG state, `d1` drawn first, and the state after both. */
export function rollDice(state: RngState): [DiceRoll, RngState] {
  const [d1, afterFirst] = rollDie(state)
  const [d2, afterSecond] = rollDie(afterFirst)
  return [{ d1, d2 }, afterSecond]
}

export function totalOf(roll: DiceRoll): Total {
  return (roll.d1 + roll.d2) as Total
}

/** Both dice show the same face — a 4, 6, 8 or 10 rolled this way is a "hardway". */
export function isDoubles(roll: DiceRoll): boolean {
  return roll.d1 === roll.d2
}

/** How many of the 36 ordered outcomes produce `total`. */
export function waysToRoll(total: Total): number {
  return 6 - Math.abs(total - 7)
}

export function probabilityOf(total: Total): Fraction {
  return Fraction.of(waysToRoll(total), 36)
}

function isDieFace(value: number): value is DieFace {
  return Number.isInteger(value) && value >= 1 && value <= 6
}
