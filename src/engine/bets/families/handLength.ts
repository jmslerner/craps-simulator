import type { HandLengthBetType, MachineConfig } from '../../config/compile.ts'
import type { Ratio } from '../../config/ratio.ts'
import type { PointNumber } from '../../config/rulesets.ts'
import type { TableState } from '../../table/state.ts'
import {
  NO_DECISION,
  reject,
  type BetFamily,
  type BetInstance,
  type Decision,
  type Located,
  type PlaceCheck,
  type PlaceRequest,
  type Rejection,
  type RollContext,
} from '../types.ts'
import {
  applySide,
  locateSide,
  lockedAfterFirstRoll,
  sideConfigPaths,
  sideInvariants,
  windowClosed,
} from './sideBet.ts'

/**
 * The Hot Shooter Jackpot (rules spec §2.6, §6.2; plan §0 #11): Shoot To Win and Roll To Win pay
 * the hand's roll count at the seven-out, "for 1", for the highest tier reached
 * (`/sideBets/<t>/tiers`, ascending in `minRolls`): the 1x tier returns the stake, written
 * `push`; fewer rolls than the first tier lose. `progress` is the rolls counted so far, one more
 * after every roll, so the panel's "N ROLL(S)" and the solver's state are both on the bet.
 *
 * Which rolls count is `/sideBets/<t>/countDefinition` (§9 #10): `allRolls` (definition A, the
 * default: the come-out through the seven-out, the seven-out counted as it settles), `exceptSevenOut`
 * (B) and `exceptComeOutAndSevenOut` (C: the bet's first roll, the come-out it was placed for,
 * counts nothing either).
 *
 * Placement: Shoot To Win takes it only in the come-out bet time of a new hand
 * (`comeOutAfterSevenOut`: `hand.rolls === 0`; CW §33e); Pennsylvania before any come-out
 * (`anyComeOut`). The main game must carry `/sideBets/<t>/qualifyingBet` first (CW §33b: 3
 * credits), refused as `BELOW_MIN_TOTAL` with `scope: 'qualifyingBet'`. It is a special game: once
 * the dice roll it cannot be withdrawn or changed.
 */

const LOSE: Decision = Object.freeze({ kind: 'lose' })
/** The 1x tier: the stake comes back, nothing more; a zero-net push that takes the bet down. */
const STAKE_BACK: Decision = Object.freeze({ kind: 'push', reason: 'zeroNet', stake: 'return' })

type Tier = HandLengthBetType['tiers'][number]

/** The highest tier `rolls` reaches, or null below the first. */
export function handLengthTier(type: HandLengthBetType, rolls: number): Tier | null {
  let reached: Tier | null = null
  for (const tier of type.tiers) if (tier.minRolls <= rolls) reached = tier
  return reached
}

function placementWindow(state: TableState, type: HandLengthBetType): Rejection | null {
  const { round } = state
  switch (type.placement) {
    case 'comeOutAfterSevenOut':
      return round.hand.rolls === 0
        ? null
        : windowClosed(type.typeId, 'comeOutAfterSevenOut', 'nextHand')
    case 'anyComeOut':
      return round.phase.kind === 'comeOut'
        ? null
        : reject('WRONG_PHASE', { typeId: type.typeId, phase: round.phase.kind, window: 'comeOut' })
  }
}

function locate(req: PlaceRequest<HandLengthBetType>): Located | Rejection {
  return locateSide(req, placementWindow, lockedAfterFirstRoll)
}

/** The main game must carry the qualifying bet: every stake on the table that is not a side bet. */
function canPlace({ state, cfg, type }: PlaceCheck<HandLengthBetType>): Rejection | null {
  const min = type.qualifyingBet
  if (min <= 0) return null
  const total = state.bets.reduce(
    (sum, bet) => (cfg.sideBets.has(bet.typeId) ? sum : sum + bet.amount),
    0,
  )
  if (total >= min) return null
  return reject('BELOW_MIN_TOTAL', {
    scope: 'qualifyingBet',
    typeId: type.typeId,
    min,
    total,
    short: min - total,
  })
}

function decide(bet: BetInstance, ctx: RollContext, type: HandLengthBetType): Decision {
  if (ctx.transition.kind === 'sevenOut') {
    const rolls = bet.progress + (type.countDefinition === 'allRolls' ? 1 : 0)
    const tier = handLengthTier(type, rolls)
    if (tier === null) return LOSE
    if (tier.pays === 'push') return STAKE_BACK
    return { kind: 'win', payKey: String(tier.minRolls), stake: 'return' }
  }
  const first = ctx.before.rollIndex === bet.placedAtRoll
  const counted = type.countDefinition !== 'exceptComeOutAndSevenOut' || !first
  return counted ? { kind: 'progress', progress: bet.progress + 1 } : NO_DECISION
}

function payout(type: HandLengthBetType, payKey: string): Ratio {
  const tier = type.tiers.find((t) => String(t.minRolls) === payKey)
  if (tier === undefined || tier.pays === 'push') {
    throw new RangeError(`${type.typeId} pays nothing at "${payKey}"`)
  }
  return tier.pays
}

function configPaths(type: HandLengthBetType, _n: PointNumber | null, cfg: MachineConfig) {
  return sideConfigPaths(type, ['countDefinition', 'tiers', 'placement', 'qualifyingBet'], cfg)
}

/** The count never passes the rolls since placement, nor the hand's. */
function invariants(bet: BetInstance, state: TableState, type: HandLengthBetType): string[] {
  const problems = sideInvariants(bet, type)
  const { round } = state
  if (bet.progress > round.rollIndex - bet.placedAtRoll || bet.progress > round.hand.rolls) {
    problems.push(`${bet.id} (${type.typeId}) has counted more rolls than its hand has rolled`)
  }
  return problems
}

export const handLengthFamily: BetFamily<HandLengthBetType> = {
  projection: 'round',
  toggleable: false,
  decidesWhenOff: false,
  locate,
  canPlace,
  mutability: lockedAfterFirstRoll,
  defaultWorking: () => true,
  decide,
  apply: applySide,
  payout,
  configPaths,
  invariants,
}
