import {
  Fraction,
  cents,
  collectSetRemaining,
  collectSetRolled,
  pointRunHits,
  pointRunState,
  settle,
  uniquePointsMade,
  type BetId,
  type BetInstance,
  type Cents,
  type CompiledSideBet,
  type MachineConfig,
  type PointNumber,
  type TableState,
  type Total,
} from '../engine/index.ts'
import {
  analyzeExisting,
  assumedPaths,
  distribution,
  settlementCash,
  startOfBet,
  type BetSpec,
  type Distribution,
} from '../exact/index.ts'
import {
  collectSetStage,
  handLengthStage,
  nextTierLine,
  pointRunStage,
  settlesNowLine,
  sideChancesLine,
  tierLabel,
  topTierLine,
  uniquePointsStage,
} from './content/sideBets.ts'
import { coachCount, coachMoney, coachProbability, coachRolls, sourceOf } from './numbers.ts'
import type { CoachLine, CoachNumber, CoachSource } from './types.ts'

/**
 * Side-bet progress (plan §5.4 `sideBetProgress`, §10 M11): for a side bet on the table, where it
 * stands in its family's own terms, what it pays if it settles without improving, the next pay step
 * up with the **exact chance of reaching it**, the chance of any win, how long it has left, and its
 * equity from now. Every number is a `CoachNumber` priced in `src/exact` from the bet's actual
 * progress (`startOfBet` carries it; the chain starts from that state), and the words come from
 * `content/sideBets.ts`.
 *
 * Tiers are read off the engine's own settlements, not off the paytable: the bet's lifetime
 * distribution from now lists every way it can come down (a loss, a push that returns it, each
 * win), with its exact chance and the cash it returns at this stake (`settlementCash`). Sorted by
 * cash, the lowest is what settling now assures (a loss when the bet pays nothing yet), the next
 * distinct cash is the next tier, and P(next tier) is the chance of ending at that cash or higher.
 * This needs no knowledge of any family's rules, and the Monte Carlo sampler
 * (tests/slow/mc.sideBets.slow.test.ts) checks the same progress starts against the engine.
 */

/** Where the bet stands, in its family's own terms (for the words and the UI). */
export type SideBetStage =
  | {
      readonly kind: 'collectSet'
      readonly rolled: readonly Total[]
      readonly remaining: readonly Total[]
    }
  | {
      readonly kind: 'uniquePointsMade'
      readonly made: readonly PointNumber[]
      /** How many points count (`/sideBets/<t>/countedPoints`). */
      readonly counted: number
    }
  | { readonly kind: 'handLength'; readonly rolls: number }
  | {
      readonly kind: 'pointRun'
      readonly point: PointNumber | null
      readonly hits: readonly PointNumber[]
    }

/** One way the bet can come down from here: a loss, a push that returns it, or a win. */
export interface SideBetOutcome {
  readonly kind: 'win' | 'push' | 'lose'
  /** The engine's pay key (`win`) or push reason; '-' for a loss. */
  readonly key: string
  /** The machine's pay label for a win ("31 for 1"); '' otherwise. */
  readonly payLabel: string
  /** What such a settlement returns at this stake, stake included, in cents. */
  readonly cash: Cents
  /** The exact chance the bet ends this way, from now. */
  readonly chance: Fraction
}

export interface SideBetTier {
  readonly outcome: SideBetOutcome
  /** The tier in words: the machine's pay label for a win, else "the stake back" or "a loss". */
  readonly label: string
  readonly cash: CoachNumber
  /** For the next tier: P(ending at this cash or higher). */
  readonly chance: CoachNumber
}

export interface SideBetProgress {
  readonly betId: BetId
  readonly spec: BetSpec
  readonly amount: Cents
  readonly family: CompiledSideBet['family']
  readonly stage: SideBetStage
  /** Every way it can come down from here, worst first. */
  readonly outcomes: readonly SideBetOutcome[]
  /** What settling on the next deciding roll assures: the lowest outcome left (a loss pays nothing). */
  readonly assured: SideBetTier
  /** The next pay step up and the exact chance of reaching it; null when the top is assured. */
  readonly nextTier: SideBetTier | null
  /** The exact chance of any win from here. */
  readonly pWin: CoachNumber
  /** E[rolls until it comes down], from here. */
  readonly expectedRolls: CoachNumber
  /** V: E[cash its current decision returns] (`analyzeExisting`). */
  readonly equity: CoachNumber
  readonly expectedLossFromNow: CoachNumber
  /** The stage, the assured pay, the next tier and the chances, as templated lines. */
  readonly lines: readonly CoachLine[]
  readonly assumedPaths: readonly string[]
}

/**
 * The progress of side bet `betId` on `state`; null when the bet is not on the table or is not a
 * side bet. Throws `ExactError` only when the solver cannot price it.
 */
