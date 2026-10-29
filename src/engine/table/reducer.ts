import type { MachineConfig } from '../config/compile.ts'
import { cents } from '../core/money.ts'
import { isRejection, reject, type Rejection } from '../bets/types.ts'
import {
  validateDeposit,
  validatePlace,
  validateSetAmount,
  validateSetGlobalWorking,
  validateSetWorking,
  type BetChange,
} from '../bets/validate.ts'
import type { Action, BatchAction } from './actions.ts'
import type { GameEvent } from './events.ts'
import { assertInvariants } from './invariants.ts'
import { chargeVig, deposit, refundVig, stake } from './ledger.ts'
import { rollTable } from './roll.ts'
import { heldOffOf, type TableState } from './state.ts'

/**
 * The table reducer (plan §4.9): every change to a table goes through `applyAction`. It is pure: it
 * returns a new state and the events that describe the change, or a rejection, and never changes
 * the state it was given. A rejected action changes nothing, and a batch applies all of its actions
 * or none. Malformed or extreme actions are refused, never thrown (plan §4.6).
 */
export type ActionResult =
  | { readonly ok: true; readonly state: TableState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly rejection: Rejection }

export interface ApplyOptions {
  /**
   * Check the table invariants after a successful action, including what the action may not
   * change (default true). The UI shell can turn this off in production builds; tests and the
   * exact solver's dispatch oracle keep it on.
   */
  readonly checkInvariants?: boolean
}

export function applyAction(
  state: TableState,
  action: Action,
  cfg: MachineConfig,
  options: ApplyOptions = {},
): ActionResult {
  if (state.configHash !== cfg.configHash) {
    throw new RangeError(`This table runs config ${state.configHash}, not ${cfg.configHash}`)
  }
  const result = dispatch(state, action, cfg)
  if (result.ok && (options.checkInvariants ?? true)) assertInvariants(result.state, cfg, state)
  return result
}

/** Null if `action` would succeed on `state`, else why not: a dry run of `applyAction`. */
export function validateAction(
  state: TableState,
  action: Action,
  cfg: MachineConfig,
): Rejection | null {
  const result = applyAction(state, action, cfg, { checkInvariants: false })
  return result.ok ? null : result.rejection
}

function dispatch(state: TableState, action: Action, cfg: MachineConfig): ActionResult {
  // Actions arrive from the UI, the session log and imported files, so the shape is checked too.
  if (typeof action !== 'object' || action === null) return refuse(reject('BAD_PARAMS'))
  switch (action.type) {
    case 'place':
      return changeBet(state, validatePlace(state, action, cfg))
    case 'setAmount':
      return changeBet(state, validateSetAmount(state, action, cfg))
    case 'setWorking': {
      const rejection = validateSetWorking(state, action, cfg)
      if (rejection !== null) return refuse(rejection)
      return done(
        {
          ...state,
          bets: state.bets.map((b) =>
            b.id === action.betId ? { ...b, working: action.working } : b,
          ),
        },
        [{ type: 'workingChanged', scope: 'bet', betId: action.betId, working: action.working }],
      )
    }
    case 'setGlobalWorking': {
      const rejection = validateSetGlobalWorking(action, cfg)
      if (rejection !== null) return refuse(rejection)
      // The button sets every bet it covers ("All On", "All Off", Set bets On/Off), so it clears
      // their own settings (a lay the machine switched back ON included). A press that turns bets
      // ON (`off` false, or null for the defaults: Interblock's Set bets On, plan §0 #21) also
      // ends Interblock's after-seven-out OFF (`heldOff`); Set bets Off leaves it, as those bets
      // are OFF either way.
      const covered = cfg.working.toggle.types
      const bets = state.bets.map((b) =>
        b.working !== null && covered.includes(b.typeId) ? { ...b, working: null } : b,
      )
      const heldOff = action.off === true ? heldOffOf(state) : []
      return done({ ...state, globalOff: action.off, bets, heldOff }, [
        { type: 'workingChanged', scope: 'global', off: action.off },
      ])
    }
    case 'deposit': {
      const rejection = validateDeposit(state, action)
      if (rejection !== null) return refuse(rejection)
      return done({ ...state, ledger: deposit(state.ledger, action.amount) }, [
        { type: 'deposited', amount: action.amount },
      ])
    }
    case 'batch':
      return batch(state, action, cfg)
    case 'roll': {
      const rolled = rollTable(state, action, cfg)
      return isRejection(rolled) ? refuse(rolled) : done(rolled.state, rolled.events)
    }
    default:
      return refuse(reject('BAD_PARAMS', { field: 'type' }))
  }
}

/**
 * Applies a validated bet change: the bet, its odds, the ledger, commission, re-bet blocks and the
 * machine's hold on a new bet.
 */
