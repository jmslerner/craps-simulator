import {
  DICE_CLASSES,
  advanceRound,
  betId,
  cents,
  commissionRule,
  decideBet,
  effectiveWorking,
  heldOffOf,
  isDoubles,
  isSettled,
  resolveBet,
  settle,
  totalBit,
  totalOf,
  type BetId,
  type BetInstance,
  type BetType,
  type Cents,
  type Decision,
  type DiceClass,
  type Fraction,
  type Ledger,
  type MachineConfig,
  type Phase,
  type PointNumber,
  type ResolvedBet,
  type RngState,
  type RollContext,
  type RoundState,
  type RoundTransition,
  type StakeDisposition,
  type TableState,
} from '../engine/index.ts'
// The machine's actions after a roll (Interblock's lay re-enable and the end of its post-seven-out
// hold at the point) change a bet's working status between rolls, so a chain must apply them (M4 →
// M6 hand-off). They are not in the engine barrel; this is the one engine module imported directly.
import { AFTER_ROLL } from '../engine/bets/policies.ts'
import { at, solveChain, type ChainSolution } from './solve.ts'

/**
 * The analysis chain of one bet (plan §5.2): a Markov chain whose states are the bet's own state
 * plus, when its family's `projection` is `round`, the round's phase and point. Each state branches
 * on the 21 dice classes (weight 1 or 2 out of 36), and every branch is worked out by the engine's
 * own rules: `advanceRound`, `effectiveWorking` on the table before the roll, `decideBet` (odds
 * after their parent, with its decision), the family's `apply`, then the roll's commit as
 * `table/roll.ts` makes it (every bet carried, toggles reset under `/workingToggle/scope:
 * nextRollOnly`, the machine's holds kept for the bets still up) and the machine's `AFTER_ROLL`
 * actions. Nothing here knows a bet's rules: a decision is whatever the engine decides.
 *
 * - **What is followed.** The subject bet, behind its parent line bet for odds (the parent's own
 *   money is not the subject's). Only the subject's settlements are labelled.
 * - **Labels** are amount-independent (`price.ts` turns them into money at any stake): a settlement
 *   `win:<payKey>:<disposition>`, `lose:-:lost`, `push:<reason>:<disposition>` (the disposition
 *   is where `settle` sends the stake, which decides its cash); `vig:rearm` when a winner that
 *   stays up has its up-front commission collected again; and `travel:<n>` when the bet moves to
 *   n (no cash; counted for odds and arrival rates).
 * - **Horizons.** `decision` ends at the subject's first settlement; `lifetime` follows it through
 *   wins that leave it up until it comes down.
 * - **Money never enters.** Decisions never read an amount (engine contract), so the chain is built
 *   once at a nominal stake, and states never record amounts or held commission.
 * - **Working inputs.** Whether a bet works reads the phase, its own ON/OFF, the machine's hold
 *   (`TableState.heldOff`: Interblock's post-seven-out OFF), the global button and whether it was
 *   carried from an earlier betting window (Shoot To Win's carried chips), so a state records all
 *   five. After any roll every bet is carried.
 * - **Side bets (M11).** A side bet's state is its own `progress` (the family's encoding: Lucky
 *   Roller's mask of targets rolled, the Fire Bet's mask of points made, the Hot Shooter's roll
 *   count, the Lucky Shooter's point and hits) beside the round's phase, so the chain's states go
 *   beyond (phase, point) exactly as far as the bet does. A bet already on the table starts from
 *   its progress (`StartContext.progress`). The projected round (`roundFor`) is kept consistent
 *   with those counts, and the one count that is unbounded — the Hot Shooter's rolls — is lumped
 *   at its top tier (`canonicalProgress`), where every further roll settles alike, so the chain is
 *   finite; the Monte Carlo sampler (src/sim) walks the same bets without lumping and is the
 *   cross-check.
 */

