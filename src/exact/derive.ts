import { Fraction, type Cents, type MachineConfig, type Rounding } from '../engine/index.ts'
import { analyzeBet } from './analyze.ts'
import { type BetSpec, type StartContext } from './chain.ts'
import { solvedChain } from './price.ts'
import { at } from './solve.ts'
import { typicalStart } from './start.ts'

/**
 * "Show math" (plan §5.2 `derive`): the derivation of a bet's numbers as steps, every number from
 * the solver and the engine's settlement, none typed in. For a $5 place 6 on a penny machine:
 * it wins 5 ways and loses 6 (of 36) on a roll that decides it, so P(win) = 5/11; $5 × 7/6 =
 * $5.833… pays $5.83; the expected loss per decision is 85/11¢, an edge of 17/1100 against a
 * nominal 1/66. The coach's templates (M9) turn these into words; they never compute.
 */

export type DerivationStep =
  | {
      /** Out of 36 rolls from the bet's usual state (where it works): how many do what. */
      readonly kind: 'ways'
      readonly win: number
      readonly lose: number
      readonly push: number
      readonly travel: number
      readonly none: number
    }
  | {
      /** The chances of the first decision. */
      readonly kind: 'chances'
      readonly win: Fraction
      readonly lose: Fraction
      readonly push: Fraction
    }
  | {
      /** One win: stake × ratio exactly, and as the machine pays it. Money in cents. */
      readonly kind: 'payout'
      readonly payKey: string
      readonly stake: Cents
      readonly ratioLabel: string
      readonly ratio: Fraction
      readonly winExact: Fraction
      readonly winPaid: Cents
      readonly rounding: Rounding | null
      readonly breakage: Fraction
      readonly vigOnWin: Cents
    }
  | {
      /** Commission charged up front at placement, and again on a winner that stays up. */
      readonly kind: 'commission'
      readonly placement: Cents
      readonly rearm: Cents
    }
  | {
      /** Expected loss (cents): per decision, and over the lifecycle with the amount risked. */
      readonly kind: 'expectedLoss'
      readonly perDecision: Fraction
      readonly lifecycle: Fraction
      readonly risked: Fraction
      readonly decisions: Fraction
    }
  | {
      readonly kind: 'edge'
      readonly edge: Fraction
      readonly nominalEdge: Fraction
      readonly breakage: Fraction
      readonly perWorkingRoll: Fraction
      readonly expectedRolls: Fraction
    }

/** The derivation of `spec` at `amount`, from `start` (its typical placement by default). */
export function derive(
  spec: BetSpec,
  amount: Cents,
  cfg: MachineConfig,
  start: StartContext | 'typical' = 'typical',
): DerivationStep[] {
  const from = start === 'typical' ? typicalStart(spec, cfg) : start
  const analysis = analyzeBet(spec, amount, from, cfg)
  const steps: DerivationStep[] = [ways(spec, from, cfg)]
  steps.push({
    kind: 'chances',
    win: analysis.pWin,
    lose: analysis.pLose,
    push: analysis.pPush,
  })
  for (const line of analysis.payouts) {
    steps.push({
      kind: 'payout',
      payKey: line.payKey,
      stake: amount,
      ratioLabel: line.ratioLabel,
      ratio: line.winExact.div(Fraction.of(amount)),
      winExact: line.winExact,
      winPaid: line.winPaid,
      rounding: line.rounding,
      breakage: line.winExact.sub(Fraction.of(line.winPaid)),
      vigOnWin: line.vigOnWin,
    })
  }
  if (analysis.vig.placement > 0 || analysis.vig.rearm > 0) {
    steps.push({ kind: 'commission', placement: analysis.vig.placement, rearm: analysis.vig.rearm })
  }
  steps.push({
    kind: 'expectedLoss',
    perDecision: analysis.lossPerDecision,
    lifecycle: analysis.lifecycle.loss,
    risked: analysis.lifecycle.risked,
    decisions: analysis.lifecycle.decisions,
  })
  steps.push({
    kind: 'edge',
    edge: analysis.edge,
    nominalEdge: analysis.nominalEdge,
    breakage: analysis.breakage,
    perWorkingRoll: analysis.edgePerWorkingRoll,
    expectedRolls: analysis.expectedRolls,
  })
  return steps
}

/**
 * The 36 rolls from the bet's most likely start where it works (any start if it works in none),
 * by what they do to it.
 */
function ways(spec: BetSpec, start: StartContext, cfg: MachineConfig): DerivationStep {
  const { chain } = solvedChain(spec, start, 'decision', cfg)
  const ranked = [...chain.starts].sort((a, b) => {
    const working = Number(at(chain.nodes, b.node).working) - Number(at(chain.nodes, a.node).working)
    return working !== 0 ? working : b.weight.compare(a.weight)
  })
  const first = ranked[0]
  const counts = { win: 0, lose: 0, push: 0, travel: 0, none: 0 }
  if (first !== undefined) {
    for (const step of at(chain.nodes, first.node).steps) {
      const kind = step.decision.kind === 'progress' ? 'none' : step.decision.kind
      counts[kind] += step.weight
    }
  }
  return { kind: 'ways', ...counts }
}
