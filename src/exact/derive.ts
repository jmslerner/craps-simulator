import {
  Fraction,
  type Cents,
  type MachineConfig,
  type Phase,
  type Rounding,
  type StakeDisposition,
} from '../engine/index.ts'
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
      /** The phase the 36 rolls are from; null when the bet does not follow the round. */
      readonly phase: Phase | null
      /** The start's weight on that state (1 when the bet always starts there). */
      readonly weight: Fraction
      /**
       * Whether the chances follow from these ways alone: every state of the first decision has
       * the same ways, and none travel. False for a line bet or come-type odds, whose first
       * decision runs through the round (the chances then come from the whole chain, not one
       * roll; M5/M6 audit).
       */
      readonly complete: boolean
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
      /** P(the first decision is this win), so the expected loss can be rebuilt. */
      readonly chance: Fraction
      /** Where the stake goes: back to credit, or left up for the next decision. */
      readonly disposition: StakeDisposition
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
      /** E[rolls the bet works] over its lifecycle: the per-working-roll edge's divisor × stake. */
      readonly workingRolls: Fraction
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
      chance: line.chance,
      disposition: line.disposition,
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
    workingRolls: analysis.lifecycle.workingRolls,
  })
  return steps
}

/**
 * The 36 rolls from the bet's most likely start where it works (any start if it works in none),
 * by what they do to it, with the state they are from (`phase`, `weight`) and whether the first
 * decision's chances follow from them alone (`complete`).
 */
function ways(spec: BetSpec, start: StartContext, cfg: MachineConfig): DerivationStep {
  const { chain } = solvedChain(spec, start, 'decision', cfg)
  const ranked = [...chain.starts].sort((a, b) => {
    const working =
      Number(at(chain.nodes, b.node).working) - Number(at(chain.nodes, a.node).working)
    return working !== 0 ? working : b.weight.compare(a.weight)
  })
  const first = ranked[0]
  const counts = { win: 0, lose: 0, push: 0, travel: 0, none: 0 }
  let phase: Phase | null = null
  let weight = Fraction.ONE
  if (first !== undefined) {
    for (const step of at(chain.nodes, first.node).steps) {
      const kind = step.decision.kind === 'progress' ? 'none' : step.decision.kind
      counts[kind] += step.weight
    }
    if (chain.group.tracksRound) phase = at(chain.nodes, first.node).table.phase
    weight = first.weight
  }
  return { kind: 'ways', ...counts, phase, weight, complete: uniformWays(chain) }
}

/**
 * Whether the first decision's chances follow from the shown ways alone: no state travels, and
 * every state with a deciding roll has the same wins, losses and pushes. P(win) is then win ÷
 * (win + lose + push) of one roll where it decides; a state where nothing decides only stretches
 * the wait. False for a line bet or come-type odds, whose decision runs through the round.
 */
function uniformWays(chain: ReturnType<typeof solvedChain>['chain']): boolean {
  let seen: string | null = null
  for (const node of chain.nodes) {
    const counts = { win: 0, lose: 0, push: 0, travel: 0, none: 0 }
    for (const step of node.steps) {
      const kind = step.decision.kind === 'progress' ? 'none' : step.decision.kind
      counts[kind] += step.weight
    }
    if (counts.travel > 0) return false
    if (counts.win + counts.lose + counts.push === 0) continue
    const key = `${counts.win},${counts.lose},${counts.push}`
    if (seen === null) seen = key
    else if (seen !== key) return false
  }
  return true
}
