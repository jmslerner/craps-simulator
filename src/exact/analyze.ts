import {
  Fraction,
  betId,
  cents,
  maxOdds,
  requireType,
  settle,
  statusAt,
  type BetInstance,
  type Cents,
  type MachineConfig,
  type PointNumber,
  type Rounding,
  type StakeDisposition,
} from '../engine/index.ts'
import { legalAmounts } from './amounts.ts'
import { ExactError, type BetSpec, type StartContext } from './chain.ts'
import {
  betAt,
  distribution,
  edgeOf,
  measure,
  upfrontCharge,
  type Distribution,
  type Measured,
} from './price.ts'
import { at } from './solve.ts'
import { typicalStart } from './start.ts'

/**
 * Exact analysis of one bet (plan §5.1, §5.2), every number from the engine's own rules through
 * the solver. The metrics are the glossary's:
 *
 * - **edge**: E[loss] ÷ E[amount risked] over the bet's lifecycle under the policy "leave it up
 *   until it loses (or resolves)", as the machine pays (rounded). Amount risked is the stake of
 *   every decision, pushes included, plus commission paid up front, at placement and when it is
 *   re-collected (plan §0 #22: commission taken from a win is not added);
 * - **nominal edge**: the same with nothing rounded (`settle` in exact mode, commission minimums
 *   kept); **breakage** = edge − nominal edge, the cost of rounding at this stake;
 * - **edge per working roll**: E[loss] ÷ (E[rolls on which it works] × stake);
 * - **pWin / pLose / pPush, expected rolls, loss per decision**: the first decision (the decision
 *   horizon), where a stake left up counts as returned.
 */

/** One way the bet can win: its pay, its chance on the first decision, and what it pays here. */
export interface PayoutLine {
  readonly payKey: string
  /** The ratio as the machine writes it ("7:6", "31 for 1"). */
  readonly ratioLabel: string
  /** P(the first decision is this win). */
  readonly chance: Fraction
  /** Stake × ratio, in cents, unrounded. */
  readonly winExact: Fraction
  /** The win as the machine pays it, in cents. */
  readonly winPaid: Cents
  /** The rounding the machine applied to the win. */
  readonly rounding: Rounding | null
  /** Commission taken from the win. */
  readonly vigOnWin: Cents
  /** Where the stake goes: back to credit, or left up for the next decision. */
  readonly disposition: StakeDisposition
}

/** Expectations over the whole lifecycle, as paid. Money in cents. */
export interface Lifecycle {
  readonly decisions: Fraction
  readonly rolls: Fraction
  readonly workingRolls: Fraction
  readonly loss: Fraction
  readonly risked: Fraction
}

export interface BetAnalysis {
  readonly spec: BetSpec
  readonly amount: Cents
  readonly pWin: Fraction
  readonly pLose: Fraction
  readonly pPush: Fraction
  readonly edge: Fraction
  readonly nominalEdge: Fraction
  readonly breakage: Fraction
  readonly edgePerWorkingRoll: Fraction
  /** E[rolls per decision]. */
  readonly expectedRolls: Fraction
  /** E[loss on the first decision], in cents, as paid. */
  readonly lossPerDecision: Fraction
  readonly lifecycle: Lifecycle
  /** The most likely win's pay, as the machine writes it; '' for a bet that never wins. */
  readonly payoutLabel: string
  /** The most likely win as paid at this stake; null for a bet that never wins. */
  readonly winPaid: Cents | null
  readonly payouts: readonly PayoutLine[]
  /** Commission at this stake: up front, taken from the most likely win, and re-collected. */
  readonly vig: { readonly placement: Cents; readonly onWin: Cents; readonly rearm: Cents }
  /** The config values this analysis rests on that are only assumed (provenance). */
  readonly assumedPaths: readonly string[]
}

