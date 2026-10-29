/**
 * The dispatch-chain oracle (plan §9 item 4): the Markov chain of one bet built by driving the
 * real reducer, `applyAction`, with every roll, and solved with this folder's own `denseSolve.ts`.
 * It checks the reducer's wiring end to end (working rules, settlement order, travel, the ledger),
 * which the exact solver in `src/exact` reaches only through `decide`, `apply` and `settle`.
 *
 * It is the one oracle that may import the engine; it must not import `src/exact`, the solver it
 * checks (tests/architecture.test.ts enforces this).
 *
 * How a chain is built:
 * 1. `dispatchVariant` loosens a machine so any stake can be placed: a 1¢ bet increment, a 1¢
 *    minimum, no minimum total, per-type minimums and increments dropped (maximums kept), and a
 *    bankroll large enough that every commission can be paid (plan §0 amendment 24).
 * 2. `startTable` places the bet on a fresh table, after the scripted rolls its window needs (a
 *    point for come bets; the parent's point for odds). Only that bet, and an odds bet's parent,
 *    are on the table.
 * 3. From each state, all 36 ordered rolls go through `applyAction({ type: 'roll', dice })`. The
 *    table after each roll is projected to a key: the phase and point, and each bet's own state
 *    (type, number, amount, held vig, its ON/OFF setting, whether it is carried from an earlier
 *    window, whether the machine holds it OFF). Rolls that decide the bet end in an absorbing
 *    outcome. A key reached by two different tables is replayed once from the second table, and
 *    must lead to the same transitions: the projection may not hide state that matters.
 * 4. Each transition records the bet's cash flows from the events and checks them against the
 *    ledger: a roll moves the bankroll by exactly the cash of the bets it decided.
 *
 * Horizons: `decision` stops at the bet's first decision; `lifetime` follows the bet until it
 * leaves the table (a winner that stays up starts a new decision), which prices the lifecycle edge
 * of rules spec §0.1 with plan §0 amendment 22's divisor: the stake of every decision plus the
 * commission paid up front (at placement, and re-collected when a winner stays up).
 */
import {
  applyAction,
  cents,
  effectiveWorking,
  makeRoll,
  newTable,
  type Action,
  type BetId,
  type GameEvent,
  type MachineConfig,
  type MachineConfigInput,
  type PointNumber,
  type TableState,
} from '../../src/engine/index.ts'
import { pruneProvenance } from '../../src/engine/config/provenance.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import { denseSolve, type DenseTransition } from './denseSolve.ts'

/** Starting credit for a dispatch table: enough that no commission is ever declined. */
const BANKROLL = 1_000_000_000

/**
 * A copy of `input` that takes any stake from 1¢ (M4 → M6 hand-off): the 101¢ stake of plan §9
 * item 4 fails the presets' $1 increment, and a lone bet under the minimum total cannot roll.
 * Provenance entries left pointing at nothing are pruned, as validation requires.
 */
export function dispatchVariant(input: MachineConfigInput): MachineConfigInput {
  const copy = structuredClone(input) as MachineConfigInput
  const perType = Object.fromEntries(
    Object.entries(copy.limits.perType ?? {}).map(([id, limits]) => [
      id,
      limits.max === undefined ? {} : { max: limits.max },
    ]),
  )
  const variant: MachineConfigInput = {
    ...copy,
    money: { ...copy.money, betIncrement: 1, startingBankroll: BANKROLL },
    limits: { ...copy.limits, min: 1, minTotal: null, perType },
  }
  return { ...variant, provenance: pruneProvenance(variant) }
}

/** The bet a chain follows. */
export interface DispatchBet {
  readonly typeId: string
  /** Number bets and hardways: the number. */
  readonly number?: number
  /** The stake, in cents. */
  readonly amount: number
  /**
   * The table's point when the bet is placed, or null for the come-out (the default; come and
   * don't come bets need a point). An odds bet behind a come or don't come bet: the table's
   * point while that bet sits on its number.
   */
  readonly point?: number | null
  /** Odds only: the line bet they go behind, on its number. */
  readonly parent?: { readonly typeId: string; readonly amount: number; readonly number: number }
}

export interface DispatchStart {
  readonly table: TableState
  readonly betId: BetId
  /** The stake and any commission charged when the bet was placed, in cents. */
  readonly placementCost: number
  /** The commission charged when the bet was placed, in cents. */
  readonly placementVig: number
}

