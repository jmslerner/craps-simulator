import { describe, expect, it } from 'vitest'
import { Fraction } from '../engine/core/rational.ts'
import {
  COOLDOWN_ROLLS,
  DISMISSALS_TO_BADGE,
  EMPTY_COACH_MEMORY,
  HIGH_EDGE_TOAST,
  QUIET_RELATIVE_SAVING,
  ROUNDING_MATERIAL_BREAKAGE,
  SAME_EVENT_MIN_SAVING,
  badgeVisibleIn,
  coachModeName,
  dismissAdvice,
  gate,
  gradeOf,
  markForFun,
  noteToast,
  retireAdvice,
  type CoachMemory,
  type GateItem,
  type GateSeverity,
} from './policy.ts'

describe('gradeOf', () => {
  it('grades edges at the plan §5.4 thresholds, inclusive at each bound', () => {
    expect(gradeOf(Fraction.of(0))).toBe('excellent')
    expect(gradeOf(Fraction.of(1, 200))).toBe('excellent') // exactly 0.5%
    expect(gradeOf(Fraction.of(1, 199))).toBe('good')
    expect(gradeOf(Fraction.of(1, 66))).toBe('good') // place 6/8
    expect(gradeOf(Fraction.of(1, 50))).toBe('good') // exactly 2%
    expect(gradeOf(Fraction.of(1, 21))).toBe('fair') // buy, upfront re-collected
    expect(gradeOf(Fraction.of(373, 6930))).toBe('fair') // crapless pass
    expect(gradeOf(Fraction.of(11, 200))).toBe('fair') // exactly 5.5%
    expect(gradeOf(Fraction.of(1, 18))).toBe('poor') // the 2:1 field
    expect(gradeOf(Fraction.of(1, 10))).toBe('poor') // exactly 10%
    expect(gradeOf(Fraction.of(1, 9))).toBe('awful')
    expect(gradeOf(Fraction.of(1, 6))).toBe('awful')
  })
})

describe('modes (plan §5.6)', () => {
  it('maps the stored setting onto the plan names', () => {
    expect(coachModeName('off')).toBe('off')
    expect(coachModeName('hints')).toBe('quiet')
    expect(coachModeName('full')).toBe('coach')
  })

  it('badges: hidden when off, poor/awful only in quiet, all in coach', () => {
    expect(badgeVisibleIn('off', 'awful')).toBe(false)
    expect(badgeVisibleIn('quiet', 'good')).toBe(false)
    expect(badgeVisibleIn('quiet', 'fair')).toBe(false)
    expect(badgeVisibleIn('quiet', 'poor')).toBe(true)
    expect(badgeVisibleIn('quiet', 'awful')).toBe(true)
    expect(badgeVisibleIn('coach', 'excellent')).toBe(true)
    expect(badgeVisibleIn('coach', 'awful')).toBe(true)
  })
})

// --- The gate fixture (plan §10 M9c acceptance): expected toasts per mode. ---

function advice(
  id: string,
  ruleId: string,
  severity: GateSeverity,
  over: Partial<GateItem> = {},
): GateItem {
  return {
    id,
    ruleId,
    severity,
    subject: { typeId: id.split('|')[1] ?? 'place' },
    impact: Fraction.ZERO,
    ...over,
  }
}

/** A sameEvent tip: place 4 → buy 4 style, edge 6.67%, saving 4.67 pp (well over both bars). */
const SAME_EVENT = advice('same-event|place', 'same-event', 'tip', {
  edge: Fraction.of(1, 15),
  saving: Fraction.of(7, 150),
  impact: Fraction.of(100),
})

/** A sameEvent tip that clears 0.25 pp but not quiet's 25% relative bar (saving/edge = 10%). */
const SMALL_SAVING = advice('same-event|lay', 'same-event', 'tip', {
  edge: Fraction.of(1, 20),
  saving: Fraction.of(1, 200),
  impact: Fraction.of(20),
})

/** An awful one-roll bet: edge 1/6, over both high-edge bars. */
const HIGH_EDGE = advice('edge-warning|any7', 'edge-warning', 'warn', {
  edge: Fraction.of(1, 6),
  impact: Fraction.of(250),
})

