import {
  Fraction,
  applyAction,
  heldOffOf,
  validateAction,
  workingStatus,
} from '../../engine/index.ts'
import type { Action, MachineConfig, TableState } from '../../engine/index.ts'
import { analyzeLayout, perHourAt } from '../../exact/index.ts'
import { coachCount, coachNumber, sourceOf } from '../numbers.ts'
import type { Advice, Advisor } from './advice.ts'
import { adviceId, spotLabel } from './advice.ts'

/**
 * The working advisor (plan §5.4): what is ON or OFF for the next roll and what a toggle does to
 * the hourly cost.
 *
 * - **working-off**: the inspected bet is OFF for this roll — it cannot win and cannot lose. The
 *   guide and coach never claim an OFF bet plays (plan §0 #18 lessons).
 * - **working-held**: bets are held OFF since the seven-out; "Set bets On" returns them to the
 *   machine defaults. That mapping — `setGlobalWorking(null)`, defaults rather than forced ON —
 *   has no config pointer, so the advice carries the coach's own assumed flag citing the rules
 *   spec (§13 M5/M6 → M9 hand-off).
 * - **working-cost**: on the come-out with working toggle-covered bets, the $/hour now against
 *   $/hour with bets off, both from `analyzeLayout` on the real and the dry-run table.
 */

/** The coach's own assumed flag for the Set-bets-On reading (no config pointer exists for it). */
export const SET_BETS_ON_ASSUMPTION =
  'rules-spec §9 #28: "Set bets On" returns covered bets to machine defaults, not forced ON'

export const working: Advisor = (input): Advice[] => {
  const { cfg, state } = input
  if (state === null) return []
  const out: Advice[] = []

  if (input.betId !== null) {
    const bet = state.bets.find((b) => b.id === input.betId)
    if (bet !== undefined && !workingStatus(bet, state, cfg).working) {
      const subject = { typeId: bet.typeId, number: bet.number, betId: bet.id }
      out.push({
        id: adviceId('working-off', subject),
        ruleId: 'working-off',
        severity: 'info',
        subject,
        templateId: 'working-off',
        numbers: {},
        words: { name: spotLabel(cfg, { typeId: bet.typeId, number: bet.number }) },
        impact: Fraction.ZERO,
      })
    }
  }

  const held = heldOffOf(state)
  if (held.length > 0) {
    const setOn: Action = { type: 'setGlobalWorking', off: null }
    if (validateAction(state, setOn, cfg) === null) {
      const subject = { typeId: input.spec.typeId, number: input.spec.number }
      out.push({
        id: adviceId('working-held', subject),
        ruleId: 'working-held',
        severity: 'tip',
        subject,
        templateId: 'working-held',
        numbers: {
          count: coachCount(
            Fraction.of(held.length),
            sourceOf('heldOffOf', { field: 'length' }, cfg),
          ),
        },
        words: {},
        impact: Fraction.ZERO,
        fix: { label: 'Set bets On', actions: [setOn] },
        assumed: [SET_BETS_ON_ASSUMPTION],
      })
    }
  }

  const cost = comeOutCost(state, cfg)
  if (cost !== null) out.push(cost)
  return out
}

/** The come-out $/hour with working bets against the same table with Bets Off. */
function comeOutCost(state: TableState, cfg: MachineConfig): Advice | null {
  if (state.round.phase.kind !== 'comeOut' || !cfg.working.toggle.global) return null
  if (state.globalOff === true || state.bets.length === 0) return null
  const action: Action = { type: 'setGlobalWorking', off: true }
  if (validateAction(state, action, cfg) !== null) return null
  const toggled = applyAction(state, action, cfg, { checkInvariants: false })
  if (!toggled.ok) return null
  const now = analyzeLayout(state, cfg)
  const then = analyzeLayout(toggled.state, cfg)
  if (now.perRoll.equals(then.perRoll)) return null
  const pace = cfg.pace.rollsPerHour
  const nowHour = perHourAt(now.perRoll, cfg).find((entry) => entry.at === pace)
  const thenHour = perHourAt(then.perRoll, cfg).find((entry) => entry.at === pace)
  if (nowHour === undefined || thenHour === undefined) return null
  const subject = { typeId: 'table', number: null } as const
  return {
    id: adviceId('working-cost', subject),
    ruleId: 'working-cost',
    severity: 'info',
    subject,
    templateId: 'working-cost',
    numbers: {
      nowHour: coachNumber(
        'perHour',
        nowHour.value,
        sourceOf('analyzeLayout', { at: pace, toggled: false }, cfg),
      ),
      thenHour: coachNumber(
        'perHour',
        thenHour.value,
        sourceOf('analyzeLayout', { at: pace, toggled: true }, cfg),
      ),
    },
    words: {},
    impact: Fraction.ZERO,
    fix: { label: 'Bets Off for the come-out', actions: [action] },
  }
}
