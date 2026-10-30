import {
  ReplayError,
  applyAction,
  cents,
  newTable,
  replayHistory,
  type Action,
  type Cents,
  type GameEvent,
  type Ledger,
  type MachineConfig,
  type SettlementTrace,
  type TableState,
  type WindowRecord,
  type WindowedSession,
} from '../../engine/index.ts'

/**
 * The session meters (rules spec §4.6): what the player put in and what they bet over the whole
 * session, kept from the session log and the engine's events — never from the capped roll history
 * — so a resumed session (the same log) shows the same figures.
 *
 * - **Credit added**: every deposit, the buy-in included. Its total is the engine's own
 *   `Ledger.deposits`, the figure the session strip and the summary already show; the meters add
 *   the list: the buy-in (the starting bankroll, a deposit when it is more than $0) and each top-up
 *   after it with the roll it came before, from the log's `deposit` actions (inside batches too).
 *   An undone deposit leaves the log, so it never counts. A top-up is never a win (plan §0 #19).
 * - **Total wagered**: Σ of each bet decision's stake (`SettlementTrace.stake`) — every family:
 *   line, odds, number, hardway, one-roll and side bets — so a bet that stays up counts again at
 *   its next decision. A decision follows rules spec §0.1 (`isDecision`): a tie counts (the don't
 *   pass bar 12), odds handed back unplayed (`offReturned`) do not, and neither does a side bet's
 *   settlement that leaves it up (the Lucky Shooter's come-out 7 or 11). The engine's
 *   `Ledger.wagered` counts those two too, so it is a different figure and is not shown.
 * - **Commission paid**: the engine's own `Ledger.vigPaid` (net of refunds), and its parts from
 *   the events: charged up front at placement and on increases less what take-downs and cuts
 *   refunded; taken from wins (`vigOnWin`); collected again to keep a winner up, from the win
 *   (`vigRearm`) or from credit, less what a declined re-collection refunded. Commission is not
 *   part of the total wagered.
 *
 * The meters are a fold over the log: `addBetting` for each betting action the log kept (its
 * events come from the table, as replay gives them), `addRoll` for each roll. The game store runs
 * the fold live; `metersOfSession` runs it over a whole log for a resume, an archive or a test.
 * Everything is whole cents and plain JSON, so the meters can be stored with the session.
 */

/** A deposit after the buy-in. */
export interface TopUp {
  readonly amount: Cents
  /** The session's roll it came before, 0-based (`RoundState.rollIndex` when it was made). */
  readonly beforeRoll: number
}

/** Commission paid, by where it came from; the parts add up to `Ledger.vigPaid`. */
export interface CommissionParts {
  /** Charged at placement and on increases, less what take-downs and cuts refunded. */
  readonly upfront: Cents
  /** Taken from wins (commission charged on the win). */
  readonly fromWins: Cents
  /** Collected again to keep a winner up, from the win or from credit, less declined refunds. */
  readonly recollected: Cents
}

/** What the session's settlements and commission events add up to. */
export interface Wagering {
  /** TOTAL WAGERED: Σ stake over every decision (rules spec §0.1, §4.6). */
  readonly wagered: Cents
  /** The decisions `wagered` counts. */
  readonly decisions: number
  readonly commission: CommissionParts
}

export interface SessionMeters {
  /** The starting bankroll: the session's first deposit, when it is more than $0. */
  readonly buyIn: Cents
  /** Every deposit after the buy-in, in log order. */
  readonly topUps: readonly TopUp[]
  /**
   * The settlements' and commission's figures; null when the session's log no longer replays on
   * this engine (a divergent resume, plan §8), so its settlements cannot be recovered.
   */
  readonly wagering: Wagering | null
}

/** The meters of a session and of its committed windows alone (the open window's base). */
export interface SessionMetersPair {
  /** Every committed window: the log up to the last roll. */
  readonly committed: SessionMeters
  /** The committed windows and the open window's actions: the session as it stands. */
  readonly current: SessionMeters
}

/**
 * What the screens show: the meters with the engine's own totals for the same table — credit
 * added is `Ledger.deposits` and commission paid `Ledger.vigPaid` — so each figure exists once.
 */
