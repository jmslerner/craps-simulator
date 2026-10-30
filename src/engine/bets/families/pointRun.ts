import type { MachineConfig, PointRunBetType } from '../../config/compile.ts'
import type { Ratio } from '../../config/ratio.ts'
import { isPointNumber, type PointNumber } from '../../config/rulesets.ts'
import type { Total } from '../../core/dice.ts'
import { totalBit, totalsInMask } from '../../round/round.ts'
import type { TableState } from '../../table/state.ts'
import {
  NO_DECISION,
  reject,
  type BetFamily,
  type BetInstance,
  type Decision,
  type Located,
  type Mutability,
  type PlaceRequest,
  type Rejection,
  type RollContext,
} from '../types.ts'
import {
  LOCKED,
  OPEN,
  applySide,
  bitCount,
  hasRolled,
  locateSide,
  newHandWindow,
  sideConfigPaths,
  sideInvariants,
} from './sideBet.ts'

/**
 * The Lucky Shooter, Interblock's special bet (rules spec §2.6, §6.3; PA §623c.2, MD; plan §0 #11),
 * traditional craps only. On the come-out, a total in `/rules/craps` loses, one in
 * `/rules/naturals` pushes with the bet staying up (§0.2 #8), and a box number
 * (`/sideBets/<t>/points`) becomes the bet's point P. Each later roll of a box number not yet hit
 * and not P adds a hit. Any other roll settles with k hits: P, a come-out total, or, where
 * `/sideBets/<t>/repeatEndsBet`, a number already hit. After every other box number has hit, the
 * next roll settles: P pays `/sideBets/<t>/topAward`, anything else the top count of
 * `/sideBets/<t>/payTable`. A count the table lacks loses.
 *
 * `progress` holds P and the hit mask: `pointRunProgress(point, hits)`, read back with
 * `pointRunState`. Placement: before the point (`beforePoint`, Interblock; `comeOut`, PA: a
 * come-out roll), or before a new hand (`newHand`, MD). Until its point is set it may still come
 * down where `/sideBets/<t>/removableBeforePoint`, and grow while its window is open; with the
 * point set it is a contract bet.
 */

const LOSE: Decision = Object.freeze({ kind: 'lose' })
/** A come-out 7 or 11: nothing paid, the bet stays up for the next come-out. */
const STAYS: Decision = Object.freeze({ kind: 'push', reason: 'bar' })
const TOP = 'top'

/** Bits 0–12 of `progress` are the hit mask; the point sits above them. */
const HIT_BITS = 13
const HIT_MASK = (1 << HIT_BITS) - 1

/** The progress of a Lucky Shooter on `point` (null before it is set) with the hits in `hits`. */
export function pointRunProgress(point: PointNumber | null, hits: number): number {
  return ((point ?? 0) << HIT_BITS) | (hits & HIT_MASK)
}

/** The point and hit mask a Lucky Shooter's `progress` holds. */
export function pointRunState(progress: number): { point: PointNumber | null; hits: number } {
  const point = progress >> HIT_BITS
  return { point: isPointNumber(point) ? point : null, hits: progress & HIT_MASK }
}

/** The box numbers a Lucky Shooter with `progress` has hit, ascending. */
export function pointRunHits(progress: number): PointNumber[] {
  return totalsInMask(pointRunState(progress).hits).filter(isPointNumber)
}

function isBox(type: PointRunBetType, total: Total): total is PointNumber {
  return type.points.some((n) => n === total)
}

function placementWindow(state: TableState, type: PointRunBetType): Rejection | null {
  switch (type.placement) {
    case 'beforePoint':
    case 'comeOut': {
      const { phase } = state.round
      return phase.kind === 'comeOut'
        ? null
        : reject('WRONG_PHASE', { typeId: type.typeId, phase: phase.kind, window: 'comeOut' })
    }
    case 'newHand':
      return newHandWindow(state, type)
  }
}

/**
 * Free until the dice roll; before its point it grows while its window is open and comes down where
 * the machine allows; with the point set it is a contract bet.
 */
