import type { LineBetType, MachineConfig } from '../../config/compile.ts'
import type { PointNumber } from '../../config/rulesets.ts'
import type { Total } from '../../core/dice.ts'
import type { TableState } from '../../table/state.ts'
import {
  NO_DECISION,
  reject,
  roundingPointer,
  type BetFamily,
  type BetInstance,
  type Decision,
  type Located,
  type Mutability,
  type PlaceRequest,
  type Rejection,
  type RollContext,
} from '../types.ts'

/**
 * Pass, come, don't pass and don't come (rules spec §2.2, §3.1, §3.5).
 *
 * A line bet with no number is on its first roll: pass and don't pass on the come-out, come and
 * don't come in their boxes. It is decided by the ruleset's come-out lists, never by the variant's
 * name: a natural wins the do side, craps loses it, and a point total sends the bet to that number.
 * The don't side mirrors this, except that the barred total (`/rules/dontBar`) pushes. Crapless
 * craps has 7 as its only natural and no craps, so its come-out loses nothing. On a number N, the
 * do side wins on N and loses on 7, and the don't side the reverse.
 *
 * A come bet's first roll is its own decision, whatever the pass line does on the same roll: a
 * come bet on N and the come box travelling to N are decided separately and never merge (rules
 * spec §0.2 #12).
 */

/** The one pay entry of a line bet: its flat pay. */
const FLAT = 'flat'

const LOSE: Decision = Object.freeze({ kind: 'lose' })
const BAR_PUSH: Decision = Object.freeze({ kind: 'push', reason: 'bar' })
const FIXED: Mutability = Object.freeze({
  increase: false,
  decrease: false,
  remove: false,
  toggle: false,
})
const FREE: Mutability = Object.freeze({
  increase: true,
  decrease: true,
  remove: true,
  toggle: false,
})

/** Whether the stake of a winning bet stays up for its next decision (`/catalog/<t>/afterWin`). */
function stays(type: LineBetType, firstRoll: boolean, total: Total): boolean {
  switch (type.afterWin) {
    case 'stay':
      return true
    case 'return':
      return false
    case 'stayIfFirstRoll':
      return firstRoll
    case 'stayIf11':
      return firstRoll && total === 11
  }
}

function win(type: LineBetType, firstRoll: boolean, total: Total): Decision {
  return { kind: 'win', payKey: FLAT, stake: stays(type, firstRoll, total) ? 'stay' : 'return' }
}

/** Pass and don't pass wait for the come-out; come and don't come are made with a point on. */
function phaseRejection(
  type: LineBetType,
  state: TableState,
  cfg: MachineConfig,
): Rejection | null {
  const { phase } = state.round
  if (type.window === phase.kind) return null
  if (type.window === 'comeOut' && type.side === 'do' && cfg.input.rules.allowPutBets) return null
  return reject('WRONG_PHASE', { typeId: type.typeId, phase: phase.kind, window: type.window })
}

function locate(req: PlaceRequest<LineBetType>): Located | Rejection {
  const { state, cfg, type } = req
  const at = { typeId: type.typeId }
  if (req.number !== null) return reject('BAD_PARAMS', { ...at, field: 'number' })
  if (req.parentId !== null) return reject('BAD_PARAMS', { ...at, field: 'parentId' })
  const wrongPhase = phaseRejection(type, state, cfg)
  if (wrongPhase !== null) return wrongPhase
  const { phase } = state.round
  // Pass and don't pass are one bet, wherever it is; come and don't come add to the box. A put
  // bet (pass with the point on, where `/rules/allowPutBets`) goes straight on the point.
  const onLine = type.window === 'comeOut'
  const existing =
    state.bets.find((b) => b.typeId === type.typeId && (onLine || b.number === null)) ?? null
  // After a removal under `rebetAfterRemove: nextCycle`, no new money goes on the type until the
  // next come-out: no new bet, and no addition to one in the box (§0.2 #5: "never re-placed").
  if (state.rebetBlocked.includes(type.typeId)) {
    return reject('WINDOW_CLOSED', { ...at, reason: 'rebetAfterRemove', until: 'nextComeOut' })
  }
  const number = onLine && phase.kind === 'point' ? phase.point : null
  return { existing, number: existing?.number ?? number, parentId: null }
}