/** Places `bet` on a fresh table of `cfg` after the scripted rolls its window needs. */
export function startTable(cfg: MachineConfig, bet: DispatchBet): DispatchStart {
  let table = newTable(cfg, 'dispatch-chain')
  const act = (action: Action): readonly GameEvent[] => {
    const result = applyAction(table, action, cfg)
    if (!result.ok) {
      const { code, details } = result.rejection
      throw new Error(`${JSON.stringify(action)} refused: ${code} ${JSON.stringify(details)}`)
    }
    table = result.state
    return result.events
  }
  const rollTotal = (total: number) => act({ type: 'roll', dice: diceFor(total) })
  const place = (typeId: string, amount: number, extra: Partial<Action> = {}) =>
    act({ type: 'place', typeId, amount: cents(amount), ...extra } as Action)
  const point = bet.point ?? null

  let parentId: BetId | undefined
  if (bet.parent !== undefined) {
    // A pass or don't pass parent goes in on the come-out and takes its number as the point; a
    // come or don't come parent goes in on the table's point and travels to its number.
    const { typeId, amount, number } = bet.parent
    if (point === null) {
      place(typeId, amount)
      rollTotal(number)
    } else {
      if (point === number) throw new RangeError(`${typeId} on ${number} needs another point`)
      rollTotal(point)
      place(typeId, amount)
      rollTotal(number)
    }
    parentId = table.bets.find((b) => b.typeId === typeId && b.number === number)?.id
    if (parentId === undefined) throw new Error(`${typeId} did not reach ${number}`)
  } else if (point !== null) rollTotal(point)

  const before = table.ledger
  const events = place(bet.typeId, bet.amount, {
    ...(bet.number === undefined ? {} : { number: bet.number as PointNumber }),
    ...(parentId === undefined ? {} : { parentId }),
  })
  const placed = events.find((e) => e.type === 'betPlaced')
  if (placed?.type !== 'betPlaced') throw new Error(`${bet.typeId} was not placed`)
  const placementVig = events.reduce(
    (sum, e) => (e.type === 'vigCharged' && e.betId === placed.bet.id ? sum + e.amount : sum),
    0,
  )
  return {
    table,
    betId: placed.bet.id,
    placementCost: before.bankroll - table.ledger.bankroll,
    placementVig,
  }
}

export type Horizon = 'decision' | 'lifetime'

/** One roll's effect on the followed bet. */
interface Step {
  /** Absorbed: the decision (`decision` horizon), or how the bet left the table (`lifetime`). */
  readonly outcome: string | null
  /** The table after the roll, when the chain goes on. */
  readonly next: TableState | null
  readonly rewards: Readonly<Record<string, Fraction>>
}

export interface DispatchChain {
  /** The table of each state; state 0 is the start. */
  readonly tables: readonly TableState[]
  readonly keys: readonly string[]
  readonly transitions: readonly (readonly DenseTransition[])[]
  readonly start: DispatchStart
}

/**
 * Builds the chain of `bet` on `cfg` (a compiled `dispatchVariant`). Rewards per transition, all
 * in cents except the roll counts:
 * - `rolls`, `workingRolls`: 1 per roll, and 1 per roll on which the bet was working;
 * - `cash`: what the roll moved between the bankroll and the bet (credited, less commission
 *   re-collected from credit, plus a declined bet's stake and refund);
 * - `rearm`: commission re-collected because a winner stays up, from the win and from credit;
 * - `wagered`: the stake of the decision, when the roll decides the bet;
 * - `staysUp`: the stake left on the table when the `decision` horizon ends on a winner (or bar
 *   push) that stays up.
 */
export function buildChain(cfg: MachineConfig, bet: DispatchBet, horizon: Horizon): DispatchChain {
  const start = startTable(cfg, bet)
  const tables: TableState[] = [start.table]
  const keys: string[] = [stateKey(start.table, start.betId)]
  const index = new Map<string, number>([[keys[0] ?? '', 0]])
  const replayed = new Set<string>()
  const transitions: DenseTransition[][] = []
  const stepsOf = (table: TableState) =>
    ROLLS.map(([d1, d2]) => rollStep(cfg, table, start.betId, d1, d2, horizon))

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]
    if (table === undefined) break
    const out: DenseTransition[] = []
    for (const step of stepsOf(table)) {
      const p = Fraction.of(1, 36)
      if (step.outcome !== null) {
        out.push({ p, to: { absorb: step.outcome }, rewards: step.rewards })
        continue
      }
      if (step.next === null) throw new Error('A step goes nowhere')
      const key = stateKey(step.next, start.betId)
      let j = index.get(key)
      if (j === undefined) {
        j = tables.length
        index.set(key, j)
        tables.push(step.next)
        keys.push(key)
      } else if (!replayed.has(key) && !sameTable(tables[j], step.next)) {
        // The same key from another table: its future must be the same.
        replayed.add(key)
        const known = tables[j]
        if (known === undefined) throw new Error('Lost a state')
        const a = stepsOf(known).map((s) => describe(s, start.betId))
        const b = stepsOf(step.next).map((s) => describe(s, start.betId))
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          throw new Error(`The key hides state that matters: ${key}`)
        }
      }
      out.push({ p, to: { state: j }, rewards: step.rewards })
    }
    transitions.push(out)
  }
  return { tables, keys, transitions, start }
}

