import type { MachineConfig } from '../config/compile.ts'
import type { PointNumber } from '../config/rulesets.ts'
import type { Phase, RoundStep, RoundTransition } from '../round/round.ts'
import type { GameEvent } from '../table/events.ts'
import { heldOffOf, type TableState } from '../table/state.ts'
import {
  reject,
  type BetInstance,
  type BetType,
  type Rejection,
  type RollContext,
} from './types.ts'

/**
 * The machine policies of rules spec §2.3 (steps 2, 8 and 9) and §2.4, and the lists the engine
 * consults them through. Each list is also an extension point: a later rule is added to the list
 * it needs, and the engine already consults every list in the right place.
 *
 * | Config knob | Where |
 * |---|---|
 * | `/comeOut/autoOff` (Shoot To Win) | `FORCED_WORKING`: `comeOutAutoOff`, OFF for the come-out above every toggle (§9 #7) |
 * | `/afterSevenOut/newPlacedOff` (Interblock) | `startsOff`: a bet placed in the window after the trigger is held OFF (`TableState.heldOff`, step `afterSevenOut` of `bets/working.ts`); a press that sets bets ON ends it (`table/reducer.ts`); `AFTER_ROLL`: `afterSevenOutUntilPoint` ends it at the point where `until: pointEstablished` |
 * | `/layAutoOn` (Interblock) | `AFTER_ROLL`: `layAutoOn` |
 * | `/oddsOffReturnedAtPointMade` (Interblock) | `RETURN_OFF_ODDS`: `offOddsReturnedAtPointMade` |
 * | `/excludeLineVsLayBuy` (Interblock) | `EXCLUSIONS`: `lineVsLayBuy` |
 * | `/offBets/consumeCredit` (Shoot To Win) | not in money: every bet keeps its stake, ON or OFF (`limits.ts`, `availableCredit`) |
 * | `/limits/minTotal` ("BETS ARE NOT VALID YET!") | `validateRoll` (`bets/validate.ts`) with `checkMinTotal` (`limits.ts`), not `ROLL_CHECKS`: it counts only working bets, and `effectiveWorking` cannot be imported here |
 *
 * Interblock's after-seven-out OFF is a hold of its own (`TableState.heldOff`), not a
 * `DEFAULT_WORKING` rule: the machine holds new bets OFF even after the player has pressed Set bets
 * On (the button's ON lasts until changed), so it must outrank the button, and only a later press
 * that sets bets ON ends it. It is not the bet's own setting either: on a machine with per-bet
 * toggles, a bet set ON works, and one set back to its default is held again (rules spec §2.4,
 * §9 #29), and the `nextRollOnly` reset of the toggles leaves it (`table/roll.ts`).
 *
 * The rules here read only the table and the config, never the registry, so that bet families can
 * import this file without importing the registry, which imports the families.
 */

/** What a working rule sees about one bet before a roll. */
export interface WorkingInput {
  readonly bet: BetInstance
  readonly type: BetType
  readonly state: TableState
  readonly cfg: MachineConfig
  /** The phase of the next roll. */
  readonly phase: Phase
  /**
   * Placed before the current betting window: a bet "carried from the previous series" in Shoot
   * To Win's words, rather than one placed for the next roll.
   */
  readonly carried: boolean
}

/** A machine's say on whether a bet works: ON, OFF, or null for no opinion. */
export type WorkingRule = (input: WorkingInput) => boolean | null

/** A machine action after a roll: the table after it, and what it did. */
export type AfterRollRule = (
  state: TableState,
  step: RoundStep,
  cfg: MachineConfig,
) => { readonly state: TableState; readonly events: readonly GameEvent[] }

/**
 * Shoot To Win's come-out auto-OFF (`/comeOut/autoOff`; CW §4): "any chips bet remaining from the
 * previous series on COME ODDS/PLACE/BUY/HARDWAYS/BIG6/BIG8 are automatically turned OFF until the
 * Point is established and then are automatically turned ON". On a come-out roll, a bet of a
 * `carried` type placed before this betting window, or of a `newlyPlaced` type placed in it [A,
 * §9 #7], is OFF whatever the toggles say. With a point on the rule has no say (`reOnAt:
 * pointEstablished`), so the bet works again unless the player has switched it OFF.
 */
export function comeOutAutoOff({ bet, cfg, phase, carried }: WorkingInput): boolean | null {
  const autoOff = cfg.working.comeOutAutoOff
  if (autoOff === null || phase.kind !== 'comeOut') return null
  return (carried ? autoOff.carried : autoOff.newlyPlaced).includes(bet.typeId) ? false : null
}

