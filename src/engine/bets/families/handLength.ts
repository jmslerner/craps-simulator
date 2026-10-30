import type { HandLengthBetType, MachineConfig } from '../../config/compile.ts'
import type { Ratio } from '../../config/ratio.ts'
import type { PointNumber } from '../../config/rulesets.ts'
import type { TableState } from '../../table/state.ts'
import {
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
 * `push`; fewer rolls than the first tier lose.
 *
 * **The count is the hand's** (§2.6: the counter is `hand.rolls`). `progress` is the rolls the hand
 * has made so far, its come-out included: a bet placed on a hand's first come-out starts at 0, and
 * one placed on a later come-out (Pennsylvania's `anyComeOut`) carries the hand's earlier rolls
 * (`initialProgress`). Every roll adds one, so the panel's "N ROLL(S)" and the solver's state are
 * both on the bet, and a decision reads nothing but the bet and the roll's transition.
 *
 * Which of the hand's rolls count is `/sideBets/<t>/countDefinition` (§9 #10), read when the
 * seven-out ends a hand of `progress + 1` rolls (`handLengthCount`): `allRolls` (definition A, the
 * default: every roll, the come-out and the seven-out included), `exceptSevenOut` (B) and
 * `exceptComeOutAndSevenOut` (C: neither the hand's first come-out nor the seven-out — the hand's,
 * not the bet's, whenever it was placed). The rolls counted so far, mid-hand, are
 * `handLengthCounted`.
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

/** The highest tier `count` reaches, or null below the first. */
export function handLengthTier(type: HandLengthBetType, count: number): Tier | null {
  let reached: Tier | null = null
  for (const tier of type.tiers) if (tier.minRolls <= count) reached = tier
  return reached
}

/**
 * The count a hand of `rolls` rolls, the seven-out included, settles at (§6.2, §9 #10): all of them
 * under definition A, all but the seven-out under B, all but the hand's first come-out and the
 * seven-out under C.
 */
export function handLengthCount(type: HandLengthBetType, rolls: number): number {
  switch (type.countDefinition) {
    case 'allRolls':
      return rolls
    case 'exceptSevenOut':
      return Math.max(0, rolls - 1)
    case 'exceptComeOutAndSevenOut':
      return Math.max(0, rolls - 2)
  }
}

/**
 * The rolls counted so far by a bet with `progress` (the hand's rolls so far), before any
 * seven-out: every one of them under A and B, all but the hand's first come-out under C. What the
 * machine's "N ROLL(S)" panel shows.
 */
export function handLengthCounted(type: HandLengthBetType, progress: number): number {
  return type.countDefinition === 'exceptComeOutAndSevenOut' ? Math.max(0, progress - 1) : progress
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

/** A new bet carries the hand's rolls so far (§2.6): none on a new hand's come-out. */
function initialProgress(state: TableState): number {
  return state.round.hand.rolls
}

function decide(bet: BetInstance, ctx: RollContext, type: HandLengthBetType): Decision {
  if (ctx.transition.kind === 'sevenOut') {
    const tier = handLengthTier(type, handLengthCount(type, bet.progress + 1))
    if (tier === null) return LOSE
    if (tier.pays === 'push') return STAKE_BACK
    return { kind: 'win', payKey: String(tier.minRolls), stake: 'return' }
  }
  return { kind: 'progress', progress: bet.progress + 1 }
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

/** The count is the hand's: never more rolls than the hand has rolled. */
function invariants(bet: BetInstance, state: TableState, type: HandLengthBetType): string[] {
  const problems = sideInvariants(bet, type)
  if (bet.progress > state.round.hand.rolls) {
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
  initialProgress,
  invariants,
}