/**
 * Before its first roll, or back on the line or in the box after a win or a bar push, a line bet
 * can be changed freely. On a number, the do side is a contract bet (§3.1), except that a put bet
 * may be added to. The don't side may only be reduced or taken down where `/catalog/<t>/onNumber`
 * says `reduceRemove` (Interblock and live tables), and is locked where it says `locked` (Shoot To
 * Win's don't pass).
 */
function mutability(
  bet: BetInstance,
  _state: TableState,
  type: LineBetType,
  cfg: MachineConfig,
): Mutability {
  if (bet.number === null) return FREE
  if (type.side === 'do') {
    const putBet = type.window === 'comeOut' && cfg.input.rules.allowPutBets
    return putBet ? { ...FIXED, increase: true } : FIXED
  }
  return type.onNumber === 'reduceRemove' ? { ...FIXED, decrease: true, remove: true } : FIXED
}

function decide(bet: BetInstance, ctx: RollContext, type: LineBetType): Decision {
  const { total, rules } = ctx
  const dont = type.side === 'dont'
  if (bet.number === null) {
    if (rules.naturals.includes(total)) return dont ? LOSE : win(type, true, total)
    if (rules.craps.includes(total)) {
      if (!dont) return LOSE
      return total === rules.dontBar ? BAR_PUSH : win(type, true, total)
    }
    const point = rules.points.find((p) => p === total)
    return point === undefined ? NO_DECISION : { kind: 'travel', number: point }
  }
  if (total === 7) return dont ? win(type, false, total) : LOSE
  if (total === bet.number) return dont ? LOSE : win(type, false, total)
  return NO_DECISION
}

/**
 * A traveller moves to its number. A winner that stays goes back to the line or the box for its
 * next decision; one that is returned comes down, as does a loser. A bar push leaves the bet as it
 * is, still waiting for its first decision.
 */
function apply(bet: BetInstance, decision: Decision): BetInstance | null {
  switch (decision.kind) {
    case 'travel':
      return { ...bet, number: decision.number }
    case 'win':
      return decision.stake === 'stay' ? { ...bet, number: null } : null
    case 'lose':
      return null
    case 'push':
      return decision.reason === 'bar' ? bet : null
    case 'none':
    case 'progress':
      return bet
  }
}

function configPaths(type: LineBetType, _n: PointNumber | null, cfg: MachineConfig): string[] {
  const at = `/catalog/${type.typeId}`
  return [
    '/rules/naturals',
    '/rules/craps',
    '/rules/points',
    ...(type.side === 'dont' ? ['/rules/dontBar'] : []),
    `${at}/side`,
    `${at}/window`,
    `${at}/pays`,
    `${at}/afterWin`,
    roundingPointer(cfg, type.typeId),
  ]
}

/**
 * A don't bet taken down from its number cannot be bet again until the next come-out where
 * `/catalog/<t>/rebetAfterRemove` is `nextCycle` (Interblock §2.3, live tables; rules spec §0.2 #5:
 * "not re-placed until the next cycle"). Reducing it leaves the bet up, so it blocks nothing.
 */
function blocksRebet(bet: BetInstance, to: number, type: LineBetType): boolean {
  return (
    type.side === 'dont' && type.rebetAfterRemove === 'nextCycle' && bet.number !== null && to === 0
  )
}

/** A bet on the line (pass or don't pass) sits on the round's point, or waits for the come-out. */
function invariants(bet: BetInstance, state: TableState, type: LineBetType): string[] {
  if (type.window !== 'comeOut') return []
  const { phase } = state.round
  const point = phase.kind === 'point' ? phase.point : null
  return bet.number === point
    ? []
    : [`${bet.id} (${type.typeId}) is on ${String(bet.number)} but the point is ${String(point)}`]
}

export const lineFamily: BetFamily<LineBetType> = {
  projection: 'round',
  toggleable: false,
  decidesWhenOff: false,
  locate,
  canPlace: () => null,
  mutability,
  defaultWorking: () => true,
  decide,
  apply,
  payout: (type) => type.pays,
  configPaths,
  blocksRebet,
  invariants,
}
