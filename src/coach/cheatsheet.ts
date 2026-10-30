import type { Cents, MachineConfig } from '../engine/index.ts'
import type { CatalogRow } from '../exact/catalog.ts'
import { atMinimumNote, notModelledNote, sheetCost, sheetDetail } from './content/layout.ts'
import { sideBetSheetNote } from './content/sideBets.ts'
import { returnsUnplayed, winChanceOfDecisions } from './decisions.ts'
import { coachMoney, coachPercent, coachProbability, coachRolls, sourceOf } from './numbers.ts'
import { gradeOf } from './policy.ts'
import type { CoachLine, CoachNumber, Grade } from './types.ts'
import { badgeKey } from './types.ts'

/**
 * The cheat sheet's coach content (plan §5.5 surface 7, §10 M9d): every bet the machine offers,
 * `byEdge(catalogTable(cfg))` — sorted by edge, lowest first, ties in config order — each priced
 * at its exact unit, with the machine's own pay label, the chance and length of a decision, the
 * at-minimum warning and the assumed chips. This module only attaches provenance and words to
 * `CatalogRow`s computed in `src/exact` (the worker sends them raw over the wire), so the UI can
 * rebuild the sheet without loading the solver; `import type` keeps it that way.
 */

export interface SheetRow {
  /** `badgeKey(typeId, number)`: the row's identity for the DOM and tests. */
  readonly key: string
  readonly label: string
  readonly family: string
  /** The stake the row is priced at: the bet's exact unit, machine-paid cents. */
  readonly amount: Cents
  readonly edge: CoachNumber
  readonly grade: Grade
  /** "pays … · at … · wins … · decides in …", from the row's own fields. */
  readonly detail: CoachLine
  /** Edge per working roll and the standing cost, where the bet stands as a stream. */
  readonly cost: CoachLine
  /** The warning where the smallest legal stake prices worse; null when none does. */
  readonly atMinimum: CoachLine | null
  /** For a side bet (M11): how its family settles, in words; null for the main game's bets. */
  readonly note: CoachLine | null
  readonly assumedPaths: readonly string[]
}

export interface CheatSheet {
  readonly rows: readonly SheetRow[]
  /** The sheet's approximation note; null when the machine sets nothing the trainer skips. */
  readonly notModelled: CoachLine | null
}

/**
 * The sheet from raw catalog rows. Sorting matches `byEdge`: by edge, lowest first, ties keeping
 * the given (config) order, so handing it `catalogTable(cfg)` in either order is the same sheet.
 */
export function sheetFromRows(rows: readonly CatalogRow[], cfg: MachineConfig): CheatSheet {
  const sorted = [...rows].sort((a, b) => a.edge.compare(b.edge))
  return {
    rows: sorted.map((row) => sheetRow(row, cfg)),
    notModelled:
      cfg.notModelled.length === 0
        ? null
        : { id: 'not-modelled', parts: notModelledNote(cfg.notModelled.join(', ')) },
  }
}

function sheetRow(row: CatalogRow, cfg: MachineConfig): SheetRow {
  const source = sourceOf('catalogRow', { spec: row.spec, amount: row.amount }, cfg)
  const assumed = row.assumedPaths
  const edge = coachPercent(row.edge, source, assumed)
  // "Wins … of decisions": an odds bet's returned-unplayed mass is not a decision (spec §0.1 [M]),
  // so its chance is conditioned on being played; the source names the conditioning for the audit.
  const pWin = returnsUnplayed(cfg, row.spec)
    ? coachProbability(
        winChanceOfDecisions(cfg, row.spec, row),
        sourceOf('catalogRow', { spec: row.spec, amount: row.amount, field: 'pWinDecided' }, cfg),
        assumed,
      )
    : coachProbability(row.pWin, source, assumed)
  return {
    key: badgeKey(row.spec.typeId, row.spec.number),
    label: row.label,
    family: row.family,
    amount: row.amount,
    edge,
    grade: gradeOf(row.edge),
    detail: {
      id: 'detail',
      parts: sheetDetail(row.payoutLabel, {
        amount: coachMoney(row.amount, source, assumed),
        pWin,
        rolls: coachRolls(row.expectedRolls, source, assumed),
      }),
    },
    cost: {
      id: 'cost',
      parts: sheetCost({
        perWorkingRoll: coachPercent(row.edgePerWorkingRoll, source, assumed),
        standing:
          row.standingPerRoll === null ? null : coachMoney(row.standingPerRoll, source, assumed),
      }),
    },
    atMinimum:
      row.atMinimum === null
        ? null
        : {
            id: 'at-minimum',
            parts: atMinimumNote({
              amount: coachMoney(row.atMinimum.amount, source, assumed),
              edge: coachPercent(row.atMinimum.edge, source, assumed),
            }),
          },
    note: sideNote(row, cfg),
    assumedPaths: assumed,
  }
}

/** The side-bet note of a row, from the family of the side bet it prices; null otherwise. */
function sideNote(row: CatalogRow, cfg: MachineConfig): CoachLine | null {
  const side = cfg.sideBets.get(row.spec.typeId)
  return side === undefined ? null : { id: 'side-note', parts: sideBetSheetNote(side.family) }
}
