import { Fraction, type Cents, type MachineConfig } from '../engine/index.ts'
import {
  distribution,
  measure,
  settlementCash,
  upfrontCharge,
  type BetSpec,
  type StartContext,
} from '../exact/index.ts'

/**
 * The exact side of the Monte Carlo comparison (plan §9 item 9): what one decision of a bet is
 * worth, label by label, straight from `src/exact`. Everything is a `Fraction`; the tests turn
 * them into floats at the last step. The solver prices in the same `rounded` mode the sampler
 * settles in, so the two sides of the comparison see the same cents.
 */

/** One settlement label of the decision distribution, with its exact probability and cash. */
export interface LabelExpectation {
  readonly key: string
  readonly probability: Fraction
  /** Cash credited by one such decision, a stake that stays up counted as returned. */
  readonly cash: Fraction
}

/** The exact per-decision distribution of a bet, priced at one stake. */
export interface DecisionExpectation {
  readonly spec: BetSpec
  readonly amount: Cents
  /** What one decision pays in: the stake plus any up-front commission, in cents. */
  readonly outlay: Fraction
  /** E[loss] per decision: `measure(...).loss` from the solved distribution. */
  readonly meanLoss: Fraction
  /** Var[loss] per decision: Σ p·(cash − outlay)² − meanLoss². */
  readonly variance: Fraction
  /** The settlement labels, probabilities summing to 1 at the decision horizon. */
  readonly labels: readonly LabelExpectation[]
  /** E[rolls per decision]. */
  readonly rolls: Fraction
}

/**
 * The exact expectation of one decision of `spec` at `amount` from `start`, on the rounded mode.
 * The mean comes from `measure` and the labels from `settlementCash`; the two are cross-checked
 * against each other exactly, so a drift between this module's label accounting and
 * `src/exact/price.ts` fails loudly instead of skewing a tolerance.
 */
export function decisionExpectation(
  spec: BetSpec,
  start: StartContext,
  amount: Cents,
  cfg: MachineConfig,
): DecisionExpectation {
  const dist = distribution(spec, start, 'decision', cfg)
  const outlay = Fraction.of(amount).add(upfrontCharge(spec, amount, cfg, 'rounded'))
  const labels: LabelExpectation[] = []
  for (const [index, label] of dist.labels.entries()) {
    if (label.kind !== 'settle') continue
    const probability = at(dist.counts, index)
    let cash = settlementCash(spec, label.decision, amount, cfg, 'rounded')
    if (label.disposition === 'stays') cash = cash.add(Fraction.of(amount))
    labels.push({ key: label.key, probability, cash })
  }
  const total = Fraction.sum(labels.map(({ probability }) => probability))
  if (!total.sub(Fraction.ONE).isZero()) {
    throw new Error(`${spec.typeId}: decision probabilities sum to ${total.toString()}, not 1`)
  }
  const measured = measure(dist, amount, cfg, 'rounded')
  const credited = Fraction.sum(labels.map(({ probability, cash }) => probability.mul(cash)))
  if (!outlay.sub(credited).sub(measured.loss).isZero()) {
    throw new Error(`${spec.typeId}: label cash disagrees with measure(...)`)
  }
  let secondMoment = Fraction.ZERO
  for (const { probability, cash } of labels) {
    const loss = outlay.sub(cash)
    secondMoment = secondMoment.add(probability.mul(loss).mul(loss))
  }
  const variance = secondMoment.sub(measured.loss.mul(measured.loss))
  return { spec, amount, outlay, meanLoss: measured.loss, variance, labels, rolls: dist.rolls }
}

function at<T>(list: readonly T[], index: number): T {
  const value = list[index]
  if (value === undefined) throw new RangeError(`Nothing at index ${index}`)
  return value
}