/** A fair bet's info warning: under both toast bars. */
const MILD_EDGE = advice('edge-warning|pass', 'edge-warning', 'info', {
  edge: Fraction.of(373, 6930),
  impact: Fraction.of(27),
})

/** A rounding tip (the $5 place 6). */
const ROUNDING = advice('rounding|place6', 'rounding', 'tip', {
  edge: Fraction.of(17, 1100),
  saving: Fraction.of(1, 150),
  impact: Fraction.of(4),
})

/** Informational context: never a toast class. */
const CONTEXT = advice('variant-context|pass', 'variant-context', 'info')

describe('the gate (plan §5.6): toasts per mode, budget, cooldown, dismissals, for fun', () => {
  const ROLL = 10

  it('off mode hides everything', () => {
    const result = gate([SAME_EVENT, HIGH_EDGE, ROUNDING, CONTEXT], 'off', EMPTY_COACH_MEMORY, ROLL)
    expect(result.toast).toBeNull()
    expect(result.feed).toHaveLength(0)
    expect(result.badge).toHaveLength(0)
    expect(result.hidden).toHaveLength(4)
  })

  it('coach mode: one toast per window, ranked by severity then $ impact; the rest feed', () => {
    const result = gate(
      [CONTEXT, SAME_EVENT, HIGH_EDGE, ROUNDING, MILD_EDGE],
      'coach',
      EMPTY_COACH_MEMORY,
      ROLL,
    )
    expect(result.toast?.id).toBe(HIGH_EDGE.id) // warn beats tip
    expect(result.feed.map((item) => item.id)).toStrictEqual([
      SAME_EVENT.id, // tip, $1.00/decision
      ROUNDING.id, // tip, smaller impact
      MILD_EDGE.id, // info below the 4% bar
      CONTEXT.id, // info, never toasts
    ])
    expect(result.hidden).toHaveLength(0)
  })

  it('quiet mode: only the strong sameEvent and the 9%+ edge toast; context is silent', () => {
    const strong = gate([SAME_EVENT, CONTEXT, MILD_EDGE], 'quiet', EMPTY_COACH_MEMORY, ROLL)
    expect(strong.toast?.id).toBe(SAME_EVENT.id) // saving 4.67pp ≥ 25% of 6.67%
    expect(strong.hidden.map((i) => i.id)).toContain(CONTEXT.id)
    expect(strong.hidden.map((i) => i.id)).toContain(MILD_EDGE.id)

    const weak = gate([SMALL_SAVING], 'quiet', EMPTY_COACH_MEMORY, ROLL)
    expect(weak.toast).toBeNull() // 10% relative saving is under the 25% bar
    expect(weak.hidden).toHaveLength(1)

    const high = gate([HIGH_EDGE], 'quiet', EMPTY_COACH_MEMORY, ROLL)
    expect(high.toast?.id).toBe(HIGH_EDGE.id) // 16.7% ≥ 9%

    const rounding = gate([ROUNDING], 'quiet', EMPTY_COACH_MEMORY, ROLL)
    expect(rounding.toast).toBeNull() // rounding tips are badges in quiet
    expect(rounding.badge.map((i) => i.id)).toStrictEqual([ROUNDING.id])
  })

  it('budget: a window that already toasted routes every candidate to the feed', () => {
    const memory = noteToast(EMPTY_COACH_MEMORY, 'something|else', ROLL)
    const result = gate([SAME_EVENT, HIGH_EDGE], 'coach', memory, ROLL)
    expect(result.toast).toBeNull()
    expect(result.feed.map((i) => i.id)).toStrictEqual([HIGH_EDGE.id, SAME_EVENT.id])
    // The next betting window gets its budget back.
    expect(gate([SAME_EVENT], 'coach', memory, ROLL + 1).toast?.id).toBe(SAME_EVENT.id)
  })

  it(`cooldown: a toasted id stays off the toast surface for ${COOLDOWN_ROLLS} rolls`, () => {
    const shown = noteToast(EMPTY_COACH_MEMORY, SAME_EVENT.id, ROLL)
    const soon = gate([SAME_EVENT], 'coach', shown, ROLL + COOLDOWN_ROLLS - 1)
    expect(soon.toast).toBeNull()
    expect(soon.feed.map((i) => i.id)).toStrictEqual([SAME_EVENT.id])
    const later = gate([SAME_EVENT], 'coach', shown, ROLL + COOLDOWN_ROLLS)
    expect(later.toast?.id).toBe(SAME_EVENT.id)
  })

  it(`dismissals: ${DISMISSALS_TO_BADGE} dismissals demote that advice to badge-only`, () => {
    const once = dismissAdvice(EMPTY_COACH_MEMORY, SAME_EVENT.id)
    expect(gate([SAME_EVENT], 'coach', once, ROLL).toast?.id).toBe(SAME_EVENT.id)
    const twice = dismissAdvice(once, SAME_EVENT.id)
    const result = gate([SAME_EVENT], 'coach', twice, ROLL)
    expect(result.toast).toBeNull()
    expect(result.badge.map((i) => i.id)).toStrictEqual([SAME_EVENT.id])
  })

  it('retireAdvice ("Don\'t show", said once) demotes to badge-only at once and is idempotent', () => {
    const retired = retireAdvice(EMPTY_COACH_MEMORY, SAME_EVENT.id)
    expect(retired.dismissed[SAME_EVENT.id]).toBe(DISMISSALS_TO_BADGE)
    const result = gate([SAME_EVENT], 'coach', retired, ROLL)
    expect(result.toast).toBeNull()
    expect(result.badge.map((i) => i.id)).toStrictEqual([SAME_EVENT.id])
    // A soft dismissal before it, or a retire after it, never lowers the count.
    expect(retireAdvice(dismissAdvice(EMPTY_COACH_MEMORY, SAME_EVENT.id), SAME_EVENT.id)).toEqual(
      retired,
    )
    expect(retireAdvice(retired, SAME_EVENT.id)).toBe(retired)
    const thrice = dismissAdvice(retired, SAME_EVENT.id)
    expect(retireAdvice(thrice, SAME_EVENT.id)).toBe(thrice)
  })

  it('"it\'s for fun" silences the bet type in every mode but leaves other types alone', () => {
    const memory = markForFun(EMPTY_COACH_MEMORY, 'place')
    for (const mode of ['quiet', 'coach'] as const) {
      const result = gate([SAME_EVENT, HIGH_EDGE], mode, memory, ROLL)
      expect(result.hidden.map((i) => i.id)).toContain(SAME_EVENT.id) // subject typeId 'place'
      expect(result.toast?.id).toBe(HIGH_EDGE.id)
    }
  })

  it('once-only advice (edge warning per bet lifecycle) retires to badge after it has shown', () => {
    const once = { ...HIGH_EDGE, once: true }
    const shown = noteToast(EMPTY_COACH_MEMORY, once.id, 2)
    const result = gate([once], 'coach', shown, 2 + COOLDOWN_ROLLS + 50)
    expect(result.toast).toBeNull()
    expect(result.badge.map((i) => i.id)).toStrictEqual([once.id])
  })

  it('is pure: identical inputs give identical routing and never touch the memory', () => {
    const memory: CoachMemory = noteToast(dismissAdvice(EMPTY_COACH_MEMORY, 'x'), 'y', 3)
    const snapshot = JSON.stringify(memory)
    const items = [SAME_EVENT, HIGH_EDGE, ROUNDING, CONTEXT, MILD_EDGE]
    const first = gate(items, 'coach', memory, ROLL)
    const second = gate(items, 'coach', memory, ROLL)
    expect(second).toStrictEqual(first)
    expect(JSON.stringify(memory)).toBe(snapshot)
  })

  it('thresholds are the published policy values', () => {
    expect(SAME_EVENT_MIN_SAVING.equals(Fraction.of(1, 400))).toBe(true) // 0.25 pp
    expect(QUIET_RELATIVE_SAVING.equals(Fraction.of(1, 4))).toBe(true) // 25 %
    expect(HIGH_EDGE_TOAST.coach.equals(Fraction.of(1, 25))).toBe(true) // 4 %
    expect(HIGH_EDGE_TOAST.quiet.equals(Fraction.of(9, 100))).toBe(true) // 9 %
    expect(ROUNDING_MATERIAL_BREAKAGE.equals(Fraction.of(1, 10_000))).toBe(true) // 0.01 pp
  })
})
