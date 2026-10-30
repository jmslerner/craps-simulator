import { expect } from 'vitest'
import { Fraction, cents, type Cents, type MachineConfig } from '../../src/engine/index.ts'
import { smallestBet, typeLimits } from '../../src/engine/bets/limits.ts'
import type { BetSpec } from '../../src/exact/index.ts'
import type { DecisionExpectation, DecisionSample } from '../../src/sim/index.ts'

/**
 * The Monte Carlo assertions (plan §9 item 9), shared by the quick subset
 * (tests/properties/mc.prop.test.ts) and the slow suite (tests/slow/mc.*.slow.test.ts):
 *
 * - **Mean loss within 4σ.** The sample mean loss of n decisions is compared with the exact mean
 *   from `src/exact`, within 4 standard errors (σ/√n) using the exact per-decision σ. At 4σ a
 *   correct engine fails with probability about 6×10⁻⁵ per bet — and the seeds are pinned, so a
 *   pass is deterministic.
 * - **χ² on outcome labels.** Observed settlement-label frequencies against the exact label
 *   probabilities: Σ (obs − exp)²/exp over the labels with expected count ≥ 5 (the rest pooled),
 *   compared with the upper 0.1% point of χ² at the matching degrees of freedom.
 * - **Exact label accounting.** Every sampled label must be one the solver predicts with positive
 *   probability, and the cash the engine settled for it must equal the solver's cash exactly —
 *   integer cents against the exact `Fraction`, no tolerance.
 */

/**
 * Upper 0.1% points of the χ² distribution (α = 10⁻³), indexed by degrees of freedom; index 0 is
 * unused. Standard table values, correct to 0.004%. The Wilson–Hilferty approximation
 * k·(1 − 2/(9k) + z·√(2/(9k)))³ with z₀.₉₉₉ = 3.090232 reproduces them to within 0.5% only from
 * about 10 degrees of freedom up (at df = 1 it is off by 3%), so the low-df entries are the table
 * values, not the approximation. The same table gives 66.62 at 35 degrees of freedom, the value
 * plan §9 item 7 pins for the 36-cell dice check.
 */
export const CHI2_CRIT_P001: readonly number[] = [
  Number.NaN,
  10.828,
  13.816,
  16.266,
  18.467,
  20.515,
  22.458,
  24.322,
  26.124,
  27.877,
  29.588,
  31.264,
  32.909,
  34.528,
  36.123,
  37.697,
  39.252,
  40.79,
  42.312,
  43.82,
  45.315,
  46.797,
  48.268,
  49.728,
  51.179,
]

export interface ChiSquared {
  readonly statistic: number
  readonly df: number
  readonly critical: number
  /** Cells kept after pooling, as `key: observed/expected`. */
  readonly cells: readonly string[]
}

export interface DecisionCheck {
  /** |sample mean loss − exact mean| in standard errors. */
  readonly sigmas: number
  /** Null when pooling leaves fewer than two cells. */
  readonly chi2: ChiSquared | null
}

/**
 * Checks one sampled bet against its exact expectation: the 4σ mean, the χ² on label frequencies,
 * and exact per-label cash. `name` labels the failure messages.
 */
