import { Fraction, cents, validateAction } from '../engine/index.ts'
import type { BetId, Cents, MachineConfig, TableState } from '../engine/index.ts'
import {
  ExactError,
  analyzeBet,
  analyzeExisting,
  assumedPaths,
  derive,
  takeDownValue,
} from '../exact/index.ts'
import type { BetAnalysis, BetSpec, DerivationStep } from '../exact/index.ts'
import { adviseSpot } from './advisors/index.ts'
import type { Advice } from './advisors/advice.ts'
import {
  chanceLine,
  chancesStep,
  commissionStep,
  edgeLine,
  edgeStep,
  equityLine,
  expectedLossStep,
  lossFromNowLine,
  neverResolvesLine,
  paysLine,
  payoutStep,
  takeDownLine,
  waysIncompleteNote,
  waysStep,
} from './content/templates.ts'
import { returnsUnplayed, winChanceOfDecisions } from './decisions.ts'
import { coachCount, coachMoney, coachPercent, coachProbability, sourceOf } from './numbers.ts'
import { sideBetProgress, type SideBetProgress } from './sideBetProgress.ts'
import type { CoachLine, CoachNumber, CoachSource } from './types.ts'

/**
 * The bet inspector's coach content (plan §5.5 surface 3, §10 M9a): the bet priced at the
 * player's own amount, the "Show math" derivation (`derive` → `DerivationStep[]` → templated
 * lines), and, for a bet already on the table, its equity (`analyzeExisting`, `takeDownValue`).
 * Everything is computed in the analysis worker and crosses the boundary as wire data; the UI
 * (`InspectorExtras`) renders the lines verbatim through `formatPart` and computes nothing.
 */

export interface ExistingMath {
  readonly betId: BetId
  /** Whether the bet will be decided if nothing is switched from now on. */
  readonly resolves: boolean
  /** Whether the machine would let the bet come down now (dry-run `validateAction`). */
  readonly canTakeDown: boolean
  /** E[cash its current decision returns], in cents. */
  readonly equity: CoachNumber
  readonly expectedLossFromNow: CoachNumber
  /** What taking it down now returns (stake less any non-returnable charge). */
  readonly takeDown: CoachNumber
}

export interface InspectorMath {
  readonly spec: BetSpec
  readonly amount: Cents
  /** Null when the spec alone cannot be priced (the equity lines may still be present). */
  readonly edge: CoachNumber | null
  readonly winPaid: CoachNumber | null
  /** The headline lines: pays, edge, chance, and the equity lines for a bet on the table. */
  readonly lines: readonly CoachLine[]
  /** The "Show math" derivation, one line per `DerivationStep`. */
  readonly steps: readonly CoachLine[]
  readonly existing: ExistingMath | null
  /**
   * For a side bet on the table (M11, plan §5.4 `sideBetProgress`): where it stands, what settling
   * now assures, the next tier with the exact chance of reaching it, and its equity from now. Its
   * lines are also appended to `lines`. Null for every other bet and for an empty spot (optional,
   * so a hand-built `InspectorMath` from before M11 still type-checks).
   */
  readonly sideBet?: SideBetProgress | null
  /**
   * What the advisors say about this spot (plan §5.4, §10 M9c): alternatives with their one-tap
   * switch, the edge warning, odds, efficiency, variant and working context. The UI routes them
   * through the gate (`coach/policy.ts`) before showing anything.
   */
  readonly advice: readonly Advice[]
  /** Config pointers with `assumed` provenance under any shown number. */
  readonly assumedPaths: readonly string[]
}

/**
 * The inspector's math for `spec` at `amount`. `state` and `betId` name a bet on the table for
 * the equity block; both null for an empty spot. Throws only on non-`ExactError` failures.
 */