export interface SessionTotals {
  /** CREDIT ADDED: every deposit, the buy-in included (`Ledger.deposits`). */
  readonly creditAdded: Cents
  /** How many deposits: the buy-in (when more than $0) and every top-up. */
  readonly deposits: number
  readonly buyIn: Cents
  readonly topUps: readonly TopUp[]
  /** TOTAL WAGERED; null when the log no longer replays (`SessionMeters.wagering`). */
  readonly wagered: Cents | null
  readonly decisions: number | null
  /** COMMISSION PAID, net of refunds (`Ledger.vigPaid`). */
  readonly commission: Cents
  readonly commissionParts: CommissionParts | null
}

const NO_COMMISSION: CommissionParts = {
  upfront: cents(0),
  fromWins: cents(0),
  recollected: cents(0),
}

/** The meters before anything is played: the buy-in alone. */
export function startMeters(buyIn: Cents): SessionMeters {
  return {
    buyIn,
    topUps: [],
    wagering: { wagered: cents(0), decisions: 0, commission: NO_COMMISSION },
  }
}

/**
 * Whether a settlement is a decision of its bet (rules spec §0.1): every win, loss and push is,
 * ties included (the don't pass bar 12), except a settlement that returns odds unplayed (push
 * `offReturned`: OFF when their parent was decided, or handed back at a point made), whose stake
 * never had action, and a side bet's settlement that leaves it up (the Lucky Shooter's come-out
 * 7 or 11, which "stays on the betting field"): a side bet is one wager, settled once (§6).
 */
export function isDecision(trace: SettlementTrace, cfg: MachineConfig): boolean {
  if (trace.outcome === 'push' && trace.pushReason === 'offReturned') return false
  return !(trace.stakeDisposition === 'stays' && cfg.sideBets.has(trace.typeId))
}

/** The `deposit` actions in `action`, nested batches included, in the order they apply. */
export function depositsIn(action: Action): Cents[] {
  const found: Cents[] = []
  // Its own stack rather than recursion, as the reducer flattens batches.
  const stack: { readonly list: readonly Action[]; next: number }[] = [{ list: [action], next: 0 }]
  for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
    const inner = top.list[top.next]
    top.next += 1
    if (inner === undefined) stack.pop()
    else if (inner.type === 'batch') stack.push({ list: inner.actions, next: 0 })
    else if (inner.type === 'deposit') found.push(inner.amount)
  }
  return found
}

/**
 * One betting action the log kept: its deposits become top-ups before roll `beforeRoll`, and the
 * commission its events charged or refunded up front joins the up-front part.
 */
export function addBetting(
  meters: SessionMeters,
  action: Action,
  events: readonly GameEvent[],
  beforeRoll: number,
): SessionMeters {
  const deposits = depositsIn(action)
  const topUps =
    deposits.length === 0
      ? meters.topUps
      : [...meters.topUps, ...deposits.map((amount) => ({ amount, beforeRoll }))]
  const { wagering } = meters
  if (wagering === null) return topUps === meters.topUps ? meters : { ...meters, topUps }
  let upfront: number = wagering.commission.upfront
  for (const event of events) {
    if (event.type === 'vigCharged') upfront += event.amount
    else if (event.type === 'vigRefunded') upfront -= event.amount
  }
  if (topUps === meters.topUps && upfront === wagering.commission.upfront) return meters
  return {
    ...meters,
    topUps,
    wagering: { ...wagering, commission: { ...wagering.commission, upfront: cents(upfront) } },
  }
}

/**
 * One roll's events: every decision's stake (`isDecision`), the commission taken from wins, and
 * the commission collected again to keep a winner up — from the win (the settlement's `vigRearm`,
 * which its `vigCharged` from the win only announces) or from credit — less what a declined
 * re-collection refunded.
 */
export function addRoll(
  meters: SessionMeters,
  events: readonly GameEvent[],
  cfg: MachineConfig,
): SessionMeters {
  const { wagering } = meters
  if (wagering === null) return meters
  let wagered: number = wagering.wagered
  let decisions = wagering.decisions
  let fromWins: number = wagering.commission.fromWins
  let recollected: number = wagering.commission.recollected
  for (const event of events) {
    if (event.type === 'betResolved') {
      const { trace } = event
      if (isDecision(trace, cfg)) {
        wagered += trace.stake
        decisions += 1
      }
      fromWins += trace.vigOnWin
      recollected += trace.vigRearm
    } else if (event.type === 'vigCharged' && event.from === 'credit') {
      recollected += event.amount
    } else if (event.type === 'vigRefunded') {
      recollected -= event.amount
    }
  }
  return {
    ...meters,
    wagering: {
      wagered: cents(wagered),
      decisions,
      commission: {
        upfront: wagering.commission.upfront,
        fromWins: cents(fromWins),
        recollected: cents(recollected),
      },
    },
  }
}

