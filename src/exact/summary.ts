import {
  Fraction,
  ReplayError,
  applyAction,
  cents,
  hashJson,
  newTable,
  requireBet,
  type Action,
  type BetId,
  type BetInstance,
  type Cents,
  type Dice,
  type FamilyKey,
  type GameEvent,
  type MachineConfig,
  type PushReason,
  type SessionHeader,
  type SettlementTrace,
  type TableState,
  type WindowRecord,
} from '../engine/index.ts'
import { analysisCache, remember } from './cache.ts'
import { ExactError, isSideFamily, type BetSpec } from './chain.ts'
import { startOfBet, takeDownValue } from './equity.ts'
import { analysisKey, distribution, price } from './price.ts'

/**
 * The session account behind the session summary (plan §5.7, §10 M13): every decision's cost and
 * every roll's luck over a session log, replayed from the log itself, so a resumed session (the
 * same log) gives the same account to the last fraction of a cent.
 *
 * **Wealth.** `W = bankroll + Σ equity`, where a bet's equity is what its current decision will
 * still return on average (`analyzeExisting`'s V, plan §5.1). Then, exactly,
 *
 *   W_end − W_start − (credit added after the start) = Σ luck − Σ decision cost
 *
 * and, since the session starts with no bets and the starting bankroll is the first deposit,
 * `W_end − total deposits = Σ luck − Σ cost`: the result is measured against everything put in,
 * so a top-up is never a win (plan §0 #19).
 *
 * **Decision cost** (plan §5.1: outlay − Δequity), booked per bet:
 * - every betting action — a bet placed, pressed, cut or taken down, a switch ON or OFF, the
 *   button: what it moved from credit onto the bet (stake, up-front vig; less what came back),
 *   less what it changed the bet's equity by. Placing a bet costs its decision's expected loss;
 *   taking one down gives back the expected loss of the decision it leaves; a switch that changes
 *   no decision's value costs nothing. Deposits move no bet and cost nothing;
 * - the machine's own re-wager of a winner that stays up (the M5/M6 → M9 hand-off's "Limits"): a
 *   new decision of the same bet at the same stake, so its cost is the stake plus any up-front
 *   vig collected again from the win or from credit, less the new decision's equity.
 *
 * **Luck**, per bet a roll found on the table: what the roll realized against the equity the bet
 * had. For a bet the roll decided, the realized value is what `price.ts` counts for a settlement
 * — the credit, the vig re-collected from the win, and the stake when it stays up — so it equals
 * its equity on average over the dice (the martingale the summary property checks). For a bet
 * the roll did not decide (a point roll that misses, a come bet travelling, a side bet's
 * progress), it is the change in its equity plus any cash the roll moved for it. A side bet's
 * settlement that leaves it up (the Lucky Shooter's come-out 7 or 11) decides nothing (rules spec
 * §0.1, §6; `decidesWager`), so it is luck on the same wager, never a re-wager.
 *
 * Every amount is exact: integer cents for money that moved, `Fraction`s of cents for equity, cost
 * and luck. The identity is checked by the tests (`identityGap`), not here: the account is built
 * per bet from the engine's events and settlement traces, and the identity holds only if those
 * explain every movement of the ledger.
 */

/** Wealth at one point of the session (all cents). */
export interface Wealth {
  /** The player's credit. */
  readonly bankroll: Cents
  /** Σ stake of the bets on the table, at face value. */
  readonly onTable: Cents
  /** Σ equity of the bets on the table. */
  readonly equity: Fraction
  /** W = bankroll + Σ equity. */
  readonly wealth: Fraction
  /** Money put in so far, the starting bankroll included (`Ledger.deposits`). */
  readonly deposits: Cents
}

