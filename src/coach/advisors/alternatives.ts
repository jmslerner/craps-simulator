import { cents, validateAction } from '../../engine/index.ts'
import { Fraction, formatCents } from '../../engine/index.ts'
import type { Action } from '../../engine/index.ts'
import {
  ExactError,
  analyzeBet,
  legalAmounts,
  sameEvents,
  suggestAlternatives,
} from '../../exact/index.ts'
import type { Alternative, BetAnalysis, BetSpec } from '../../exact/index.ts'
import { coachMoney, coachPercent, sourceOf } from '../numbers.ts'
import { SAME_EVENT_MIN_SAVING } from '../policy.ts'
import type { Advice, Advisor, CoachInput } from './advice.ts'
import { adviceId, spotLabel } from './advice.ts'
import { paysExactlyAt } from './exactness.ts'

/**
 * Cheaper ways to make the bet (plan §5.4 sameEvent and restructure; §10 M9c):
 *
 * - **same-event**: a strictly cheaper bet that wins, loses and pushes on identical rolls, at the
 *   same stake, saving at least the `policy.ts` threshold (0.25 pp) — with a one-tap switch. The
 *   claim is defended twice here: the switch batch is dry-run through `validateAction` on the
 *   player's table, and the identical-events claim is re-verified with `sameEvents`, both again on
 *   top of what `suggestAlternatives` already checked. `suggestAlternatives` compares first-decision
 *   dollars, which correctly refuses the $15 buy-vs-place "tie" (rules spec §4.3) but cannot see a
 *   bet whose up-front vig is **never re-collected**: buy 5 with `rearm: none` loses more on its
 *   first decision yet less over the lifecycle (the honest long-run figure, plan §5.1 — the §5.4
 *   flip's third leg). For exactly that case a fallback compares lifecycle dollars on the same
 *   event stream, and builds and dry-runs its own switch batch.
 * - **sizing**: the same bet at a nearby stake the machine pays more exactly, with a one-tap
 *   resize when a bet is on the table. Left out when the stake's problem is breakage — the
 *   rounding advice (amountEfficiency) owns that case, so the inspector says it once.
 * - **restructure**: information only (a different exposure), never counted as a leak and never
 *   given a fix button.
 *
 * Needs the table: alternatives are advice about switching money already routed somewhere.
 */

export const alternatives: Advisor = (input): Advice[] => {
  const { cfg, spec, amount, state } = input
  if (state === null) return []
  const own = analyzeBet(spec, amount, 'typical', cfg)
  const list = suggestAlternatives(state, spec, amount, cfg)
  const out: Advice[] = []
  let sawSameEvent = false
  let sawSizing = false
  let sawRestructure = false
  for (const alt of list) {
    if (alt.comparability === 'sameEvent' && !sawSameEvent) {
      const advice = sameEventAdvice(input, own.edge, alt)
      if (advice !== null) {
        out.push(advice)
        sawSameEvent = true
      }
    } else if (alt.comparability === 'sizing' && !sawSizing) {
      // The template says the named stake "pays exactly", so only such a stake is offered: exact's
      // sizing scan returns the nearest CHEAPER stakes, which a commission minimum can make
      // inexact ones (M9 audit; the min-vig advice covers that trap in its own words).
      if (own.breakage.compare(Fraction.ZERO) <= 0 && paysExactlyAt(spec, alt.amount, cfg)) {
        out.push(sizingAdvice(input, own.edge, alt))
        sawSizing = true
      }
    } else if (alt.comparability === 'restructure' && !sawRestructure) {
      out.push(restructureAdvice(input, own.edge, alt))
      sawRestructure = true
    }
  }
  if (!sawSameEvent) {
    const lifetime = lifetimeSameEvent(input, own)
    if (lifetime !== null) out.push(lifetime)
  }
  return out
}

/**
 * The rearm-none fallback: a same-events number bet whose lifecycle edge and lifecycle dollars are
 * both lower at this stake, though its first decision (up-front vig) costs more. Same event stream
 * ⇒ same decision count, so lifecycle loss is compared like for like.
 */
function lifetimeSameEvent(input: CoachInput, own: BetAnalysis): Advice | null {
  const { cfg, spec, amount, state } = input
  if (state === null || spec.number === null) return null
  for (const type of cfg.catalog.values()) {
    if (type.family !== 'numberVsSeven' || type.typeId === spec.typeId) continue
    if (!type.numbers.some((n) => n === spec.number)) continue
    const other: BetSpec = { typeId: type.typeId, number: spec.number }
    if (!legalAmounts(other, cfg, { from: amount, to: amount }).includes(amount)) continue
    let theirs: BetAnalysis
    try {
      theirs = analyzeBet(other, amount, 'typical', cfg)
    } catch (error) {
      if (error instanceof ExactError) continue
      throw error
    }
    const saving = own.edge.sub(theirs.edge)
    if (saving.compare(SAME_EVENT_MIN_SAVING) < 0) continue
    const lifeSaving = own.lifecycle.loss.sub(theirs.lifecycle.loss)
    if (lifeSaving.isZero() || lifeSaving.isNegative()) continue
    if (!sameEvents(spec, other, 'typical', cfg)) continue
    const existing = state.bets.find((b) => b.typeId === spec.typeId && b.number === spec.number)
    const actions: Action[] = [
      ...(existing === undefined
        ? []
        : [{ type: 'setAmount', betId: existing.id, amount: cents(0) } as Action]),
      { type: 'place', typeId: other.typeId, number: spec.number, amount },
    ]
    if (validateAction(state, { type: 'batch', actions }, cfg) !== null) continue
    // Per decision over the lifecycle: the honest long-run dollars (plan §5.1).
    const perDecision = lifeSaving.div(own.lifecycle.decisions)
    const synthetic: Alternative = {
      comparability: 'sameEvent',
      spec: other,
      amount,
      edge: theirs.edge,
      saving,
      lossPerDecision: theirs.lossPerDecision,
      savingPerDecision: perDecision,
      actions,
    }
    return sameEventAdvice(input, own.edge, synthetic, 'lifetimeSameEvent')
  }
  return null
}

