import type { MachineConfig, NumberBetType } from '../../config/compile.ts'
import type { Ratio } from '../../config/ratio.ts'
import { isPointNumber, type PointKey, type PointNumber } from '../../config/rulesets.ts'
import type { Phase } from '../../round/round.ts'
import {
  commissionRule,
  vigHeldAfterWin,
  vigOnChange,
  winCommission,
} from '../../settle/commission.ts'
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
 * Bets decided by one number against 7 (rules spec §2.2, §3.2): place, buy and big 6/8 win when
 * their number is rolled and lose on any 7; lay and place-to-lose win on any 7 and lose when their
 * number is rolled. Every other roll leaves them up, in either phase.
 *
 * - **Pays** `/catalog/<t>/pays/<n>`, rounded by the type's rounding on that number
 *   (`/catalog/<t>/payoutRoundingByNumber/<n>`, else its own or `/money/payoutRounding`;
 *   `payoutRoundingFor`). Buy and lay carry a commission (`settle/commission.ts`).
 * - **After a win** the bet stays up or comes back per `/catalog/<t>/afterWin`.
 * - **Numbers:** the type's own (`/catalog/<t>/numbers`): crapless place and buy on all ten points,
 *   big on 6 and 8.
 * - **Any roll, any change:** placed in either phase, pressed, reduced, taken down and switched ON
 *   and OFF where the machine allows it (§3.2). A second bet of a type on its number adds to the
 *   first.
 * - **Working:** with a point on it works unless switched OFF; on the come-out per
 *   `/catalog/<t>/comeOutDefault`. The machine rules on top (Shoot To Win's come-out auto-OFF,
 *   Interblock's after-seven-out OFF and lay re-enable) apply to every family in `bets/working.ts`
 *   and `bets/policies.ts`.
 */

const LOSE: Decision = Object.freeze({ kind: 'lose' })
const FREE: Mutability = Object.freeze({
  increase: true,
  decrease: true,
  remove: true,
  toggle: true,
})

/** Place, buy and big win on their number; lay and place-to-lose on 7 (§3.2). */
function winsOnNumber(type: NumberBetType): boolean {
  return type.kind === 'place' || type.kind === 'buy' || type.kind === 'big'
}

function isOffered(type: NumberBetType, n: PointNumber | null): n is PointNumber {
  return type.numbers.some((offered) => offered === n)
}

/** A number bet names one of its type's numbers, and adds to a bet already on it. */
function locate(req: PlaceRequest<NumberBetType>): Located | Rejection {
  const { state, type, number } = req
  const at = { typeId: type.typeId }
  if (!isOffered(type, number)) return reject('BAD_PARAMS', { ...at, field: 'number' })
  if (req.parentId !== null) return reject('BAD_PARAMS', { ...at, field: 'parentId' })
  const existing = state.bets.find((b) => b.typeId === type.typeId && b.number === number) ?? null
  return { existing, number, parentId: null }
}

function defaultWorking(phase: Phase, type: NumberBetType): boolean {
  return phase.kind === 'point' || type.comeOutDefault === 'on'
}

function decide(bet: BetInstance, ctx: RollContext, type: NumberBetType): Decision {
  const n = bet.number
  if (n === null) return NO_DECISION
  const [wins, loses] = winsOnNumber(type) ? [n, 7] : [7, n]
  if (ctx.total === wins) return { kind: 'win', payKey: String(n), stake: type.afterWin }
  if (ctx.total === loses) return LOSE
  return NO_DECISION
}

/**
 * A winner that stays is left up, holding the commission re-collected for its next decision; a
 * loser and a winner that comes back come down.
 */
function apply(
  bet: BetInstance,
  decision: Decision,
  _ctx: RollContext,
  type: NumberBetType,
): BetInstance | null {
  switch (decision.kind) {
    case 'win': {
      if (decision.stake === 'return') return null
      const vigHeld = vigHeldAfterWin(bet, type)
      return vigHeld === bet.vigHeld ? bet : { ...bet, vigHeld }
    }
    case 'lose':
    case 'push':
      return null
    case 'none':
    case 'travel':
    case 'progress':
      return bet
  }
}

function payout(type: NumberBetType, payKey: string): Ratio {
  const n = Number(payKey)
  const ratio = isPointNumber(n) ? type.pays.get(n) : undefined
  if (ratio === undefined) throw new RangeError(`${type.typeId} pays nothing at "${payKey}"`)
  return ratio
}

/**
 * Its kind and numbers, its pay on the number and the commission that applies there, after-win and
 * come-out default, the machine rules that switch it OFF and ON, and its rounding on the number.
 */
function configPaths(type: NumberBetType, n: PointNumber | null, cfg: MachineConfig): string[] {
  const at = `/catalog/${type.typeId}`
  return [
    `${at}/kind`,
    `${at}/numbers`,
    n === null ? `${at}/pays` : `${at}/pays/${n}`,
    ...commissionPaths(type, n, cfg),
    `${at}/afterWin`,
    `${at}/comeOutDefault`,
    ...comeOutAutoOffPaths(cfg),
    ...afterSevenOutPaths(cfg),
    ...(type.kind === 'lay' ? ['/layAutoOn'] : []),
    ...roundingPaths(type, n, cfg),
  ]
}

/**
 * The rounding a bet on `n` reads (`payoutRoundingFor`): its per-number rounding or the type's. With
 * no number, the type's, and the per-number roundings too where it has any.
 */
function roundingPaths(type: NumberBetType, n: PointNumber | null, cfg: MachineConfig): string[] {
  const own = roundingPointer(cfg, type.typeId, n)
  return n === null && type.payoutRoundingByNumber.size > 0
    ? [own, `/catalog/${type.typeId}/payoutRoundingByNumber`]
    : [own]
}

/** The commission entries a bet on `n` reads: its own override, or the type's commission. */
function commissionPaths(type: NumberBetType, n: PointNumber | null, cfg: MachineConfig): string[] {
  if (type.commission === null) return []
  const at = `/catalog/${type.typeId}`
  const input = cfg.input.catalog[type.typeId]
  const byNumber = input?.family === 'numberVsSeven' ? input.commissionByNumber : undefined
  if (n === null) {
    return byNumber === undefined
      ? [`${at}/commission`]
      : [`${at}/commission`, `${at}/commissionByNumber`]
  }
  return byNumber?.[String(n) as PointKey] === undefined
    ? [`${at}/commission`]
    : [`${at}/commissionByNumber/${n}`]
}

/**
 * A number bet sits on one of its type's numbers, behind nothing, and holds commission only where
 * its type charges it up front.
 */
function invariants(bet: BetInstance, _state: TableState, type: NumberBetType): string[] {
  const problems: string[] = []
  if (!isOffered(type, bet.number)) {
    problems.push(`${bet.id} (${type.typeId}) is on ${String(bet.number)}, not one of its numbers`)
  }
  if (bet.parentId !== null) problems.push(`${bet.id} (${type.typeId}) backs ${bet.parentId}`)
  const rule = commissionRule(type, bet.number)
  if (bet.vigHeld !== 0 && rule?.timing !== 'upfront') {
    problems.push(`${bet.id} (${type.typeId}) holds ${bet.vigHeld}¢ of commission it never charges`)
  }
  return problems
}

export const numberVsSevenFamily: BetFamily<NumberBetType> = {
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
  vigOnChange: (bet, to, type) => vigOnChange(bet, to, type),
  winCommission,
  invariants,
}
