import {
  ALL_ROLLS,
  advanceRound,
  betId,
  cents,
  decideBet,
  effectiveWorking,
  heldOffOf,
  isDoubles,
  isSettled,
  resolveType,
  settle,
  totalOf,
  type BetId,
  type BetInstance,
  type Cents,
  type Decision,
  type Ledger,
  type MachineConfig,
  type Phase,
  type ResolvedType,
  type RngState,
  type RollContext,
  type RoundState,
  type RoundStep,
  type StakeDisposition,
  type TableState,
} from '../engine/index.ts'
// The machine's own actions after a roll change working status between rolls, exactly as the roll
// pipeline applies them. They are not in the engine barrel; this is the one engine module imported
// directly, as src/exact/chain.ts does for the same reason.
import { AFTER_ROLL } from '../engine/bets/policies.ts'
import type { BetSpec, StartContext } from '../exact/index.ts'
import { nextBelow, pickWeighted, prepareWeightedPick } from './uniform.ts'

/**
 * The per-bet decision sampler (plan §9 item 9, M7): one bet walked roll by roll through the
 * engine's own `decideBet` and `settle` until it is decided, over and over, with dice drawn from
 * the engine's RNG. The tally of outcome labels and cash is what the tests compare with
 * `src/exact`'s solved distribution, so Monte Carlo catches solver, chain-construction and RNG
 * bugs. It shares `decideBet` and `settle` with the solver by design — rule bugs are the rule
 * tables' and oracles' job (§9) — but it shares none of the solver's chain building: the walk here
 * is a plain sequential simulation of the roll pipeline (rules spec §2.3), with its own state
 * keying, written from `table/roll.ts`, not from `exact/chain.ts`.
 *
 * The walk mirrors the pipeline step by step: working from `effectiveWorking` on the table before
 * the roll, the round's transition from `advanceRound`, decisions in settlement order (a parent
 * line bet before its odds, which take its decision), each family's `apply`, then the commit
 * (stakes carried, `nextRollOnly` toggles reset, the machine's holds kept for bets still up) and
 * the machine's `AFTER_ROLL` actions. Like the solver, it projects the round to the phase alone
 * (decisions read nothing else of it) and keeps every bet's held commission at zero, pricing a
 * settlement as `credited + vigRearm` — `src/exact/price.ts`'s accounting — plus the stake when
 * it stays up, since a stake left standing at the decision horizon counts as returned.
 *
 * Everything returned is exact: integer decision counts, integer cents. The float statistics
 * (means, sigmas, chi-squared) belong in the test files.
 */

/** The tally of one sampling run: integer counts and exact cents, never floats. */
export interface DecisionSample {
  readonly spec: BetSpec
  readonly amount: Cents
  /** Decisions sampled: the sum of `counts`. */
  readonly decisions: number
  /** Rolls walked, and those on which the subject bet worked. */
  readonly rolls: number
  readonly workingRolls: number
  /** Total cash credited over all decisions, in cents (stays-up stakes counted as returned). */
  readonly totalCash: number
  /** Decisions per settlement label, keyed as the solver keys them: `win:<pay>:<disposition>`. */
  readonly counts: ReadonlyMap<string, number>
  /** The deterministic cash of one decision of each label, in cents. */
  readonly cashByLabel: ReadonlyMap<string, number>
  /** The RNG state after the run, so a caller can keep drawing from the same stream. */
  readonly rng: RngState
}

/** A settled decision: what `settle` prices. */
type SettledDecision = Extract<Decision, { kind: 'win' | 'lose' | 'push' }>

/** The sampler's table between rolls: the subject (and its parent, for odds), slot by slot. */
interface WalkTable {
  readonly phase: Phase
  readonly bets: readonly (BetInstance | null)[]
  readonly globalOff: boolean | null
  readonly heldOff: readonly BetId[]
}

/** What one of the 36 dice does to a state: a settlement of the subject, or the next state. */
interface Outcome {
  readonly settled: { readonly key: string; readonly cash: number } | null
  readonly next: Node | null
}

