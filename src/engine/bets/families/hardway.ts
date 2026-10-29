import type { HardwayBetType, MachineConfig } from '../../config/compile.ts'
import type { Ratio } from '../../config/ratio.ts'
import type { HardNumber, PointNumber } from '../../config/rulesets.ts'
import type { Phase } from '../../round/round.ts'
import type { TableState } from '../../table/state.ts'
import { afterSevenOutPaths, comeOutAutoOffPaths } from '../policies.ts'
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
 * Hard 4, 6, 8 and 10 (rules spec §2.2, §3.3; the same in crapless).
 *
 * Hard N wins when N is rolled as a pair, paying `/catalog/<t>/pays/<n>`, and loses when N is rolled
 * the easy way or on any 7, whatever the phase: the standard multi-roll rule, not the one-roll
 * wording of CW §16c (§0.2 #11). Every other roll leaves it up. A winner stays up or comes back per
 * `/catalog/<t>/afterWin`.
 *
 * A hardway can be placed on any roll, pressed, reduced or taken down, and switched ON and OFF where
 * the machine allows it. On the come-out it works per `/catalog/<t>/comeOutDefault`; with a point on
 * it always works unless switched OFF. Machine rules on top of that (Shoot To Win's come-out auto-OFF,
 * Interblock's Set bets Off) are applied for every family in `bets/working.ts`.
 */

const LOSE: Decision = Object.freeze({ kind: 'lose' })
const FREE: Mutability = Object.freeze({
  increase: true,
  decrease: true,
  remove: true,
  toggle: true,
})

function isOffered(type: HardwayBetType, n: PointNumber | null): n is HardNumber {
  return type.numbers.some((offered) => offered === n)
}

/** A hardway names one of the type's numbers, and adds to a bet already on it. */
function locate(req: PlaceRequest<HardwayBetType>): Located | Rejection {
  const { state, type, number } = req
  const at = { typeId: type.typeId }
  if (!isOffered(type, number)) return reject('BAD_PARAMS', { ...at, field: 'number' })
  if (req.parentId !== null) return reject('BAD_PARAMS', { ...at, field: 'parentId' })
  const existing = state.bets.find((b) => b.typeId === type.typeId && b.number === number) ?? null
  return { existing, number, parentId: null }
}

function defaultWorking(phase: Phase, type: HardwayBetType): boolean {
  return phase.kind === 'point' || type.comeOutDefault === 'on'
}

function decide(bet: BetInstance, ctx: RollContext, type: HardwayBetType): Decision {
  if (ctx.total === 7) return LOSE
  if (ctx.total !== bet.number) return NO_DECISION
  if (!ctx.isPair) return LOSE
  return { kind: 'win', payKey: String(bet.number), stake: type.afterWin }
}

/** A winner that stays is left as it is; anything else decided comes down. */
function apply(bet: BetInstance, decision: Decision): BetInstance | null {
  switch (decision.kind) {
    case 'win':
      return decision.stake === 'stay' ? bet : null
    case 'lose':
    case 'push':
      return null
    case 'none':
    case 'travel':
    case 'progress':
      return bet
  }
}

function payout(type: HardwayBetType, payKey: string): Ratio {
  const n = Number(payKey)
  const ratio = type.pays.get(n as HardNumber)
  if (ratio === undefined) throw new RangeError(`${type.typeId} pays nothing at "${payKey}"`)
  return ratio
}

/**
 * The type's numbers and its pay on the number, its after-win rule and come-out default, the
 * machine rules that switch it OFF, and its rounding.
 */
function configPaths(type: HardwayBetType, n: PointNumber | null, cfg: MachineConfig): string[] {
  const at = `/catalog/${type.typeId}`
  return [
    `${at}/numbers`,
    n === null ? `${at}/pays` : `${at}/pays/${n}`,
    `${at}/afterWin`,
    `${at}/comeOutDefault`,
    ...comeOutAutoOffPaths(cfg),
    ...afterSevenOutPaths(cfg),
    roundingPointer(cfg, type.typeId),
  ]
}

/** A hardway sits on one of its type's numbers, behind nothing. */
function invariants(bet: BetInstance, _state: TableState, type: HardwayBetType): string[] {
  const problems: string[] = []
  if (!isOffered(type, bet.number)) {
    problems.push(`${bet.id} (${type.typeId}) is on ${String(bet.number)}, not a hard number`)
  }
  if (bet.parentId !== null) problems.push(`${bet.id} (${type.typeId}) backs ${bet.parentId}`)
  return problems
}

export const hardwayFamily: BetFamily<HardwayBetType> = {
  // Whether it works depends on the phase (its come-out default), so the solver tracks the round.
  projection: 'round',
  toggleable: true,
  decidesWhenOff: false,
  locate,
  canPlace: () => null,
  mutability: () => FREE,
  defaultWorking,
  decide,
  apply,
  payout,
  configPaths,
  invariants,
}
