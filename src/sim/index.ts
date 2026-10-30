/**
 * Lean Monte Carlo (plan §10 M7, §9 item 9): samplers that drive the engine's own rules — never a
 * re-implementation — so the slow suite can compare sampled play with `src/exact`'s solved
 * numbers. Everything exported is exact (integer counts, integer cents, `Fraction`s); the float
 * statistics live in the tests.
 */

export { sampleDecisions } from './decisions.ts'
export type { DecisionSample } from './decisions.ts'
export { decisionExpectation } from './expected.ts'
export type { DecisionExpectation, LabelExpectation } from './expected.ts'
export { playFlatBet, playRandomRolls } from './drive.ts'
export type { FlatBetTally, RandomSessionTally } from './drive.ts'
export { nextBelow, pickWeighted, prepareWeightedPick } from './uniform.ts'
export type { WeightedPick } from './uniform.ts'