/** A memoized state: outcomes are computed once per dice and replayed on every later visit. */
interface Node {
  readonly walk: WalkTable
  readonly state: TableState
  readonly working: readonly boolean[]
  readonly subjectWorks: boolean
  readonly outcomes: (Outcome | null)[]
}

/** The subject's stake in slot `subject`; any parent is nominal and never read by a decision. */
const PARENT_NOMINAL = cents(1_000_000_000)
const WALK_RNG: RngState = [1, 2, 3, 4]
const WALK_LEDGER: Ledger = {
  deposits: cents(0),
  bankroll: cents(0),
  houseNet: cents(0),
  vigPaid: cents(0),
  wagered: cents(0),
}
/** A guard against a walk that never decides; the solver throws NEVER_RESOLVES for such starts. */
const MAX_ROLLS_PER_DECISION = 100_000

/**
 * Samples `decisions` decisions of `spec` at `amount` from `start`, with dice drawn from `rng`.
 * The start phase of each decision is drawn from the start's exact phase weights.
 */
export function sampleDecisions(
  spec: BetSpec,
  start: StartContext,
  amount: Cents,
  cfg: MachineConfig,
  decisions: number,
  rng: RngState,
): DecisionSample {
  const sampler = new Sampler(spec, start, amount, cfg)
  const counts = new Map<string, number>()
  const cashByLabel = new Map<string, number>()
  let rolls = 0
  let workingRolls = 0
  let totalCash = 0
  let state = rng
  for (let decision = 0; decision < decisions; decision++) {
    const [phaseIndex, afterPick] = pickWeighted(sampler.startPick, state)
    state = afterPick
    let node = at(sampler.startNodes, phaseIndex)
    for (let roll = 0; ; roll++) {
      if (roll >= MAX_ROLLS_PER_DECISION) {
        throw new Error(`${spec.typeId} was still undecided after ${MAX_ROLLS_PER_DECISION} rolls`)
      }
      const [diceIndex, afterDice] = nextBelow(36, state)
      state = afterDice
      const outcome = node.outcomes[diceIndex] ?? sampler.computeOutcome(node, diceIndex)
      rolls++
      if (node.subjectWorks) workingRolls++
      if (outcome.settled !== null) {
        const { key, cash } = outcome.settled
        const known = cashByLabel.get(key)
        if (known === undefined) cashByLabel.set(key, cash)
        else if (known !== cash) {
          throw new Error(`Label ${key} of ${spec.typeId} paid both ${known}¢ and ${cash}¢`)
        }
        counts.set(key, (counts.get(key) ?? 0) + 1)
        totalCash += cash
        break
      }
      if (outcome.next === null) throw new Error(`${spec.typeId} vanished without a settlement`)
      node = outcome.next
    }
  }
  return {
    spec,
    amount,
    decisions,
    rolls,
    workingRolls,
    totalCash,
    counts,
    cashByLabel,
    rng: state,
  }
}

/** The lazily built walk graph of one (spec, start, amount, config). */
class Sampler {
  readonly startPick
  readonly startNodes: Node[]
  private readonly spec: BetSpec
  private readonly amount: Cents
  private readonly cfg: MachineConfig
  private readonly slots: readonly ResolvedType[]
  private readonly subject: number
  private readonly nodes = new Map<string, Node>()

  constructor(spec: BetSpec, start: StartContext, amount: Cents, cfg: MachineConfig) {
    this.spec = spec
    this.amount = amount
    this.cfg = cfg
    const { slots, subject } = slotsFor(spec, cfg)
    this.slots = slots
    this.subject = subject
    this.startPick = prepareWeightedPick(start.phases.map(({ weight }) => weight))
    this.startNodes = start.phases.map(({ phase }) => this.node(this.startTable(phase, start)))
  }

