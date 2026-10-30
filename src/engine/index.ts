/**
 * The engine's public API: machine configs, the round, bets, settlement and the table reducer.
 * The UI, workers and scripts import from here; engine modules import each other directly.
 */

export { ENGINE_VERSION } from './version.ts'

// Primitives.
export { Fraction } from './core/rational.ts'
export {
  ROUNDING_MODES,
  TO_THE_PENNY,
  cents,
  formatCents,
  parseDollars,
  roundCents,
} from './core/money.ts'
export type { Cents, Rounding, RoundingMode } from './core/money.ts'
export { ALL_ROLLS, DICE_CLASSES, TOTALS, isDoubles, makeRoll, totalOf } from './core/dice.ts'
export type { Dice, DiceClass, DiceRoll, Die, DieFace, Total } from './core/dice.ts'
export { deriveSeed32, seedRng } from './core/rng.ts'
export type { RngState } from './core/rng.ts'
export { canonicalJson, hashJson } from './core/hash.ts'

// Machine configs.
export { ConfigError, compileConfig, configHashOf, validateConfig } from './config/compile.ts'
export type {
  CollectSetBetType,
  CommissionRule,
  CompiledBetType,
  CompiledSideBet,
  CompositeBet,
  HandLengthBetType,
  HardwayBetType,
  LineBetType,
  MachineConfig,
  MinTotal,
  NumberBetType,
  OddsBetType,
  OneRollBetType,
  PointRunBetType,
  TypeLimits,
  UniquePointsBetType,
} from './config/compile.ts'
export type { MachineConfigInput } from './config/schema.ts'
export { DEFAULT_PRESET_ID, PRESETS, PRESET_IDS, isPresetId } from './config/presets/index.ts'
export type { PresetId } from './config/presets/index.ts'
export { listAssumptions, statusAt } from './config/provenance.ts'
export type { ProvenanceStatus } from './config/provenance.ts'
export { POINT_NUMBERS, isPointNumber } from './config/rulesets.ts'
export type { PointNumber, Ruleset, Variant } from './config/rulesets.ts'

// The round.
export { advanceRound, initialRound, totalBit, totalsInMask } from './round/round.ts'
export type { Hand, Phase, RoundState, RoundStep, RoundTransition } from './round/round.ts'

// Bets.
export { REJECTION_CODES, betId, isSettled, payoutRoundingFor } from './bets/types.ts'
export type {
  BetFamily,
  BetId,
  BetInstance,
  BetType,
  Decision,
  FamilyKey,
  MainBetType,
  PushReason,
  Rejection,
  RejectionCode,
  RollContext,
} from './bets/types.ts'
export {
  FAMILY_ORDER,
  decideBet,
  requireBet,
  requireType,
  resolveBet,
  resolveType,
} from './bets/registry.ts'
export type { ResolvedBet, ResolvedType } from './bets/registry.ts'
export { canToggle, effectiveWorking, workingStatus } from './bets/working.ts'
export type { WorkingSource, WorkingStatus } from './bets/working.ts'
export { maxOdds, smallestBet, typeLimits } from './bets/limits.ts'
export { legalBets } from './bets/legal.ts'
export type { LegalBet, LegalBetsOptions } from './bets/legal.ts'

// Side bets (M11): how each family encodes `BetInstance.progress`, for the solver and the layout.
export { bitCount } from './bets/families/sideBet.ts'
export {
  collectSetMask,
  collectSetRemaining,
  collectSetRolled,
} from './bets/families/collectSet.ts'
export { uniquePointsCount, uniquePointsMade } from './bets/families/uniquePointsMade.ts'
export { handLengthTier } from './bets/families/handLength.ts'
export { pointRunHits, pointRunProgress, pointRunState } from './bets/families/pointRun.ts'

// Settlement.
export { settle } from './settle/settle.ts'
export type { SettlementTrace, StakeDisposition } from './settle/trace.ts'
export { commissionRule, upfrontVig, vigBase, vigOf } from './settle/commission.ts'

// The table.
export { heldOffOf, newTable } from './table/state.ts'
export type { LastRoll, TableState } from './table/state.ts'
export type { Action } from './table/actions.ts'
export type { GameEvent } from './table/events.ts'
export type { Ledger } from './table/ledger.ts'
export { applyAction, validateAction } from './table/reducer.ts'
export type { ActionResult, ApplyOptions } from './table/reducer.ts'
export { InvariantError, assertInvariants, invariantViolations } from './table/invariants.ts'

// The session: the betting window, macros, replay and the session log (M5).
export {
  clearWindow,
  dispatchBetting,
  lastWindowOf,
  newSession,
  rollWindow,
  undo,
} from './session/window.ts'
export type {
  BettingResult,
  RollResult,
  SessionHeader,
  WindowRecord,
  WindowedSession,
} from './session/window.ts'
export {
  doubleBets,
  maxOutOdds,
  pressBet,
  repeatBets,
  takeDownAll,
  winsOf,
} from './session/macros.ts'
export {
  ReplayError,
  headerConfig,
  replay,
  replayHistory,
  resumeSession,
} from './session/replay.ts'
export type {
  ReplayFailure,
  ReplayOptions,
  ReplayedWindow,
  ResumeOptions,
} from './session/replay.ts'
export {
  SESSION_LOG_FORMAT,
  SESSION_LOG_VERSION,
  deserializeSession,
  parseSessionLog,
  serializeSession,
  sessionFromLog,
  toSessionLog,
} from './session/serialize.ts'
export type { LoadResult, ParseResult, SessionLog, SessionLogError } from './session/serialize.ts'
