import { Fraction, type Cents, type MachineConfig } from '../engine/index.ts'
import {
  exactUnit,
  largestAmount,
  legalAmounts,
  minimumFreeFrom,
  roundingPeriod,
  smallestAmount,
} from './amounts.ts'
import { configPathsOf } from './analyze.ts'
import { catalogSpecs } from './catalog.ts'
import {
  ExactError,
  chainFrom,
  rearmDue,
  solveBetChain,
  tableKey,
  type BetSpec,
  type ChainLabel,
} from './chain.ts'
import {
  distribution,
  edgeOf,
  measure,
  nodeDistribution,
  price,
  solvedChain,
  upfrontCharge,
} from './price.ts'
import { at } from './solve.ts'
import { typicalStart } from './start.ts'

/**
 * The implausible-edge check (plan §4.4, §0 #10; rules spec §4.2, §5.3), run on every config and
 * every edit: a casino never offers a bet the player is favoured on, so a negative edge is a
 * data-entry error ("place 6 pays 7:5", ceiling or half-up rounding on a wrong-way payout, "for 1"
 * read as "to 1"), and an edge above 40% almost certainly is too.
 *
 * Rounding makes the edge depend on the stake, so each bet is checked at every stake rounding can
 * tell apart: one rounding period of legal stakes from the minimum (`roundingPeriod`; the relative
 * effect of a remainder is largest at the smallest stake that has it), the same again from where a
 * commission minimum stops binding, and the maximum. At each stake, three things must not favour
 * the player:
 *
 * - the lifecycle edge;
 * - the first decision, from the bet's typical placement;
 * - every later decision, from each state a winner left up enters (with the commission re-collected
 *   for it, if any): a buy paying above true odds with its vig paid once is fair on the first
 *   decision and player-favoured on every one after.
 *
 * Odds at true odds have an edge of exactly 0, so any rounding up of a lay-odds payout shows here.
 */

export type SanityCode = 'playerAdvantage' | 'highEdge' | 'unanalysable'

export interface SanityIssue {
  readonly severity: 'error' | 'warning'
  readonly code: SanityCode
  readonly spec: BetSpec
  /** The stake the problem shows at; null when the bet could not be analysed. */
  readonly amount: Cents | null
  readonly edge: Fraction | null
  readonly message: string
  /** The config pointers the bet's numbers rest on, for the editor to point at. */
  readonly paths: readonly string[]
}

/** Above this edge a bet is almost certainly mistyped (plan §4.4). */
export const HIGH_EDGE = Fraction.of(2, 5)

export const PLAYER_ADVANTAGE = 'player advantage: almost certainly a data-entry error'

/** At most this many stakes per sweep. */
const SWEEP_LIMIT = 240

/** Every problem with `cfg`'s non-side bets; empty when all of them are plausible. */
export function sanityCheck(cfg: MachineConfig): SanityIssue[] {
  return catalogSpecs(cfg).flatMap((spec) => checkBet(spec, cfg))
}

/** The problems with one bet (see the module comment). */
export function checkBet(spec: BetSpec, cfg: MachineConfig): SanityIssue[] {
  const paths = configPathsOf(spec, cfg)
  try {
    return issuesOf(spec, cfg, paths)
  } catch (error) {
    if (!(error instanceof ExactError)) throw error
    // Odds the cap allows none of on a number cannot be placed there: nothing to check.
    if (error.code === 'BAD_START') return []
    return [
      {
        severity: 'warning',
        code: 'unanalysable',
        spec,
        amount: null,
        edge: null,
        message: error.message,
        paths,
      },
    ]
  }
}