/** A bet to analyse: a type the machine offers and the number it is on. */
export interface BetSpec {
  readonly typeId: string
  /**
   * A number bet's or hardway's own number; for odds, the point they sit on (their parent's); for
   * a line bet, its own point once it has one. Null for a line bet on the line or in the box, a
   * one-roll bet and a composite.
   */
  readonly number: PointNumber | null
}

export type Horizon = 'decision' | 'lifetime'

export interface WeightedPhase {
  readonly phase: Phase
  readonly weight: Fraction
}

/**
 * Where an analysis starts: the phase of the next roll (or a distribution of phases summing to 1),
 * and the working inputs the bet starts with.
 */
export interface StartContext {
  readonly phases: readonly WeightedPhase[]
  /** Placed before the current betting window (Shoot To Win's carried chips); false = new. */
  readonly carried: boolean
  /** The bet's own ON/OFF setting; null follows the button and the machine's defaults. */
  readonly working: boolean | null
  /** The machine's ON/OFF button (`TableState.globalOff`). */
  readonly globalOff: boolean | null
  /**
   * Whether the machine holds the bet OFF (`TableState.heldOff`: Interblock's place or buy bet
   * placed right after a seven-out, until Set bets On). Absent means no hold.
   */
  readonly held?: boolean
  /**
   * A side bet's progress so far (`BetInstance.progress`, in its family's encoding), for a bet
   * already on the table; absent or 0 for a new bet. A bet with progress has rolled, so it must be
   * `carried`.
   */
  readonly progress?: number
}

/** Why an analysis cannot be made. */
export type ExactErrorCode =
  'NOT_OFFERED' | 'BAD_SPEC' | 'BAD_START' | 'MAX_STATES' | 'NEVER_RESOLVES'

export class ExactError extends Error {
  readonly code: ExactErrorCode

  constructor(code: ExactErrorCode, message: string) {
    super(message)
    this.name = 'ExactError'
    this.code = code
  }
}

/** The come-out: the phase of a chain that does not follow the round. */
export const COME_OUT: Phase = Object.freeze({ kind: 'comeOut' })

/**
 * The default guard on the number of states a chain may reach (plan §5.2): a safety net against a
 * runaway chain, not a budget. The largest chain a preset or a researched variant needs is a Fire
 * Bet counting all ten crapless points — 1,024 masks of points made in each of 11 phases, 11,264
 * states, built in well under a second (M11) — so the guard sits above that.
 */
export const DEFAULT_MAX_STATES = 16_384

/**
 * The bets a chain follows, in settlement order: odds after their parent. Fixed for the whole
 * chain; a slot whose bet has come down holds null.
 */
export interface Group {
  readonly slots: readonly ResolvedBet[]
  /** The slot of the bet being analysed. */
  readonly subject: number
  /** Whether any slot's family needs the round's phase and point (`projection: 'round'`). */
  readonly tracksRound: boolean
  /** The stake each slot is built with; decisions never read it. */
  readonly nominal: readonly Cents[]
}

/**
 * A projected table: the phase of the next roll, the bets in each slot, and the table-wide working
 * inputs: the global button and the machine's holds.
 */
export interface TableNode {
  /** The phase of the next roll; the come-out when the round is not tracked. */
  readonly phase: Phase
  readonly bets: readonly (BetInstance | null)[]
  readonly globalOff: boolean | null
  /** The bets the machine holds OFF (`TableState.heldOff`). */
  readonly heldOff: readonly BetId[]
}

/** What one dice class does to a projected table. */
export interface RollOutcome {
  readonly dice: DiceClass
  readonly transition: RoundTransition
  /** Each slot's decision; `none` for an empty slot. */
  readonly decisions: readonly Decision[]
  /**
   * The table after the roll: decisions applied, the roll committed (toggles reset where they last
   * one roll, holds kept for the bets still up) and the machine's actions after it.
   */
  readonly next: TableNode
}

export type SettledDecision = Extract<Decision, { kind: 'win' | 'lose' | 'push' }>

