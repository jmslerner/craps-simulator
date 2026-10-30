import type { CollectSetBetType, MachineConfig } from '../../config/compile.ts'
import type { Ratio } from '../../config/ratio.ts'
import type { PointNumber } from '../../config/rulesets.ts'
import type { Total } from '../../core/dice.ts'
import { totalBit, totalsInMask } from '../../round/round.ts'
import type { TableState } from '../../table/state.ts'
import {
  NO_DECISION,
  type BetFamily,
  type BetInstance,
  type Decision,
  type Located,
  type PlaceRequest,
  type Rejection,
  type RollContext,
} from '../types.ts'
import {
  applySide,
  locateSide,
  lockedAfterFirstRoll,
  newHandWindow,
  sideConfigPaths,
  sideInvariants,
  windowClosed,
} from './sideBet.ts'

/**
 * Lucky Roller: Low Rolls / All Small, High Rolls / All Tall and Roll 'Em All / Make 'Em All
 * (rules spec §2.6, §6.4; plan §0 #11). The bet wins at once when every target total
 * (`/sideBets/<t>/targets`) has rolled since it was placed, paying `/sideBets/<t>/pays`, and loses
 * on a 7: any 7, a come-out 7 included (`endsOn: anySeven`, every machine researched), or only a
 * seven-out (`endsOn: sevenOut`). Repeats and order do not matter, so progress is the mask of
 * targets rolled (`totalBit`), and tracking starts fresh at placement.
 *
 * Placement (`/sideBets/<t>/placement`, §2.6): Interblock takes it only right after a 7 of any kind
 * or before the first roll of the cycle, and not again after a win until a 7 (`afterSevenOrStart`:
 * `sinceSeven.rolls === 0`, which a winning roll never leaves); Shoot To Win before any roll while
 * no bet of the type is active (`noneOfTypeActive`: the active bet is on the spot and locked); NJ and
 * MD before a new hand (`newHand`).
 */

const LOSE: Decision = Object.freeze({ kind: 'lose' })

/** The one pay key: the set is complete. */
const SET = 'set'

/** The mask of a type's targets. */
export function collectSetMask(type: CollectSetBetType): number {
  return type.targets.reduce((mask, total) => mask | totalBit(total), 0)
}

/** The targets a bet with `progress` has rolled, ascending. */
export function collectSetRolled(progress: number): Total[] {
  return totalsInMask(progress)
}

/** The targets a bet with `progress` still needs, ascending. */
export function collectSetRemaining(type: CollectSetBetType, progress: number): Total[] {
  return type.targets.filter((total) => (progress & totalBit(total)) === 0)
}

function placementWindow(state: TableState, type: CollectSetBetType): Rejection | null {
  switch (type.placement) {
    case 'afterSevenOrStart':
      return state.round.sinceSeven.rolls === 0
        ? null
        : windowClosed(type.typeId, 'afterSevenOrStart', 'nextSeven')
    case 'noneOfTypeActive':
      return null
    case 'newHand':
      return newHandWindow(state, type)
  }
}

function locate(req: PlaceRequest<CollectSetBetType>): Located | Rejection {
  return locateSide(req, placementWindow, lockedAfterFirstRoll)
}

function decide(bet: BetInstance, ctx: RollContext, type: CollectSetBetType): Decision {
  const { total, transition } = ctx
  if (total === 7) {
    return type.endsOn === 'anySeven' || transition.kind === 'sevenOut' ? LOSE : NO_DECISION
  }
  const bit = totalBit(total)
  const full = collectSetMask(type)
  if ((full & bit) === 0 || (bet.progress & bit) !== 0) return NO_DECISION
  const progress = bet.progress | bit
  return progress === full
    ? { kind: 'win', payKey: SET, stake: 'return' }
    : { kind: 'progress', progress }
}

function payout(type: CollectSetBetType, payKey: string): Ratio {
  if (payKey !== SET) throw new RangeError(`${type.typeId} pays nothing at "${payKey}"`)
  return type.pays
}

function configPaths(type: CollectSetBetType, _n: PointNumber | null, cfg: MachineConfig) {
  return sideConfigPaths(type, ['targets', 'pays', 'endsOn', 'placement'], cfg)
}

/** Progress names only targets, and never the whole set, which is paid at once. */
function invariants(bet: BetInstance, _state: TableState, type: CollectSetBetType): string[] {
  const problems = sideInvariants(bet, type)
  const full = collectSetMask(type)
  const at = `${bet.id} (${type.typeId})`
  if ((bet.progress & ~full) !== 0)
    problems.push(`${at} has rolled totals that are not its targets`)
  if (bet.progress === full) problems.push(`${at} has its whole set and should have been paid`)
  return problems
}

export const collectSetFamily: BetFamily<CollectSetBetType> = {
  projection: 'round',
  toggleable: false,
  decidesWhenOff: false,
  locate,
  canPlace: () => null,
  mutability: lockedAfterFirstRoll,
  defaultWorking: () => true,
  decide,
  apply: applySide,
  payout,
  configPaths,
  invariants,
}
