import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { sheetFromRows } from '../../coach/cheatsheet.ts'
import { formatCoachNumber, formatPart } from '../../coach/format.ts'
import { coachModeName } from '../../coach/policy.ts'
import type { TemplateParts } from '../../coach/types.ts'
import { ensureCatalog, sheetFor, subscribeAnalysis } from '../services/analysisClient.ts'
import { useGameState, useSettingsState } from './context.tsx'

/**
 * The cheat sheet (plan §5.5 surface 7, §10 M9d): every bet this machine offers, best edge first —
 * `byEdge(catalogTable(cfg))`, each row priced at its exact unit — with the machine's own pay
 * label, the chance and length of a decision, the at-minimum warning, assumed chips, and the
 * not-modelled note. The worker sends the raw `CatalogRow`s with the badges; `sheetFromRows` only
 * attaches provenance and words, so this stays off the main thread's solver budget.
 *
 * Coach mode (plan §5.6): the sheet is coaching, so Off hides it; Quiet and Coach keep it, since it
 * opens only when the player asks for it.
 */

export function CheatSheet() {
  const cfg = useGameState((state) => state.cfg)
  const coachMode = useSettingsState((state) => coachModeName(state.coachMode))
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open && cfg !== null && coachMode !== 'off') ensureCatalog(cfg)
  }, [open, cfg, coachMode])

  const rows = useSyncExternalStore(subscribeAnalysis, () =>
    cfg === null ? null : sheetFor(cfg.configHash),
  )
  const sheet = useMemo(
    () => (cfg === null || rows === null ? null : sheetFromRows(rows, cfg)),
    [cfg, rows],
  )

  if (cfg === null || coachMode === 'off') return null

  return (
    <section className="sheet" aria-label="Cheat sheet">
      <button
        type="button"
        className="sheet-toggle"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        Cheat sheet {open ? '▴' : '▾'}
      </button>
      {open &&
        (sheet === null ? (
          <p className="meter-empty">Computing the table…</p>
        ) : (
          <div className="sheet-body" data-testid="sheet-body">
            <p className="sheet-caption">
              Every bet on this machine, best first, each priced at its exact unit.
            </p>
            {sheet.notModelled !== null && (
              <p className="sheet-not-modelled" role="note" data-testid="sheet-not-modelled">
                {text(sheet.notModelled.parts)}
              </p>
            )}
            {/* The rows scroll inside the card, so the list takes focus for the keyboard (M14). */}
            <ol
              className="sheet-rows"
              data-testid="sheet-rows"
              tabIndex={0}
              aria-label="Bets, best edge first"
            >
              {sheet.rows.map((row) => (
                <li key={row.key} className="sheet-row" data-sheet-row={row.key}>
                  <div className="sheet-head">
                    <span className="sheet-label">{row.label}</span>
                    {row.assumedPaths.length > 0 && (
                      <span className="sheet-assumed" title={row.assumedPaths.join(', ')}>
                        assumed
                      </span>
                    )}
                    <span className={`sheet-edge grade-${row.grade}`}>
                      {formatCoachNumber(row.edge)}
                    </span>
                  </div>
                  <p className="sheet-detail">{text(row.detail.parts)}</p>
                  <p className="sheet-detail">{text(row.cost.parts)}</p>
                  {row.atMinimum !== null && (
                    <p className="sheet-min">{text(row.atMinimum.parts)}</p>
                  )}
                  {row.note !== null && (
                    <p className="sheet-note" data-coach-line={row.note.id}>
                      {text(row.note.parts)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
    </section>
  )
}

/** Template parts as plain text: words verbatim, every number formatted from its `CoachNumber`. */
function text(parts: TemplateParts): string {
  return parts.map((part) => formatPart(part)).join('')
}