export type ChainLabel =
  | {
      readonly kind: 'settle'
      readonly key: string
      readonly decision: SettledDecision
      readonly disposition: StakeDisposition
    }
  | { readonly kind: 'rearm'; readonly key: string }
  | { readonly kind: 'travel'; readonly key: string; readonly number: PointNumber }

export interface ChainStep {
  readonly dice: DiceClass
  /** Out of 36. */
  readonly weight: number
  /** The subject's decision on this roll. */
  readonly decision: Decision
  /** The next state, or -1 when the subject came down or the horizon ended. */
  readonly to: number
  readonly labels: readonly number[]
}

export interface ChainNode {
  readonly key: string
  readonly table: TableNode
  /** Whether the subject works on the next roll. */
  readonly working: boolean
  readonly steps: readonly ChainStep[]
}

export interface BetChain {
  readonly spec: BetSpec
  readonly horizon: Horizon
  readonly group: Group
  readonly nodes: readonly ChainNode[]
  readonly labels: readonly ChainLabel[]
  readonly starts: readonly { readonly node: number; readonly weight: Fraction }[]
}

/** A chain and the solver's values for each of its states: label counts, rolls, working rolls. */
export interface SolvedChain {
  readonly chain: BetChain
  readonly solution: ChainSolution
}

/** The solver columns after the labels: rolls, then rolls on which the subject works. */
export const ROLLS_COLUMN = 0
export const WORKING_COLUMN = 1

const SCALE = 36
const RNG: RngState = [1, 2, 3, 4]
const LEDGER: Ledger = {
  deposits: cents(0),
  bankroll: cents(0),
  houseNet: cents(0),
  vigPaid: cents(0),
  wagered: cents(0),
}

/**
 * The slots for `spec`: the bet alone, or odds behind their parent line bet. Throws `ExactError`
 * for a type the machine does not offer or a number the bet cannot be on. Side bets (M11) resolve
 * like any other bet the table can hold (`resolveBet`); they take no number.
 */
export function groupFor(spec: BetSpec, cfg: MachineConfig): Group {
  const resolved = resolveBet(cfg, spec.typeId)
  if (resolved === null) {
    throw new ExactError('NOT_OFFERED', `${cfg.id} does not offer "${spec.typeId}"`)
  }
  const { type } = resolved
  const { number } = spec
  const bad = () =>
    new ExactError('BAD_SPEC', `${spec.typeId} cannot be on ${String(number)} in ${cfg.id}`)
  switch (type.family) {
    case 'numberVsSeven':
    case 'hardway':
      if (!type.numbers.some((n) => n === number)) throw bad()
      break
    case 'odds': {
      if (number === null || !type.pays.has(number)) throw bad()
      const parent = resolveBet(cfg, type.parent)
      if (parent === null)
        throw new ExactError('NOT_OFFERED', `No ${type.parent} for ${spec.typeId}`)
      return makeGroup([parent, resolved], 1)
    }
    case 'line':
      if (number !== null && !cfg.ruleset.points.includes(number)) throw bad()
      break
    case 'oneRoll':
    case 'composite':
    case 'collectSet':
    case 'uniquePointsMade':
    case 'handLength':
    case 'pointRun':
      if (number !== null) throw bad()
      break
  }
  return makeGroup([resolved], 0)
}

/** A group of bets placed side by side, none behind another (the product chain of `events.ts`). */
export function groupOf(typeIds: readonly string[], cfg: MachineConfig): Group {
  const slots = typeIds.map((typeId) => {
    const resolved = resolveBet(cfg, typeId)
    if (resolved === null)
      throw new ExactError('NOT_OFFERED', `${cfg.id} does not offer "${typeId}"`)
    return resolved
  })
  return makeGroup(slots, 0)
}

/**
 * Decisions never read amounts, so a chain is built at fixed nominal stakes that no config value
 * affects (a limit edit must not change an analysis): $1 for the subject and $10,000,000 for any
 * other slot, so a parent's odds cap always covers the nominal odds.
 */
