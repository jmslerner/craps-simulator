import {
  Fraction,
  type Cents,
  type CompiledSideBet,
  type MachineConfig,
  type Ratio,
} from '../engine/index.ts'
import {
  exactUnit,
  largestAmount,
  legalAmounts,
  minimumFreeFrom,
  roundingPeriod,
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
 * Odds that pay below true odds are plausible — a machine may pay 11:2 on a crapless 2 — but they
 * are no longer free, so they carry a warning with their edge (`notFree`, plan §10 M12: 2/12 odds at
 * 11:2 cost 1/14, 7.14%), which the machine editor shows beside the pay.
 *
 * Side bets (M11) are checked like every other bet, and their pay tables once more on their own
 * (`payDrops`, a warning): a table that pays less as the bet makes progress — more points made,
 * more rolls, more hits — is almost certainly mistyped, like the crapless Fire Bet's table A
 * written for six points on a machine that counts ten, where a seventh point turns a 999 to 1 win
 * into a loss (rules spec §6.6; the M11 audit's repro). The coach reads what settling now pays
 * from the bet's current progress, so such a table shows as it plays, but the editor should say so.
 */

export type SanityCode =
  'playerAdvantage' | 'playerEven' | 'highEdge' | 'notFree' | 'payDrops' | 'unanalysable'

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

export const PLAYER_EVEN = "player-even: almost certainly a 'for 1' pay typed as 'to 1'"

export const PAY_DROPS = 'pays less for more progress: almost certainly a mistyped pay table'

export const NOT_FREE = 'not free: these odds pay below true odds, so they carry a house edge'

/** At most this many stakes per sweep. */
const SWEEP_LIMIT = 240

/**
 * Every problem with `cfg`'s bets — the catalog's, the composites and the side bets
 * (`catalogSpecs`) — empty when all of them are plausible.
 */
export function sanityCheck(cfg: MachineConfig): SanityIssue[] {
  return catalogSpecs(cfg).flatMap((spec) => checkBet(spec, cfg))
}

/** The problems with one bet (see the module comment). */
export function checkBet(spec: BetSpec, cfg: MachineConfig): SanityIssue[] {
  const paths = configPathsOf(spec, cfg)
  const side = cfg.sideBets.get(spec.typeId)
  const drops = side === undefined ? [] : payDrops(spec, side, paths)
  try {
    return [...issuesOf(spec, cfg, paths), ...drops]
  } catch (error) {
    if (!(error instanceof ExactError)) throw error
    // Odds the cap allows none of on a number cannot be placed there: nothing to check.
    if (error.code === 'BAD_START') return drops
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
      ...drops,
    ]
  }
}

/** What a side bet settles for at one step of its progress: a loss, the stake back, or a win. */
type StepPay = 'nothing' | 'push' | Ratio

/**
 * A side bet's pay table read step by step as the bet makes progress, each step with what the bet
 * settles for if it ends there: the Fire Bet's counts of points made, from none to every counted
 * point (or to `payImmediatelyAt`, which pays at once); the Hot Shooter's tiers in rising rolls,
 * below the first tier a loss; the Lucky Shooter's hits, from none to every other box number, then
 * every hit and the point. A Lucky Roller has one pay and cannot drop. A step that settles for less
 * than the one before it is a warning (see the module comment).
 */
export function payDrops(
  spec: BetSpec,
  side: CompiledSideBet,
  paths: readonly string[],
): SanityIssue[] {
  const steps: { readonly what: string; readonly pay: StepPay }[] = []
  switch (side.family) {
    case 'collectSet':
      return []
    case 'uniquePointsMade': {
      const last = side.payImmediatelyAt ?? side.countedPoints.length
      for (let count = 0; count <= last; count += 1) {
        steps.push({
          what: `${count} ${count === 1 ? 'point' : 'points'} made`,
          pay: side.payTable.get(count) ?? 'nothing',
        })
      }
      break
    }
    case 'handLength':
      steps.push({ what: 'a hand under the first tier', pay: 'nothing' })
      for (const tier of side.tiers) {
        steps.push({ what: `${tier.minRolls} rolls`, pay: tier.pays })
      }
      break
    case 'pointRun': {
      const others = side.points.length - 1
      for (let hits = 0; hits <= others; hits += 1) {
        steps.push({
          what: `${hits} ${hits === 1 ? 'hit' : 'hits'}`,
          pay: side.payTable.get(hits) ?? 'nothing',
        })
      }
      steps.push({ what: 'every hit and then the point', pay: side.topAward })
      break
    }
  }
  const issues: SanityIssue[] = []
  for (let index = 1; index < steps.length; index += 1) {
    const before = at(steps, index - 1)
    const now = at(steps, index)
    if (netOf(now.pay).compare(netOf(before.pay)) >= 0) continue
    issues.push({
      severity: 'warning',
      code: 'payDrops',
      spec,
      amount: null,
      edge: null,
      message: `${PAY_DROPS}: ${now.what} ${payWords(now.pay)}, but ${before.what} ${payWords(before.pay)}`,
      paths,
    })
  }
  return issues
}

/** The net a step pays per unit staked: −1 for a loss, 0 for the stake back, the ratio for a win. */
function netOf(pay: StepPay): Fraction {
  if (pay === 'nothing') return Fraction.of(-1)
  if (pay === 'push') return Fraction.ZERO
  return Fraction.of(pay.num, pay.den)
}

function payWords(pay: StepPay): string {
  if (pay === 'nothing') return 'loses'
  if (pay === 'push') return 'returns the stake'
  return `pays ${pay.label}`
}

function issuesOf(spec: BetSpec, cfg: MachineConfig, paths: readonly string[]): SanityIssue[] {
  const start = typicalStart(spec, cfg)
  const first = distribution(spec, start, 'decision', cfg)
  const lifetime = solvedChain(spec, start, 'lifetime', cfg)
  const life = distribution(spec, start, 'lifetime', cfg)
  const labels = [...first.labels, ...life.labels]
  const later = laterDecisions(spec, lifetime.chain, cfg)
  const reArmed = rearmDue(
    at(lifetime.chain.group.slots, lifetime.chain.group.subject).type,
    spec.number,
  )

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
    // A bet that is exactly fair is almost always an Interblock "x for 1" pay entered "x to 1"
    // (plan §0 #10: Any 7 at 5:1 and P = 1/6 is dead even). Only free odds are fair by design
    // (rules spec §8.1 rank 1), so the odds family is exempt — and odds that are not fair, paying
    // below true odds whatever the rounding, are flagged "not free" with their edge instead.
    const nominal = edgeOf(measure(life, unit, cfg, 'exact'))
    const family = cfg.catalog.get(spec.typeId)?.family
    if (family === 'odds' && nominal.compare(Fraction.ZERO) > 0) {
      issues.push({
        severity: 'warning',
        code: 'notFree',
        spec,
        amount: unit,
        edge: nominal,
        message: NOT_FREE,
        paths,
      })
    }
    if (family !== 'odds' && (edge.isZero() || nominal.isZero())) {
      issues.push({
        severity: 'error',
        code: 'playerEven',
        spec,
        amount: unit,
        edge: edge.isZero() ? edge : nominal,
        message: PLAYER_EVEN,
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
 * The stakes a sweep checks: a rounding period of legal stakes from the minimum, the same from
 * where any commission minimum stops binding, and the largest legal stake.
 */
export function sweepAmounts(
  spec: BetSpec,
  labels: readonly ChainLabel[],
  cfg: MachineConfig,
): Cents[] {
  const [lowest, next] = legalAmounts(spec, cfg, { from: 0, to: Number.MAX_SAFE_INTEGER }, 2)
  if (lowest === undefined) return []
  // Remainders repeat over legal stakes every lcm(period, step), not every period: $1 and $2 lay
  // odds at 5:6 round differently although the period is 6¢.
  const step = next === undefined ? 1 : next - lowest
  const span = lcm(roundingPeriod(spec, labels, cfg), step)
  const amounts = new Set<Cents>()
  const scanFrom = (from: number) => {
    for (const amount of legalAmounts(spec, cfg, { from, to: from + span }, SWEEP_LIMIT)) {
      amounts.add(amount)
    }
  }
  scanFrom(lowest)
  const free = minimumFreeFrom(spec, cfg)
  if (free > lowest) scanFrom(free)
  const largest = largestAmount(spec, cfg)
  if (largest !== null) amounts.add(largest)
  return [...amounts].sort((a, b) => a - b)
}

function lcm(a: number, b: number): number {
  let [x, y] = [a, b]
  while (y !== 0) [x, y] = [y, x % y]
  return (a / x) * b
}
