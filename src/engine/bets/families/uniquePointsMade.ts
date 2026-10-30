import type { MachineConfig, UniquePointsBetType } from '../../config/compile.ts'
import type { Ratio } from '../../config/ratio.ts'
import { isPointNumber, type PointNumber } from '../../config/rulesets.ts'
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
  bitCount,
  locateSide,
  lockedAfterFirstRoll,
  newHandWindow,
  sideConfigPaths,
  sideInvariants,
} from './sideBet.ts'

/**
 * The Fire Bet (rules spec §2.6, §6.6; plan §4.5, §0 #11): the distinct points the hand both sets
 * and makes, among `/sideBets/<t>/countedPoints` (the live table's 4–10; a crapless machine may
 * count all ten or only 4–10, §0.2 #13). A counted `pointMade` sets its bit in `progress`; a point
 * made again adds nothing; naturals and craps do nothing. At the seven-out the bet is paid once
 * for its count from `/sideBets/<t>/payTable`, or lost when the table has no pay for it. Where a
 * house pays the top count at once (`/sideBets/<t>/payImmediatelyAt`), reaching it wins there.
 *
 * It is placed only before a new hand's first roll (`placement: newHand`, MD; `hand.rolls === 0`)
 * and is a contract bet once the dice roll.
 */

const LOSE: Decision = Object.freeze({ kind: 'lose' })

/** The counted points a bet with `progress` has made, ascending. */
export function uniquePointsMade(progress: number): PointNumber[] {
  return totalsInMask(progress).filter(isPointNumber)
}

/** How many unique points a bet with `progress` has made. */
export function uniquePointsCount(progress: number): number {
  return bitCount(progress)
}

function win(count: number): Decision {
  return { kind: 'win', payKey: String(count), stake: 'return' }
}

function locate(req: PlaceRequest<UniquePointsBetType>): Located | Rejection {
  return locateSide(req, newHandWindow, lockedAfterFirstRoll)
}

function decide(bet: BetInstance, ctx: RollContext, type: UniquePointsBetType): Decision {
  const { transition } = ctx
  if (transition.kind === 'sevenOut') {
    const count = bitCount(bet.progress)
    return type.payTable.has(count) ? win(count) : LOSE
  }
  if (transition.kind !== 'pointMade' || !type.countedPoints.includes(transition.point)) {
    return NO_DECISION
  }
  const bit = totalBit(transition.point)
  if ((bet.progress & bit) !== 0) return NO_DECISION
  const progress = bet.progress | bit
  const count = bitCount(progress)
  if (type.payImmediatelyAt !== null && count >= type.payImmediatelyAt) return win(count)
  return { kind: 'progress', progress }
}

function payout(type: UniquePointsBetType, payKey: string): Ratio {
  const ratio = type.payTable.get(Number(payKey))
  if (ratio === undefined) throw new RangeError(`${type.typeId} pays nothing at "${payKey}"`)
  return ratio
}

function configPaths(type: UniquePointsBetType, _n: PointNumber | null, cfg: MachineConfig) {
  return sideConfigPaths(type, ['countedPoints', 'payTable', 'payImmediatelyAt', 'placement'], cfg)
}

/**
 * Progress names only counted points the hand has made (the bet goes up before the hand's first
 * roll, so its points are among the hand's), and never a count that was paid at once.
 */
function invariants(bet: BetInstance, state: TableState, type: UniquePointsBetType): string[] {
  const problems = sideInvariants(bet, type)
  const at = `${bet.id} (${type.typeId})`
  const counted = type.countedPoints.reduce((mask, n) => mask | totalBit(n), 0)
  if ((bet.progress & ~counted) !== 0) problems.push(`${at} counts a point that does not count`)
  if ((bet.progress & ~state.round.hand.pointsMadeMask) !== 0) {
    problems.push(`${at} counts a point its hand has not made`)
  }
  if (type.payImmediatelyAt !== null && bitCount(bet.progress) >= type.payImmediatelyAt) {
    problems.push(`${at} has ${bitCount(bet.progress)} points and should have been paid`)
  }
  return problems
}

export const uniquePointsMadeFamily: BetFamily<UniquePointsBetType> = {
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
