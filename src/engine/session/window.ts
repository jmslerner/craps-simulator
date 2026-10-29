import type { MachineConfig } from '../config/compile.ts'
import type { MachineConfigInput } from '../config/schema.ts'
import type { Dice } from '../core/dice.ts'
import { canonicalJson, hashJson } from '../core/hash.ts'
import { reject, type Rejection } from '../bets/types.ts'
import type { Action, RollAction } from '../table/actions.ts'
import type { GameEvent } from '../table/events.ts'
import { applyAction } from '../table/reducer.ts'
import { newTable, type TableState } from '../table/state.ts'
import { ENGINE_VERSION } from '../version.ts'

/**
 * The betting window (plan §4.9). A session is a log of windows. Between rolls the player bets,
 * presses, takes down, switches bets ON and OFF and adds credit; those actions are the open
 * window's `pending` actions, already applied to `state`, and undo takes them back one at a time,
 * as far as the window's start. A roll closes the window: it commits the pending actions and the
 * roll together as one `WindowRecord`, with the hash of the table the roll left, and opens the next
 * window on that table. Nothing before a roll can be undone after it, so no bet is made, kept or
 * taken back with hindsight.
 *
 * - Only accepted actions are logged, as plain JSON copies, so the log is exactly what the table
 *   applied. A refused action changes nothing (the UI counts refusals for the coach), and so does
 *   an accepted one that leaves the table as it was, which is not logged either: undo always takes
 *   back something the player can see.
 * - Deposits (Add credit, plan §0 #19) are betting actions like the rest: logged with their window,
 *   replayed, and undone while the window is open.
 * - A refused roll (the round's minimum, credit, limits) leaves the window open and unchanged.
 * - Every function here is pure: it returns a new session and never changes the one it is given.
 *
 * The log (`header` plus `committed`) replays to the same table (`replay.ts`) and serializes as
 * versioned JSON (`serialize.ts`).
 */

/**
 * What a log needs to be replayed on its own: the engine version that recorded it, the machine (its
 * config input as played, and the hash it compiles to) and the dice seed.
 */
export interface SessionHeader {
  /** `ENGINE_VERSION` when the session was recorded: a log replays only on its own version. */
  readonly engineVersion: number
  /** The machine's `configHash`, which `config` must compile to. */
  readonly configHash: string
  /** The dice seed: the table's dice stream starts at `seedRng(seed)`. */
  readonly seed: string
  /** The machine's validated config input, so a log replays without the machine list. */
  readonly config: MachineConfigInput
}

/** One committed betting window: the betting actions, then the roll that closed it. */
export interface WindowRecord {
  /** The betting actions the table accepted, in order. Never a roll. */
  readonly actions: readonly Action[]
  /** `{ type: 'roll' }` for dice from the table's stream; with `dice` when they were scripted. */
  readonly roll: RollAction
  /** `hashJson` of the table after the roll. */
  readonly hashAfter: string
}

/**
 * A session in play: the log so far and the open window. It is plain JSON, so the shell can store
 * it as it is (plan §8).
 */
export interface WindowedSession {
  readonly header: SessionHeader
  readonly committed: readonly WindowRecord[]
  /** The table when the open window began: the new table, or the table the last roll left. */
  readonly windowStart: TableState
  /** The open window's actions, in order. */
  readonly pending: readonly Action[]
  /** The table now: `windowStart` with `pending` applied. */
  readonly state: TableState
  /**
   * What Repeat Last Bet repeats (`repeatBets` in `macros.ts`): the bets made in the latest
   * committed window that made any, its `place` and `setAmount` actions in order, with nested
   * batches flattened (`lastWindowOf`). Deposits and the ON/OFF switches are not bets, so they are
   * not repeated.
   */
  readonly lastWindow: readonly Action[]
}

/** A betting action's outcome: the session after it and the action's events, or the refusal. */
export type BettingResult =
  | { readonly ok: true; readonly session: WindowedSession; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly rejection: Rejection }

/** A roll's outcome: the next window's session, the roll's events and the committed record. */
export type RollResult =
  | {
      readonly ok: true
      readonly session: WindowedSession
      readonly events: readonly GameEvent[]
      readonly record: WindowRecord
    }
  | { readonly ok: false; readonly rejection: Rejection }

/** A new session on `cfg`: the starting bankroll, an empty log and the dice seeded from `seed`. */
export function newSession(cfg: MachineConfig, seed: string): WindowedSession {
  const state = newTable(cfg, seed)
  return {
    header: { engineVersion: ENGINE_VERSION, configHash: cfg.configHash, seed, config: cfg.input },
    committed: [],
    windowStart: state,
    pending: [],
    state,
    lastWindow: [],
  }
}

/**
 * Applies one betting action (anything but a roll, which only `rollWindow` makes) to the open
 * window. An accepted action that changes the table joins `pending`; a refused one, or one that
 * changes nothing, leaves the session as it was.
 */