export function inspectorMath(
  spec: BetSpec,
  amount: Cents,
  cfg: MachineConfig,
  state: TableState | null = null,
  betId: BetId | null = null,
): InspectorMath {
  const source = sourceOf('analyzeBet', { spec, amount, start: 'typical' }, cfg)
  let analysis: BetAnalysis | null = null
  try {
    analysis = analyzeBet(spec, amount, 'typical', cfg)
  } catch (error) {
    if (!(error instanceof ExactError)) throw error
  }

  const lines: CoachLine[] = []
  const steps: CoachLine[] = []
  let edge: CoachNumber | null = null
  let winPaid: CoachNumber | null = null

  if (analysis !== null) {
    const assumed = analysis.assumedPaths
    edge = coachPercent(analysis.edge, source, assumed)
    if (analysis.winPaid !== null) {
      winPaid = coachMoney(analysis.winPaid, source, assumed)
      lines.push({
        id: 'pays',
        parts: paysLine(
          { stake: coachMoney(amount, source, assumed), win: winPaid },
          analysis.payoutLabel,
        ),
      })
    }
    lines.push({ id: 'edge', parts: edgeLine({ edge }) })
    // "Wins … of decisions": odds returned unplayed are not decisions (rules spec §0.1 [M]), so an
    // odds bet's chance is conditioned on being played, under a source that says so.
    const pWin = returnsUnplayed(cfg, spec)
      ? coachProbability(
          winChanceOfDecisions(cfg, spec, analysis),
          sourceOf('analyzeBet', { spec, amount, start: 'typical', field: 'pWinDecided' }, cfg),
          assumed,
        )
      : coachProbability(analysis.pWin, source, assumed)
    lines.push({ id: 'chance', parts: chanceLine({ pWin }) })
    const deriveSource = sourceOf('derive', { spec, amount, start: 'typical' }, cfg)
    for (const [index, step] of derive(spec, amount, cfg).entries()) {
      steps.push(stepLine(step, index, deriveSource, assumed))
    }
  }

  const existing = state !== null && betId !== null ? existingMath(betId, state, cfg) : null
  if (existing !== null) {
    if (!existing.resolves) lines.push({ id: 'never-resolves', parts: neverResolvesLine() })
    lines.push({ id: 'equity', parts: equityLine({ equity: existing.equity }) })
    lines.push({
      id: 'loss-from-now',
      parts: lossFromNowLine({ loss: existing.expectedLossFromNow }),
    })
    // Never claim a contract bet can come down: the line appears only when the machine allows it.
    if (existing.canTakeDown) {
      lines.push({ id: 'take-down', parts: takeDownLine({ value: existing.takeDown }) })
    }
  }

  const sideBet =
    existing !== null && state !== null && betId !== null && cfg.sideBets.has(spec.typeId)
      ? sideBetMath(betId, state, cfg)
      : null
  if (sideBet !== null) lines.push(...sideBet.lines)

  return {
    spec,
    amount,
    edge,
    winPaid,
    lines,
    steps,
    existing,
    sideBet,
    advice: adviseSpot({ cfg, spec, amount, state, betId }),
    assumedPaths: analysis?.assumedPaths ?? assumedPaths(spec, cfg),
  }
}

/** The side-bet progress block; null when the solver cannot price the bet from here. */
function sideBetMath(betId: BetId, state: TableState, cfg: MachineConfig): SideBetProgress | null {
  try {
    return sideBetProgress(betId, state, cfg)
  } catch (error) {
    if (error instanceof ExactError) return null
    throw error
  }
}

/** The equity block for a bet on the table; null when the bet is not there any more. */
function existingMath(betId: BetId, state: TableState, cfg: MachineConfig): ExistingMath | null {
  const bet = state.bets.find((b) => b.id === betId)
  if (bet === undefined) return null
  const spec: BetSpec = { typeId: bet.typeId, number: bet.number }
  const assumed = assumedPaths(spec, cfg)
  const existingSource = sourceOf('analyzeExisting', { betId }, cfg)
  const ex = analyzeExisting(betId, state, cfg)
  const canTakeDown =
    validateAction(state, { type: 'setAmount', betId, amount: cents(0) }, cfg) === null
  return {
    betId,
    resolves: ex.resolves,
    canTakeDown,
    equity: coachMoney(ex.equity, existingSource, assumed),
    expectedLossFromNow: coachMoney(ex.expectedLossFromNow, existingSource, assumed),
    takeDown: coachMoney(
      takeDownValue(bet, state, cfg),
      sourceOf('takeDownValue', { betId }, cfg),
      assumed,
    ),
  }
}

/** One `DerivationStep` as a templated line, every number a `CoachNumber` sourced to `derive`. */
function stepLine(
  step: DerivationStep,
  index: number,
  source: CoachSource,
  assumed: readonly string[],
): CoachLine {
  const id = `${index}:${step.kind}`
  const count = (value: number): CoachNumber => coachCount(Fraction.of(value), source, assumed)
  switch (step.kind) {
    case 'ways': {
      const total = step.win + step.lose + step.push + step.travel + step.none
      const parts = waysStep({
        rolls: count(total),
        win: count(step.win),
        lose: count(step.lose),
        push: count(step.push),
        travel: count(step.travel),
        none: count(step.none),
      })
      return {
        id,
        parts: step.complete ? parts : [...parts, ' ', ...waysIncompleteNote()],
      }
    }
    case 'chances':
      return {
        id,
        parts: chancesStep({
          win: coachProbability(step.win, source, assumed),
          lose: coachProbability(step.lose, source, assumed),
          push: coachProbability(step.push, source, assumed),
        }),
      }
    case 'payout':
      return {
        id,
        parts: payoutStep(
          {
            stake: coachMoney(step.stake, source, assumed),
            exact: coachMoney(step.winExact, source, assumed),
            paid: coachMoney(step.winPaid, source, assumed),
            vigOnWin: coachMoney(step.vigOnWin, source, assumed),
          },
          step.ratioLabel,
        ),
      }
    case 'commission':
      return {
        id,
        parts: commissionStep({
          placement: coachMoney(step.placement, source, assumed),
          rearm: coachMoney(step.rearm, source, assumed),
        }),
      }
    case 'expectedLoss':
      return {
        id,
        parts: expectedLossStep({
          perDecision: coachMoney(step.perDecision, source, assumed),
          lifecycle: coachMoney(step.lifecycle, source, assumed),
          risked: coachMoney(step.risked, source, assumed),
        }),
      }
    case 'edge':
      return {
        id,
        parts: edgeStep({
          edge: coachPercent(step.edge, source, assumed),
          nominal: coachPercent(step.nominalEdge, source, assumed),
          breakage: coachPercent(step.breakage, source, assumed),
          perWorkingRoll: coachPercent(step.perWorkingRoll, source, assumed),
        }),
      }
  }
}
