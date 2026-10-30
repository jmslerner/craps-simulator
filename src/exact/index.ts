/**
 * Exact analysis (plan §5.1, §5.2): every number the coach shows, derived from the engine's own
 * rules by an exact solver. The coach, the workers and the scripts import from here.
 */

export {
  COME_OUT,
  DEFAULT_MAX_STATES,
  ExactError,
  buildChain,
  canonicalProgress,
  followsRound,
  roundFor,
  solveBetChain,
} from './chain.ts'
export type {
  BetChain,
  BetSpec,
  ChainLabel,
  ExactErrorCode,
  Horizon,
  SolvedChain,
  StartContext,
  WeightedPhase,
} from './chain.ts'
export { clearAnalysisCache } from './cache.ts'
export { solveChain } from './solve.ts'
export type { ChainSolution, RewardChain, Step } from './solve.ts'
export { roundStats } from './roundStats.ts'
export type { PhaseShare, RoundStats } from './roundStats.ts'
export {
  afterTravel,
  everyPhase,
  isPutStart,
  pointPhases,
  roundWeightedStart,
  startAt,
  startKey,
  typicalStart,
} from './start.ts'
export {
  EXACT_VERSION,
  analysisKey,
  distribution,
  edgeOf,
  measure,
  price,
  settlementCash,
  upfrontCharge,
} from './price.ts'
export type { Distribution, Measured, PriceMode, Priced } from './price.ts'
export {
  commissionMinimumBinds,
  exactUnit,
  largestAmount,
  legalAmounts,
  minimumFreeFrom,
  paysExactly,
  roundingPeriod,
  smallestAmount,
} from './amounts.ts'
export {
  analyzeBet,
  assumedPaths,
  attainableOdds,
  combinedEdge,
  configPathsOf,
  efficientAmounts,
  firstDecision,
  lifecycleHorizon,
} from './analyze.ts'
export type { BetAnalysis, CombinedEdge, Lifecycle, PayoutLine } from './analyze.ts'
export { analyzeExisting, startOfBet, takeDownValue } from './equity.ts'
export type { ExistingAnalysis } from './equity.ts'
export { arrivalRate, renewalCost, standingCost, workingShare } from './standing.ts'
export type { StandingCost, StandingPolicy, Toggles } from './standing.ts'
export { PACE_RANGE, analyzeLayout, perHourAt } from './layout.ts'
export type { LayoutAnalysis, LayoutBet, LayoutSwap } from './layout.ts'
export { sameEvents } from './events.ts'
export { byEdge, catalogRow, catalogSpecs, catalogTable } from './catalog.ts'
export type { CatalogRow } from './catalog.ts'
export { suggestAlternatives } from './alternatives.ts'
export type { Alternative, Comparability } from './alternatives.ts'
export { derive } from './derive.ts'
export type { DerivationStep } from './derive.ts'
export {
  HIGH_EDGE,
  NOT_FREE,
  PAY_DROPS,
  PLAYER_ADVANTAGE,
  PLAYER_EVEN,
  checkBet,
  payDrops,
  sanityCheck,
  sweepAmounts,
} from './sanity.ts'
export type { SanityCode, SanityIssue } from './sanity.ts'
export { fromWire, toWire } from './wire.ts'
export type { Wire, WireFraction } from './wire.ts'
