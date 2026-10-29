import type { MachineConfig, OddsBetType } from '../../config/compile.ts'
import type { Ratio } from '../../config/ratio.ts'
import { isPointNumber, type PointNumber } from '../../config/rulesets.ts'
import type { Phase } from '../../round/round.ts'
import { findBet, type TableState } from '../../table/state.ts'
import { oddsCap } from '../limits.ts'
import { RETURN_OFF_ODDS, comeOutAutoOffPaths } from '../policies.ts'
import {
  NO_DECISION,
  reject,
  roundingPointer,
  type BetFamily,
  type BetInstance,
  type Decision,
  type Located,
  type Mutability,
  type PlaceCheck,
  type PlaceRequest,
  type Rejection,
  type RollContext,
} from '../types.ts'

/**
 * Free odds behind a line bet (rules spec §2.2, §2.3 step 4, §3.1, §4.4): take odds behind pass
 * and come, lay odds behind don't pass and don't come.
 *
 * Odds sit on their parent's number and follow its decision: they win when it wins, paying
 * `/catalog/<t>/pays/<n>`, and lose when it loses. Odds that are OFF when their parent is decided
 * are returned (`push`, `offReturned`): come odds on a come-out 7, say. Odds always come down with
 * their parent, even when the parent stays up after a win. They may be added (up to the cap),
 * reduced or taken down at any time before they are decided, and switched ON and OFF where the
 * machine allows it.
 */

const LOSE: Decision = Object.freeze({ kind: 'lose' })
const RETURNED: Decision = Object.freeze({ kind: 'push', reason: 'offReturned' })
const FREE: Mutability = Object.freeze({
  increase: true,
  decrease: true,
  remove: true,
  toggle: true,
})

/** The line bet `parentId` names, if it is one this odds type can back. */
function parentOf(state: TableState, type: OddsBetType, parentId: string | null) {
  const parent = parentId === null ? undefined : state.bets.find((b) => b.id === parentId)
  return parent?.typeId === type.parent ? parent : null
}

/**
 * Odds land on their parent's number, adding to any odds already there. An action may name the
 * number too, but it must be the parent's. A missing or wrong parent is left for `canPlace`, which
 * rejects it at validation step 4.
 */
function locate(req: PlaceRequest<OddsBetType>): Located | Rejection {
  const { state, type } = req
  const parent = parentOf(state, type, req.parentId)
  if (parent === null) return { existing: null, number: req.number, parentId: req.parentId }
  if (req.number !== null && req.number !== parent.number) {
    return reject('BAD_PARAMS', { typeId: type.typeId, field: 'number' })
  }
  const existing =
    state.bets.find((b) => b.typeId === type.typeId && b.parentId === parent.id) ?? null
  return { existing, number: parent.number, parentId: parent.id }
}

/** Validation step 4: a parent of the right type, on a number, and the cap (§4.4). */
function canPlace({ state, cfg, type, bet }: PlaceCheck<OddsBetType>): Rejection | null {
  const at = { typeId: type.typeId }
  const parent = parentOf(state, type, bet.parentId)
  if (parent === null) {
    return reject('NO_PARENT', { ...at, parent: type.parent, parentId: bet.parentId ?? '' })
  }
  if (parent.number === null) return reject('PARENT_NOT_ON_POINT', { ...at, parentId: parent.id })
  const max = oddsCap(type, parent, cfg)
  return bet.amount > max ? reject('ODDS_LIMIT', { ...at, amount: bet.amount, max }) : null
}

/**
 * Pass-line odds never face a come-out roll: the point is on whenever they are. Odds on come and
 * don't come bets do, and work then per `/catalog/<t>/comeOutDefault`.
 */
function defaultWorking(phase: Phase, type: OddsBetType): boolean {
  return phase.kind === 'point' || type.comeOutDefault !== 'off'
}

function decide(bet: BetInstance, ctx: RollContext): Decision {
  const parent = ctx.parentDecision ?? NO_DECISION
  switch (parent.kind) {
    case 'win':
      return ctx.working ? { kind: 'win', payKey: String(bet.number), stake: 'return' } : RETURNED
    case 'lose':
      return ctx.working ? LOSE : RETURNED
    case 'push':
      // A parent on a number never pushes; if one did, its odds would simply come back.
      return RETURNED
    case 'none':
    case 'travel':
    case 'progress':
      if (!ctx.working && RETURN_OFF_ODDS.some((rule) => rule(bet, ctx))) return RETURNED
      return NO_DECISION
  }
}

/** Decided odds come down: paid and returned, lost, or returned unpaid. */
function apply(bet: BetInstance, decision: Decision): BetInstance | null {
  return decision.kind === 'none' ? bet : null
}

function payout(type: OddsBetType, payKey: string): Ratio {
  const n = Number(payKey)
  const ratio = isPointNumber(n) ? type.pays.get(n) : undefined
  if (ratio === undefined) throw new RangeError(`${type.typeId} pays nothing at "${payKey}"`)
  return ratio
}

/**
 * The odds' own pay on the number, cap and come-out default, the machine rules that switch odds
 * OFF or return them, and the parent's side (its decisions are the odds' decisions).
 */
function configPaths(type: OddsBetType, n: PointNumber | null, cfg: MachineConfig): string[] {
  const at = `/catalog/${type.typeId}`
  const parent = cfg.catalog.get(type.parent)
  return [
    `${at}/parent`,
    n === null ? `${at}/pays` : `${at}/pays/${n}`,
    `${at}/limit/basis`,
    n === null ? `${at}/limit/multiple` : `${at}/limit/multiple/${n}`,
    ...(type.comeOutDefault === null ? [] : [`${at}/comeOutDefault`, ...comeOutAutoOffPaths(cfg)]),
    '/oddsOffReturnedAtPointMade',
    roundingPointer(cfg, type.typeId),
    ...(parent?.family === 'line' ? [`/catalog/${parent.typeId}/side`] : []),
  ]
}

/** Odds sit on their parent's number, one odds bet per parent, within the cap. */
function invariants(
  bet: BetInstance,
  state: TableState,
  type: OddsBetType,
  cfg: MachineConfig,
): string[] {
  const parent = bet.parentId === null ? undefined : findBet(state, bet.parentId)
  if (parent === undefined || parent.typeId !== type.parent) {
    return [`${bet.id} (${type.typeId}) has no ${type.parent} bet to back`]
  }
  const problems: string[] = []
  if (parent.number === null || bet.number !== parent.number) {
    problems.push(`${bet.id} is on ${String(bet.number)}, its parent on ${String(parent.number)}`)
  }
  const twins = state.bets.filter((b) => b.typeId === type.typeId && b.parentId === parent.id)
  if (twins.length > 1) problems.push(`${parent.id} carries ${twins.length} ${type.typeId} bets`)
  const max = oddsCap(type, parent, cfg)
  if (bet.amount > max)
    problems.push(`${bet.id} holds ${bet.amount}¢ of odds, above the ${max}¢ cap`)
  return problems
}

export const oddsFamily: BetFamily<OddsBetType> = {
  projection: 'round',
  toggleable: true,
  decidesWhenOff: true,
  locate,
  canPlace,
  mutability: () => FREE,
  defaultWorking,
  decide,
  apply,
  payout,
  configPaths,
  invariants,
}