/** One bet's share of one decision: a betting action, or the machine's re-wager of a winner. */
export interface CostEntry {
  /** The window (0-based); the open window is `committed.length`. */
  readonly window: number
  /** The action's index in its window; null for a re-wager, which the window's roll made. */
  readonly step: number | null
  readonly kind: 'action' | 'rewager'
  readonly betId: BetId
  readonly spec: BetSpec
  readonly family: FamilyKey
  /** The bet's stake after the step; 0 when it came down. */
  readonly amount: Cents
  /** Cents from credit onto the bet (stake and up-front vig) less cents given back. */
  readonly outlay: number
  /** The bet's equity before the step (0 for a new bet or a new decision). */
  readonly equityBefore: Fraction
  /** Its equity after the step (0 when it came down). */
  readonly equityAfter: Fraction
  /** outlay − (equityAfter − equityBefore). */
  readonly cost: Fraction
}

/** What one roll did to one bet it found on the table. */
export interface LuckEntry {
  readonly betId: BetId
  /** The bet as the roll found it. */
  readonly spec: BetSpec
  readonly family: FamilyKey
  readonly amount: Cents
  readonly equityBefore: Fraction
  /**
   * Cents the roll moved to credit for the bet: its settlement's credit, less up-front vig charged
   * to credit to keep it up, plus what a declined re-collection gave back with the stake.
   */
  readonly cash: number
  /** The settlement the roll made, or null. */
  readonly outcome: 'win' | 'lose' | 'push' | null
  readonly pushReason: PushReason | null
  /**
   * The roll decided the bet's wager: a settlement, except one that leaves a side bet up. A push
   * that hands back odds unplayed (`offReturned`) is settled here but is no decision of the bet
   * (rules spec §0.1); `playedDecision` says so.
   */
  readonly decided: boolean
  /** A decision with action on the stake: `decided`, and not odds handed back unplayed. */
  readonly playedDecision: boolean
  /** The bet's equity after the roll: its new decision's when it stays up, 0 when it came down. */
  readonly equityAfter: Fraction
  /** Realized − equityBefore (see the module comment). */
  readonly luck: Fraction
}

export interface RollAccount {
  readonly window: number
  /** The roll's 0-based index in the session (`diceRolled.rollIndex`). */
  readonly rollIndex: number
  readonly dice: Dice
  /** Σ of the bets' luck. */
  readonly luck: Fraction
  /** The bets the roll settled, moved or revalued; a bet it left as it was is not listed. */
  readonly bets: readonly LuckEntry[]
}

export interface SessionAccount {
  readonly configHash: string
  /** Committed windows (rolls) covered. */
  readonly windows: number
  /** Actions of the open window covered. */
  readonly pending: number
  readonly start: Wealth
  readonly end: Wealth
  /** Credit added after the start: `end.deposits − start.deposits`. */
  readonly topUps: Cents
  /** Every decision's cost, in log order. */
  readonly costs: readonly CostEntry[]
  readonly rolls: readonly RollAccount[]
  /** Σ decision cost. */
  readonly cost: Fraction
  /** Σ luck. */
  readonly luck: Fraction
  /** The table the log ends on, the open window's actions applied. */
  readonly state: TableState
}

/**
 * How far the account is from the identity `W_end − W_start − topUps = Σ luck − Σ cost`: zero
 * whenever the engine's events explain every movement of the ledger.
 */
export function identityGap(account: SessionAccount): Fraction {
  const realized = account.end.wealth.sub(account.start.wealth).sub(Fraction.of(account.topUps))
  return realized.sub(account.luck.sub(account.cost))
}

/** The account of a whole log, the open window's `pending` actions included. */
export function accountSession(
  header: SessionHeader,
  committed: readonly WindowRecord[],
  pending: readonly Action[],
  cfg: MachineConfig,
): SessionAccount {
  const accountant = new SessionAccountant(header, cfg)
  for (const record of committed) accountant.addWindow(record)
  return accountant.account(pending)
}

/**
 * The account built window by window, so a caller can spread a long log over several tasks and
 * add the windows a later roll commits without replaying the earlier ones. `account(pending)`
 * leaves the accountant as it was, so it can be asked again after the open window changes.
 */
export class SessionAccountant {
  readonly header: SessionHeader
  readonly cfg: MachineConfig
  private state: TableState
  private readonly startWealth: Wealth
  private readonly costs: CostEntry[] = []
  private readonly rollAccounts: RollAccount[] = []
  private windowCount = 0
  private readonly equities = new WeakMap<TableState, Map<BetId, Fraction>>()

