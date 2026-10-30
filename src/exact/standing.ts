import {
  Fraction,
  cents,
  requireBet,
  totalOf,
  type Cents,
  type FamilyKey,
  type MachineConfig,
  type Phase,
  type PointNumber,
  type RoundState,
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
  type RollOutcome,
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
 * | number bets, hardways, one-roll, composites | loss per working roll × π(where it works) |
 * | pass, don't pass | loss per decision × π(comeOut): one starts on each come-out roll |
 * | come, don't come | loss per decision × π(point): one starts in the box on each point roll |
 * | odds | loss per decision × the rate the parent arrives on the number |
 * | side bets (M11) | loss per roll it is up × the share of rolls it is up, over the re-bet cycle |
 *
 * π and the arrival rates come from the round's own chain (`roundStats`) and the parent's chain;
 * the losses from the bet's chain, priced at the stake as the machine pays. A side bet is placed
 * again as soon as its window reopens — at once after Interblock's Lucky Roller loses to a 7, only
 * after the next 7 when it has won; at the seven-out for the Fire Bet and the Hot Shooter; at the
 * next come-out for the Lucky Shooter — so its cost comes straight from that cycle (`rebetCycle`),
 * whose window checks read the roll just made (a 7, a seven-out) as the families' windows do.
 *
 * `renewalCost` computes the same thing a second way, as the plan's identity check asks (§9 item
 * 6): lifecycle loss ÷ lifecycle rolls of a renewal cycle. For a bet that is up alone, the cycle is
 * a chain in which the bet is placed again as soon as it comes down (where its window allows),
 * cut at a regeneration state; for come bets and odds, whose bets overlap, the cycle is the round's
 * come-out to come-out and the bets placed in it.
 */