const NOMINAL_SUBJECT = cents(100)
const NOMINAL_OTHER = cents(1_000_000_000)

function makeGroup(slots: readonly ResolvedBet[], subject: number): Group {
  return {
    slots,
    subject,
    tracksRound: slots.some((slot) => followsRound(slot)),
    nominal: slots.map((_, index) => (index === subject ? NOMINAL_SUBJECT : NOMINAL_OTHER)),
  }
}

/**
 * Whether a slot's decisions can read the round's phase and point: its family's `projection`,
 * except that a Lucky Roller that ends on any 7 (`/sideBets/<t>/endsOn: anySeven`, every machine
 * researched) reads nothing of the round — a 7 loses it whatever the phase and every other total
 * is matched against its own mask — so its chain need not multiply its masks by the phases (Roll
 * 'Em All's 1,024 masks would otherwise meet crapless's 11 phases). The family declares `round`
 * because its `sevenOut` variant does read the transition. `chain.test.ts` proves the reading:
 * such a bet decides identically in every phase for every progress and dice class.
 */
export function followsRound({ family, type }: ResolvedBet): boolean {
  if (family.projection !== 'round') return false
  return !(type.family === 'collectSet' && type.endsOn === 'anySeven')
}

/**
 * The table a group starts on for `spec` at `phase`: the subject (and, for odds, its parent on the
 * same number), with the start's working inputs and, for a side bet already on the table, its
 * progress. Throws `BAD_START` when the families' own invariants reject the table (a pass bet off
 * its point, say), or when a bet with progress is said to be new.
 */
export function startTable(
  group: Group,
  spec: BetSpec,
  phase: Phase,
  start: Pick<StartContext, 'carried' | 'working' | 'globalOff' | 'held' | 'progress'>,
  cfg: MachineConfig,
): TableNode {
  const progress = start.progress ?? 0
  if (progress !== 0 && !start.carried) {
    throw new ExactError(
      'BAD_START',
      `${spec.typeId} has progress, so it has rolled: it is carried`,
    )
  }
  const placedAtRoll = start.carried ? 0 : 1
  const bets = group.slots.map((slot, index): BetInstance => {
    const isSubject = index === group.subject
    return {
      id: betId(index + 1),
      typeId: slot.type.typeId,
      number: spec.number,
      parentId: isSubject && group.subject > 0 ? betId(1) : null,
      amount: at(group.nominal, index),
      vigHeld: cents(0),
      working: isSubject ? start.working : null,
      progress: isSubject ? progress : 0,
      // A parent is on its number already, so it was placed in an earlier window.
      placedAtRoll: isSubject ? placedAtRoll : 0,
    }
  })
  const table: TableNode = {
    phase: group.tracksRound ? phase : COME_OUT,
    bets,
    globalOff: start.globalOff,
    heldOff: start.held === true ? [betId(group.subject + 1)] : [],
  }
  checkTable(group, table, cfg)
  return table
}

/** Throws `BAD_START` when any family's invariants reject the table. */
export function checkTable(group: Group, table: TableNode, cfg: MachineConfig): void {
  const state = tableState(cfg, table)
  for (const [index, bet] of table.bets.entries()) {
    if (bet === null) continue
    const { family, type } = at(group.slots, index)
    const problems = family.invariants?.(bet, state, type, cfg) ?? []
    if (problems.length > 0) throw new ExactError('BAD_START', problems.join('; '))
  }
}

/** The key that identifies a projected table: equal keys behave identically on every roll. */
export function tableKey(group: Group, table: TableNode): string {
  const phase = !group.tracksRound
    ? '-'
    : table.phase.kind === 'comeOut'
      ? 'co'
      : `p${table.phase.point}`
  const bets = table.bets
    .map((bet) =>
      bet === null
        ? '_'
        : `${bet.number ?? '-'}/${String(bet.working)}/${bet.placedAtRoll}/${bet.progress}`,
    )
    .join(',')
  return `${phase}|${bets}|${String(table.globalOff)}|${table.heldOff.join(',')}`
}

