import {
  DICE_CLASSES,
  Fraction,
  advanceRound,
  type MachineConfig,
  type Phase,
  type PointNumber,
} from '../engine/index.ts'
import { analysisCache, remember } from './cache.ts'
import { COME_OUT, roundAt } from './chain.ts'
import { at, solveChain } from './solve.ts'

/**
 * The round on its own (rules spec §1.3, plan §5.1): how long a pass-line decision and a hand last,
 * and the long-run share of rolls in each phase, π. Every number comes from the engine's
 * `advanceRound` over the 21 dice classes and the exact solver, never from a formula typed in:
 *
 * - a **decision cycle** runs from a come-out roll to the next come-out (natural, craps, point made
 *   or seven-out). By renewal, π(phase) = E[rolls in that phase per cycle] ÷ E[rolls per cycle],
 *   so π(comeOut) = 1 ÷ E[rolls per decision] (crapless 2310/9613, traditional 165/557);
 * - a **hand** runs from its first come-out through its seven-out (crapless 57678/7303 rolls,
 *   traditional 1671/196).
 */

export interface PhaseShare {
  readonly phase: Phase
  /** The long-run share of rolls made in this phase. */
  readonly share: Fraction
  /** Expected rolls in this phase per decision cycle. */
  readonly perDecision: Fraction
}

export interface RoundStats {
  /** E[rolls per pass-line decision], from a come-out to the next. */
  readonly rollsPerDecision: Fraction
  /** E[rolls per hand], the seven-out included. */
  readonly rollsPerHand: Fraction
  /** π(comeOut): the share of rolls that are come-out rolls. */
  readonly comeOutShare: Fraction
  /** π(point) = 1 − π(comeOut). */
  readonly pointShare: Fraction
  /** π for every phase, the come-out first, then the points in the ruleset's order. */
  readonly phases: readonly PhaseShare[]
  /** Per decision cycle: the probability that the come-out establishes each point. */
  readonly established: readonly { readonly point: PointNumber; readonly chance: Fraction }[]
}

const SCALE = 36
const cache = analysisCache<string, RoundStats>()

/** The round statistics of `cfg`'s ruleset, cached by config hash. */
export function roundStats(cfg: MachineConfig): RoundStats {
  const cached = cache.get(cfg.configHash)
  if (cached !== undefined) return cached
  const stats = computeRoundStats(cfg)
  remember(cache, cfg.configHash, stats, 64)
  return stats
}

function computeRoundStats(cfg: MachineConfig): RoundStats {
  const phases: Phase[] = [
    COME_OUT,
    ...cfg.ruleset.points.map((point): Phase => ({ kind: 'point', point })),
  ]
  const indexOf = (phase: Phase) =>
    phase.kind === 'comeOut' ? 0 : 1 + cfg.ruleset.points.indexOf(phase.point)
  const rolls = phases.map((phase) =>
    DICE_CLASSES.map((dice) => ({
      weight: dice.weight,
      step: advanceRound(roundAt(phase), dice, cfg.ruleset),
    })),
  )
  const points = cfg.ruleset.points

  // A decision cycle ends when the next roll is a come-out. Columns: rolls in each phase, then the
  // establishment of each point.
  const columns = phases.length + points.length
  const cycle = solveChain({
    scale: SCALE,
    columns,
    steps: rolls.map((out) =>
      out.map(({ weight, step }) => ({
        weight,
        to: step.next.phase.kind === 'comeOut' ? -1 : indexOf(step.next.phase),
      })),
    ),
    rewards: rolls.map((out, state) => {
      const row = new Array<bigint>(columns).fill(0n)
      row[state] = BigInt(SCALE)
      for (const { weight, step } of out) {
        if (step.transition.kind !== 'pointEstablished') continue
        const column = phases.length + points.indexOf(step.transition.point)
        row[column] = at(row, column) + BigInt(weight)
      }
      return row
    }),
  })
  const fromComeOut = at(cycle.values, 0)
  if (fromComeOut === null) throw new Error('The round never returns to the come-out')
  const visits = phases.map((_, index) => at(fromComeOut, index))
  const rollsPerDecision = Fraction.sum(visits)

  // A hand ends at the seven-out.
  const hand = solveChain({
    scale: SCALE,
    columns: 1,
    steps: rolls.map((out) =>
      out.map(({ weight, step }) => ({
        weight,
        to: step.transition.kind === 'sevenOut' ? -1 : indexOf(step.next.phase),
      })),
    ),
    rewards: rolls.map(() => [BigInt(SCALE)]),
  })
  const handFromComeOut = at(hand.values, 0)
  if (handFromComeOut === null) throw new Error('A hand never ends')

  const comeOutShare = at(visits, 0).div(rollsPerDecision)
  return {
    rollsPerDecision,
    rollsPerHand: at(handFromComeOut, 0),
    comeOutShare,
    pointShare: Fraction.ONE.sub(comeOutShare),
    phases: phases.map((phase, index) => ({
      phase,
      perDecision: at(visits, index),
      share: at(visits, index).div(rollsPerDecision),
    })),
    established: points.map((point, index) => ({
      point,
      chance: at(fromComeOut, phases.length + index),
    })),
  }
}