/** Analyses `spec` at `amount` from `start` (`'typical'`: its usual placement, `start.ts`). */
export function analyzeBet(
  spec: BetSpec,
  amount: Cents,
  start: StartContext | 'typical',
  cfg: MachineConfig,
): BetAnalysis {
  const from = start === 'typical' ? typicalStart(spec, cfg) : start
  const first = distribution(spec, from, 'decision', cfg)
  const life = distribution(spec, from, 'lifetime', cfg)
  const paid = measure(life, amount, cfg, 'rounded')
  const nominal = measure(life, amount, cfg, 'exact')
  const edge = edgeOf(paid)
  const nominalEdge = edgeOf(nominal)
  const outcomes = firstDecision(first)
  const payouts = payoutLines(first, amount, cfg)
  const main = payouts.reduce<PayoutLine | null>(
    (best, line) => (best === null || line.chance.compare(best.chance) > 0 ? line : best),
    null,
  )
  const placement = upfrontCharge(spec, amount, cfg, 'rounded')
  const rearmDue = life.labels.some((label) => label.kind === 'rearm')
  return {
    spec,
    amount,
    pWin: outcomes.win,
    pLose: outcomes.lose,
    pPush: outcomes.push,
    edge,
    nominalEdge,
    breakage: edge.sub(nominalEdge),
    edgePerWorkingRoll: perWorkingRoll(paid, amount),
    expectedRolls: first.rolls,
    lossPerDecision: measure(first, amount, cfg, 'rounded').loss,
    lifecycle: lifecycleOf(paid),
    payoutLabel: main?.ratioLabel ?? '',
    winPaid: main?.winPaid ?? null,
    payouts,
    vig: {
      placement: toCents(placement),
      onWin: main?.vigOnWin ?? cents(0),
      rearm: rearmDue ? toCents(placement) : cents(0),
    },
    assumedPaths: assumedPaths(spec, cfg),
  }
}

/** The chances that the first decision is a win, a loss or a push. */
export function firstDecision(first: Distribution): {
  readonly win: Fraction
  readonly lose: Fraction
  readonly push: Fraction
} {
  let win = Fraction.ZERO
  let lose = Fraction.ZERO
  let push = Fraction.ZERO
  for (const [index, label] of first.labels.entries()) {
    if (label.kind !== 'settle') continue
    const count = at(first.counts, index)
    if (label.decision.kind === 'win') win = win.add(count)
    else if (label.decision.kind === 'lose') lose = lose.add(count)
    else push = push.add(count)
  }
  return { win, lose, push }
}

/** Each winning label of the first decision, settled by the engine at `amount`. */
function payoutLines(first: Distribution, amount: Cents, cfg: MachineConfig): PayoutLine[] {
  const lines: PayoutLine[] = []
  for (const [index, label] of first.labels.entries()) {
    if (label.kind !== 'settle' || label.decision.kind !== 'win') continue
    const bet = betAt(first.spec, amount)
    const rounded = settle(bet, label.decision, cfg)
    const exact = settle(bet, label.decision, cfg, 'exact')
    lines.push({
      payKey: label.decision.payKey,
      ratioLabel: rounded.ratioLabel,
      chance: at(first.counts, index),
      winExact: exact.winPaid,
      winPaid: rounded.winPaid,
      rounding: rounded.rounding,
      vigOnWin: rounded.vigOnWin,
      disposition: label.disposition,
    })
  }
  return lines
}

/** Expected loss per working roll, per unit staked. */
export function perWorkingRoll(measured: Measured, amount: Cents): Fraction {
  if (measured.workingRolls.isZero()) {
    throw new ExactError('NEVER_RESOLVES', 'The bet never works, so it is never decided')
  }
  return measured.loss.div(measured.workingRolls.mul(Fraction.of(amount)))
}

function lifecycleOf(measured: Measured): Lifecycle {
  const { decisions, rolls, workingRolls, loss, risked } = measured
  return { decisions, rolls, workingRolls, loss, risked }
}

/**
 * The JSON pointers `spec`'s analysis reads, from its family (`configPaths`): its pays, rounding,
 * commission, working rules and so on.
 */
export function configPathsOf(spec: BetSpec, cfg: MachineConfig): readonly string[] {
  const { family, type } = requireType(cfg, spec.typeId)
  return family.configPaths(type, spec.number, cfg)
}

/**
 * The config pointers behind `spec`'s numbers whose provenance is `assumed`, at the pointer or
 * anywhere below it: the coach's "assumed" chip (plan §5.3).
 */
