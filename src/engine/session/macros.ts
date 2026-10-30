import type { MachineConfig } from '../config/compile.ts'
import { canonicalJson } from '../core/hash.ts'
import { cents, type Cents } from '../core/money.ts'
import { legalBets, type LegalBet } from '../bets/legal.ts'
import { typeLimits } from '../bets/limits.ts'
import type { BetId } from '../bets/types.ts'
import type { Action } from '../table/actions.ts'
import type { GameEvent } from '../table/events.ts'
import { applyAction, validateAction } from '../table/reducer.ts'
import type { TableState } from '../table/state.ts'

/**
 * The betting macros (plan §4.9; Interblock's Repeat Last Bet, Double Bet and Press, the odds
 * pop-up's maximum, and taking everything down). Each is pure and returns what to dispatch in the
 * betting window: nothing, when there is nothing to do or the table would refuse it, or exactly one
 * `batch`, which the table accepts as it stands and which changes it. One batch is one undo step,
 * and it applies all or nothing.
 *
 * Amounts come from `legalBets`, so every limit applies: per-type minimums, maximums and units, the
 * odds cap, the table maximum and credit (with any up-front commission). Where one change uses up
 * what the next could have had (credit, the table maximum), the macro builds its batch one change
 * at a time on the table the changes before it leave.
 */

/**
 * Repeat Last Bet: the session's `lastWindow` (the bets made in the latest window that made any)
 * again, as one batch, if the table accepts all of it now. Presses and odds name their bet by id,
 * so one whose bet has since come down makes the whole repeat unavailable, as does a line bet out
 * of its phase.
 */
export function repeatBets(
  state: TableState,
  lastWindow: readonly Action[],
  cfg: MachineConfig,
): readonly Action[] {
  return asBatch(state, [...lastWindow], cfg)
}

/**
 * Double Bet: every bet that may grow to twice its amount, doubled, all in one batch; nothing when
 * the table cannot take them all together (credit, the table maximum). A bet whose double the table
 * refuses on its own (a contract bet, a maximum or the odds cap) stays as it is.
 */
export function doubleBets(state: TableState, cfg: MachineConfig): readonly Action[] {
  const spots = legalBets(state, cfg)
  const actions = state.bets.flatMap((bet): Action[] => {
    const spot = spots.find((s) => s.betId === bet.id)
    if (spot === undefined || spot.canAdd !== null) return []
    const action: Action = { type: 'setAmount', betId: bet.id, amount: cents(bet.amount * 2) }
    const refusal = validateAction(state, action, cfg)
    // A double that only credit or the table maximum refuses stays in the batch, so the whole
    // macro comes back empty (all or nothing); one the bet's own limits refuse leaves that bet as
    // it is and the rest still double (M5/M6 audit).
    if (
      refusal !== null &&
      refusal.code !== 'INSUFFICIENT_CREDIT' &&
      refusal.code !== 'TABLE_MAX'
    ) {
      return []
    }
    return [action]
  })
  return asBatch(state, actions, cfg)
}

/**
 * Press: adds what the bet won (`won`, from `winsOf` on the roll's events) back onto it, in whole
 * units of its increment, as far as its limits and credit allow; the rest of the win stays in
 * credit. Nothing when the win is less than one unit or the bet cannot grow.
 */
export function pressBet(
  state: TableState,
  betId: BetId,
  won: Cents,
  cfg: MachineConfig,
): readonly Action[] {
  if (!Number.isSafeInteger(won) || won <= 0) return []
  const spot = legalBets(state, cfg).find((s) => s.betId === betId)
  if (spot === undefined || spot.canAdd !== null) return []
  const { increment } = typeLimits(cfg, spot.typeId, spot.number)
  const add = Math.min(won - (won % increment), spot.maxAdd)
  if (add < spot.minAdd) return []
  return asBatch(state, [{ type: 'setAmount', betId, amount: cents(spot.amount + add) }], cfg)
}

