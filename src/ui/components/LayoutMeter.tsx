import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { formatCents } from '../../engine/index.ts'
import { formatCoachNumber, formatPart } from '../../coach/format.ts'
import { emptyMeter } from '../../coach/content/layout.ts'
import { coachModeName } from '../../coach/policy.ts'
import type { MeterToggle } from '../../coach/meter.ts'
import type { TemplateParts } from '../../coach/types.ts'
import {
  layoutFor,
  layoutKeyOf,
  requestLayout,
  subscribeAnalysis,
} from '../services/analysisClient.ts'
import { selectShown, selectWorkingToggle } from '../state/gameStore.ts'
import { useGameState, useSettingsState } from './context.tsx'

/**
 * The layout cost meter (plan §5.5 surface 6, §10 M9d): what keeping the table's bets up costs —
 * Σ of the standing costs a roll, the hourly line over the pace range with the machine's own pace
 * marked, each bet's share, the cheapest same-event relayout, and what the Set bets On/Off button
 * would change it to, priced on the dry-run table. Everything shown is a `CoachNumber` computed by
 * the analysis worker and rendered verbatim through `formatPart`; this component computes nothing.
 *
 * Coach mode (plan §5.6 "Layout meter" row): hidden when the coach is off, compact in quiet — the
 * headline alone, no hourly line, by-bet rows, relayout or toggle effect — and full in coach.
 */

export function LayoutMeter() {
  const cfg = useGameState((state) => state.cfg)
  const shown = useGameState(selectShown)
  const workingToggle = useGameState(selectWorkingToggle)
  const coachMode = useSettingsState((state) => coachModeName(state.coachMode))

  const toggle = useMemo((): MeterToggle | null => {
    if (workingToggle === null) return null
    return { action: workingToggle.action, showSetOn: workingToggle.showSetOn }
  }, [workingToggle])

  const key = useMemo(
    () => (cfg === null || shown === null ? null : layoutKeyOf(cfg, shown, toggle)),
    [cfg, shown, toggle],
  )

  useEffect(() => {
    if (cfg !== null && shown !== null && coachMode !== 'off') requestLayout(cfg, shown, toggle)
  }, [cfg, shown, toggle, coachMode])

  const meter = useSyncExternalStore(subscribeAnalysis, () =>
    key === null ? null : layoutFor(key),
  )

  if (cfg === null || shown === null || coachMode === 'off') return null
  const compact = coachMode === 'quiet'

  return (
    <section
      className="cost-meter"
      aria-label="Layout cost meter"
      data-testid="layout-meter"
      data-compact={compact || undefined}
    >
      <h3 className="meter-title">Cost meter</h3>
      {meter === null ? (
        <p className="meter-empty">Pricing the layout…</p>
      ) : meter.byBet.length === 0 ? (
        <p className="meter-empty" data-testid="meter-empty">
          {text(emptyMeter())}
        </p>
      ) : compact ? (
        <p className="meter-headline" data-testid="meter-per-roll">
          {text(meter.headline.parts)}
        </p>
      ) : (
        <>
          <p className="meter-headline" data-testid="meter-per-roll">
            {text(meter.headline.parts)}
          </p>
          <ul className="meter-hourly" data-testid="meter-hourly">
            {meter.hourly.map((pace) => (
              <li key={pace.at} data-pace={pace.at} data-machine={pace.machine || undefined}>
                {text(pace.line.parts)}
              </li>
            ))}
          </ul>
          <details className="meter-details">
            <summary>By bet</summary>
            <ul className="meter-rows">
              {meter.byBet.map((row) => (
                <li key={row.betId} className="meter-row" data-meter-bet={row.betId}>
                  <span className="meter-bet-label">{row.label}</span>
                  <span className="meter-bet-amount">
                    {formatCents(row.amount, { trimWholeDollars: true })}
                  </span>
                  <span className="meter-bet-cost">
                    {row.perRoll !== null
                      ? `${formatCoachNumber(row.perRoll)} a roll`
                      : row.counted !== null
                        ? text(row.counted.parts)
                        : ''}
                  </span>
                </li>
              ))}
            </ul>
            {meter.toggled !== null && (
              <p className="meter-toggle" data-testid="meter-toggle">
                {text(meter.toggled.parts)}
              </p>
            )}
            {meter.alternative !== null && (
              <div className="meter-alt" data-testid="meter-alt">
                <p className="meter-alt-headline">{text(meter.alternative.headline.parts)}</p>
                <ul className="meter-rows">
                  {meter.alternative.swaps.map((swap) => (
                    <li key={swap.betId}>{text(swap.line.parts)}</li>
                  ))}
                </ul>
              </div>
            )}
          </details>
          {meter.assumedPaths.length > 0 && (
            <p className="coach-assumed" title={meter.assumedPaths.join(', ')}>
              Uses assumed machine values
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** Template parts as plain text: words verbatim, every number formatted from its `CoachNumber`. */
function text(parts: TemplateParts): string {
  return parts.map((part) => formatPart(part)).join('')
}