/**
 * Whether each slot's bet works on the next roll (`effectiveWorking` on the table before it);
 * false for an empty slot.
 */
export function workingOf(table: TableNode, cfg: MachineConfig): boolean[] {
  const state = tableState(cfg, table)
  return table.bets.map((bet) => bet !== null && effectiveWorking(bet, state, cfg))
}

/**
 * What each of the 21 dice classes does to `table` (rules spec §2.3 steps 1–8): the round's
 * transition, each slot's decision in settlement order (odds get their parent's), each family's
 * `apply`, then the commit (every bet is now carried; `nextRollOnly` toggles go back to their
 * defaults) and the machine's `AFTER_ROLL` actions.
 *
 * MAINTENANCE (M5/M6 audit, refactor note): the commit below re-states `table/roll.ts`'s
 * unexported commit step — `vigHeld` cleared, `placedAtRoll` reset, the `nextRollOnly` reset of
 * the toggles and the button, and the `heldOff` filter to the bets still up — and `rearmDue`
 * re-states `settle/commission.ts`'s `rearmAfterWin` condition. Slot order stands in for the
 * reducer's settlement order, which is safe only because a group is built parent-first
 * (`groupFor`), the one ordering settlement uses for these bets. None of this may drift: an engine
 * change to any of those steps must be mirrored here (or the helpers exported and shared — an
 * engine change, out of scope for the exact module alone), and the dispatch-chain oracle
 * (tests/oracle/dispatchChain.ts drives the real reducer; dispatchChain.slow compares every preset
 * bet) is the net that catches a mismatch.
 */
export function rollOutcomes(
  group: Group,
  table: TableNode,
  working: readonly boolean[],
  cfg: MachineConfig,
): RollOutcome[] {
  const state = tableState(cfg, table)
  const before = state.round
  const nextRollOnly = cfg.working.toggle.scope === 'nextRollOnly'
  return DICE_CLASSES.map((dice): RollOutcome => {
    const step = advanceRound(before, dice, cfg.ruleset)
    const shared = {
      dice,
      total: totalOf(dice),
      isPair: isDoubles(dice),
      before,
      transition: step.transition,
      rules: cfg.ruleset,
      cfg,
    }
    const decisions: Decision[] = []
    const after: (BetInstance | null)[] = []
    for (const [index, bet] of table.bets.entries()) {
      if (bet === null) {
        decisions.push({ kind: 'none' })
        after.push(null)
        continue
      }
      const resolved = at(group.slots, index)
      const ctx: RollContext = {
        ...shared,
        working: at(working, index),
        parentDecision: bet.parentId === null ? null : parentDecision(table, decisions, bet),
      }
      const decision = decideBet(bet, ctx, resolved)
      decisions.push(decision)
      after.push(
        canonicalProgress(resolved, resolved.family.apply(bet, decision, ctx, resolved.type)),
      )
    }
    const phase = group.tracksRound ? step.next.phase : COME_OUT
    let bets = after.map((bet) =>
      bet === null
        ? null
        : {
            ...bet,
            vigHeld: cents(0),
            placedAtRoll: 0,
            working: nextRollOnly ? null : bet.working,
          },
    )
    let globalOff = nextRollOnly ? null : table.globalOff
    // The machine's holds outlive the roll for the bets still up (they are not toggles).
    const up = new Set(bets.flatMap((bet) => (bet === null ? [] : [bet.id])))
    let heldOff: readonly BetId[] = table.heldOff.filter((id) => up.has(id))
    if (up.size > 0) {
      let committed = tableState(cfg, { phase, bets, globalOff, heldOff })
      for (const rule of AFTER_ROLL) committed = rule(committed, step, cfg).state
      bets = bets.map((bet) => {
        if (bet === null) return null
        const now = committed.bets.find((b) => b.id === bet.id)
        return now === undefined || now.working === bet.working
          ? bet
          : { ...bet, working: now.working }
      })
      globalOff = committed.globalOff
      heldOff = heldOffOf(committed)
    }
    return {
      dice,
      transition: step.transition,
      decisions,
      next: { phase, bets, globalOff, heldOff },
    }
  })
}