/**
 * Toggles a standing bet keeps: its own ON/OFF and the global button. Interblock's post-seven-out
 * hold is not one of them: it lasts until the player sets bets ON, which over the long run the
 * player does, so standing costs take it as released.
 */
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
  const { type } = requireBet(cfg, spec.typeId)
  const stats = roundStats(cfg)
  const start = typicalStart(spec, cfg, toggles)
  switch (type.family) {
    case 'collectSet':
    case 'uniquePointsMade':
    case 'handLength':
    case 'pointRun': {
      const cycle = rebetCycle(spec, amount, cfg, toggles)
      const rate = cycle.workingRolls.div(cycle.rolls)
      if (rate.isZero()) {
        return { perRoll: Fraction.ZERO, policy: 'workingRolls', rate, lossPerUnit: Fraction.ZERO }
      }
      const loss = cycle.loss.div(cycle.workingRolls)
      return { perRoll: loss.mul(rate), policy: 'workingRolls', rate, lossPerUnit: loss }
    }
    case 'line': {
      if (spec.number !== null) {
        // A put bet is one decision, not a stream (rules spec §3.1): it has no standing policy.
        throw new ExactError('BAD_SPEC', `${spec.typeId} on ${spec.number} is priced per decision`)
      }
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
 * with `toggles`, per the engine's `effectiveWorking`.
 *
 * Where a bet works the same in each phase whether it is new or carried from an earlier window
 * (every preset), this is plan §5.1's Σ π(phase) over the phases where it works. Where it does not
 * (Shoot To Win with new chips working on the come-out and carried ones not, say), a bet placed
 * again after it comes down is new for a roll or more, so the share comes from the exact re-bet
 * cycle instead: working rolls ÷ rolls per cycle.
 *
 * Only for bets that can stand in every phase (number bets, hardways, one-roll bets and
 * composites): a line bet or odds is tied to the round, and is priced per decision instead. A side
 * bet always works while it is up, but is up only while its window and its own run allow, so its
 * share is the re-bet cycle's: rolls it is up ÷ rolls per cycle.
 */
export function workingShare(spec: BetSpec, cfg: MachineConfig, toggles: Toggles = {}): Fraction {
  const family = requireBet(cfg, spec.typeId).type.family
  if (family === 'line' || family === 'odds') {
    throw new ExactError('BAD_SPEC', `${spec.typeId} is priced per decision, not per working roll`)
  }
  if (isSideFamily(family)) {
    const cycle = rebetCycle(spec, cents(100), cfg, toggles)
    return cycle.workingRolls.div(cycle.rolls)
  }
  const group = groupFor(spec, cfg)
  const working = toggles.working ?? null
  const globalOff = toggles.globalOff ?? null
  const tableAt = (phase: Phase, carried: boolean): TableNode | null => {
    try {
      return startTable(group, spec, phase, { carried, working, globalOff }, cfg)
    } catch (error) {
      // A one-roll bet that comes back after every roll cannot be carried (its invariants).
      if (error instanceof ExactError && error.code === 'BAD_START') return null
      throw error
    }
  }
  const tables: TableNode[] = []
  const works = (phase: Phase, carried: boolean): boolean | null => {
    const table = tableAt(phase, carried)
    if (table === null) return null
    tables.push(table)
    return at(workingOf(table, cfg), group.subject)
  }
  let share = Fraction.ZERO
  let uniform = true
  for (const { phase, share: weight } of roundStats(cfg).phases) {
    const fresh = works(phase, false)
    const carried = works(phase, true) ?? fresh
    if (carried !== fresh) uniform = false
    if (carried === true) share = share.add(weight)
  }
  // The machine can change the toggles between rolls, which no per-phase reading sees: an
  // `AFTER_ROLL` rule switches the bet itself (Interblock's lay re-enable: a lay under Set bets
  // Off still costs about 19¢ a roll where /layAutoOn is set — M5/M6 audit), and a `nextRollOnly`
  // scope resets a toggle after one roll. When any roll does, the share comes from the exact
  // re-bet cycle, like a non-uniform one.
  if (uniform && !togglesChange(group, tables, working, globalOff, cfg)) return share
  const cycle = rebetCycle(spec, cents(100), cfg, toggles)
  return cycle.workingRolls.div(cycle.rolls)
}

/**
 * Whether any roll from `tables` leaves the subject's own setting or the button different from the
 * toggles the bet started with: the machine switched one (`AFTER_ROLL`), or the toggle only lasted
 * the roll. Every such rule acts on a transition any phase can roll (a 7, a point made), so one
 * roll from each start phase sees it.
 */
function togglesChange(
  group: Group,
  tables: readonly TableNode[],
  working: boolean | null,
  globalOff: boolean | null,
  cfg: MachineConfig,
): boolean {
  return tables.some((table) =>
    rollOutcomes(group, table, workingOf(table, cfg), cfg).some((outcome) => {
      const subject = at(outcome.next.bets, group.subject)
      if (subject === null) return false
      return subject.working !== working || outcome.next.globalOff !== globalOff
    }),
  )
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
  const { type } = requireBet(cfg, spec.typeId)
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
      loss = chance.mul(
        decisionLoss(spec, startAt({ kind: 'point', point: n }, toggles), amount, cfg),
      )
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
  const cycle = rebetCycle(spec, amount, cfg, toggles)
  return cycle.loss.div(cycle.rolls)
}

/** One renewal cycle of a bet placed again whenever it comes down: expectations, in cents. */
interface Cycle {
  readonly loss: Fraction
  readonly rolls: Fraction
  readonly workingRolls: Fraction
}

/**
 * A bet up alone, placed again as soon as it comes down (or, if its window is closed, as soon as
 * it opens): the expected loss, rolls and working rolls of a cycle that runs from a fresh placement
 * at a regeneration state r to the next placement landing on r. Every step is the engine's (the
 * same `rollOutcomes` the analysis chains use); the cash of each step is priced at `amount`. A bet
 * placed again is new and follows the toggles; the machine's post-seven-out hold is taken as
 * released (the player sets bets ON), as the long run requires.
 */
function rebetCycle(spec: BetSpec, amount: Cents, cfg: MachineConfig, toggles: Toggles): Cycle {
  const group = groupFor(spec, cfg)
  const subjectType = at(group.slots, group.subject).type
  const placement = upfrontCharge(spec, amount, cfg, 'rounded')
  const placeCost = Fraction.of(amount).add(placement)
  const rearm = rearmDue(subjectType, spec.number) ? placement : Fraction.ZERO
  const fresh = (phase: Phase, globalOff: boolean | null) =>
    startTable(
      group,
      spec,
      phase,
      { carried: false, working: toggles.working ?? null, globalOff },
      cfg,
    )

  interface Edge {
    readonly weight: number
    readonly to: number
    /** The step's loss in cents: stakes and vig paid, less cash credited. */
    readonly loss: Fraction
    readonly placesAgain: boolean
  }
  const workingAt: boolean[] = []
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
  for (const { phase } of typicalStart(spec, cfg).phases)
    add(fresh(phase, toggles.globalOff ?? null))
  const edges: Edge[][] = []
  for (let i = 0; i < tables.length; i++) {
    const table = at(tables, i)
    const working = workingOf(table, cfg)
    workingAt.push(at(working, group.subject))
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
        if (at(next.bets, group.subject) === null && canPlace(group, spec, outcome, cfg)) {
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
    const rewards = edges.map((out, state) => {
      let loss = 0n
      for (const { weight, to, loss: stepLoss, placesAgain } of out) {
        const counted = to === r && placesAgain ? stepLoss.sub(placeCost) : stepLoss
        loss += BigInt(weight) * counted.num * (common / counted.den)
      }
      return [loss, 36n * common, at(workingAt, state) ? 36n * common : 0n]
    })
    const values = solveChain({ scale: 36, steps, rewards, columns: 3 }).values[r]
    if (values === null || values === undefined) continue
    const per = (column: number) => at(values, column).div(Fraction.of(common))
    return { loss: placeCost.add(per(0)), rolls: per(1), workingRolls: per(2) }
  }
  throw new ExactError('NEVER_RESOLVES', `${spec.typeId} is never placed again`)
}

/**
 * Whether `spec` can be placed on the table `outcome` leaves: its family's window (`locate`), read
 * on the round as that roll leaves it. The projected round carries no counters, so the two the
 * side-bet windows read are set from the roll itself: no roll since a 7 when it was a 7 of any
 * kind (`sinceSeven.rolls`: Interblock's Lucky Roller), a new hand when it was a seven-out
 * (`hand.rolls`: the Fire Bet, the Hot Shooter); the phase is the table's. The Hot Shooter's
 * qualifying main-game stake (its `canPlace`) is the player's to keep up and is not checked here.
 */
function canPlace(group: Group, spec: BetSpec, outcome: RollOutcome, cfg: MachineConfig): boolean {
  const { family, type } = at(group.slots, group.subject)
  const state = tableState(cfg, outcome.next)
  const located = family.locate({
    state: { ...state, round: roundAfter(state.round, outcome) },
    cfg,
    type,
    number: spec.number,
    parentId: null,
  })
  return !('code' in located)
}

/** `round` as the roll `outcome` leaves its counters: the ones the side-bet windows read. */
function roundAfter(round: RoundState, outcome: RollOutcome): RoundState {
  const seven = totalOf(outcome.dice) === 7
  const sevenOut = outcome.transition.kind === 'sevenOut'
  return {
    ...round,
    hand: { ...round.hand, rolls: sevenOut ? 0 : round.hand.rolls },
    sinceSeven: {
      rolls: seven ? 0 : round.sinceSeven.rolls,
      totalsMask: round.sinceSeven.totalsMask,
    },
  }
}

function isSideFamily(family: FamilyKey): boolean {
  return (
    family === 'collectSet' ||
    family === 'uniquePointsMade' ||
    family === 'handLength' ||
    family === 'pointRun'
  )
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