export function assumedPaths(spec: BetSpec, cfg: MachineConfig): readonly string[] {
  const entries = Object.entries(cfg.provenance)
  return configPathsOf(spec, cfg).filter(
    (path) =>
      statusAt(cfg.provenance, path) === 'assumed' ||
      entries.some(([pointer, entry]) => pointer.startsWith(`${path}/`) && entry.status === 'assumed'),
  )
}

/**
 * The edge at every legal stake in `range` (plan §5.2 `efficientAmounts`): rounding scans and
 * minimum-vig break-even scans. Stakes come from the engine's validation (`legalAmounts`).
 */
export function efficientAmounts(
  spec: BetSpec,
  cfg: MachineConfig,
  range: { readonly from: number; readonly to: number },
  start: StartContext | 'typical' = 'typical',
): { readonly amount: Cents; readonly edge: Fraction }[] {
  const from = start === 'typical' ? typicalStart(spec, cfg) : start
  const life = distribution(spec, from, 'lifetime', cfg)
  return legalAmounts(spec, cfg, range).map((amount) => ({
    amount,
    edge: edgeOf(measure(life, amount, cfg, 'rounded')),
  }))
}

/** A line bet with odds behind it, per decision of the line bet (glossary, "combined edge"). */
export interface CombinedEdge {
  /** (loss on the flat + E[loss on the odds]) ÷ (flat + E[odds wagered]). */
  readonly edge: Fraction
  /** E[loss per decision] on the flat bet and on the odds, in cents. */
  readonly flatLoss: Fraction
  readonly oddsLoss: Fraction
  /** E[odds wagered per decision], in cents. */
  readonly oddsWagered: Fraction
  /** The odds placed behind the flat on each point. */
  readonly odds: readonly { readonly number: PointNumber; readonly amount: Cents; readonly chance: Fraction }[]
}

/**
 * The combined edge of a line bet of `flat` with odds behind it whenever it goes to a number:
 * `odds(n)` on n, the table's maximum by default (`maxOdds`). Odds lower the edge per dollar
 * wagered but never the flat bet's expected loss.
 */
export function combinedEdge(
  line: BetSpec,
  flat: Cents,
  cfg: MachineConfig,
  odds: 'max' | ((n: PointNumber) => Cents) = 'max',
): CombinedEdge {
  const flatDist = distribution(line, typicalStart(line, cfg), 'decision', cfg)
  const flatLoss = measure(flatDist, flat, cfg, 'rounded').loss
  const oddsId = cfg.oddsFor.get(line.typeId)
  let oddsLoss = Fraction.ZERO
  let oddsWagered = Fraction.ZERO
  const placed: { number: PointNumber; amount: Cents; chance: Fraction }[] = []
  for (const [index, label] of flatDist.labels.entries()) {
    if (label.kind !== 'travel' || oddsId === undefined) continue
    const n = label.number
    const amount = odds === 'max' ? maxOdds(parentOn(line.typeId, n, flat), cfg) : odds(n)
    if (amount === 0) continue
    const chance = at(flatDist.counts, index)
    const spec = { typeId: oddsId, number: n }
    const oddsDist = distribution(spec, typicalStart(spec, cfg), 'decision', cfg)
    const measured = measure(oddsDist, amount, cfg, 'rounded')
    oddsLoss = oddsLoss.add(chance.mul(measured.loss))
    oddsWagered = oddsWagered.add(chance.mul(measured.risked))
    placed.push({ number: n, amount, chance })
  }
  const edge = flatLoss.add(oddsLoss).div(Fraction.of(flat).add(oddsWagered))
  return { edge, flatLoss, oddsLoss, oddsWagered, odds: placed }
}

/** A line bet of `amount` on `n`, for the engine's odds cap. */
function parentOn(typeId: string, n: PointNumber, amount: Cents): BetInstance {
  return {
    id: betId(1),
    typeId,
    number: n,
    parentId: null,
    amount,
    vigHeld: cents(0),
    working: null,
    progress: 0,
    placedAtRoll: 0,
  }
}

/** A whole number of cents held as a fraction (a rounded amount). */
function toCents(amount: Fraction): Cents {
  if (amount.den !== 1n) throw new RangeError(`${amount.toString()}¢ is not whole cents`)
  return cents(Number(amount.num))
}
