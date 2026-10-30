import { Fraction } from '../engine/index.ts'
import type { Grade } from './types.ts'

/**
 * The coach's editable thresholds, modes and anti-nag gate (plan §5.4, §5.6; §10 M9c). These are
 * policy, not machine facts: they grade and route computed numbers, they never produce one. The
 * gate is pure — advice in, surfaces out — and **it never blocks a bet**: nothing here can refuse,
 * delay or change an action; the engine alone answers those.
 */

/** Edge grade bounds (edge ≤ bound), checked in order; above the last bound is `awful`. */
export const GRADE_BOUNDS: readonly { readonly grade: Grade; readonly atMost: Fraction }[] = [
  { grade: 'excellent', atMost: Fraction.of(1, 200) }, // 0.5%
  { grade: 'good', atMost: Fraction.of(1, 50) }, // 2%
  { grade: 'fair', atMost: Fraction.of(11, 200) }, // 5.5%
  { grade: 'poor', atMost: Fraction.of(1, 10) }, // 10%
]

/** How many times each teachable moment is shown before it retires (plan §5.4, §5.6: first 3). */
export const MOMENT_SHOWN_COUNT = 3

/** The grade of a per-decision edge (plan §5.4 edgeWarning). */
export function gradeOf(edge: Fraction): Grade {
  for (const { grade, atMost } of GRADE_BOUNDS) {
    if (edge.compare(atMost) <= 0) return grade
  }
  return 'awful'
}

// ---------------------------------------------------------------------------------------------
// Modes (plan §5.6): the stored setting is 'off' | 'hints' | 'full'; the plan's names map onto it.

export type CoachModeName = 'off' | 'quiet' | 'coach'

/** The plan's mode for the persisted `settingsStore.coachMode` value. */
export function coachModeName(setting: 'off' | 'hints' | 'full'): CoachModeName {
  switch (setting) {
    case 'off':
      return 'off'
    case 'hints':
      return 'quiet'
    case 'full':
      return 'coach'
  }
}

/** Zone edge badges per mode: hidden / poor & awful only / all (plan §5.6 table). */
export function badgeVisibleIn(mode: CoachModeName, grade: Grade): boolean {
  if (mode === 'off') return false
  if (mode === 'quiet') return grade === 'poor' || grade === 'awful'
  return true
}

// ---------------------------------------------------------------------------------------------
// Thresholds (plan §5.4, §5.6). The 0.25 pp and 25 % sameEvent thresholds live here (§13 row).

/** A sameEvent switch is offered at all only when it saves at least 0.25 pp per unit risked. */
export const SAME_EVENT_MIN_SAVING: Fraction = Fraction.of(1, 400)

/** In quiet mode a sameEvent switch toasts only when it cuts at least 25 % of the bet's edge. */
export const QUIET_RELATIVE_SAVING: Fraction = Fraction.of(1, 4)

/** The high-edge toast fires from these edges up (plan §5.6: quiet 9 %, coach 4 %). */
export const HIGH_EDGE_TOAST: Readonly<Record<'quiet' | 'coach', Fraction>> = {
  quiet: Fraction.of(9, 100),
  coach: Fraction.of(1, 25),
}

/** At most one toast per betting window; the rest go to the feed (plan §5.6). */
export const TOAST_BUDGET_PER_WINDOW = 1

/** A (rule, bet) pair that toasted stays off the toast surface for this many rolls. */
export const COOLDOWN_ROLLS = 20

/** This many dismissals demote an advice to badge-only. */
export const DISMISSALS_TO_BADGE = 2

/**
 * A rounding tip needs breakage of at least this share of the stake per decision (0.01 pp). The
 * coach prints percents to two decimals, so a smaller shave would show the same figure as paid and
 * unrounded ("1.52% against 1.52%") and teach nothing; two values at least 0.01 pp apart always
 * print differently under half-away rounding. The $10,000 place 6 on a $5 machine loses ⅔¢ a win
 * (0.00003 pp) and stays silent; the $5 place 6 on a penny machine (0.03 pp) does not.
 */
export const ROUNDING_MATERIAL_BREAKAGE: Fraction = Fraction.of(1, 10_000)