export interface DispatchAnalysis {
  /** Transient states in the chain. */
  readonly states: number
  /** P(each absorbing outcome) from the start. */
  readonly outcomes: ReadonlyMap<string, Fraction>
  readonly expectedRolls: Fraction
  readonly expectedWorkingRolls: Fraction
  /** E[cash back from the bet], in cents. */
  readonly cashBack: Fraction
  /** E[commission re-collected from winners that stay up], in cents. */
  readonly rearm: Fraction
  /** E[stake left up when the horizon ends], in cents (`decision` horizon only). */
  readonly staysUp: Fraction
  /** E[Σ stakes of the decisions], in cents. */
  readonly wagered: Fraction
  readonly placementCost: number
  readonly placementVig: number
  /**
   * E[loss], in cents: the placement cost − cash back. On the `decision` horizon a stake left up
   * counts as back, and a re-collection is the next decision's commission, not this one's.
   */
  readonly loss: Fraction
  /** E[amount risked]: Σ stakes + commission paid up front (plan §0 amendment 22). */
  readonly risked: Fraction
  readonly edge: Fraction
  /** E[net] ÷ stake: −loss ÷ stake. */
  readonly netPerStake: Fraction
  /** loss ÷ (E[working rolls] × stake) (plan §5.1). */
  readonly edgePerWorkingRoll: Fraction
}

/** Builds and solves the chain of `bet`; see `buildChain`. */
export function dispatchAnalysis(
  cfg: MachineConfig,
  bet: DispatchBet,
  horizon: Horizon,
): DispatchAnalysis {
  const chain = buildChain(cfg, bet, horizon)
  const solved = denseSolve({ size: chain.tables.length, transitions: chain.transitions }, {
    visits: false,
  })
  const from = solved.rewards[0]
  const reward = (name: string) => from?.get(name) ?? Fraction.ZERO
  const { placementCost, placementVig } = chain.start
  const cashBack = reward('cash')
  const rearm = reward('rearm')
  const staysUp = reward('staysUp')
  const wagered = reward('wagered')
  const stake = Fraction.of(bet.amount)
  const loss =
    horizon === 'decision'
      ? Fraction.of(placementCost).sub(cashBack).sub(rearm).sub(staysUp)
      : Fraction.of(placementCost).sub(cashBack)
  const risked = wagered.add(Fraction.of(placementVig)).add(horizon === 'lifetime' ? rearm : Fraction.ZERO)
  const workingRolls = reward('workingRolls')
  return {
    states: chain.tables.length,
    outcomes: solved.absorption[0] ?? new Map(),
    expectedRolls: reward('rolls'),
    expectedWorkingRolls: workingRolls,
    cashBack,
    rearm,
    staysUp,
    wagered,
    placementCost,
    placementVig,
    loss,
    risked,
    edge: loss.div(risked),
    netPerStake: loss.neg().div(stake),
    edgePerWorkingRoll: workingRolls.isZero() ? Fraction.ZERO : loss.div(workingRolls.mul(stake)),
  }
}

/** The 36 ordered rolls. */
const ROLLS: readonly (readonly [number, number])[] = [1, 2, 3, 4, 5, 6].flatMap((d1) =>
  [1, 2, 3, 4, 5, 6].map((d2) => [d1, d2] as const),
)

/**
 * One roll from `table`: the bet's outcome if the roll ends the horizon, and its cash, checked
 * against the ledger.
 */