/**
 * The canonical state of a bet after a roll. Only the Hot Shooter Jackpot's progress is unbounded:
 * it counts every roll of the hand, while its pay is fixed by the highest tier reached
 * (`/sideBets/<t>/tiers`), so every count from the top tier's `minRolls` on settles alike, under
 * every count definition (A adds the seven-out to the count before reading the tier, so a count at
 * the top tier is already there; B and C read the count as it is). Such a count is lumped at that
 * tier, which makes the chain finite (plan §11: a specialized projection, cross-checked by the
 * Monte Carlo sampler, which never lumps). Every other family's progress is a bounded mask.
 */
export function canonicalProgress(
  { type }: ResolvedBet,
  bet: BetInstance | null,
): BetInstance | null {
  if (bet === null || type.family !== 'handLength') return bet
  const top = type.tiers.reduce((most, tier) => Math.max(most, tier.minRolls), 0)
  return bet.progress > top ? { ...bet, progress: top } : bet
}

/** The decision of the bet `bet` backs, on this roll; `none` if it is not on the table. */
function parentDecision(table: TableNode, decisions: readonly Decision[], bet: BetInstance) {
  const index = table.bets.findIndex((other) => other?.id === bet.parentId)
  return index === -1 ? { kind: 'none' as const } : at(decisions, index)
}

/**
 * The chain of `spec` from `start`. Throws `ExactError` for a bet the machine does not offer, a bad
 * start, or more than `maxStates` states.
 */
export function buildChain(
  spec: BetSpec,
  start: StartContext,
  horizon: Horizon,
  cfg: MachineConfig,
  maxStates = DEFAULT_MAX_STATES,
): BetChain {
  const group = groupFor(spec, cfg)
  if (start.phases.length === 0) throw new ExactError('BAD_START', 'A start needs a phase')
  const starts = start.phases.map(({ phase, weight }) => ({
    table: startTable(group, spec, phase, start, cfg),
    weight,
  }))
  return chainFrom(spec, group, starts, horizon, cfg, maxStates)
}

/**
 * The chain from given tables (each with its start weight): breadth-first over the tables the
 * subject can reach, stopping where the horizon ends.
 */
export function chainFrom(
  spec: BetSpec,
  group: Group,
  starts: readonly { readonly table: TableNode; readonly weight: Fraction }[],
  horizon: Horizon,
  cfg: MachineConfig,
  maxStates = DEFAULT_MAX_STATES,
): BetChain {
  const labels = new LabelSet(group, spec.number, cfg)
  const index = new Map<string, number>()
  const tables: TableNode[] = []
  const add = (table: TableNode): number => {
    const key = tableKey(group, table)
    const known = index.get(key)
    if (known !== undefined) return known
    if (tables.length >= maxStates) {
      throw new ExactError('MAX_STATES', `${spec.typeId} reaches more than ${maxStates} states`)
    }
    index.set(key, tables.length)
    tables.push(table)
    return tables.length - 1
  }
  const startNodes = new Map<number, Fraction>()
  for (const { table, weight } of starts) {
    const node = add(table)
    const sum = startNodes.get(node)
    startNodes.set(node, sum === undefined ? weight : sum.add(weight))
  }
  const nodes: ChainNode[] = []
  const subjectType = at(group.slots, group.subject).type
  for (let i = 0; i < tables.length; i++) {
    const table = at(tables, i)
    const working = workingOf(table, cfg)
    const steps = rollOutcomes(group, table, working, cfg).map((outcome): ChainStep => {
      const decision = at(outcome.decisions, group.subject)
      const subject = at(outcome.next.bets, group.subject)
      const stepLabels: number[] = []
      let ends = subject === null
      if (isSettled(decision)) {
        const label = labels.settle(decision)
        stepLabels.push(label.index)
        if (horizon === 'decision') ends = true
        else if (label.disposition === 'stays' && rearmDue(subjectType, spec.number)) {
          stepLabels.push(labels.rearm())
        }
      } else if (decision.kind === 'travel') {
        stepLabels.push(labels.travel(decision.number))
      }
      if (!ends && group.subject > 0 && at(outcome.next.bets, 0) === null) {
        throw new Error(`${spec.typeId} outlived the bet it backs`)
      }
      return {
        dice: outcome.dice,
        weight: outcome.dice.weight,
        decision,
        to: ends ? -1 : add(outcome.next),
        labels: stepLabels,
      }
    })
    nodes.push({
      key: tableKey(group, table),
      table,
      working: at(working, group.subject),
      steps,
    })
  }
  return {
    spec,
    horizon,
    group,
    nodes,
    labels: labels.all,
    starts: [...startNodes].map(([node, weight]) => ({ node, weight })),
  }
}