// ---------------------------------------------------------------------------------------------
// Memory: what the player has seen, dismissed and silenced. Plain JSON, updated by pure helpers.

export interface CoachMemory {
  /** Advice id → the roll index its last toast was shown at. */
  readonly shownAt: Readonly<Record<string, number>>
  /** Advice id → how many times the player dismissed it. */
  readonly dismissed: Readonly<Record<string, number>>
  /** Bet types the player marked "it's for fun": silenced, still counted in the summary (M13). */
  readonly forFun: readonly string[]
  /** The betting window (roll index) that already used its toast budget; null before the first. */
  readonly lastToastRoll: number | null
}

export const EMPTY_COACH_MEMORY: CoachMemory = Object.freeze({
  shownAt: Object.freeze({}),
  dismissed: Object.freeze({}),
  forFun: Object.freeze([] as string[]),
  lastToastRoll: null,
})

/** Records that `id`'s toast was shown in the betting window before roll `rollIndex`. */
export function noteToast(memory: CoachMemory, id: string, rollIndex: number): CoachMemory {
  return {
    ...memory,
    shownAt: { ...memory.shownAt, [id]: rollIndex },
    lastToastRoll: rollIndex,
  }
}

/** One more dismissal of `id`; at `DISMISSALS_TO_BADGE` the gate demotes it to badge-only. */
export function dismissAdvice(memory: CoachMemory, id: string): CoachMemory {
  return {
    ...memory,
    dismissed: { ...memory.dismissed, [id]: (memory.dismissed[id] ?? 0) + 1 },
  }
}

/**
 * "Don't show this advice again", said once: retires `id` to badge-only at once by counting it as
 * `DISMISSALS_TO_BADGE` dismissals. A surface whose button promises that (the inspector's) calls
 * this, so one tap does what its label says; `dismissAdvice` stays the soft count for a toast's
 * close control.
 */
export function retireAdvice(memory: CoachMemory, id: string): CoachMemory {
  if ((memory.dismissed[id] ?? 0) >= DISMISSALS_TO_BADGE) return memory
  return { ...memory, dismissed: { ...memory.dismissed, [id]: DISMISSALS_TO_BADGE } }
}

/** Silences a bet type ("it's for fun"); the session summary still counts it (plan §5.6). */
export function markForFun(memory: CoachMemory, typeId: string): CoachMemory {
  if (memory.forFun.includes(typeId)) return memory
  return { ...memory, forFun: [...memory.forFun, typeId] }
}

// ---------------------------------------------------------------------------------------------
// The gate (plan §5.6): pure routing of advice to surfaces. It takes advice structurally, so it
// depends on no advisor code; `coach/advisors/advice.ts`'s `Advice` satisfies `GateItem`.

export type GateSeverity = 'info' | 'tip' | 'warn' | 'critical'

export interface GateItem {
  readonly id: string
  readonly ruleId: string
  readonly severity: GateSeverity
  readonly subject: { readonly typeId: string }
  /** Expected cents per decision the advice is worth, for ranking (severity × $ impact). */
  readonly impact: Fraction
  readonly edge?: Fraction
  readonly saving?: Fraction
  readonly once?: boolean
}

export type GateSurface = 'toast' | 'feed' | 'badge' | 'hidden'

export interface GateResult<T extends GateItem> {
  /** The one advice this betting window toasts; null when nothing qualifies or the budget is spent. */
  readonly toast: T | null
  /** Advice worth reading that did not toast (budget, cooldown, below-toast info), ranked. */
  readonly feed: readonly T[]
  /** Advice demoted to badge-only (two dismissals, already-shown once-only advice, quiet tips). */
  readonly badge: readonly T[]
  /** Advice the mode or the player silenced. */
  readonly hidden: readonly T[]
}

const SEVERITY_RANK: Readonly<Record<GateSeverity, number>> = {
  critical: 3,
  warn: 2,
  tip: 1,
  info: 0,
}

/** Which toast class a rule belongs to (plan §5.6 mode table); null never toasts. */
function toastClass(ruleId: string): 'sameEvent' | 'highEdge' | 'rounding' | null {
  switch (ruleId) {
    case 'same-event':
      return 'sameEvent'
    case 'edge-warning':
      return 'highEdge'
    case 'rounding':
    case 'min-vig':
      return 'rounding'
    default:
      return null
  }
}