function issuesOf(spec: BetSpec, cfg: MachineConfig, paths: readonly string[]): SanityIssue[] {
  const start = typicalStart(spec, cfg)
  const first = distribution(spec, start, 'decision', cfg)
  const lifetime = solvedChain(spec, start, 'lifetime', cfg)
  const life = distribution(spec, start, 'lifetime', cfg)
  const labels = [...first.labels, ...life.labels]
  const later = laterDecisions(spec, lifetime.chain, cfg)
  const reArmed = rearmDue(at(lifetime.chain.group.slots, lifetime.chain.group.subject).type, spec.number)

  let worst: { readonly amount: Cents; readonly edge: Fraction } | null = null
  for (const amount of sweepAmounts(spec, labels, cfg)) {
    const lifecycle = measure(life, amount, cfg, 'rounded')
    const firstDecision = measure(first, amount, cfg, 'rounded')
    const again = reArmed ? upfrontCharge(spec, amount, cfg, 'rounded') : Fraction.ZERO
    const paidIn = Fraction.of(amount).add(again)
    const checks = [
      { loss: lifecycle.loss, risked: lifecycle.risked },
      { loss: firstDecision.loss, risked: firstDecision.risked },
      ...later.map((dist) => ({
        loss: paidIn.sub(price(dist, amount, cfg, 'rounded').credited),
        risked: paidIn,
      })),
    ]
    for (const { loss, risked } of checks) {
      if (risked.isZero() || !loss.isNegative()) continue
      const edge = loss.div(risked)
      if (worst === null || edge.compare(worst.edge) < 0) worst = { amount, edge }
    }
  }
  const issues: SanityIssue[] = []
  if (worst !== null) {
    issues.push({
      severity: 'error',
      code: 'playerAdvantage',
      spec,
      amount: worst.amount,
      edge: worst.edge,
      message: PLAYER_ADVANTAGE,
      paths,
    })
  }
  const unit = exactUnit(spec, first.labels, cfg)
  if (unit !== null) {
    const edge = edgeOf(measure(life, unit, cfg, 'rounded'))
    if (edge.compare(HIGH_EDGE) > 0) {
      issues.push({
        severity: 'warning',
        code: 'highEdge',
        spec,
        amount: unit,
        edge,
        message: `an edge of ${edge.formatPercent(2)}% is far above any real bet's: check its pays`,
        paths,
      })
    }
  }
  return issues
}

/**
 * The decision-horizon distribution from every state a winner left up enters: the states a later
 * decision starts from.
 */
function laterDecisions(
  spec: BetSpec,
  lifetime: ReturnType<typeof solvedChain>['chain'],
  cfg: MachineConfig,
) {
  const entered = new Set<number>()
  for (const node of lifetime.nodes) {
    for (const step of node.steps) {
      if (step.to === -1) continue
      const stays = step.labels.some((index) => {
        const label: ChainLabel = at(lifetime.labels, index)
        return label.kind === 'settle' && label.disposition === 'stays'
      })
      if (stays) entered.add(step.to)
    }
  }
  if (entered.size === 0) return []
  const tables = [...entered].map((index) => at(lifetime.nodes, index).table)
  const decisions = solveBetChain(
    chainFrom(
      spec,
      lifetime.group,
      tables.map((table) => ({ table, weight: Fraction.ONE })),
      'decision',
      cfg,
    ),
  )
  const byKey = new Map(decisions.chain.nodes.map((node, index) => [node.key, index]))
  return tables.map((table) => {
    const node = byKey.get(tableKey(lifetime.group, table))
    if (node === undefined) throw new Error('A later decision lost its start state')
    return nodeDistribution(decisions, node)
  })
}

/**
 * The stakes a sweep checks: a rounding period of legal stakes from the minimum, the same from where
 * any commission minimum stops binding, and the largest legal stake.
 */
export function sweepAmounts(
  spec: BetSpec,
  labels: readonly ChainLabel[],
  cfg: MachineConfig,
): Cents[] {
  const period = roundingPeriod(spec, labels, cfg)
  const lowest = smallestAmount(spec, cfg)
  if (lowest === null) return []
  const amounts = new Set<Cents>()
  const window = (from: number) => {
    for (const amount of legalAmounts(spec, cfg, { from, to: from + period }, SWEEP_LIMIT)) {
      amounts.add(amount)
    }
  }
  window(lowest)
  const free = minimumFreeFrom(spec, cfg)
  if (free > lowest) window(free)
  const largest = largestAmount(spec, cfg)
  if (largest !== null) amounts.add(largest)
  return [...amounts].sort((a, b) => a - b)
}
