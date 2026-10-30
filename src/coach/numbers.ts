import type { Cents, Fraction, MachineConfig } from '../engine/index.ts'
import type { CoachNumber, CoachNumberKind, CoachSource } from './types.ts'

/**
 * `CoachNumber` constructors (plan §5.3): every number the coach will show is built here, carrying
 * the `src/exact` call it came from and the assumed config paths it rests on. Nothing in this
 * module computes — the values arrive from `src/exact` — it only attaches provenance.
 */

/** The source record of an exact call: the function's name, its JSON-safe args, and the config. */
export function sourceOf(fn: string, args: unknown, cfg: MachineConfig): CoachSource {
  return { fn, args, configHash: cfg.configHash }
}

export function coachNumber(
  kind: CoachNumberKind,
  exact: Fraction | Cents,
  source: CoachSource,
  assumedPaths: readonly string[] = [],
): CoachNumber {
  return { kind, exact, source, assumedPaths }
}

export const coachPercent = (
  exact: Fraction,
  source: CoachSource,
  assumedPaths: readonly string[] = [],
): CoachNumber => coachNumber('percent', exact, source, assumedPaths)

export const coachProbability = (
  exact: Fraction,
  source: CoachSource,
  assumedPaths: readonly string[] = [],
): CoachNumber => coachNumber('probability', exact, source, assumedPaths)

export const coachMoney = (
  exact: Fraction | Cents,
  source: CoachSource,
  assumedPaths: readonly string[] = [],
): CoachNumber => coachNumber('money', exact, source, assumedPaths)

export const coachCount = (
  exact: Fraction,
  source: CoachSource,
  assumedPaths: readonly string[] = [],
): CoachNumber => coachNumber('count', exact, source, assumedPaths)

export const coachRolls = (
  exact: Fraction,
  source: CoachSource,
  assumedPaths: readonly string[] = [],
): CoachNumber => coachNumber('rolls', exact, source, assumedPaths)