function sameEventAdvice(
  input: CoachInput,
  ownEdge: Fraction,
  alt: Alternative,
  sourceFn: 'suggestAlternatives' | 'lifetimeSameEvent' = 'suggestAlternatives',
): Advice | null {
  const { cfg, spec, amount, state } = input
  if (state === null || alt.actions.length === 0) return null
  if (alt.saving.compare(SAME_EVENT_MIN_SAVING) < 0) return null
  // Re-verify the two claims the toast makes (plan §5.8): same events, and a legal one-tap switch.
  if (!sameEvents(spec, alt.spec, 'typical', cfg)) return null
  if (validateAction(state, { type: 'batch', actions: [...alt.actions] }, cfg) !== null) return null
  const subject = {
    typeId: spec.typeId,
    number: spec.number,
    ...(input.betId === null ? {} : { betId: input.betId }),
  }
  const altSource = sourceOf(sourceFn, { spec, amount, alt: alt.spec, field: 'sameEvent' }, cfg)
  return {
    id: adviceId('same-event', subject),
    ruleId: 'same-event',
    severity: 'tip',
    subject,
    templateId: 'same-event',
    numbers: {
      ownEdge: coachPercent(ownEdge, sourceOf('analyzeBet', { spec, amount }, cfg)),
      altEdge: coachPercent(alt.edge, sourceOf('analyzeBet', { spec: alt.spec, amount }, cfg)),
      saving: coachPercent(alt.saving, altSource),
      savingPerDecision: coachMoney(alt.savingPerDecision ?? Fraction.ZERO, altSource),
    },
    words: { from: spotLabel(cfg, spec), to: spotLabel(cfg, alt.spec) },
    impact: alt.savingPerDecision ?? Fraction.ZERO,
    edge: ownEdge,
    saving: alt.saving,
    fix: { label: `Switch to ${spotLabel(cfg, alt.spec)}`, actions: alt.actions },
  }
}

function sizingAdvice(input: CoachInput, ownEdge: Fraction, alt: Alternative): Advice {
  const { cfg, spec, amount, state } = input
  const subject = {
    typeId: spec.typeId,
    number: spec.number,
    ...(input.betId === null ? {} : { betId: input.betId }),
  }
  const source = sourceOf('suggestAlternatives', { spec, amount, field: 'sizing' }, cfg)
  const fixable =
    state !== null &&
    alt.actions.length > 0 &&
    validateAction(state, { type: 'batch', actions: [...alt.actions] }, cfg) === null
  return {
    id: adviceId('sizing', subject),
    ruleId: 'sizing',
    severity: 'tip',
    subject,
    templateId: 'sizing',
    numbers: {
      stake: coachMoney(amount, source),
      edge: coachPercent(ownEdge, sourceOf('analyzeBet', { spec, amount }, cfg)),
      betterAmount: coachMoney(alt.amount, source),
      betterEdge: coachPercent(alt.edge, sourceOf('analyzeBet', { spec, amount: alt.amount }, cfg)),
    },
    words: { name: spotLabel(cfg, spec) },
    impact: Fraction.ZERO,
    edge: ownEdge,
    saving: alt.saving,
    ...(fixable
      ? { fix: { label: `Make it ${formatCents(alt.amount)}`, actions: alt.actions } }
      : {}),
  }
}

function restructureAdvice(input: CoachInput, ownEdge: Fraction, alt: Alternative): Advice {
  const { cfg, spec, amount } = input
  const subject = {
    typeId: spec.typeId,
    number: spec.number,
    ...(input.betId === null ? {} : { betId: input.betId }),
  }
  const sameSpec = alt.spec.typeId === spec.typeId && alt.spec.number === spec.number
  const to = sameSpec
    ? `a smaller ${spotLabel(cfg, spec)} with full odds`
    : spotLabel(cfg, alt.spec)
  return {
    id: adviceId('restructure', subject),
    ruleId: 'restructure',
    severity: 'info',
    subject,
    templateId: 'restructure',
    numbers: {
      ownEdge: coachPercent(ownEdge, sourceOf('analyzeBet', { spec, amount }, cfg)),
      altEdge: coachPercent(
        alt.edge,
        sameSpec
          ? sourceOf('combinedEdge', { line: spec, flat: alt.amount, odds: 'max' }, cfg)
          : sourceOf('analyzeBet', { spec: alt.spec, amount: alt.amount }, cfg),
      ),
    },
    words: { from: spotLabel(cfg, spec), to },
    impact: Fraction.ZERO,
    edge: ownEdge,
    saving: alt.saving,
  }
}