  constructor(header: SessionHeader, cfg: MachineConfig) {
    if (header.configHash !== cfg.configHash) {
      throw new RangeError(`This session plays config ${header.configHash}, not ${cfg.configHash}`)
    }
    this.header = header
    this.cfg = cfg
    this.state = newTable(cfg, header.seed)
    this.startWealth = this.wealthOf(this.state)
  }

  /** Committed windows accounted so far. */
  get windows(): number {
    return this.windowCount
  }

  /**
   * Accounts the next committed window: its betting actions, then its roll. Throws `ReplayError`
   * when the table refuses a logged action or ends the window on another table than the log's.
   */
  addWindow(record: WindowRecord): void {
    const windowIndex = this.windowCount
    const atRoll = this.applyActions(this.state, record.actions, windowIndex, this.costs)
    const rolled = applyAction(atRoll, record.roll, this.cfg)
    if (!rolled.ok) {
      throw new ReplayError({
        kind: 'refused',
        window: windowIndex,
        step: 'roll',
        rejection: rolled.rejection,
      })
    }
    const replayed = hashJson(rolled.state)
    if (replayed !== record.hashAfter) {
      throw new ReplayError({
        kind: 'hash',
        window: windowIndex,
        logged: record.hashAfter,
        replayed,
      })
    }
    const { roll, rewagers } = accountRoll(
      atRoll,
      rolled.state,
      rolled.events,
      windowIndex,
      this.cfg,
      {
        equity: (bet, state) => this.equity(bet, state),
      },
    )
    this.rollAccounts.push(roll)
    this.costs.push(...rewagers)
    this.state = rolled.state
    this.windowCount = windowIndex + 1
  }

  /** The account so far, with the open window's `pending` actions applied to a copy. */
  account(pending: readonly Action[]): SessionAccount {
    const costs = [...this.costs]
    const state = this.applyActions(this.state, pending, this.windowCount, costs)
    const end = this.wealthOf(state)
    return {
      configHash: this.cfg.configHash,
      windows: this.windowCount,
      pending: pending.length,
      start: this.startWealth,
      end,
      topUps: cents(end.deposits - this.startWealth.deposits),
      costs,
      rolls: [...this.rollAccounts],
      cost: Fraction.sum(costs.map((entry) => entry.cost)),
      luck: Fraction.sum(this.rollAccounts.map((roll) => roll.luck)),
      state,
    }
  }

  /** Applies a window's betting actions, booking each bet's cost; returns the table after them. */
  private applyActions(
    start: TableState,
    actions: readonly Action[],
    windowIndex: number,
    costs: CostEntry[],
  ): TableState {
    let state = start
    actions.forEach((action, step) => {
      const result = applyAction(state, action, this.cfg)
      if (!result.ok) {
        throw new ReplayError({
          kind: 'refused',
          window: windowIndex,
          step,
          rejection: result.rejection,
        })
      }
      const outlays = outlaysOf(result.events)
      const ids = [...new Set([...state.bets, ...result.state.bets].map((bet) => bet.id))]
      for (const id of ids) {
        const before = state.bets.find((bet) => bet.id === id)
        const after = result.state.bets.find((bet) => bet.id === id)
        const equityBefore = before === undefined ? Fraction.ZERO : this.equity(before, state)
        const equityAfter = after === undefined ? Fraction.ZERO : this.equity(after, result.state)
        const outlay = outlays.get(id) ?? 0
        if (outlay === 0 && equityAfter.equals(equityBefore)) continue
        const bet = after ?? before
        if (bet === undefined) continue
        costs.push({
          window: windowIndex,
          step,
          kind: 'action',
          betId: id,
          spec: specOf(bet),
          family: this.familyOf(bet),
          amount: after?.amount ?? cents(0),
          outlay,
          equityBefore,
          equityAfter,
          cost: Fraction.of(outlay).sub(equityAfter.sub(equityBefore)),
        })
      }
      state = result.state
    })
    return state
  }