  /** The table a decision starts on: a fresh subject (and its parent) with the start's toggles. */
  private startTable(phase: Phase, start: StartContext): WalkTable {
    const bets = this.slots.map((slot, index): BetInstance => {
      const isSubject = index === this.subject
      return {
        id: betId(index + 1),
        typeId: slot.type.typeId,
        number: this.spec.number,
        parentId: isSubject && this.subject > 0 ? betId(1) : null,
        amount: isSubject ? this.amount : PARENT_NOMINAL,
        vigHeld: cents(0),
        working: isSubject ? start.working : null,
        progress: 0,
        // A parent is already on its number, so it was placed in an earlier window.
        placedAtRoll: isSubject && !start.carried ? 1 : 0,
      }
    })
    const walk: WalkTable = {
      phase,
      bets,
      globalOff: start.globalOff,
      heldOff: start.held === true ? [betId(this.subject + 1)] : [],
    }
    const state = this.tableState(walk)
    for (const [index, bet] of walk.bets.entries()) {
      if (bet === null) continue
      const { family, type } = at(this.slots, index)
      const problems = family.invariants?.(bet, state, type, this.cfg) ?? []
      if (problems.length > 0) {
        throw new Error(`Bad start for ${this.spec.typeId}: ${problems.join('; ')}`)
      }
    }
    return walk
  }

  /** The memoized node of `walk`, created on first sight. */
  private node(walk: WalkTable): Node {
    const key = walkKey(walk)
    const known = this.nodes.get(key)
    if (known !== undefined) return known
    const state = this.tableState(walk)
    const working = walk.bets.map((bet) => bet !== null && effectiveWorking(bet, state, this.cfg))
    const made: Node = {
      walk,
      state,
      working,
      subjectWorks: at(working, this.subject),
      outcomes: new Array<Outcome | null>(36).fill(null),
    }
    this.nodes.set(key, made)
    return made
  }

  /** Works out (and memoizes) what dice `diceIndex` does to `node`: one roll of the pipeline. */
  computeOutcome(node: Node, diceIndex: number): Outcome {
    const { cfg } = this
    const dice = at(ALL_ROLLS, diceIndex)
    const { walk, state } = node
    const step = advanceRound(state.round, dice, cfg.ruleset)
    const shared = {
      dice,
      total: totalOf(dice),
      isPair: isDoubles(dice),
      before: state.round,
      transition: step.transition,
      rules: cfg.ruleset,
      cfg,
    }
    const decisions: Decision[] = []
    const after: (BetInstance | null)[] = []
    let settledSubject: { readonly key: string; readonly cash: number } | null = null
    for (const [index, bet] of walk.bets.entries()) {
      if (bet === null) {
        decisions.push({ kind: 'none' })
        after.push(null)
        continue
      }
      const resolved = at(this.slots, index)
      const ctx: RollContext = {
        ...shared,
        working: at(node.working, index),
        parentDecision: bet.parentId === null ? null : at(decisions, 0),
      }
      const decision = decideBet(bet, ctx, resolved)
      decisions.push(decision)
      if (index === this.subject && isSettled(decision)) {
        settledSubject = this.settledOutcome(bet, decision)
        break
      }
      after.push(resolved.family.apply(bet, decision, ctx, resolved.type))
    }
    const outcome: Outcome =
      settledSubject !== null
        ? { settled: settledSubject, next: null }
        : { settled: null, next: this.node(this.commit(walk, step, after)) }
    node.outcomes[diceIndex] = outcome
    return outcome
  }

  /** The settlement's label key and cash: `credited + vigRearm`, plus a stake that stays up. */
  private settledOutcome(
    bet: BetInstance,
    decision: SettledDecision,
  ): { readonly key: string; readonly cash: number } {
    const trace = settle(bet, decision, this.cfg)
    const stays = trace.stakeDisposition === 'stays'
    return {
      key: labelKey(decision, trace.stakeDisposition),
      cash: trace.credited + trace.vigRearm + (stays ? this.amount : 0),
    }
  }

