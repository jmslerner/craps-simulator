import {
  Fraction,
  requireType,
  type Cents,
  type MachineConfig,
  type Phase,
  type PointNumber,
} from '../engine/index.ts'
import {
  ExactError,
  groupFor,
  rearmDue,
  rollOutcomes,
  startTable,
  tableKey,
  tableState,
  workingOf,
  type BetSpec,
  type ChainLabel,
  type Group,
  type StartContext,
  type TableNode,
} from './chain.ts'
import { distribution, measure, settlementCash, upfrontCharge } from './price.ts'
import { roundStats } from './roundStats.ts'
import { at, solveChain, type Step } from './solve.ts'
import { startAt, typicalStart } from './start.ts'

/**
 * Standing cost (plan §5.1, glossary): the long-run expected loss per roll of keeping a bet up and
 * betting it again whenever the table allows. Every formula is exact and renewal-based:
 *
 * | Bet | Standing cost per roll |
 * |---|---|
 * | number bets, hardways, one-roll bets, composites | loss per working roll × π(phases where a carried bet works) |
 * | pass, don't pass | loss per decision × π(comeOut): one decision starts on every come-out roll |
 * | come, don't come | loss per decision × π(point): one starts in the box on every point-phase roll |
 * | odds | loss per decision × the rate at which the parent arrives on the number |
 *
 * π and the arrival rates come from the round's own chain (`roundStats`) and the parent's chain;
 * the losses from the bet's chain, priced at the stake as the machine pays.
 *
 * `renewalCost` computes the same thing a second way, as the plan's identity check asks (§9 item
 * 6): lifecycle loss ÷ lifecycle rolls of a renewal cycle. For a bet that is up alone, the cycle is
 * a chain in which the bet is placed again as soon as it comes down (where its window allows),
 * cut at a regeneration state; for come bets and odds, whose bets overlap, the cycle is the round's
 * come-out to come-out and the bets placed in it.
 */

/** Toggles a standing bet keeps: its own ON/OFF and the global button. */
export interface Toggles {
  readonly working?: boolean | null
  readonly globalOff?: boolean | null
}

export type StandingPolicy = 'workingRolls' | 'comeOutDecisions' | 'pointRollDecisions' | 'arrivals'

export interface StandingCost {
  /** Expected loss per roll, in cents. */
  readonly perRoll: Fraction
  /** How the loss is spread over rolls (see the module table). */
  readonly policy: StandingPolicy
  /** Working rolls, decisions or arrivals per roll. */
  readonly rate: Fraction
  /** The expected loss per unit of `rate`, in cents: per working roll, decision or arrival. */
  readonly lossPerUnit: Fraction
}

/** The standing cost of `spec` at `amount` (the π formulas of the module comment). */
export function standingCost(
  spec: BetSpec,
  amount: Cents,
  cfg: MachineConfig,
  toggles: Toggles = {},
): StandingCost {
  const { type } = requireType(cfg, spec.typeId)
  const stats = roundStats(cfg)
  const start = typicalStart(spec, cfg, toggles)
  switch (type.family) {
    case 'line': {
      const loss = decisionLoss(spec, start, amount, cfg)
      const rate = type.window === 'comeOut' ? stats.comeOutShare : stats.pointShare
      const policy = type.window === 'comeOut' ? 'comeOutDecisions' : 'pointRollDecisions'
      return { perRoll: loss.mul(rate), policy, rate, lossPerUnit: loss }
    }
    case 'odds': {
      const rate = arrivalRate(type.parent, numberOf(spec), cfg)
      const loss = decisionLoss(spec, start, amount, cfg)
      return { perRoll: loss.mul(rate), policy: 'arrivals', rate, lossPerUnit: loss }
    }
    case 'numberVsSeven':
    case 'hardway':
    case 'oneRoll':
    case 'composite': {
      const rate = workingShare(spec, cfg, toggles)
      if (rate.isZero()) {
        return { perRoll: Fraction.ZERO, policy: 'workingRolls', rate, lossPerUnit: Fraction.ZERO }
      }
      const life = measure(distribution(spec, start, 'lifetime', cfg), amount, cfg, 'rounded')
      const loss = life.loss.div(life.workingRolls)
      return { perRoll: loss.mul(rate), policy: 'workingRolls', rate, lossPerUnit: loss }
    }
  }
}

/**
 * π(phases where it works): the long-run share of rolls on which a standing bet of `spec` works,
 * with `toggles`, per the engine's `effectiveWorking` in each phase. A standing bet has been carried
 * from earlier windows, unless its type cannot be (a one-roll bet that comes back after every roll:
 * the families' invariants reject it carried), in which case it is new on every roll.
 */