  /** Credit plus the equity of every bet on `state`. */
  private wealthOf(state: TableState): Wealth {
    const equity = Fraction.sum(state.bets.map((bet) => this.equity(bet, state)))
    const { bankroll, deposits } = state.ledger
    return {
      bankroll,
      onTable: cents(state.bets.reduce((sum, bet) => sum + bet.amount, 0)),
      equity,
      wealth: Fraction.of(bankroll).add(equity),
      deposits,
    }
  }

  /** A bet's equity on `state`, remembered per table. */
  private equity(bet: BetInstance, state: TableState): Fraction {
    let known = this.equities.get(state)
    if (known === undefined) {
      known = new Map()
      this.equities.set(state, known)
    }
    const hit = known.get(bet.id)
    if (hit !== undefined) return hit
    const value = betEquity(bet, state, this.cfg)
    known.set(bet.id, value)
    return value
  }

  private familyOf(bet: BetInstance): FamilyKey {
    return requireBet(this.cfg, bet.typeId).type.family
  }
}

/** A roll's account: each bet's luck, and the re-wagers of the winners it left up. */
export interface RollAccounting {
  readonly roll: RollAccount
  /** The machine's re-wagers this roll made: decision costs, booked with the roll's window. */
  readonly rewagers: readonly CostEntry[]
}

export interface AccountRollOptions {
  /** How to value a bet on a table; `betEquity` by default (the accountant remembers per table). */
  readonly equity?: (bet: BetInstance, state: TableState) => Fraction
}

/**
 * What the roll that took `atRoll` to `after` (with `events`) did to each bet it found there: its
 * luck, and, for a winner (or a barred push) that stays up, the machine's re-wager as a decision
 * cost. Pure: the tests feed it every one of the 36 rolls of a table to check that luck averages
 * exactly zero.
 */
export function accountRoll(
  atRoll: TableState,
  after: TableState,
  events: readonly GameEvent[],
  windowIndex: number,
  cfg: MachineConfig,
  options: AccountRollOptions = {},
): RollAccounting {
  const equity = options.equity ?? ((bet, state) => betEquity(bet, state, cfg))
  const rolled = events.find((event) => event.type === 'diceRolled')
  if (rolled?.type !== 'diceRolled') throw new Error('a roll must emit diceRolled')
  const traces = new Map<BetId, SettlementTrace>()
  // Up-front vig collected again to keep a winner up: all of it, and the part charged to credit
  // (the rest came out of the win, which `credited` already holds back).
  const rearmed = new Map<BetId, number>()
  const rearmedFromCredit = new Map<BetId, number>()
  // A re-collection credit could not pay: the stake (`betRemoved`) and what the win had paid
  // toward the vig (`vigRefunded`) go back to credit as the machine takes the bet down.
  const returned = new Map<BetId, number>()
  const add = (map: Map<BetId, number>, id: BetId, amount: number): void => {
    map.set(id, (map.get(id) ?? 0) + amount)
  }
  for (const event of events) {
    if (event.type === 'betResolved') {
      traces.set(event.trace.betId, event.trace)
    } else if (event.type === 'vigCharged' && event.reason === 'rearm') {
      add(rearmed, event.betId, event.amount)
      if (event.from === 'credit') add(rearmedFromCredit, event.betId, event.amount)
    } else if (event.type === 'vigRefunded' || event.type === 'betRemoved') {
      add(returned, event.betId, event.amount)
    }
  }
  const bets: LuckEntry[] = []
  const rewagers: CostEntry[] = []
  for (const bet of atRoll.bets) {
    const equityBefore = equity(bet, atRoll)
    const trace = traces.get(bet.id)
    const left = after.bets.find((other) => other.id === bet.id)
    const equityAfter = left === undefined ? Fraction.ZERO : equity(left, after)
    const cash =
      (trace?.credited ?? 0) - (rearmedFromCredit.get(bet.id) ?? 0) + (returned.get(bet.id) ?? 0)
    const family = requireBet(cfg, bet.typeId).type.family
    const decided = trace !== undefined && (left === undefined || !isSideFamily(family))
    let luck: Fraction
    if (trace !== undefined && decided) {
      // What the decision realized, counted as `price.ts` counts a settlement: the credit, the
      // vig the win paid toward keeping the bet up, and the stake when it stays up.
      const stays = trace.stakeDisposition === 'stays' ? trace.stake : 0
      luck = Fraction.of(trace.credited + trace.vigRearm + stays).sub(equityBefore)
      if (left !== undefined) {
        // The winner (or a barred push) stays up for a new decision: the machine's re-wager.
        const outlay = trace.stake + (rearmed.get(bet.id) ?? 0)
        rewagers.push({
          window: windowIndex,
          step: null,
          kind: 'rewager',
          betId: bet.id,
          spec: specOf(left),
          family,
          amount: left.amount,
          outlay,
          equityBefore: Fraction.ZERO,
          equityAfter,
          cost: Fraction.of(outlay).sub(equityAfter),
        })
      }
    } else {
      luck = Fraction.of(cash).add(equityAfter).sub(equityBefore)
    }
    // A bet the roll neither settled nor revalued: nothing to say about it.
    if (trace === undefined && cash === 0 && luck.isZero()) continue
    bets.push({
      betId: bet.id,
      spec: specOf(bet),
      family,
      amount: bet.amount,
      equityBefore,
      cash,
      outcome: trace?.outcome ?? null,
      pushReason: trace?.pushReason ?? null,
      decided,
      playedDecision: decided && trace?.pushReason !== 'offReturned',
      equityAfter,
      luck,
    })
  }
  return {
    roll: {
      window: windowIndex,
      rollIndex: rolled.rollIndex,
      dice: rolled.dice,
      luck: Fraction.sum(bets.map((entry) => entry.luck)),
      bets,
    },
    rewagers,
  }
}