/** Machine rules that override every player toggle (Shoot To Win's come-out auto-OFF). */
export const FORCED_WORKING: readonly WorkingRule[] = [comeOutAutoOff]

/**
 * The pointers a toggleable bet's working reads from Shoot To Win's come-out auto-OFF
 * (`/comeOut/autoOff`), for `configPaths`: the rule's parts when the machine has it, so that an
 * assumed part (chips newly placed for the come-out, §9 #7) is not hidden behind the verified
 * entry for the whole rule; the null value itself when it has none.
 */
export function comeOutAutoOffPaths(cfg: MachineConfig): string[] {
  const at = '/comeOut/autoOff'
  return cfg.working.comeOutAutoOff === null
    ? [at]
    : [`${at}/carried`, `${at}/newlyPlaced`, `${at}/reOnAt`]
}

/**
 * The pointers a number bet's or hardway's working reads from Interblock's after-seven-out OFF
 * (`/afterSevenOut/newPlacedOff`), by part as in `comeOutAutoOffPaths`: its trigger and how long it
 * lasts are assumed (§9 #6) where the types it covers are verified.
 */
export function afterSevenOutPaths(cfg: MachineConfig): string[] {
  const at = '/afterSevenOut/newPlacedOff'
  return cfg.working.afterSevenOut === null ? [at] : [`${at}/types`, `${at}/trigger`, `${at}/until`]
}

/** Machine defaults that the player's toggles override. None today; see the note above. */
export const DEFAULT_WORKING: readonly WorkingRule[] = []

/**
 * Interblock's after-seven-out OFF (`/afterSevenOut/newPlacedOff`; IB §3.2, rules spec §2.3 step 8,
 * §9 #6): whether the machine holds a new bet of `typeId` placed now OFF (`TableState.heldOff`).
 * That is so in the betting window right after the trigger: a seven-out (`trigger: sevenOut`: the
 * new hand has not rolled yet), or any 7, a come-out 7 included (`anySeven`). Bets placed in later
 * windows, and bets added to, start as usual. The session's first window follows no 7.
 */
export function startsOff(state: TableState, typeId: string, cfg: MachineConfig): boolean {
  const rule = cfg.working.afterSevenOut
  const { round } = state
  if (rule === null || !rule.types.includes(typeId) || round.rollIndex === 0) return false
  return rule.trigger === 'anySeven' ? round.sinceSeven.rolls === 0 : round.hand.rolls === 0
}

/**
 * Interblock (`/oddsOffReturnedAtPointMade`; IB §3.2 "Odds bets are removed when a Point is
 * reestablished", read as the point being made [A]): when the point is made, every odds bet that
 * is OFF comes down, returned, even when its own come bet is not decided by the roll. Odds whose
 * parent the roll decides are returned while OFF anyway (§2.3 step 4).
 */
export function offOddsReturnedAtPointMade(_odds: BetInstance, ctx: RollContext): boolean {
  return ctx.cfg.working.oddsOffReturnedAtPointMade && ctx.transition.kind === 'pointMade'
}

/**
 * Machine rules that return odds that are OFF on a roll that does not decide their parent. Odds
 * whose parent is decided while they are OFF are always returned; that needs no rule here.
 */
export const RETURN_OFF_ODDS: readonly ((odds: BetInstance, ctx: RollContext) => boolean)[] = [
  offOddsReturnedAtPointMade,
]

/**
 * Machine checks on a `roll` action beyond its dice, the round's minimum, credit and limits (all in
 * `validateRoll`); null when it may roll. None today.
 */
export const ROLL_CHECKS: readonly ((state: TableState, cfg: MachineConfig) => Rejection | null)[] =
  []

/**
 * Interblock's "Exclude bets on Pass/Don't Pass – Lay/Buy" (`/excludeLineVsLayBuy`; IB221): a pass
 * bet on its point blocks a new lay on that number, and a don't pass bet on its point a new buy.
 * The same pairs clash the other way round, for a put bet landing on a point where the lay or buy
 * is already up. Come and don't come bets are not covered: the setting names the pass line.
 */
export function lineVsLayBuy(
  state: TableState,
  typeId: string,
  number: PointNumber | null,
  cfg: MachineConfig,
): Rejection | null {
  if (!cfg.excludeLineVsLayBuy || number === null) return null
  const clash = state.bets.find(
    (bet) =>
      bet.number === number &&
      (lineBlocks(cfg, bet.typeId, typeId) || lineBlocks(cfg, typeId, bet.typeId)),
  )
  if (clash === undefined) return null
  return reject('EXCLUSIVE_CONFLICT', {
    typeId,
    conflictsWith: clash.typeId,
    betId: clash.id,
    scope: 'lineVsLayBuy',
  })
}