export function workingShare(spec: BetSpec, cfg: MachineConfig, toggles: Toggles = {}): Fraction {
  const group = groupFor(spec, cfg)
  let share = Fraction.ZERO
  for (const { phase, share: weight } of roundStats(cfg).phases) {
    const table = standingTable(group, spec, phase, toggles, cfg)
    if (at(workingOf(table, cfg), group.subject)) share = share.add(weight)
  }
  return share
}

function standingTable(
  group: Group,
  spec: BetSpec,
  phase: Phase,
  toggles: Toggles,
  cfg: MachineConfig,
): TableNode {
  const working = toggles.working ?? null
  const globalOff = toggles.globalOff ?? null
  try {
    return startTable(group, spec, phase, { carried: true, working, globalOff }, cfg)
  } catch (error) {
    if (!(error instanceof ExactError) || error.code !== 'BAD_START') throw error
    return startTable(group, spec, phase, { carried: false, working, globalOff }, cfg)
  }
}

/**
 * Arrivals per roll of a bet of `parentId` on `n`: its decisions per roll (π(comeOut) for a
 * come-out bet, π(point) for one made with a point on) × E[times a decision travels to n].
 */
export function arrivalRate(parentId: string, n: PointNumber, cfg: MachineConfig): Fraction {
  const parent = cfg.catalog.get(parentId)
  if (parent?.family !== 'line') throw new ExactError('BAD_SPEC', `${parentId} is not a line bet`)
  const stats = roundStats(cfg)
  const spec = { typeId: parentId, number: null }
  const dist = distribution(spec, typicalStart(spec, cfg), 'decision', cfg)
  const travels = travelCount(dist.labels, dist.counts, n)
  return travels.mul(parent.window === 'comeOut' ? stats.comeOutShare : stats.pointShare)
}

/**
 * Lifecycle loss ÷ lifecycle rolls over a renewal cycle (see the module comment), in cents per
 * roll: the identity `standingCost` must equal.
 */
export function renewalCost(
  spec: BetSpec,
  amount: Cents,
  cfg: MachineConfig,
  toggles: Toggles = {},
): Fraction {
  const { type } = requireType(cfg, spec.typeId)
  const stats = roundStats(cfg)
  const points = stats.phases.filter(
    (entry): entry is typeof entry & { phase: Extract<Phase, { kind: 'point' }> } =>
      entry.phase.kind === 'point',
  )
  if (type.family === 'line' && type.window === 'point') {
    // One bet starts in the box on every point-phase roll of the round's cycle.
    let loss = Fraction.ZERO
    for (const { phase, perDecision } of points) {
      const start = startAt(phase, toggles)
      loss = loss.add(perDecision.mul(decisionLoss(spec, start, amount, cfg)))
    }
    return loss.div(stats.rollsPerDecision)
  }
  if (type.family === 'odds') {
    const parent = cfg.catalog.get(type.parent)
    if (parent?.family !== 'line') throw new ExactError('BAD_SPEC', `${type.parent} is no line bet`)
    const n = numberOf(spec)
    let loss = Fraction.ZERO
    if (parent.window === 'comeOut') {
      // The come-out establishes n, then the odds face that point.
      const chance = stats.established.find(({ point }) => point === n)?.chance ?? Fraction.ZERO
      loss = chance.mul(decisionLoss(spec, startAt({ kind: 'point', point: n }, toggles), amount, cfg))
    } else {
      // A bet made under point p travels to n; the odds then face point p, or the come-out when
      // the travelling roll made the point.
      const parentSpec = { typeId: type.parent, number: null }
      for (const { phase, perDecision } of points) {
        const dist = distribution(parentSpec, startAt(phase), 'decision', cfg)
        const travels = travelCount(dist.labels, dist.counts, n)
        if (travels.isZero()) continue
        const after: Phase = phase.point === n ? { kind: 'comeOut' } : phase
        const odds = decisionLoss(spec, startAt(after, toggles), amount, cfg)
        loss = loss.add(perDecision.mul(travels).mul(odds))
      }
    }
    return loss.div(stats.rollsPerDecision)
  }
  return rebetCycleCost(spec, amount, cfg, toggles)
}

/**
 * A bet up alone, placed again as soon as it comes down (or, if its window is closed, as soon as
 * it opens): E[loss per cycle] ÷ E[rolls per cycle], where a cycle runs from a fresh placement at a
 * regeneration state r to the next placement landing on r. Every step is the engine's (the same
 * `rollOutcomes` the analysis chains use); the cash of each step is priced at `amount`.
 */
