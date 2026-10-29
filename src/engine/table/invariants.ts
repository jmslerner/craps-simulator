import type { MachineConfig } from '../config/compile.ts'
import { TOTALS } from '../core/dice.ts'
import { checkAmount, typeLimits } from '../bets/limits.ts'
import { resolveType } from '../bets/registry.ts'
import { betSeq, type BetInstance } from '../bets/types.ts'
import { imbalance, onTable } from './ledger.ts'
import { heldOffOf, type TableState } from './state.ts'

/**
 * Invariants of a table state (plan §4.8 step 8). `applyAction` checks them after every action
 * that succeeds, unless the caller opts out. Each violation is a readable message:
 *
 * - **Money:** every amount is whole cents, the bankroll is never negative, and
 *   `deposits = bankroll + Σ bet.amount + houseNet` (plan §4.7).
 * - **Bets:** ids are `b<n>`, unique, below `nextBetSeq` and in placement order; each bet's type is
 *   offered and implemented; amounts are positive and within the type's limits (`/limits`, with
 *   the unit on its number where the type sets one), and the table within `/limits/tableMax`;
 *   numbers are points of the game; only odds back a parent, and the parent exists; a bet holds
 *   up-front commission only if its family charges commission.
 * - **No merging:** at most one bet per type, number and parent. A come bet travelling to a number
 *   that already has one would break this, and rules spec §0.2 #12 says the existing bet is always
 *   decided on that same roll, so it never happens; merging them would hide a bug, so it is a
 *   violation instead (plan §0 #9).
 * - **Families:** each family's own `invariants` (a pass bet sits on the point; odds sit on their
 *   parent's number, within the cap; number bets hold commission only where it is charged up front).
 * - **Round and history:** the point is a point of the game, and the history is at most
 *   `/flow/historyLength` long.
 * - **Holds:** each bet the machine holds OFF (`heldOff`) is on the table, listed once, and of a
 *   type `/afterSevenOut/newPlacedOff` holds.
 * - **JSON-safe** (plan §4.1): only plain objects, arrays, strings, finite numbers, booleans and
 *   null, so the state hashes, stores and crosses to a worker unchanged.
 *
 * Given the state `before` the action too, it checks the change: the config is the same, ids are
 * never reused (`nextBetSeq` never goes back, and a bet below the old `nextBetSeq` was already on
 * the table, with the same type, parent and placement roll), the round never goes back, and
 * deposits and the amount wagered never fall.
 */
export function invariantViolations(
  state: TableState,
  cfg: MachineConfig,
  before?: TableState,
): string[] {
  const problems: string[] = []
  const add = (message: string) => problems.push(message)
  if (state.configHash !== cfg.configHash) {
    add(`the table is for config ${state.configHash}, not ${cfg.configHash}`)
  }

  const { ledger } = state
  for (const [name, amount] of Object.entries(ledger)) {
    if (!Number.isSafeInteger(amount)) add(`ledger.${name} is not whole cents: ${amount}`)
  }
  if (ledger.bankroll < 0) add(`the bankroll is negative: ${ledger.bankroll}`)
  const off = imbalance(ledger, state.bets)
  if (off !== 0) add(`deposits ≠ bankroll + bets + houseNet: off by ${off}¢`)

  const { rollIndex, phase } = state.round
  const points: readonly number[] = cfg.ruleset.points
  if (phase.kind === 'point' && !points.includes(phase.point)) {
    add(`the point ${phase.point} is not a point in ${cfg.ruleset.variant} craps`)
  }
  if ((rollIndex === 0) !== (state.lastRoll === null)) {
    add(`roll ${rollIndex} does not match lastRoll ${JSON.stringify(state.lastRoll)}`)
  }
  if (state.recentTotals.length > cfg.flow.historyLength) {
    add(`the history holds ${state.recentTotals.length} rolls, more than the machine shows`)
  }
  if (state.recentTotals.some((total) => !TOTALS.includes(total)))
    add('the history has a bad total')
  if (state.globalOff !== null && typeof state.globalOff !== 'boolean') add('globalOff is not set')
  state.rebetBlocked.forEach((typeId, index) => {
    if (resolveType(cfg, typeId) === null) add(`rebetBlocked names "${typeId}", not a bet type`)
    if (state.rebetBlocked.indexOf(typeId) !== index) add(`rebetBlocked lists ${typeId} twice`)
  })
  const holds = cfg.working.afterSevenOut?.types ?? []
  const held = heldOffOf(state)
  held.forEach((id, index) => {
    const bet = state.bets.find((b) => b.id === id)
    if (bet === undefined) add(`heldOff names ${id}, which is not on the table`)
    else if (!holds.includes(bet.typeId)) add(`${id} (${bet.typeId}) is held OFF by no rule`)
    if (held.indexOf(id) !== index) add(`heldOff lists ${id} twice`)
  })

  jsonProblems(state, 'state', add)
  const { tableMax } = cfg.limits
  if (tableMax !== null && onTable(state.bets) > tableMax) {
    add(`the table holds ${onTable(state.bets)}¢, above the ${tableMax}¢ table maximum`)
  }

  const ids = new Set<string>()
  const spots = new Set<string>()
  let previous = 0
  for (const bet of state.bets) {
    const seq = betSeq(bet.id)
    if (ids.has(bet.id)) add(`two bets have the id ${bet.id}`)
    if (!(seq > previous && seq < state.nextBetSeq)) {
      add(`${bet.id} is out of order or not below nextBetSeq ${state.nextBetSeq}`)
    }
    previous = Number.isNaN(seq) ? previous : seq
    ids.add(bet.id)
    const spot = `${bet.typeId} on ${String(bet.number)} behind ${String(bet.parentId)}`
    if (spots.has(spot)) add(`two bets share one spot (${spot}): bets never merge`)
    spots.add(spot)
    if (!Number.isSafeInteger(bet.amount) || bet.amount <= 0) {
      add(`${bet.id} has a bad amount: ${bet.amount}`)
    }
    if (!Number.isSafeInteger(bet.vigHeld) || bet.vigHeld < 0) {
      add(`${bet.id} holds bad commission: ${bet.vigHeld}`)
    }
    if (bet.number !== null && !points.includes(bet.number)) {
      add(`${bet.id} is on ${bet.number}, not a point in ${cfg.ruleset.variant} craps`)
    }
    if (!(Number.isSafeInteger(bet.placedAtRoll) && bet.placedAtRoll <= rollIndex)) {
      add(`${bet.id} was placed at roll ${bet.placedAtRoll}, after roll ${rollIndex}`)
    }
    const resolved = resolveType(cfg, bet.typeId)
    if (resolved === null) {
      add(`${bet.id} has type "${bet.typeId}", which this config does not offer`)
      continue
    }
    const { family, type } = resolved
    const limits = checkAmount(bet.amount, typeLimits(cfg, bet.typeId, bet.number), bet.typeId)
    if (limits !== null) add(`${bet.id} (${bet.typeId}) breaks its limits: ${limits.code}`)
    if (bet.parentId !== null && type.family !== 'odds') {
      add(`${bet.id} (${bet.typeId}) backs ${bet.parentId}, but only odds back a bet`)
    }
    if (bet.vigHeld !== 0 && family.vigOnChange === undefined) {
      add(`${bet.id} (${bet.typeId}) holds ${bet.vigHeld}¢ of commission its family never charges`)
    }
    for (const message of family.invariants?.(bet, state, type, cfg) ?? []) add(message)
  }
  for (const bet of state.bets) {
    if (bet.parentId !== null && !ids.has(bet.parentId)) {
      add(`${bet.id} backs ${bet.parentId}, which is not on the table`)
    }
  }
  if (before !== undefined) changeProblems(before, state, add)
  return problems
}

