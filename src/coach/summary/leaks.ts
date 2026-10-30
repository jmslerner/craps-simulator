import {
  Fraction,
  applyAction,
  cents,
  newTable,
  type Cents,
  type FamilyKey,
  type MachineConfig,
  type PointNumber,
  type TableState,
} from '../../engine/index.ts'
import { ExactError, type BetSpec } from '../../exact/index.ts'
import { alternatives } from '../advisors/alternatives.ts'

/**
 * Same-event switches for the session summary's leaks (plan §5.7: "leaks from sameEvent choices
 * only"). A leak is a decision made on a bet that has a strictly cheaper twin winning, losing and
 * pushing on exactly the same rolls, at the same stake — precisely what the coach's same-event
 * advice offers (`advisors/alternatives.ts`: `suggestAlternatives`' `sameEvent` candidates, the
 * 0.25 pp threshold of `policy.ts`, the events re-verified with `sameEvents`, and its rearm-none
 * lifetime fallback). Restructures (big 6 → place 6 where they differ, hard N → place N), sizing
 * and odds advice are information only and never leaks.
 *
 * The advice is asked for on a reference table — a fresh table of the machine, the stake's worth
 * of credit added — so a leak depends only on the bet, its number and its stake, never on how much
 * credit the player happened to hold when the decision was made (the exact analysis assumes enough
 * credit, plan §0 #24).
 */

/** A cheaper same-event bet for one (bet, number, stake). */
export interface SameEventSwitch {
  readonly from: BetSpec
  readonly to: BetSpec
  readonly amount: Cents
  /** Expected cents the switch saves per decision: the advice's `impact`. */
  readonly perDecision: Fraction
  /** Edge saved per unit risked (≥ the policy threshold). */
  readonly saving: Fraction
}

/** The families with same-event neighbours: number bets, hardways, one-roll bets, composites. */
export function mayHaveTwin(family: FamilyKey): boolean {
  return (
    family === 'numberVsSeven' ||
    family === 'hardway' ||
    family === 'oneRoll' ||
    family === 'composite'
  )
}

const MAX_REMEMBERED = 2_000
const remembered = new Map<string, SameEventSwitch | null>()

/**
 * The cheaper same-event bet the coach would switch `spec` at `amount` to, or null when there is
 * none (or the family has no same-event neighbours). Remembered per machine, bet, number and stake.
 */
export function sameEventSwitch(
  spec: BetSpec,
  amount: Cents,
  family: FamilyKey,
  cfg: MachineConfig,
): SameEventSwitch | null {
  if (!mayHaveTwin(family)) return null
  const key = `${cfg.configHash}|${spec.typeId}|${spec.number ?? '-'}|${amount}`
  const known = remembered.get(key)
  if (known !== undefined) return known
  const found = findSwitch(spec, amount, cfg)
  if (remembered.size >= MAX_REMEMBERED) {
    const oldest = remembered.keys().next()
    if (oldest.done !== true) remembered.delete(oldest.value)
  }
  remembered.set(key, found)
  return found
}

function findSwitch(spec: BetSpec, amount: Cents, cfg: MachineConfig): SameEventSwitch | null {
  let advice: ReturnType<typeof alternatives>
  try {
    advice = alternatives({ cfg, spec, amount, state: referenceTable(cfg, amount), betId: null })
  } catch (error) {
    if (error instanceof ExactError) return null
    throw error
  }
  const same = advice.find((item) => item.ruleId === 'same-event')
  if (same === undefined || same.saving === undefined) return null
  // The switch's own place action names the twin: its type and number.
  const place = same.fix?.actions.findLast((action) => action.type === 'place')
  if (place?.type !== 'place') return null
  if (same.impact.compare(Fraction.ZERO) <= 0) return null
  const to: BetSpec = { typeId: place.typeId, number: (place.number ?? null) as PointNumber | null }
  return { from: spec, to, amount, perDecision: same.impact, saving: same.saving }
}

/** A fresh table of the machine with the stake's worth of credit added: the advice's reference. */
function referenceTable(cfg: MachineConfig, amount: Cents): TableState {
  const fresh = newTable(cfg, 'session-summary-reference')
  const funded = applyAction(fresh, { type: 'deposit', amount: cents(amount * 2) }, cfg)
  return funded.ok ? funded.state : fresh
}
