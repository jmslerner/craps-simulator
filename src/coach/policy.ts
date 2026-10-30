import { Fraction } from '../engine/index.ts'
import type { Grade } from './types.ts'

/**
 * The coach's editable thresholds (plan §5.4, §5.6). These are policy, not machine facts: they
 * grade computed edges, they never produce a displayed number. M9c's gate and advisors read the
 * rest of the policy (toast budgets, cooldowns, savings thresholds) from here when they land.
 */

/** Edge grade bounds (edge ≤ bound), checked in order; above the last bound is `awful`. */
export const GRADE_BOUNDS: readonly { readonly grade: Grade; readonly atMost: Fraction }[] = [
  { grade: 'excellent', atMost: Fraction.of(1, 200) }, // 0.5%
  { grade: 'good', atMost: Fraction.of(1, 50) }, // 2%
  { grade: 'fair', atMost: Fraction.of(11, 200) }, // 5.5%
  { grade: 'poor', atMost: Fraction.of(1, 10) }, // 10%
]

/** The grade of a per-decision edge (plan §5.4 edgeWarning). */
export function gradeOf(edge: Fraction): Grade {
  for (const { grade, atMost } of GRADE_BOUNDS) {
    if (edge.compare(atMost) <= 0) return grade
  }
  return 'awful'
}