function mutability(bet: BetInstance, state: TableState, type: PointRunBetType): Mutability {
  if (!hasRolled(bet, state)) return OPEN
  if (pointRunState(bet.progress).point !== null) return LOCKED
  const removable = type.removableBeforePoint
  return {
    increase: placementWindow(state, type) === null,
    decrease: removable,
    remove: removable,
    toggle: false,
  }
}

function locate(req: PlaceRequest<PointRunBetType>): Located | Rejection {
  return locateSide(req, placementWindow, mutability)
}

/** Settles with `hits` hits: the top award when the point follows them all, else the table's pay. */
function settleWith(type: PointRunBetType, hits: number, top: boolean): Decision {
  if (top) return { kind: 'win', payKey: TOP, stake: 'return' }
  return type.payTable.has(hits) ? { kind: 'win', payKey: String(hits), stake: 'return' } : LOSE
}

function decide(bet: BetInstance, ctx: RollContext, type: PointRunBetType): Decision {
  const { total, rules } = ctx
  const { point, hits } = pointRunState(bet.progress)
  if (point === null) {
    if (rules.craps.includes(total)) return LOSE
    if (rules.naturals.includes(total)) return STAYS
    return isBox(type, total)
      ? { kind: 'progress', progress: pointRunProgress(total, 0) }
      : NO_DECISION
  }
  const count = bitCount(hits)
  const others = type.points.length - 1
  if (total === point) return settleWith(type, count, count >= others)
  if (count >= others) return settleWith(type, count, false)
  if (isBox(type, total)) {
    const bit = totalBit(total)
    if ((hits & bit) === 0)
      return { kind: 'progress', progress: pointRunProgress(point, hits | bit) }
    return type.repeatEndsBet ? settleWith(type, count, false) : NO_DECISION
  }
  return settleWith(type, count, false)
}

function payout(type: PointRunBetType, payKey: string): Ratio {
  if (payKey === TOP) return type.topAward
  const ratio = type.payTable.get(Number(payKey))
  if (ratio === undefined) throw new RangeError(`${type.typeId} pays nothing at "${payKey}"`)
  return ratio
}

function configPaths(type: PointRunBetType, _n: PointNumber | null, cfg: MachineConfig) {
  return [
    '/rules/craps',
    '/rules/naturals',
    ...sideConfigPaths(
      type,
      ['points', 'payTable', 'topAward', 'repeatEndsBet', 'placement', 'removableBeforePoint'],
      cfg,
    ),
  ]
}

/**
 * The point is one of the bet's box numbers, and the round's point while it is set (they are set
 * by the same roll and the bet never outlives the point); hits are other box numbers, and there
 * are none before the point.
 */
function invariants(bet: BetInstance, state: TableState, type: PointRunBetType): string[] {
  const problems = sideInvariants(bet, type)
  const at = `${bet.id} (${type.typeId})`
  const { point, hits } = pointRunState(bet.progress)
  const box = type.points.reduce((mask, n) => mask | totalBit(n), 0)
  if (point === null) {
    if (hits !== 0) problems.push(`${at} has hits before its point`)
    return problems
  }
  if (!isBox(type, point)) problems.push(`${at} is on ${point}, not a box number`)
  if ((hits & totalBit(point)) !== 0) problems.push(`${at} counts a hit on its own point`)
  if ((hits & ~box) !== 0) problems.push(`${at} counts hits that are not box numbers`)
  const { phase } = state.round
  if (phase.kind !== 'point' || phase.point !== point) {
    problems.push(
      `${at} is on ${point}, but the round's point is ${phase.kind === 'point' ? phase.point : 'off'}`,
    )
  }
  return problems
}

export const pointRunFamily: BetFamily<PointRunBetType> = {
  projection: 'round',
  toggleable: false,
  decidesWhenOff: false,
  locate,
  canPlace: () => null,
  mutability,
  defaultWorking: () => true,
  decide,
  apply: applySide,
  payout,
  configPaths,
  invariants,
}