  /**
   * The table after the roll (pipeline step 8, then step 9): every bet carried, `nextRollOnly`
   * toggles back to their defaults, the machine's holds kept for the bets still up, and the
   * machine's own actions after the roll.
   */
  private commit(
    walk: WalkTable,
    step: RoundStep,
    after: readonly (BetInstance | null)[],
  ): WalkTable {
    const { cfg } = this
    const nextRollOnly = cfg.working.toggle.scope === 'nextRollOnly'
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
    if (this.subject > 0 && at(bets, 0) === null && at(bets, this.subject) !== null) {
      throw new Error(`${this.spec.typeId} outlived the bet it backs`)
    }
    let globalOff = nextRollOnly ? null : walk.globalOff
    const up = new Set(bets.flatMap((bet) => (bet === null ? [] : [bet.id])))
    let heldOff: readonly BetId[] = walk.heldOff.filter((id) => up.has(id))
    const phase = step.next.phase
    if (up.size > 0) {
      let committed = this.tableState({ phase, bets, globalOff, heldOff })
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
    return { phase, bets, globalOff, heldOff }
  }

  /** The walk's table as the engine sees it, for working rules, invariants and machine actions. */
  private tableState(walk: WalkTable): TableState {
    const bets = walk.bets.filter((bet): bet is BetInstance => bet !== null)
    return {
      v: 1,
      configHash: this.cfg.configHash,
      rng: WALK_RNG,
      round: projectedRound(walk.phase),
      bets,
      nextBetSeq: walk.bets.length + 1,
      ledger: WALK_LEDGER,
      globalOff: walk.globalOff,
      lastRoll: null,
      recentTotals: [],
      rebetBlocked: [],
      heldOff: walk.heldOff,
    }
  }
}

/** The subject's slot, behind its parent line bet for odds; decisions go in slot order. */
function slotsFor(
  spec: BetSpec,
  cfg: MachineConfig,
): { readonly slots: readonly ResolvedType[]; readonly subject: number } {
  const resolved = resolveType(cfg, spec.typeId)
  if (resolved === null) throw new Error(`${cfg.id} does not offer "${spec.typeId}"`)
  if (resolved.type.family === 'odds') {
    if (spec.number === null) throw new Error(`${spec.typeId} needs the point it sits on`)
    const parent = resolveType(cfg, resolved.type.parent)
    if (parent === null) throw new Error(`No ${resolved.type.parent} for ${spec.typeId}`)
    return { slots: [parent, resolved], subject: 1 }
  }
  return { slots: [resolved], subject: 0 }
}

/**
 * A round in `phase`, projected as the solver projects it: decisions read only the phase and point
 * (plus the bet's own progress), so the walk need not track roll counts or hand masks. Roll 1 of a
 * hand under way: `placedAtRoll` 1 is new to the coming roll, 0 was carried.
 */
function projectedRound(phase: Phase): RoundState {
  return {
    phase,
    rollIndex: 1,
    hand: { index: 0, rolls: 1, pointsMadeMask: 0 },
    sinceSeven: { rolls: 1, totalsMask: 0 },
  }
}

/** `win:<payKey>:<disposition>`, `lose:-:lost` or `push:<reason>:<disposition>`, as the solver. */
function labelKey(decision: SettledDecision, disposition: StakeDisposition): string {
  switch (decision.kind) {
    case 'win':
      return `win:${decision.payKey}:${disposition}`
    case 'lose':
      return `lose:-:${disposition}`
    case 'push':
      return `push:${decision.reason}:${disposition}`
  }
}

/** The key of a walk state: equal keys behave identically on every roll. */
function walkKey(walk: WalkTable): string {
  const phase = walk.phase.kind === 'comeOut' ? 'co' : `p${walk.phase.point}`
  const held = new Set(walk.heldOff)
  const bets = walk.bets
    .map((bet) =>
      bet === null
        ? '_'
        : `${bet.number ?? '-'}/${String(bet.working)}/${bet.placedAtRoll}/${bet.progress}` +
          `${held.has(bet.id) ? '/h' : ''}`,
    )
    .join(',')
  return `${phase}|${bets}|${String(walk.globalOff)}`
}

/** `list[index]`, which must exist: walk arrays are fixed-size. */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index]
  if (value === undefined) throw new RangeError(`Nothing at index ${index}`)
  return value
}