function changeBet(state: TableState, change: BetChange | Rejection): ActionResult {
  if (isRejection(change)) return refuse(change)
  const { before, after, children, vig } = change
  const delta = after.amount - (before?.amount ?? 0)
  if (delta === 0 && vig.charge === 0 && vig.refund === 0) return done(state, [])
  let ledger = stake(state.ledger, delta)
  const bet = { ...after, vigHeld: cents(after.vigHeld + vig.charge - vig.refund) }
  const events: GameEvent[] = []
  let bets: TableState['bets']
  let nextBetSeq = state.nextBetSeq
  let heldOff = heldOffOf(state)
  if (before === null) {
    bets = [...state.bets, bet]
    nextBetSeq += 1
    events.push({ type: 'betPlaced', bet })
    if (change.heldOff) heldOff = [...heldOff, bet.id]
  } else if (after.amount === 0) {
    const down = new Set([before.id, ...children.map((child) => child.id)])
    bets = state.bets.filter((b) => !down.has(b.id))
    heldOff = heldOff.filter((id) => !down.has(id))
    events.push({
      type: 'betRemoved',
      betId: before.id,
      typeId: before.typeId,
      amount: before.amount,
      reason: 'takenDown',
    })
    for (const child of children) {
      ledger = stake(ledger, -child.amount)
      events.push({
        type: 'betRemoved',
        betId: child.id,
        typeId: child.typeId,
        amount: child.amount,
        reason: 'withParent',
      })
    }
  } else {
    bets = state.bets.map((b) => (b.id === before.id ? bet : b))
    events.push({ type: 'betAdjusted', betId: before.id, from: before.amount, to: after.amount })
  }
  if (vig.charge > 0) {
    ledger = chargeVig(ledger, vig.charge)
    const reason = before === null ? 'placement' : 'increase'
    events.push({ type: 'vigCharged', betId: after.id, amount: vig.charge, reason })
  }
  if (vig.refund > 0) {
    ledger = refundVig(ledger, vig.refund)
    events.push({ type: 'vigRefunded', betId: after.id, amount: vig.refund })
  }
  const blocked = change.blocksRebet && !state.rebetBlocked.includes(after.typeId)
  return done(
    {
      ...state,
      bets,
      nextBetSeq,
      ledger,
      rebetBlocked: blocked ? [...state.rebetBlocked, after.typeId] : state.rebetBlocked,
      heldOff,
    },
    events,
  )
}

/**
 * All of the actions, in order, each on the state the last one left; or the first rejection, with
 * `batchIndex` naming the batch's own action it came from. Nested batches are flattened first, so
 * they apply as their actions do, however deep.
 */
function batch(state: TableState, action: BatchAction, cfg: MachineConfig): ActionResult {
  const flat = flatten(action)
  if (isRejection(flat)) return refuse(flat)
  let current = state
  const events: GameEvent[] = []
  for (const { index, action: inner } of flat) {
    const result = dispatch(current, inner, cfg)
    if (!result.ok) {
      const { code, details } = result.rejection
      return refuse({ code, details: { ...details, batchIndex: index } })
    }
    current = result.state
    events.push(...result.events)
  }
  return done(current, events)
}

/** One action of a flattened batch, with the index of the batch's own action it came from. */
interface BatchPart {
  readonly index: number
  readonly action: Action
}

/**
 * A batch's actions with nested batches flattened in order, or why the batch is malformed
 * (`BAD_PARAMS`, `field: 'actions'`, before any of it is applied): `actions` is not an array, a
 * batch contains itself, or a roll appears at any depth. A batch places, presses, takes down and
 * switches bets (repeat, one-tap switches; plan §4.9); a roll inside one could be undone by a later
 * refusal. It walks the batch with its own stack rather than recursion, so no depth of nesting
 * overflows the call stack.
 */
function flatten(action: BatchAction): BatchPart[] | Rejection {
  if (!Array.isArray(action.actions)) return reject('BAD_PARAMS', { field: 'actions' })
  const parts: BatchPart[] = []
  const open = new Set<object>([action])
  const stack: { batch: BatchAction; next: number; index: number | null }[] = [
    { batch: action, next: 0, index: null },
  ]
  for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
    const actions: readonly unknown[] = frame.batch.actions
    if (frame.next >= actions.length) {
      stack.pop()
      open.delete(frame.batch)
      continue
    }
    const position = frame.next
    frame.next += 1
    const index = frame.index ?? position
    const inner = actions[position]
    if (!isActionOf(inner, 'batch')) {
      if (isActionOf(inner, 'roll')) {
        return reject('BAD_PARAMS', { field: 'actions', reason: 'roll', batchIndex: index })
      }
      parts.push({ index, action: inner as Action })
    } else if (!Array.isArray(inner.actions)) {
      return reject('BAD_PARAMS', { field: 'actions', batchIndex: index })
    } else if (open.has(inner)) {
      return reject('BAD_PARAMS', { field: 'actions', reason: 'cycle', batchIndex: index })
    } else {
      open.add(inner)
      stack.push({ batch: inner, next: 0, index })
    }
  }
  return parts
}

/** Whether `value` is an action object of the given `type`. */
function isActionOf<T extends Action['type']>(
  value: unknown,
  type: T,
): value is Extract<Action, { type: T }> {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === type
}

function done(state: TableState, events: readonly GameEvent[]): ActionResult {
  return { ok: true, state, events }
}

function refuse(rejection: Rejection): ActionResult {
  return { ok: false, rejection }
}