/** Whether a bet of `lineId` on a number blocks one of `otherId` there (`lineVsLayBuy`). */
function lineBlocks(cfg: MachineConfig, lineId: string, otherId: string): boolean {
  const line = cfg.catalog.get(lineId)
  const other = cfg.catalog.get(otherId)
  if (line?.family !== 'line' || line.window !== 'comeOut') return false
  return other?.family === 'numberVsSeven' && other.kind === (line.side === 'do' ? 'lay' : 'buy')
}

/** Exclusions beyond `/exclusiveGroups` for a new bet of `typeId` on `number`. */
export const EXCLUSIONS: readonly ((
  state: TableState,
  typeId: string,
  number: PointNumber | null,
  cfg: MachineConfig,
) => Rejection | null)[] = [lineVsLayBuy]

/**
 * Interblock's lay re-enable (`/layAutoOn`; IB §3.2 "Lay bets become enabled after a Point is
 * reestablished or a 7 is rolled", rules spec §2.3 step 8): after a point is made
 * (`afterPointMade`) or any 7 (`afterSeven`), every lay bet that a toggle has switched OFF, its
 * own or the button, comes back ON. The bet is set ON itself, so the other bets the button holds
 * OFF stay OFF, and the next press of the button switches the lay with them again.
 */
export function layAutoOn(
  state: TableState,
  step: RoundStep,
  cfg: MachineConfig,
): ReturnType<AfterRollRule> {
  const rule = cfg.working.layAutoOn
  const { transition } = step
  const due =
    rule !== null &&
    ((rule.afterPointMade && transition.kind === 'pointMade') ||
      (rule.afterSeven && isSeven(transition)))
  if (!due) return { state, events: [] }
  return switchBets(
    state,
    (bet) => (isLay(cfg, bet.typeId) && switchedOff(bet, state, cfg) ? true : undefined),
    'layAutoOn',
  )
}

/**
 * Interblock's after-seven-out OFF where it lasts until the point (`/afterSevenOut/newPlacedOff`,
 * `until: pointEstablished`): when the point is established, the machine's hold ends, and each bet
 * it held goes back to its own setting and defaults (a `workingChanged` to null, `by:
 * 'afterSevenOut'`). A player's own OFF stays. With `until: playerOn` (the presets) only a press
 * that sets bets ON ends it.
 */
export function afterSevenOutUntilPoint(
  state: TableState,
  step: RoundStep,
  cfg: MachineConfig,
): ReturnType<AfterRollRule> {
  const rule = cfg.working.afterSevenOut
  const held = heldOffOf(state)
  const ends = rule?.until === 'pointEstablished' && step.transition.kind === 'pointEstablished'
  if (!ends || held.length === 0) return { state, events: [] }
  const events: GameEvent[] = held.map((betId) => ({
    type: 'workingChanged',
    scope: 'bet',
    betId,
    working: null,
    by: 'afterSevenOut',
  }))
  return { state: { ...state, heldOff: [] }, events }
}

/**
 * Machine actions after a roll is settled and committed (rules spec §2.3 step 8): `state` is the
 * table after the roll, `step` the round step it took. Each returns the table and any events.
 */
export const AFTER_ROLL: readonly AfterRollRule[] = [layAutoOn, afterSevenOutUntilPoint]

/** Any 7: a seven-out, or a come-out natural of 7 (7 is always a natural). */
function isSeven(transition: RoundTransition): boolean {
  return transition.kind === 'sevenOut' || (transition.kind === 'natural' && transition.total === 7)
}

function isLay(cfg: MachineConfig, typeId: string): boolean {
  const type = cfg.catalog.get(typeId)
  return type?.family === 'numberVsSeven' && type.kind === 'lay'
}

/** OFF by a toggle: the bet's own setting, or the button for a type it covers. */
function switchedOff(bet: BetInstance, state: TableState, cfg: MachineConfig): boolean {
  if (bet.working !== null) return !bet.working
  return state.globalOff === true && cfg.working.toggle.types.includes(bet.typeId)
}

/** Sets each bet's own working setting where `to` says (undefined leaves it), with an event each. */
function switchBets(
  state: TableState,
  to: (bet: BetInstance) => boolean | undefined,
  by: 'layAutoOn',
): ReturnType<AfterRollRule> {
  const events: GameEvent[] = []
  const bets = state.bets.map((bet) => {
    const working = to(bet)
    if (working === undefined) return bet
    events.push({ type: 'workingChanged', scope: 'bet', betId: bet.id, working, by })
    return { ...bet, working }
  })
  return events.length === 0 ? { state, events } : { state: { ...state, bets }, events }
}