/**
 * Routes `items` to surfaces for `mode` at the betting window before roll `rollIndex`:
 * - **off** hides everything;
 * - **"it's for fun"** hides that bet type;
 * - two **dismissals** demote to badge-only;
 * - per-class mode thresholds decide toast-worthiness (sameEvent 0.25 pp always, plus 25 % of the
 *   bet's edge in quiet; high edge ≥ 4 % coach / 9 % quiet; rounding and min-vig tips toast in
 *   coach mode and badge in quiet);
 * - a **cooldown** keeps a toasted id off the toast surface for `COOLDOWN_ROLLS` rolls, and a
 *   `once` advice that has shown retires to badge;
 * - the **budget** allows one toast per betting window (`memory.lastToastRoll`); the rest rank
 *   into the feed by severity, then $ impact.
 *
 * The gate never blocks, changes or delays a bet: it returns the same advice it was given,
 * routed. Callers record a shown toast with `noteToast`; the gate itself changes no memory.
 */
export function gate<T extends GateItem>(
  items: readonly T[],
  mode: CoachModeName,
  memory: CoachMemory,
  rollIndex: number,
): GateResult<T> {
  const feed: T[] = []
  const badge: T[] = []
  const hidden: T[] = []
  const candidates: T[] = []

  for (const item of items) {
    if (mode === 'off') {
      hidden.push(item)
      continue
    }
    if (memory.forFun.includes(item.subject.typeId)) {
      hidden.push(item)
      continue
    }
    if ((memory.dismissed[item.id] ?? 0) >= DISMISSALS_TO_BADGE) {
      badge.push(item)
      continue
    }
    const route = routeFor(item, mode)
    if (route === 'toast') {
      const shownAt = memory.shownAt[item.id]
      if (item.once === true && shownAt !== undefined) {
        badge.push(item)
      } else if (shownAt !== undefined && rollIndex - shownAt < COOLDOWN_ROLLS) {
        feed.push(item)
      } else {
        candidates.push(item)
      }
    } else if (route === 'feed') {
      feed.push(item)
    } else if (route === 'badge') {
      badge.push(item)
    } else {
      hidden.push(item)
    }
  }

  candidates.sort(rank)
  const budgetSpent = memory.lastToastRoll === rollIndex
  const toast = budgetSpent ? null : (candidates[0] ?? null)
  const overflow = candidates.filter((item) => item !== toast)
  feed.push(...overflow)
  feed.sort(rank)
  return { toast, feed, badge, hidden }
}

/** Where one advice belongs in `mode`, before cooldown and budget. */
function routeFor(item: GateItem, mode: Exclude<CoachModeName, 'off'>): GateSurface {
  const klass = toastClass(item.ruleId)
  if (klass === 'sameEvent') {
    const saving = item.saving ?? Fraction.ZERO
    if (saving.compare(SAME_EVENT_MIN_SAVING) < 0) return mode === 'coach' ? 'feed' : 'hidden'
    if (mode === 'coach') return 'toast'
    const edge = item.edge ?? Fraction.ZERO
    const quietBar = edge.mul(QUIET_RELATIVE_SAVING)
    return !edge.isZero() && saving.compare(quietBar) >= 0 ? 'toast' : 'hidden'
  }
  if (klass === 'highEdge') {
    const edge = item.edge ?? Fraction.ZERO
    const bar = mode === 'coach' ? HIGH_EDGE_TOAST.coach : HIGH_EDGE_TOAST.quiet
    if (edge.compare(bar) >= 0) return 'toast'
    return mode === 'coach' ? 'feed' : 'hidden'
  }
  if (klass === 'rounding') {
    return mode === 'coach' ? 'toast' : 'badge'
  }
  return mode === 'coach' ? 'feed' : 'hidden'
}

function rank(x: GateItem, y: GateItem): number {
  const severity = SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity]
  if (severity !== 0) return severity
  const impact = y.impact.compare(x.impact)
  if (impact !== 0) return impact
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
}
