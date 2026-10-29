import type { MachineConfig } from '../config/compile.ts'
import { compositeFamily } from './composites.ts'
import { hardwayFamily } from './families/hardway.ts'
import { lineFamily } from './families/line.ts'
import { numberVsSevenFamily } from './families/numberVsSeven.ts'
import { oddsFamily } from './families/odds.ts'
import { oneRollFamily } from './families/oneRoll.ts'
import {
  NO_DECISION,
  betSeq,
  type BetFamily,
  type BetInstance,
  type BetType,
  type Decision,
  type FamilyKey,
  type RollContext,
} from './types.ts'

/**
 * Which family runs each bet type, and the order a roll settles them in.
 *
 * A later milestone adds a family by writing its file and adding one entry to `FAMILIES` (M4b:
 * `numberVsSeven`; M4c: `hardway`, `oneRoll` and composites; M11: the side bets). A type the
 * config offers but no family implements yet is not offered at all: `resolveType` returns null and
 * the validator rejects it with `NOT_OFFERED`.
 */

/**
 * Roll and settlement order (plan §4.8 step 3): line bets first, then odds (which take their
 * parent's decision), then number bets, hardways, one-roll bets, composites and side bets. Bets of
 * the same family go in placement order.
 */
export const FAMILY_ORDER: readonly FamilyKey[] = [
  'line',
  'odds',
  'numberVsSeven',
  'hardway',
  'oneRoll',
  'composite',
  'collectSet',
  'uniquePointsMade',
  'handLength',
  'pointRun',
]

type FamilyTable = {
  readonly [K in BetType['family']]?: BetFamily<Extract<BetType, { family: K }>>
}

const FAMILIES: FamilyTable = {
  line: lineFamily,
  odds: oddsFamily,
  numberVsSeven: numberVsSevenFamily,
  hardway: hardwayFamily,
  oneRoll: oneRollFamily,
  composite: compositeFamily,
}

/** A bet type together with the family that runs it. */
export interface ResolvedType {
  readonly type: BetType
  readonly family: BetFamily<BetType>
}

/**
 * The type `typeId` names in the config, whether or not a family implements it yet: a catalog type,
 * or a composite, which is one bet of its own id (plan §0 #15).
 */
export function betTypeOf(cfg: MachineConfig, typeId: string): BetType | null {
  return cfg.catalog.get(typeId) ?? cfg.composites.get(typeId) ?? null
}

/** The type and its family; null when the config does not offer it or no family implements it. */
export function resolveType(cfg: MachineConfig, typeId: string): ResolvedType | null {
  const type = betTypeOf(cfg, typeId)
  if (type === null) return null
  // Indexed by the type's own family, so the family matches the type.
  const family = FAMILIES[type.family] as BetFamily<BetType> | undefined
  return family === undefined ? null : { type, family }
}

/** `resolveType` for a bet already on the table, which must resolve. */
export function requireType(cfg: MachineConfig, typeId: string): ResolvedType {
  const resolved = resolveType(cfg, typeId)
  if (resolved === null) throw new Error(`No implemented bet type "${typeId}" in ${cfg.id}`)
  return resolved
}

/** The family's place in `FAMILY_ORDER`. */
export function familyRank(key: FamilyKey): number {
  return FAMILY_ORDER.indexOf(key)
}

/** `bets` in settlement order: by family, then by placement. */
export function settlementOrder(
  bets: readonly BetInstance[],
  cfg: MachineConfig,
): { readonly bet: BetInstance; readonly resolved: ResolvedType }[] {
  return bets
    .map((bet) => ({ bet, resolved: requireType(cfg, bet.typeId) }))
    .sort(
      (a, b) =>
        familyRank(a.resolved.type.family) - familyRank(b.resolved.type.family) ||
        betSeq(a.bet.id) - betSeq(b.bet.id),
    )
}

/**
 * A bet's decision on a roll. A bet that is not working gets `none`, except in a family that
 * decides while OFF: odds, which are returned when their parent is decided (rules spec §2.3 step
 * 4). The roll pipeline and the exact solver both decide through this.
 */
export function decideBet(bet: BetInstance, ctx: RollContext, resolved: ResolvedType): Decision {
  const { family, type } = resolved
  return ctx.working || family.decidesWhenOff ? family.decide(bet, ctx, type) : NO_DECISION
}