export function sideBetProgress(
  betId: BetId,
  state: TableState,
  cfg: MachineConfig,
): SideBetProgress | null {
  const bet = state.bets.find((b) => b.id === betId)
  if (bet === undefined) return null
  const type = cfg.sideBets.get(bet.typeId)
  if (type === undefined) return null
  const spec: BetSpec = { typeId: bet.typeId, number: null }
  const start = startOfBet(bet, state)
  const life = distribution(spec, start, 'lifetime', cfg)
  const outcomes = terminalOutcomes(bet, life, cfg)
  const floor = outcomes[0]
  if (floor === undefined) throw new RangeError(`${bet.typeId} has no way to come down`)
  const assumed = assumedPaths(spec, cfg)
  const source = (field: string): CoachSource => sourceOf('sideBetProgress', { betId, field }, cfg)
  const next = outcomes.find((outcome) => outcome.cash > floor.cash) ?? null
  const reaching = (from: SideBetOutcome): Fraction =>
    Fraction.sum(outcomes.filter((o) => o.cash >= from.cash).map((o) => o.chance))
  const labelOf = (outcome: SideBetOutcome): string =>
    outcome.kind === 'win' ? outcome.payLabel : tierLabel(outcome.kind)
  const assured: SideBetTier = {
    outcome: floor,
    label: labelOf(floor),
    cash: coachMoney(floor.cash, source('assuredCash'), assumed),
    chance: coachProbability(reaching(floor), source('assuredChance'), assumed),
  }
  const nextTier: SideBetTier | null =
    next === null
      ? null
      : {
          outcome: next,
          label: labelOf(next),
          cash: coachMoney(next.cash, source('nextTierCash'), assumed),
          chance: coachProbability(reaching(next), source('nextTierChance'), assumed),
        }
  const pWin = coachProbability(
    Fraction.sum(outcomes.filter((o) => o.kind === 'win').map((o) => o.chance)),
    source('pWin'),
    assumed,
  )
  const expectedRolls = coachRolls(life.rolls, source('expectedRolls'), assumed)
  const existing = analyzeExisting(betId, state, cfg)
  const stage = stageOf(type, bet)
  const lines: CoachLine[] = [
    { id: 'side-stage', parts: stageParts(stage, source, assumed) },
    {
      id: 'side-now',
      parts: settlesNowLine(floor.kind, floor.payLabel, { cash: assured.cash }),
    },
    nextTier === null
      ? { id: 'side-next', parts: topTierLine() }
      : {
          id: 'side-next',
          parts: nextTierLine(
            nextTier.outcome.kind === 'push' ? 'push' : 'win',
            nextTier.outcome.payLabel,
            { chance: nextTier.chance, cash: nextTier.cash },
          ),
        },
    { id: 'side-chances', parts: sideChancesLine({ pWin, rolls: expectedRolls }) },
  ]
  return {
    betId,
    spec,
    amount: bet.amount,
    family: type.family,
    stage,
    outcomes,
    assured,
    nextTier,
    pWin,
    expectedRolls,
    equity: coachMoney(existing.equity, sourceOf('analyzeExisting', { betId }, cfg), assumed),
    expectedLossFromNow: coachMoney(
      existing.expectedLossFromNow,
      sourceOf('analyzeExisting', { betId }, cfg),
      assumed,
    ),
    lines,
    assumedPaths: assumed,
  }
}

/**
 * Every way the bet comes down from here, by the engine's own settlement: the lifetime
 * distribution's settlements that take the bet down (a `stays` push only continues it), with the
 * cash each returns at the bet's stake, sorted by that cash, lowest first.
 */
function terminalOutcomes(
  bet: BetInstance,
  life: Distribution,
  cfg: MachineConfig,
): SideBetOutcome[] {
  const spec: BetSpec = { typeId: bet.typeId, number: null }
  const outcomes: SideBetOutcome[] = []
  for (const [index, label] of life.labels.entries()) {
    if (label.kind !== 'settle' || label.disposition === 'stays') continue
    const chance = life.counts[index] ?? Fraction.ZERO
    if (chance.isZero()) continue
    const { decision } = label
    const cash = settlementCash(spec, decision, bet.amount, cfg, 'rounded')
    if (cash.den !== 1n) throw new RangeError(`${bet.typeId} settles in fractions of a cent`)
    outcomes.push({
      kind: decision.kind,
      key:
        decision.kind === 'win'
          ? decision.payKey
          : decision.kind === 'push'
            ? decision.reason
            : '-',
      payLabel: decision.kind === 'win' ? settle(bet, decision, cfg).ratioLabel : '',
      cash: cents(Number(cash.num)),
      chance,
    })
  }
  return outcomes.sort((a, b) => a.cash - b.cash || a.key.localeCompare(b.key))
}

/** Where the bet stands, read with each family's own progress helpers. */
function stageOf(type: CompiledSideBet, bet: BetInstance): SideBetStage {
  switch (type.family) {
    case 'collectSet':
      return {
        kind: 'collectSet',
        rolled: collectSetRolled(bet.progress),
        remaining: collectSetRemaining(type, bet.progress),
      }
    case 'uniquePointsMade':
      return {
        kind: 'uniquePointsMade',
        made: uniquePointsMade(bet.progress),
        counted: type.countedPoints.length,
      }
    case 'handLength':
      return { kind: 'handLength', rolls: bet.progress }
    case 'pointRun':
      return {
        kind: 'pointRun',
        point: pointRunState(bet.progress).point,
        hits: pointRunHits(bet.progress),
      }
  }
}

function stageParts(
  stage: SideBetStage,
  source: (field: string) => CoachSource,
  assumed: readonly string[],
): CoachLine['parts'] {
  const count = (field: string, value: number): CoachNumber =>
    coachCount(Fraction.of(value), source(field), assumed)
  const list = (numbers: readonly number[]) => numbers.map(String).join(', ')
  switch (stage.kind) {
    case 'collectSet':
      return collectSetStage(
        { rolled: list(stage.rolled), remaining: list(stage.remaining) },
        { remaining: count('remaining', stage.remaining.length) },
      )
    case 'uniquePointsMade':
      return uniquePointsStage(
        { made: list(stage.made) },
        { count: count('made', stage.made.length), counted: count('counted', stage.counted) },
      )
    case 'handLength':
      return handLengthStage({ rolls: count('rolls', stage.rolls) })
    case 'pointRun':
      return pointRunStage(
        { point: stage.point === null ? '' : String(stage.point), hits: list(stage.hits) },
        { hits: count('hits', stage.hits.length) },
      )
  }
}
