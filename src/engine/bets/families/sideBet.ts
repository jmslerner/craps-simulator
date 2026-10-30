import type { CompiledSideBet, MachineConfig } from '../../config/compile.ts'
import type { TableState } from '../../table/state.ts'
import {
  reject,
  roundingPointer,
  type BetInstance,
  type Decision,
  type Located,
  type Mutability,
  type PlaceRequest,
  type Rejection,
} from '../types.ts'

/**
 * What the four side-bet families share (rules spec §2.6; plan §4.5, §0 #11): Lucky Roller
 * (`collectSet`), the Fire Bet (`uniquePointsMade`), the Hot Shooter Jackpot (`handLength`) and
 * the Lucky Shooter (`pointRun`).
 *
 * - **One spot per type.** A side bet names no number and no parent, and a `place` of its type
 *   lands on the bet already up, if any, or on an empty spot. The family's `window` says when a new
 *   bet may go up, read from the round's counters (`hand`, `sinceSeven`, the phase) that
 *   `round/round.ts` keeps for exactly this (plan §4.3).
 * - **Free until the dice roll, then locked.** A side bet placed in this betting window can still be
 *   pressed, reduced or taken down (`OPEN`); once a roll has gone by it is a special game that
 *   cannot be withdrawn or changed (`LOCKED`; CW §33, STWO, NJ, MD; §2.6 "Lock"). The Lucky
 *   Shooter adds its own rule before its point (`pointRun.ts`). A `place` on a bet that may not
 *   grow is refused as `CONTRACT_BET` here, since `validate.ts` lands additions only on bets that
 *   may grow (M4d note).
 * - **Always working.** No side bet is toggleable, so `bets/working.ts` reports `always`.
 * - **Progress on the bet.** `BetInstance.progress` holds the family's own encoding (a mask of
 *   totals, a roll count, or the Lucky Shooter's point and hits), and a `progress` decision replaces
 *   it. The stake comes back with every win (`stake: 'return'`), so each side bet is one decision.
 */

export const LOCKED: Mutability = Object.freeze({
  increase: false,
  decrease: false,
  remove: false,
  toggle: false,
})

export const OPEN: Mutability = Object.freeze({
  increase: true,
  decrease: true,
  remove: true,
  toggle: false,
})

/** Whether the dice have rolled since `bet` was placed. */
export function hasRolled(bet: BetInstance, state: TableState): boolean {
  return bet.placedAtRoll < state.round.rollIndex
}

/** Free before its first roll, locked after it: the plain side-bet lock. */
export function lockedAfterFirstRoll(bet: BetInstance, state: TableState): Mutability {
  return hasRolled(bet, state) ? LOCKED : OPEN
}

/** The number of bits set in a progress mask: totals rolled, points made, hits. */
export function bitCount(mask: number): number {
  let count = 0
  for (let rest = mask; rest !== 0; rest &= rest - 1) count += 1
  return count
}

/** Whether a new bet of `type` may go up on `state` now; null when it may. */
export type WindowCheck<T extends CompiledSideBet> = (
  state: TableState,
  type: T,
) => Rejection | null

/** A closed placement window: `reason` names the window, `until` when it opens again. */
export function windowClosed(typeId: string, reason: string, until: string): Rejection {
  return reject('WINDOW_CLOSED', { typeId, reason, until })
}

/** The window before a new hand's first roll (`placement: newHand`; Fire, NJ and MD rules). */
export function newHandWindow(state: TableState, type: CompiledSideBet): Rejection | null {
  return state.round.hand.rolls === 0 ? null : windowClosed(type.typeId, 'newHand', 'nextHand')
}

/**
 * Where a side bet's `place` lands (validation step 2): on the bet of its type already up, if it may
 * still grow, else `CONTRACT_BET`; on an empty spot when the family's window is open.
 */
export function locateSide<T extends CompiledSideBet>(
  req: PlaceRequest<T>,
  windowCheck: WindowCheck<T>,
  mutability: (bet: BetInstance, state: TableState, type: T, cfg: MachineConfig) => Mutability,
): Located | Rejection {
  const { state, cfg, type } = req
  const at = { typeId: type.typeId }
  if (req.number !== null) return reject('BAD_PARAMS', { ...at, field: 'number' })
  if (req.parentId !== null) return reject('BAD_PARAMS', { ...at, field: 'parentId' })
  const existing = state.bets.find((bet) => bet.typeId === type.typeId) ?? null
  if (existing !== null) {
    if (!mutability(existing, state, type, cfg).increase) {
      return reject('CONTRACT_BET', { ...at, betId: existing.id, change: 'increase' })
    }
    return { existing, number: null, parentId: null }
  }
  return windowCheck(state, type) ?? { existing: null, number: null, parentId: null }
}

/**
 * A side bet after its decision: a progressing bet carries its new progress; a winner, a loser and
 * a returned push come down; a push that leaves the stake up (`bar`) stays as it is.
 */
export function applySide(bet: BetInstance, decision: Decision): BetInstance | null {
  switch (decision.kind) {
    case 'progress':
      return { ...bet, progress: decision.progress }
    case 'win':
    case 'lose':
      return null
    case 'push':
      return decision.reason === 'bar' ? bet : null
    case 'none':
    case 'travel':
      return bet
  }
}

/** `/sideBets/<id>/<key>` for each key, then the rounding a side bet's win is paid with. */
export function sideConfigPaths(
  type: CompiledSideBet,
  keys: readonly string[],
  cfg: MachineConfig,
): string[] {
  const at = `/sideBets/${type.typeId}`
  return [...keys.map((key) => `${at}/${key}`), roundingPointer(cfg, type.typeId)]
}

/** A side bet sits on no number and backs nothing. */
export function sideInvariants(bet: BetInstance, type: CompiledSideBet): string[] {
  const problems: string[] = []
  const at = `${bet.id} (${type.typeId})`
  if (bet.number !== null)
    problems.push(`${at} is on ${bet.number}, but a side bet takes no number`)
  if (bet.parentId !== null) problems.push(`${at} backs ${bet.parentId}`)
  return problems
}