/** What an action may not change: see `invariantViolations`. */
function changeProblems(before: TableState, after: TableState, add: (message: string) => void) {
  if (after.configHash !== before.configHash) add("the action changed the table's config")
  if (after.nextBetSeq < before.nextBetSeq) {
    add(`nextBetSeq went back from ${before.nextBetSeq} to ${after.nextBetSeq}`)
  }
  const old = new Map<string, BetInstance>(before.bets.map((bet) => [bet.id, bet]))
  for (const bet of after.bets) {
    const was = old.get(bet.id)
    if (was === undefined) {
      if (betSeq(bet.id) < before.nextBetSeq) add(`${bet.id} reuses an id given out before`)
      continue
    }
    if (was.typeId !== bet.typeId || was.parentId !== bet.parentId) {
      add(`${bet.id} changed from ${was.typeId} behind ${String(was.parentId)} to ${bet.typeId}`)
    }
    if (was.placedAtRoll !== bet.placedAtRoll) add(`${bet.id} changed its placement roll`)
  }
  if (after.round.rollIndex < before.round.rollIndex) add('the round went back')
  if (after.ledger.deposits < before.ledger.deposits) add('the deposits went down')
  if (after.ledger.wagered < before.ledger.wagered) add('the amount wagered went down')
}

/**
 * Anything in `value` that JSON cannot carry unchanged (plan §4.1): a bigint, `undefined`, a
 * function or symbol, a number that is not finite, an object that is not plain (a Map, a Set, a
 * class instance), or a cycle.
 */
function jsonProblems(
  value: unknown,
  path: string,
  add: (message: string) => void,
  ancestors: readonly object[] = [],
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) add(`${path} is ${value}, which JSON cannot hold`)
    return
  }
  if (typeof value !== 'object') {
    add(`${path} is a ${typeof value}, which JSON cannot hold`)
    return
  }
  if (ancestors.includes(value)) {
    add(`${path} contains itself`)
    return
  }
  const inside = [...ancestors, value]
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index) => jsonProblems(item, `${path}[${index}]`, add, inside))
    return
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    add(`${path} is not a plain object`)
    return
  }
  for (const [key, item] of Object.entries(value)) jsonProblems(item, `${path}.${key}`, add, inside)
}

/** Thrown by `assertInvariants`; `violations` lists every problem found. */
export class InvariantError extends Error {
  readonly violations: readonly string[]

  constructor(violations: readonly string[]) {
    super(`Table invariants violated: ${violations.join('; ')}`)
    this.name = 'InvariantError'
    this.violations = violations
  }
}

/**
 * Throws an `InvariantError` if `state` breaks any invariant, or, given the state `before` the
 * action, if the action broke what it may not change.
 */
export function assertInvariants(state: TableState, cfg: MachineConfig, before?: TableState): void {
  const violations = invariantViolations(state, cfg, before)
  if (violations.length > 0) throw new InvariantError(violations)
}