const MAX_EQUITIES = 8_000
const equityCache = analysisCache<string, Fraction>()

/**
 * The equity of `bet` on table `state` (plan §5.1): E[cash its current decision returns], a stake
 * left up counted as returned — `analyzeExisting(...).equity` without the lifetime analysis, and
 * cached by everything it depends on (the analysis key and the stake). A bet that would never be
 * decided from here (held OFF until the player sets bets ON) is worth what taking it down returns.
 */
export function betEquity(bet: BetInstance, state: TableState, cfg: MachineConfig): Fraction {
  const spec = specOf(bet)
  const start = startOfBet(bet, state)
  const key = `${analysisKey(spec, start, 'decision', cfg)}|${bet.amount}`
  const cached = equityCache.get(key)
  if (cached !== undefined) return cached
  try {
    const value = price(
      distribution(spec, start, 'decision', cfg),
      bet.amount,
      cfg,
      'rounded',
    ).credited
    remember(equityCache, key, value, MAX_EQUITIES)
    return value
  } catch (error) {
    if (!(error instanceof ExactError) || error.code !== 'NEVER_RESOLVES') throw error
    return takeDownValue(bet, state, cfg)
  }
}

/** What a betting action's events moved onto (positive) or off (negative) each bet, in cents. */
function outlaysOf(events: readonly GameEvent[]): Map<BetId, number> {
  const outlays = new Map<BetId, number>()
  const add = (id: BetId, amount: number): void => {
    outlays.set(id, (outlays.get(id) ?? 0) + amount)
  }
  // Every other event a betting action makes (a switch, a deposit) moves nothing onto a bet.
  for (const event of events) {
    if (event.type === 'betPlaced') add(event.bet.id, event.bet.amount)
    else if (event.type === 'betAdjusted') add(event.betId, event.to - event.from)
    else if (event.type === 'betRemoved') add(event.betId, -event.amount)
    else if (event.type === 'vigCharged') add(event.betId, event.amount)
    else if (event.type === 'vigRefunded') add(event.betId, -event.amount)
  }
  return outlays
}

function specOf(bet: BetInstance): BetSpec {
  return { typeId: bet.typeId, number: bet.number }
}