/**
 * `committed` with the open window's actions added: each re-applied to the window's table for its
 * events, as replay would apply it (the reducer is pure, so they are the events play gave).
 */
export function withOpenWindow(
  committed: SessionMeters,
  session: WindowedSession,
  cfg: MachineConfig,
): SessionMeters {
  return addActions(committed, session.windowStart, session.pending, cfg)
}

/**
 * The meters of a whole session, its log replayed (`replayHistory`): the committed windows, then
 * the open window. A log that no longer replays on this engine keeps only what the log itself
 * says — the buy-in and the deposits — and `wagering` is null.
 */
export function metersOfSession(session: WindowedSession, cfg: MachineConfig): SessionMetersPair {
  checkConfig(session, cfg)
  const buyIn = cfg.startingBankroll
  let replayed: ReturnType<typeof replayHistory>
  try {
    replayed = replayHistory(session.header, session.committed, {
      anyEngineVersion: true,
      checkInvariants: false,
    })
  } catch (error) {
    if (!(error instanceof ReplayError)) throw error
    return metersOfDeposits(session, buyIn)
  }
  let committed = startMeters(buyIn)
  for (const played of replayed) {
    const record = session.committed[played.index]
    if (record === undefined) throw new Error(`window ${played.index} is missing from the log`)
    const beforeRoll = played.start.round.rollIndex
    record.actions.forEach((action, step) => {
      committed = addBetting(committed, action, played.actionEvents[step] ?? [], beforeRoll)
    })
    committed = addRoll(committed, played.rollEvents, cfg)
  }
  const last = replayed.at(-1)
  const open = last === undefined ? newTable(cfg, session.header.seed) : last.after
  return { committed, current: addActions(committed, open, session.pending, cfg) }
}

/** The meters with the engine's totals for the same table (`ledger`). */
export function sessionTotals(meters: SessionMeters, ledger: Ledger): SessionTotals {
  const { wagering } = meters
  return {
    creditAdded: ledger.deposits,
    deposits: depositCount(meters),
    buyIn: meters.buyIn,
    topUps: meters.topUps,
    wagered: wagering?.wagered ?? null,
    decisions: wagering?.decisions ?? null,
    commission: ledger.vigPaid,
    commissionParts: wagering?.commission ?? null,
  }
}

/** How many deposits: the buy-in, when it is more than $0, and every top-up. */
export function depositCount(meters: SessionMeters): number {
  return (meters.buyIn > 0 ? 1 : 0) + meters.topUps.length
}

/** Σ of the commission parts: `Ledger.vigPaid` on the same table (tested, never assumed). */
export function commissionTotal(parts: CommissionParts): Cents {
  return cents(parts.upfront + parts.fromWins + parts.recollected)
}

function addActions(
  meters: SessionMeters,
  start: TableState,
  actions: readonly Action[],
  cfg: MachineConfig,
): SessionMeters {
  let current = meters
  let state = start
  const beforeRoll = start.round.rollIndex
  actions.forEach((action, index) => {
    const result = applyAction(state, action, cfg, { checkInvariants: false })
    if (!result.ok) {
      // The log kept only actions the table accepted, and the reducer is pure.
      throw new Error(`Pending action ${index} no longer applies: ${result.rejection.code}`)
    }
    current = addBetting(current, action, result.events, beforeRoll)
    state = result.state
  })
  return current
}

/**
 * The meters a log's own actions give, without replaying it: the buy-in and every deposit, and
 * `wagering` null. For a log this engine cannot replay.
 */
export function metersOfDeposits(session: WindowedSession, buyIn: Cents): SessionMetersPair {
  const none: SessionMeters = { buyIn, topUps: [], wagering: null }
  const committed = session.committed.reduce(
    (meters: SessionMeters, record: WindowRecord, index) =>
      record.actions.reduce((sum, action) => addBetting(sum, action, [], index), meters),
    none,
  )
  const open = session.committed.length
  const current = session.pending.reduce(
    (meters, action) => addBetting(meters, action, [], open),
    committed,
  )
  return { committed, current }
}

/** The session plays `cfg`'s machine. */
function checkConfig(session: WindowedSession, cfg: MachineConfig): void {
  if (session.header.configHash !== cfg.configHash) {
    throw new RangeError(
      `This session plays config ${session.header.configHash}, not ${cfg.configHash}`,
    )
  }
}