/**
 * Maximum odds: each odds spot behind a bet (`parentId`, or every one when null) raised to the most
 * it can hold now, its `maxAdd` from `legalBets`: the cap, the odds type's maximum and unit, the
 * table maximum and credit. Spots fill in layout order, each with the credit the ones before it
 * left, so afterwards no odds spot can take more.
 */
export function maxOutOdds(
  state: TableState,
  parentId: BetId | null,
  cfg: MachineConfig,
): readonly Action[] {
  const targets = legalBets(state, cfg).filter(
    (spot) => spot.parentId !== null && (parentId === null || spot.parentId === parentId),
  )
  const actions: Action[] = []
  let current = state
  for (const target of targets) {
    const spot = legalBets(current, cfg).find(
      (s) => s.typeId === target.typeId && s.parentId === target.parentId,
    )
    if (spot === undefined || spot.parentId === null || spot.canAdd !== null) continue
    const action: Action =
      spot.betId === null
        ? { type: 'place', typeId: spot.typeId, parentId: spot.parentId, amount: spot.maxAdd }
        : { type: 'setAmount', betId: spot.betId, amount: cents(spot.amount + spot.maxAdd) }
    const next = accept(current, action, cfg)
    if (next === null) continue
    current = next
    actions.push(action)
  }
  return asBatch(state, actions, cfg)
}

/**
 * Take down all: every bet whose spot says it can come down (`canRemove` null), in table order.
 * Odds whose parent comes down go with it; contract bets stay.
 */
export function takeDownAll(state: TableState, cfg: MachineConfig): readonly Action[] {
  const removable = new Set(
    legalBets(state, cfg).flatMap((spot: LegalBet) =>
      spot.betId !== null && spot.canRemove === null ? [spot.betId] : [],
    ),
  )
  const actions: Action[] = []
  let current = state
  for (const bet of state.bets) {
    if (!removable.has(bet.id)) continue
    if (bet.parentId !== null && removable.has(bet.parentId)) continue
    const action: Action = { type: 'setAmount', betId: bet.id, amount: cents(0) }
    const next = accept(current, action, cfg)
    if (next === null) continue
    current = next
    actions.push(action)
  }
  return asBatch(state, actions, cfg)
}

/**
 * What each bet won on a roll, from the roll's events: the credit its win brought in beyond a
 * returned stake, net of commission taken from the win, and of any re-collected from credit. These
 * are the amounts `pressBet` presses by.
 */
export function winsOf(events: readonly GameEvent[]): ReadonlyMap<BetId, Cents> {
  const wins = new Map<BetId, number>()
  for (const event of events) {
    if (event.type === 'betResolved' && event.trace.outcome === 'win') {
      const { trace } = event
      const returned = trace.stakeDisposition === 'returned' ? trace.stake : 0
      wins.set(trace.betId, (wins.get(trace.betId) ?? 0) + trace.credited - returned)
    } else if (event.type === 'vigCharged' && event.reason === 'rearm' && event.from === 'credit') {
      const won = wins.get(event.betId)
      if (won !== undefined) wins.set(event.betId, won - event.amount)
    }
  }
  return new Map([...wins].map(([id, won]) => [id, cents(Math.max(0, won))]))
}

/** `actions` as one batch, if the table accepts it and it changes the table; otherwise nothing. */
function asBatch(state: TableState, actions: Action[], cfg: MachineConfig): readonly Action[] {
  if (actions.length === 0) return []
  const batch: Action = { type: 'batch', actions }
  const next = accept(state, batch, cfg)
  return next === null || canonicalJson(next) === canonicalJson(state) ? [] : [batch]
}

/** The table after `action`, or null if it refuses it. */
function accept(state: TableState, action: Action, cfg: MachineConfig): TableState | null {
  const result = applyAction(state, action, cfg, { checkInvariants: false })
  return result.ok ? result.state : null
}