export function dispatchBetting(
  session: WindowedSession,
  action: Action,
  cfg: MachineConfig,
): BettingResult {
  checkConfig(session, cfg)
  if (isRoll(action)) {
    return { ok: false, rejection: reject('BAD_PARAMS', { field: 'type', reason: 'roll' }) }
  }
  // The table applies the copy the log keeps, so replaying the log gives this very result.
  const logged = plainCopy(action)
  if (logged === null) return { ok: false, rejection: reject('BAD_PARAMS', { field: 'action' }) }
  const result = applyAction(session.state, logged, cfg)
  if (!result.ok) return result
  if (sameTable(result.state, session.state)) return { ok: true, session, events: result.events }
  return {
    ok: true,
    session: { ...session, pending: [...session.pending, logged], state: result.state },
    events: result.events,
  }
}

/**
 * Takes back the open window's last action, restoring the table exactly as it was before it; null
 * when the window has nothing to undo. A roll is never undone: the window it closed is committed.
 */
export function undo(session: WindowedSession, cfg: MachineConfig): WindowedSession | null {
  checkConfig(session, cfg)
  if (session.pending.length === 0) return null
  const pending = session.pending.slice(0, -1)
  return { ...session, pending, state: applyAll(session.windowStart, pending, cfg) }
}

/** Clear: takes back every action of the open window, back to the table it started on. */
export function clearWindow(session: WindowedSession, cfg: MachineConfig): WindowedSession {
  checkConfig(session, cfg)
  if (session.pending.length === 0) return session
  return { ...session, pending: [], state: session.windowStart }
}

/**
 * Rolls the dice on the open window's table: `dice` for scripted dice (tests and e2e builds only),
 * otherwise from the table's dice stream. An accepted roll commits the window's actions and the
 * roll as one record and opens the next window on the table it left; a refused roll (the round's
 * minimum, credit, limits) changes nothing, so the player can fix the bets and roll again.
 */
export function rollWindow(session: WindowedSession, cfg: MachineConfig, dice?: Dice): RollResult {
  checkConfig(session, cfg)
  const roll: RollAction = dice === undefined ? { type: 'roll' } : { type: 'roll', dice }
  const result = applyAction(session.state, roll, cfg)
  if (!result.ok) return result
  const record: WindowRecord = {
    actions: session.pending,
    roll: dice === undefined ? roll : { type: 'roll', dice: { d1: dice.d1, d2: dice.d2 } },
    hashAfter: hashJson(result.state),
  }
  const repeat = repeatable(session.pending)
  return {
    ok: true,
    session: {
      header: session.header,
      committed: [...session.committed, record],
      windowStart: result.state,
      pending: [],
      state: result.state,
      lastWindow: repeat.length > 0 ? repeat : session.lastWindow,
    },
    events: result.events,
    record,
  }
}

/**
 * The session's `lastWindow` for a log: the bets of the latest window that made any (`repeatable`),
 * or none.
 */
export function lastWindowOf(committed: readonly WindowRecord[]): Action[] {
  for (let index = committed.length - 1; index >= 0; index--) {
    const record = committed[index]
    const actions = record === undefined ? [] : repeatable(record.actions)
    if (actions.length > 0) return actions
  }
  return []
}

/**
 * The bets among a window's accepted actions, which Repeat can make again: its `place` and
 * `setAmount` actions in order, with nested batches flattened (Repeat's one batch applies them the
 * same way). Deposits add credit and the switches set bets ON or OFF; neither is a bet.
 */
function repeatable(actions: readonly Action[]): Action[] {
  const kept: Action[] = []
  // Its own stack rather than recursion, as the reducer flattens batches: no depth overflows it.
  const stack: { readonly list: readonly Action[]; next: number }[] = [{ list: actions, next: 0 }]
  for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
    const action = top.list[top.next]
    top.next += 1
    if (action === undefined) stack.pop()
    else if (action.type === 'batch') stack.push({ list: action.actions, next: 0 })
    else if (action.type === 'place' || action.type === 'setAmount') kept.push(action)
  }
  return kept
}

/** The table after `actions`, each of which it accepted before. */
function applyAll(start: TableState, actions: readonly Action[], cfg: MachineConfig): TableState {
  return actions.reduce((state, action, index) => {
    const result = applyAction(state, action, cfg)
    if (!result.ok) {
      // The reducer is pure and deterministic, so this means the engine has broken that promise.
      throw new Error(`Pending action ${index} no longer applies: ${result.rejection.code}`)
    }
    return result.state
  }, start)
}

/** The session plays `cfg`'s machine: a session never has two configs (plan §4.9). */
function checkConfig(session: WindowedSession, cfg: MachineConfig): void {
  if (session.header.configHash !== cfg.configHash) {
    throw new RangeError(
      `This session plays config ${session.header.configHash}, not ${cfg.configHash}`,
    )
  }
}

function isRoll(action: Action): boolean {
  return typeof action === 'object' && action !== null && action.type === 'roll'
}

/**
 * A plain JSON copy of `action` for the log: no shared objects, and no `undefined` members, so the
 * log equals its own JSON round trip. Null when JSON cannot hold it.
 */
function plainCopy(action: Action): Action | null {
  try {
    const text = JSON.stringify(action) as string | undefined
    return text === undefined ? null : (JSON.parse(text) as Action)
  } catch {
    return null
  }
}

function sameTable(a: TableState, b: TableState): boolean {
  return a === b || canonicalJson(a) === canonicalJson(b)
}
