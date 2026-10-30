import type { MachineConfig } from '../engine/index.ts'
import { catalogTable } from '../exact/index.ts'
import { coachPercent, sourceOf } from './numbers.ts'
import { gradeOf } from './policy.ts'
import type { ZoneBadge } from './types.ts'

/**
 * Zone edge badges (plan §5.5 surface 2, §10 M9a): one badge per bet the machine offers, on each
 * of its numbers — the house edge at the bet's exact unit, straight from `catalogTable`, graded by
 * `policy.ts`. The analysis worker computes these off the main thread; `ZoneButton` renders them;
 * the e2e badge check compares each rendered badge against `__CRAPS_TEST__.analyze`, which calls
 * this same function on the main thread.
 *
 * The badge is priced at the exact unit, not the player's stake, so it reads as the bet's
 * headline cost ("Place 6 — 1.52%"); the inspector prices the player's own amount.
 */

export function zoneBadges(cfg: MachineConfig): readonly ZoneBadge[] {
  return catalogTable(cfg).map((row) => ({
    typeId: row.spec.typeId,
    number: row.spec.number,
    amount: row.amount,
    edge: coachPercent(
      row.edge,
      sourceOf('catalogRow', { spec: row.spec, amount: row.amount }, cfg),
      row.assumedPaths,
    ),
    grade: gradeOf(row.edge),
  }))
}
