import type { MachineConfig } from '../config/compile.ts'
import { heldOffOf, type TableState } from '../table/state.ts'
import { DEFAULT_WORKING, FORCED_WORKING, type WorkingInput } from './policies.ts'
import { requireType } from './registry.ts'
import type { BetInstance } from './types.ts'

/**
 * Whether a bet works on the next roll (rules spec §2.3 step 2, §2.4), and why. It is pure and
 * reads only the table and the config, so the UI, the exact solver and the reference differential
 * can ask it outside a roll. Precedence, highest first, with the `source` each step reports:
 *
 * 1. `always`: bets that always work: line flats, come and don't come points, one-roll bets,
 *    composites and side bets (a family that is not `toggleable`).
 * 2. `machine`: machine rules above every toggle (`FORCED_WORKING`). Shoot To Win switches its
 *    `/comeOut/autoOff` types OFF for the come-out roll (carried come odds, place, buy, hardway and
 *    big chips; new ones too [A]), and the player cannot turn them back ON (§9 #7). With a point on
 *    the rule is silent, so they work again: "automatically turned ON" (CW §4).
 * 3. `bet`: the bet's own setting (`bet.working`). The player sets it where
 *    `/workingToggle/perBet` allows, and Interblock's machine sets a lay ON after a point is made or
 *    a 7 (`/layAutoOn`). A press of the global button clears it for the types the button covers.
 * 4. `afterSevenOut`: Interblock's hold on a place or buy bet placed right after a seven-out
 *    (`/afterSevenOut/newPlacedOff`, `state.heldOff`): OFF until Set bets On. It outranks the
 *    button, so a Set bets On pressed before the seven-out does not reach it (§0.2 #4, §9 #6), and
 *    it yields to the bet's own setting: where per-bet toggles exist, ON turns the bet ON and the
 *    default (null) leaves it held (§9 #29).
 * 5. `button`: the machine's ON/OFF button (`state.globalOff`), for the types in
 *    `/workingToggle/types`. Its `false` means ON and overrides the defaults, so come odds work on
 *    the come-out after "All On". Interblock's Set bets On is `null` (plan §0 #21, §9 #28): the
 *    defaults, so come odds stay OFF on the come-out.
 * 6. `machineDefault`: machine defaults that a toggle overrides (`DEFAULT_WORKING`; none today).
 * 7. `default`: the type's own default for the phase (`defaultWorking`): everything works with a
 *    point on; on the come-out, per `/catalog/<t>/comeOutDefault`.
 */
export type WorkingSource =
  'always' | 'machine' | 'bet' | 'afterSevenOut' | 'button' | 'machineDefault' | 'default'

export interface WorkingStatus {
  readonly working: boolean
  readonly source: WorkingSource
}

/** Whether `bet` works on the next roll, and which step of the precedence decided it. */
export function workingStatus(
  bet: BetInstance,
  state: TableState,
  cfg: MachineConfig,
): WorkingStatus {
  const { family, type } = requireType(cfg, bet.typeId)
  if (!family.toggleable) return { working: true, source: 'always' }
  const input: WorkingInput = {
    bet,
    type,
    state,
    cfg,
    phase: state.round.phase,
    carried: bet.placedAtRoll < state.round.rollIndex,
  }
  const forced = firstSay(FORCED_WORKING, input)
  if (forced !== null) return { working: forced, source: 'machine' }
  if (bet.working !== null) return { working: bet.working, source: 'bet' }
  if (heldOffOf(state).includes(bet.id)) return { working: false, source: 'afterSevenOut' }
  if (state.globalOff !== null && cfg.working.toggle.types.includes(bet.typeId)) {
    return { working: !state.globalOff, source: 'button' }
  }
  const byDefault = firstSay(DEFAULT_WORKING, input)
  if (byDefault !== null) return { working: byDefault, source: 'machineDefault' }
  return { working: family.defaultWorking(state.round.phase, type, cfg), source: 'default' }
}

/** Whether `bet` works on the next roll (`workingStatus` without the reason). */
export function effectiveWorking(bet: BetInstance, state: TableState, cfg: MachineConfig): boolean {
  return workingStatus(bet, state, cfg).working
}

/**
 * Whether the player may switch this one bet ON and OFF: its family allows it now, and the machine
 * has per-bet toggles covering its type (`/workingToggle/perBet`, `/workingToggle/types`).
 */
export function canToggle(bet: BetInstance, state: TableState, cfg: MachineConfig): boolean {
  const { family, type } = requireType(cfg, bet.typeId)
  const { toggle } = cfg.working
  return (
    family.toggleable &&
    family.mutability(bet, state, type, cfg).toggle &&
    toggle.perBet &&
    toggle.types.includes(bet.typeId)
  )
}

function firstSay(
  rules: readonly ((input: WorkingInput) => boolean | null)[],
  input: WorkingInput,
): boolean | null {
  for (const rule of rules) {
    const say = rule(input)
    if (say !== null) return say
  }
  return null
}