/**
 * Whether a winner that stays up has its up-front commission collected again (rules spec §4.3;
 * the engine's `rearmAfterWin`): a number bet whose rule on this number is charged up front with
 * `rearm` other than `none`. With enough credit (plan §0 #24) it is the full up-front vig, from
 * the win and from credit.
 */
export function rearmDue(type: BetType, number: PointNumber | null): boolean {
  if (type.family !== 'numberVsSeven') return false
  const rule = commissionRule(type, number)
  return rule !== null && rule.timing === 'upfront' && rule.rearm !== 'none'
}

/** Solves a chain: per state, the expected count of each label, then rolls and working rolls. */
export function solveBetChain(chain: BetChain): SolvedChain {
  const columns = chain.labels.length + 2
  const rewards = chain.nodes.map((node) => {
    const row = new Array<bigint>(columns).fill(0n)
    for (const step of node.steps) {
      for (const label of step.labels) row[label] = at(row, label) + BigInt(step.weight)
    }
    row[chain.labels.length + ROLLS_COLUMN] = BigInt(SCALE)
    row[chain.labels.length + WORKING_COLUMN] = node.working ? BigInt(SCALE) : 0n
    return row
  })
  const solution = solveChain({
    scale: SCALE,
    steps: chain.nodes.map((node) => node.steps.map(({ weight, to }) => ({ weight, to }))),
    rewards,
    columns,
  })
  return { chain, solution }
}

/** A table as the engine sees it, for working rules, invariants and the machine's actions. */
export function tableState(cfg: MachineConfig, table: TableNode): TableState {
  const bets = table.bets.filter((bet): bet is BetInstance => bet !== null)
  return {
    v: 1,
    configHash: cfg.configHash,
    rng: RNG,
    round: roundFor(table.phase, bets, cfg),
    bets,
    nextBetSeq: bets.length + 1,
    ledger: LEDGER,
    globalOff: table.globalOff,
    lastRoll: null,
    recentTotals: [],
    rebetBlocked: [],
    heldOff: table.heldOff,
  }
}

/**
 * A round in `phase`, projected: the families of non-side bets read only the phase and point
 * (`projection: round`). Roll 1 of a hand under way, so bets with `placedAtRoll` 1 are new to the
 * coming roll and those with 0 were carried.
 */
export function roundAt(phase: Phase): RoundState {
  return {
    phase,
    rollIndex: 1,
    hand: { index: 0, rolls: 1, pointsMadeMask: 0 },
    sinceSeven: { rolls: 1, totalsMask: 0 },
  }
}