export function checkDecisionSample(
  name: string,
  sample: DecisionSample,
  exp: DecisionExpectation,
): DecisionCheck {
  const n = sample.decisions
  const labels = exp.labels.filter(({ probability }) => probability.num > 0n)
  const keys = new Set(labels.map(({ key }) => key))

  // Every sampled label is predicted, and its settled cash is exactly the solver's.
  for (const key of sample.counts.keys()) {
    expect(keys.has(key), `${name}: sampled label ${key} has zero exact probability`).toBe(true)
  }
  for (const { key, cash } of labels) {
    const settled = sample.cashByLabel.get(key)
    if (settled === undefined) continue
    expect(
      Fraction.of(settled).sub(cash).isZero(),
      `${name}: label ${key} settled ${settled}¢, exactly ${cash.toString()} expected`,
    ).toBe(true)
  }

  // Sample mean loss within 4σ of the exact mean, with the exact per-decision σ.
  const meanLoss = exp.meanLoss.toNumber()
  const sampleMean = exp.outlay.toNumber() - sample.totalCash / n
  const variance = exp.variance.toNumber()
  expect(variance, `${name}: a decision with no variance`).toBeGreaterThan(0)
  const sigmas = Math.abs(sampleMean - meanLoss) / Math.sqrt(variance / n)
  expect(
    sigmas,
    `${name}: sample mean loss ${sampleMean.toFixed(4)}¢ vs exact ${meanLoss.toFixed(4)}¢ ` +
      `(${sigmas.toFixed(2)}σ over ${n} decisions)`,
  ).toBeLessThanOrEqual(4)

  // χ² of label frequencies against the exact probabilities.
  const chi2 = chiSquared(
    labels.map(({ key, probability }) => ({
      key,
      expected: probability.toNumber() * n,
      observed: sample.counts.get(key) ?? 0,
    })),
  )
  if (chi2 !== null) {
    expect(
      chi2.statistic,
      `${name}: χ² ${chi2.statistic.toFixed(2)} over ${chi2.df} df exceeds ${chi2.critical} ` +
        `(α=0.001); cells ${chi2.cells.join(', ')}`,
    ).toBeLessThanOrEqual(chi2.critical)
  }
  return { sigmas, chi2 }
}

/**
 * The χ² statistic over cells with expected count ≥ 5; the smaller cells are pooled into one, and
 * a pool still under 5 is merged into the smallest kept cell. Null when fewer than two cells
 * remain (the statistic would be trivially 0 over 0 degrees of freedom).
 */
export function chiSquared(
  cells: readonly { readonly key: string; readonly expected: number; readonly observed: number }[],
): ChiSquared | null {
  const kept = cells.filter(({ expected }) => expected >= 5)
  const small = cells.filter(({ expected }) => expected < 5)
  const pooled = [...kept]
  if (small.length > 0) {
    const pool = {
      key: `pooled(${small.length})`,
      expected: small.reduce((sum, cell) => sum + cell.expected, 0),
      observed: small.reduce((sum, cell) => sum + cell.observed, 0),
    }
    if (pool.expected >= 5 || kept.length === 0) pooled.push(pool)
    else {
      const smallest = pooled.reduce((a, b) => (a.expected <= b.expected ? a : b))
      pooled[pooled.indexOf(smallest)] = {
        key: `${smallest.key}+${pool.key}`,
        expected: smallest.expected + pool.expected,
        observed: smallest.observed + pool.observed,
      }
    }
  }
  if (pooled.length < 2) return null
  const df = pooled.length - 1
  const critical = CHI2_CRIT_P001[df]
  if (critical === undefined || Number.isNaN(critical)) {
    throw new Error(`No χ² critical value for ${df} degrees of freedom: extend CHI2_CRIT_P001`)
  }
  let statistic = 0
  for (const { expected, observed } of pooled) {
    statistic += ((observed - expected) * (observed - expected)) / expected
  }
  return {
    statistic,
    df,
    critical,
    cells: pooled.map(
      ({ key, observed, expected }) => `${key}: ${observed}/${expected.toFixed(1)}`,
    ),
  }
}

/**
 * A flat stake for `typeId` that the machine accepts and that meets the roll minimum on its own:
 * the type's smallest bet, stepped up by its increment to any `totalRound` or `perBet` minimum.
 */
export function flatStake(cfg: MachineConfig, typeId: string): Cents {
  const limits = typeLimits(cfg, typeId)
  const required = cfg.limits.minTotal?.amount ?? 0
  let amount: number = smallestBet(limits)
  while (amount < required) amount += limits.increment
  return cents(amount)
}

/** The one-decision spec of a flat bet: line bets on the line and one-roll bets. */
export function flatSpec(typeId: string): BetSpec {
  return { typeId, number: null }
}