function rebetCycleCost(
  spec: BetSpec,
  amount: Cents,
  cfg: MachineConfig,
  toggles: Toggles,
): Fraction {
  const group = groupFor(spec, cfg)
  const subjectType = at(group.slots, group.subject).type
  const placement = upfrontCharge(spec, amount, cfg, 'rounded')
  const placeCost = Fraction.of(amount).add(placement)
  const rearm = rearmDue(subjectType, spec.number) ? placement : Fraction.ZERO
  const fresh = (phase: Phase, globalOff: boolean | null) =>
    startTable(group, spec, phase, { carried: false, working: toggles.working ?? null, globalOff }, cfg)

  interface Edge {
    readonly weight: number
    readonly to: number
    /** The step's loss in cents: stakes and vig paid, less cash credited. */
    readonly loss: Fraction
    readonly placesAgain: boolean
  }
  const keys = new Map<string, number>()
  const tables: TableNode[] = []
  const add = (table: TableNode) => {
    const key = tableKey(group, table)
    const known = keys.get(key)
    if (known !== undefined) return known
    keys.set(key, tables.length)
    tables.push(table)
    return tables.length - 1
  }
  for (const { phase } of typicalStart(spec, cfg).phases) add(fresh(phase, toggles.globalOff ?? null))
  const edges: Edge[][] = []
  for (let i = 0; i < tables.length; i++) {
    const table = at(tables, i)
    const working = workingOf(table, cfg)
    edges.push(
      rollOutcomes(group, table, working, cfg).map((outcome): Edge => {
        const decision = at(outcome.decisions, group.subject)
        let loss = Fraction.ZERO
        if (decision.kind === 'win' || decision.kind === 'lose' || decision.kind === 'push') {
          loss = loss.sub(settlementCash(spec, decision, amount, cfg, 'rounded'))
          const subjectAfter = at(outcome.next.bets, group.subject)
          if (decision.kind === 'win' && subjectAfter !== null) loss = loss.add(rearm)
        }
        let next = outcome.next
        let placesAgain = false
        if (at(next.bets, group.subject) === null && canPlace(group, spec, next, cfg)) {
          next = fresh(next.phase, next.globalOff)
          placesAgain = true
          loss = loss.add(placeCost)
        }
        return { weight: outcome.dice.weight, to: add(next), loss, placesAgain }
      }),
    )
  }
  // The regeneration state: the first state a re-placement lands on, by key.
  const landings = [
    ...new Set(edges.flatMap((out) => out.filter((e) => e.placesAgain).map((e) => e.to))),
  ].sort((a, b) => tableKey(group, at(tables, a)).localeCompare(tableKey(group, at(tables, b))))
  for (const r of landings) {
    // Steps into r end the cycle; their placement belongs to the next cycle.
    const steps: Step[][] = edges.map((out) =>
      out.map(({ weight, to }) => ({ weight, to: to === r ? -1 : to })),
    )
    const denominators = edges.flatMap((out) => out.map(({ loss }) => loss.den))
    const common = denominators.reduce((a, b) => lcm(a, b), 1n)
    const rewards = edges.map((out) => {
      let loss = 0n
      for (const { weight, to, loss: stepLoss, placesAgain } of out) {
        const counted = to === r && placesAgain ? stepLoss.sub(placeCost) : stepLoss
        loss += BigInt(weight) * counted.num * (common / counted.den)
      }
      return [loss, 36n * common]
    })
    const values = solveChain({ scale: 36, steps, rewards, columns: 2 }).values[r]
    if (values === null || values === undefined) continue
    const cycleLoss = placeCost.add(at(values, 0).div(Fraction.of(common)))
    const cycleRolls = at(values, 1).div(Fraction.of(common))
    return cycleLoss.div(cycleRolls)
  }
  throw new ExactError('NEVER_RESOLVES', `${spec.typeId} is never placed again`)
}

/** Whether `spec` can be placed on `table` now: its family's window (`locate`). */
function canPlace(group: Group, spec: BetSpec, table: TableNode, cfg: MachineConfig): boolean {
  const { family, type } = at(group.slots, group.subject)
  const located = family.locate({
    state: tableState(cfg, { ...table, bets: table.bets.filter((bet) => bet !== null) }),
    cfg,
    type,
    number: spec.number,
    parentId: null,
  })
  return !('code' in located)
}

/** E[loss of one decision] of `spec` at `amount` from `start`, as paid, in cents. */
function decisionLoss(
  spec: BetSpec,
  start: StartContext,
  amount: Cents,
  cfg: MachineConfig,
): Fraction {
  return measure(distribution(spec, start, 'decision', cfg), amount, cfg, 'rounded').loss
}

function travelCount(
  labels: readonly ChainLabel[],
  counts: readonly Fraction[],
  n: PointNumber,
): Fraction {
  let total = Fraction.ZERO
  for (const [index, label] of labels.entries()) {
    if (label.kind === 'travel' && label.number === n) total = total.add(at(counts, index))
  }
  return total
}

function numberOf(spec: BetSpec): PointNumber {
  if (spec.number === null) throw new ExactError('BAD_SPEC', `${spec.typeId} needs a number`)
  return spec.number
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b
}