/**
 * The projected round of a table holding `bets` (M11): `roundAt(phase)` when none of them has
 * progress, else a hand under way long enough for the counts on the bets — roll 1 + the largest
 * progress, so a Hot Shooter's rolls fit in the hand and in the rolls since its placement — in
 * which every point has been made, so a Fire Bet's points made are among the hand's. Decisions
 * read none of these counters (only the phase, the transition and the bet's own progress), so the
 * state key need not carry them; the families' invariants do read them, and must find them
 * consistent. New bets are placed at roll 1, which stays the first roll (a bet with progress has
 * rolled, so it is carried: `startTable`).
 */
export function roundFor(
  phase: Phase,
  bets: readonly BetInstance[],
  cfg: MachineConfig,
): RoundState {
  const most = bets.reduce((top, bet) => Math.max(top, bet.progress), 0)
  if (most === 0) return roundAt(phase)
  const rolls = 1 + most
  const pointsMadeMask = cfg.ruleset.points.reduce((mask, point) => mask | totalBit(point), 0)
  return {
    phase,
    rollIndex: rolls,
    hand: { index: 0, rolls, pointsMadeMask },
    sinceSeven: { rolls, totalsMask: 0 },
  }
}

/** The labels a chain has used, numbered in order of first use. */
class LabelSet {
  readonly all: ChainLabel[] = []
  private readonly byKey = new Map<string, number>()
  private readonly dispositions = new Map<string, StakeDisposition>()
  private readonly nominal: BetInstance
  private readonly cfg: MachineConfig

  constructor(group: Group, number: PointNumber | null, cfg: MachineConfig) {
    const { type } = at(group.slots, group.subject)
    this.cfg = cfg
    this.nominal = {
      id: betId(1),
      typeId: type.typeId,
      number,
      parentId: null,
      amount: at(group.nominal, group.subject),
      vigHeld: cents(0),
      working: null,
      progress: 0,
      placedAtRoll: 0,
    }
  }

  /**
   * The label of a settlement: its kind, its pay key or push reason, and where `settle` sends the
   * stake. The disposition is the engine's (`settle`'s `stakeDisposition`), and with the kind and
   * pay or reason it fixes the decision, so equal keys price equally.
   */
  settle(decision: SettledDecision): {
    readonly index: number
    readonly disposition: StakeDisposition
  } {
    const detail = decisionDetail(decision)
    let disposition = this.dispositions.get(detail)
    if (disposition === undefined) {
      disposition = settle(this.nominal, decision, this.cfg, 'exact').stakeDisposition
      this.dispositions.set(detail, disposition)
    }
    const key = `${labelHead(decision)}:${disposition}`
    const index = this.intern(key, () => ({ kind: 'settle', key, decision, disposition }))
    return { index, disposition }
  }

  rearm(): number {
    const key = 'vig:rearm'
    return this.intern(key, () => ({ kind: 'rearm', key }))
  }

  travel(number: PointNumber): number {
    const key = `travel:${number}`
    return this.intern(key, () => ({ kind: 'travel', key, number }))
  }

  private intern(key: string, make: () => ChainLabel): number {
    const known = this.byKey.get(key)
    if (known !== undefined) return known
    this.byKey.set(key, this.all.length)
    this.all.push(make())
    return this.all.length - 1
  }
}

/** `win:<payKey>`, `lose:-` or `push:<reason>`: a settlement label without the stake's fate. */
function labelHead(decision: SettledDecision): string {
  switch (decision.kind) {
    case 'win':
      return `win:${decision.payKey}`
    case 'lose':
      return 'lose:-'
    case 'push':
      return `push:${decision.reason}`
  }
}

/** The whole decision as a string, the stake's fate included where the decision says it. */
function decisionDetail(decision: SettledDecision): string {
  switch (decision.kind) {
    case 'win':
      return `win:${decision.payKey}:${decision.stake}`
    case 'lose':
      return 'lose:-'
    case 'push':
      return decision.reason === 'zeroNet'
        ? `push:${decision.reason}:${decision.stake}`
        : `push:${decision.reason}`
  }
}
