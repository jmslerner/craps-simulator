/**
 * Closed-form craps math, used as an oracle for the engine and the exact solver.
 *
 * It is written from the rules spec with its own rule constants, and imports only primitives
 * (Fraction, dice counts) from `src/engine/core`. Like every oracle module, it must never import
 * the engine's rule code (`src/engine/{bets,round,settle,table,session}`, the engine barrel or
 * `src/engine/config/rulesets.ts`) or the solver in `src/exact`: shared rule code cannot catch its
 * own bugs. tests/architecture.test.ts enforces this.
 */
import { probabilityOf, waysToRoll, type Total } from '../../src/engine/core/dice.ts'
import { Fraction } from '../../src/engine/core/rational.ts'

/**
 * Crapless ("never ever craps"): only 7 wins on the come-out and every other
 * total becomes the point. Traditional: 7/11 win, 2/3/12 lose, points 4-10.
 */
export type Variant = 'crapless' | 'traditional'

export const POINT_NUMBERS: Record<Variant, readonly Total[]> = {
  traditional: [4, 5, 6, 8, 9, 10],
  crapless: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
}

/** Come-out totals that win a pass/come bet immediately. */
export const NATURALS: Record<Variant, readonly Total[]> = {
  traditional: [7, 11],
  crapless: [7],
}

/** Come-out totals that lose a pass/come bet immediately. */
export const CRAPS: Record<Variant, readonly Total[]> = {
  traditional: [2, 3, 12],
  crapless: [],
}

export function isPointNumber(variant: Variant, total: Total): boolean {
  return POINT_NUMBERS[variant].includes(total)
}

/** Chance that `total` is rolled before a 7 — what every point, place, buy and odds bet hinges on. */
export function chanceBeforeSeven(total: Total): Fraction {
  if (total === 7) throw new RangeError('7 cannot be rolled before itself')
  const ways = waysToRoll(total)
  return Fraction.of(ways, ways + 6)
}

/** Expected rolls until either `total` or 7 appears. */
export function expectedRollsToResolve(total: Total): Fraction {
  if (total === 7) throw new RangeError('7 resolves immediately')
  return Fraction.of(36, waysToRoll(total) + 6)
}

/** Probability that a pass (or come) bet wins. It never pushes. */
export function passLineWinChance(variant: Variant): Fraction {
  const naturals = Fraction.sum(NATURALS[variant].map(probabilityOf))
  const points = POINT_NUMBERS[variant].map((p) => probabilityOf(p).mul(chanceBeforeSeven(p)))
  return naturals.add(Fraction.sum(points))
}

/** Expected rolls from a come-out until the pass line is decided. */
export function expectedRollsPerLineDecision(variant: Variant): Fraction {
  const pointPhase = POINT_NUMBERS[variant].map((p) =>
    probabilityOf(p).mul(expectedRollsToResolve(p)),
  )
  return Fraction.ONE.add(Fraction.sum(pointPhase))
}

/** Probability that a pass-line decision ends in a seven-out, handing the dice to a new shooter. */
export function sevenOutChancePerDecision(variant: Variant): Fraction {
  return Fraction.sum(
    POINT_NUMBERS[variant].map((p) => probabilityOf(p).mul(Fraction.ONE.sub(chanceBeforeSeven(p)))),
  )
}

/**
 * Expected rolls per shooter (from first come-out to seven-out). By Wald's
 * identity this is rolls-per-decision divided by the per-decision seven-out chance.
 */
export function expectedRollsPerShooter(variant: Variant): Fraction {
  return expectedRollsPerLineDecision(variant).div(sevenOutChancePerDecision(variant))
}