function rollStep(
  cfg: MachineConfig,
  table: TableState,
  betId: BetId,
  d1: number,
  d2: number,
  horizon: Horizon,
): Step {
  const bet = table.bets.find((b) => b.id === betId)
  if (bet === undefined) throw new Error('The followed bet is gone')
  const working = effectiveWorking(bet, table, cfg)
  const result = applyAction(table, { type: 'roll', dice: makeRoll(d1, d2) }, cfg)
  if (!result.ok) {
    throw new Error(`A roll of ${d1}-${d2} was refused: ${result.rejection.code}`)
  }
  const { state, events } = result
  const cash = cashByBet(events)
  const bankrollMoved = state.ledger.bankroll - table.ledger.bankroll
  const allCash = [...cash.values()].reduce((sum, x) => sum + x, 0)
  if (bankrollMoved !== allCash) {
    throw new Error(`Roll ${d1}-${d2}: the bankroll moved ${bankrollMoved}, the events ${allCash}`)
  }
  const resolved = events.find((e) => e.type === 'betResolved' && e.trace.betId === betId)
  const trace = resolved?.type === 'betResolved' ? resolved.trace : null
  const rearm = events.reduce(
    (sum, e) =>
      e.type === 'vigCharged' && e.betId === betId && e.reason === 'rearm' ? sum + e.amount : sum,
    0,
  )
  const after = state.bets.find((b) => b.id === betId)
  const rewards: Record<string, Fraction> = {
    rolls: Fraction.ONE,
    workingRolls: working ? Fraction.ONE : Fraction.ZERO,
    cash: Fraction.of(cash.get(betId) ?? 0),
    rearm: Fraction.of(rearm),
    wagered: Fraction.of(trace === null ? 0 : trace.stake),
  }
  if (trace !== null && horizon === 'decision') {
    if (after !== undefined) rewards.staysUp = Fraction.of(after.amount)
    return { outcome: trace.outcome, next: null, rewards }
  }
  if (after === undefined) {
    const declined = events.some(
      (e) => e.type === 'betRemoved' && e.betId === betId && e.reason === 'vigDeclined',
    )
    return {
      outcome: declined ? 'declined' : trace?.stakeDisposition === 'lost' ? 'lost' : 'returned',
      next: null,
      rewards,
    }
  }
  return { outcome: null, next: state, rewards }
}

/**
 * Cash between the bankroll and each bet on a roll, from its events: what a settlement credited,
 * less commission re-collected from credit, plus a refund and the stake of a bet taken down
 * because its commission was declined.
 */
function cashByBet(events: readonly GameEvent[]): Map<string, number> {
  const cash = new Map<string, number>()
  const add = (id: string, amount: number) => cash.set(id, (cash.get(id) ?? 0) + amount)
  for (const e of events) {
    if (e.type === 'betResolved') add(e.trace.betId, e.trace.credited)
    else if (e.type === 'vigCharged' && e.from === 'credit') add(e.betId, -e.amount)
    else if (e.type === 'vigRefunded') add(e.betId, e.amount)
    else if (e.type === 'betRemoved') add(e.betId, e.amount)
  }
  return cash
}

/**
 * The state a chain tracks: the round's phase and point, and each bet's own state. The followed
 * bet is `self` and its parent `parent`, whatever their ids. Left out: the dice stream, roll and
 * hand counters, the history panel and the ledger, none of which decides a bet on this table.
 */
function stateKey(table: TableState, betId: BetId): string {
  const { phase } = table.round
  const held = new Set(table.heldOff ?? [])
  const self = table.bets.find((b) => b.id === betId)
  const name = (id: BetId | null) =>
    id === null ? null : id === betId ? 'self' : id === self?.parentId ? 'parent' : `bet:${id}`
  return JSON.stringify({
    phase: phase.kind,
    point: phase.kind === 'point' ? phase.point : null,
    globalOff: table.globalOff,
    rebetBlocked: [...table.rebetBlocked].sort(),
    bets: table.bets.map((b) => ({
      bet: name(b.id),
      typeId: b.typeId,
      number: b.number,
      parent: name(b.parentId),
      amount: b.amount,
      vigHeld: b.vigHeld,
      working: b.working,
      progress: b.progress,
      carried: b.placedAtRoll < table.round.rollIndex,
      held: held.has(b.id),
    })),
  })
}

/** A step as comparable text: its outcome or next key, and its rewards. */
function describe(step: Step, betId: BetId): string {
  const rewards = Object.entries(step.rewards).map(([k, v]) => `${k}=${v.toString()}`)
  const to = step.outcome ?? (step.next === null ? '?' : stateKey(step.next, betId))
  return `${to} ${rewards.join(' ')}`
}

function sameTable(a: TableState | undefined, b: TableState): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b)
}

/** Two dice showing `total`, the easy way where there is one (1-3 for 4, 2-6 for 8). */
function diceFor(total: number) {
  const d1 = Math.max(1, total - 6)
  return makeRoll(d1, total - d1)
}
