import { applyAction, newTable, replayHistory, requireBet } from '../../engine/index.ts'
import type {
  Action,
  GameEvent,
  MachineConfig,
  TableState,
  WindowedSession,
} from '../../engine/index.ts'

/**
 * An independent recomputation of the session meters (rules spec §4.6) for the tests, written from
 * the definitions and the engine's raw events — never from `coach/summary/meters.ts`:
 *
 * - deposits: the logged `deposit` actions, found by walking each action and its batches
 *   recursively; the buy-in is the machine's starting bankroll;
 * - decisions: every settlement, except odds handed back unplayed (push `offReturned`) and a
 *   settlement of a side-bet family that leaves the bet on the table the roll left (looked up by
 *   id there, not read off the trace's disposition);
 * - commission: every `vigCharged` that moved money from credit, every settlement's `vigOnWin` and
 *   `vigRearm`, less every `vigRefunded`, split by where it happened.
 *
 * Plain numbers, no `cents` branding, so a slip in the meters' types cannot hide here.
 */

export interface OracleMeters {
  readonly buyIn: number
  readonly topUps: readonly { readonly amount: number; readonly beforeRoll: number }[]
  /** buy-in + Σ top-ups. */
  readonly creditAdded: number
  readonly wagered: number
  readonly decisions: number
  /** Settlements that are no decision, and their stakes: the rest of `Ledger.wagered`. */
  readonly notDecisions: number
  readonly notDecidedStakes: number
  readonly upfront: number
  readonly fromWins: number
  readonly recollected: number
  readonly commission: number
  /** What the session reached, for coverage checks. */
  readonly seen: {
    readonly offReturned: number
    readonly sideBetLeftUp: number
    readonly barPushes: number
    readonly declinedRecollections: number
    readonly recollectedFromCredit: number
    readonly depositsInBatches: number
  }
}

const SIDE_FAMILIES: ReadonlySet<string> = new Set([
  'collectSet',
  'uniquePointsMade',
  'handLength',
  'pointRun',
])

/** The deposits in an action, depth first. */
function depositAmounts(
  action: Action,
  inBatch: boolean,
  out: { amount: number; batch: boolean }[],
) {
  if (action.type === 'deposit') out.push({ amount: action.amount, batch: inBatch })
  else if (action.type === 'batch')
    for (const inner of action.actions) depositAmounts(inner, true, out)
}

export function oracleMeters(session: WindowedSession, cfg: MachineConfig): OracleMeters {
  const topUps: { amount: number; beforeRoll: number }[] = []
  let wagered = 0
  let decisions = 0
  let notDecisions = 0
  let notDecidedStakes = 0
  let upfront = 0
  let fromWins = 0
  let recollected = 0
  const seen = {
    offReturned: 0,
    sideBetLeftUp: 0,
    barPushes: 0,
    declinedRecollections: 0,
    recollectedFromCredit: 0,
    depositsInBatches: 0,
  }

  const betting = (action: Action, events: readonly GameEvent[], rollIndex: number): void => {
    const found: { amount: number; batch: boolean }[] = []
    depositAmounts(action, false, found)
    for (const deposit of found) {
      topUps.push({ amount: deposit.amount, beforeRoll: rollIndex })
      if (deposit.batch) seen.depositsInBatches += 1
    }
    for (const event of events) {
      if (event.type === 'vigCharged') upfront += event.amount
      if (event.type === 'vigRefunded') upfront -= event.amount
    }
  }

  const windows = replayHistory(session.header, session.committed, { anyEngineVersion: true })
  for (const played of windows) {
    const record = session.committed[played.index]
    if (record === undefined) throw new Error(`no record for window ${played.index}`)
    record.actions.forEach((action, step) => {
      betting(action, played.actionEvents[step] ?? [], played.index)
    })
    for (const event of played.rollEvents) {
      if (event.type === 'betResolved') {
        const { trace } = event
        const leftUp = played.after.bets.some((bet) => bet.id === trace.betId)
        const family = requireBet(cfg, trace.typeId).type.family
        const unplayed = trace.outcome === 'push' && trace.pushReason === 'offReturned'
        const sideLeftUp = leftUp && SIDE_FAMILIES.has(family)
        if (unplayed) seen.offReturned += 1
        if (sideLeftUp) seen.sideBetLeftUp += 1
        if (trace.pushReason === 'bar' && !SIDE_FAMILIES.has(family)) seen.barPushes += 1
        if (unplayed || sideLeftUp) {
          notDecisions += 1
          notDecidedStakes += trace.stake
        } else {
          decisions += 1
          wagered += trace.stake
        }
        fromWins += trace.vigOnWin
        recollected += trace.vigRearm
      } else if (
        event.type === 'vigCharged' &&
        event.reason === 'rearm' &&
        event.from === 'credit'
      ) {
        recollected += event.amount
        seen.recollectedFromCredit += 1
      } else if (event.type === 'vigRefunded') {
        recollected -= event.amount
      } else if (event.type === 'betRemoved' && event.reason === 'vigDeclined') {
        seen.declinedRecollections += 1
      }
    }
  }

  let table: TableState = windows.at(-1)?.after ?? newTable(cfg, session.header.seed)
  const open = session.committed.length
  for (const action of session.pending) {
    const result = applyAction(table, action, cfg)
    if (!result.ok) throw new Error(`a pending action was refused: ${result.rejection.code}`)
    betting(action, result.events, open)
    table = result.state
  }

  const buyIn = cfg.startingBankroll
  return {
    buyIn,
    topUps,
    creditAdded: buyIn + topUps.reduce((sum, topUp) => sum + topUp.amount, 0),
    wagered,
    decisions,
    notDecisions,
    notDecidedStakes,
    upfront,
    fromWins,
    recollected,
    commission: upfront + fromWins + recollected,
    seen,
  }
}
