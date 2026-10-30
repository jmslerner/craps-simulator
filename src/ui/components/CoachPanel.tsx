import type { ReactNode } from 'react'
import { CoachModeControl } from './CoachModeControl.tsx'
import { useSettingsState, useStores } from './context.tsx'

/**
 * The coach panel (plan §6; the demo's Coach section): a titled card with the guide toggle and
 * the coach-mode control in its head, holding the coach surfaces the App puts inside it — the
 * approximation note, the layout cost meter, the session strip and the cheat sheet. Pure layout:
 * the children own their data and their gating.
 */

export function CoachPanel({ children }: { children: ReactNode }) {
  return (
    <section className="coach" aria-labelledby="coach-title">
      <div className="coach-head">
        <h2 className="coach-title" id="coach-title">
          Coach
        </h2>
        <div className="toggles">
          <GuideToggle />
          <CoachModeControl />
        </div>
      </div>
      {children}
    </section>
  )
}

/** The next-step guide's on/off toggle (plan §0 #18): the bar's Hide control hands it focus. */
export function GuideToggle() {
  const { settings } = useStores()
  const guideEnabled = useSettingsState((state) => state.guideEnabled)
  return (
    <button
      type="button"
      id="guide-toggle"
      aria-pressed={guideEnabled}
      onClick={() => settings.getState().update({ guideEnabled: !guideEnabled })}
    >
      Guide
    </button>
  )
}
