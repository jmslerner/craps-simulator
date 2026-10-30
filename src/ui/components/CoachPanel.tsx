import type { ReactNode } from 'react'
import { CoachModeControl } from './CoachModeControl.tsx'
import { useSettingsState, useStores } from './context.tsx'
import { DOCKED_DRAWER_QUERY, useMediaQuery } from './useMediaQuery.ts'

/**
 * The Coach drawer (plan §0 #28): everything the trainer adds to the machine, out of the machine's
 * way — the guide's detail, the "Next roll" panel, the roll history with its arithmetic, the cost
 * meter, the session and the cheat sheet, under the guide toggle and the coach-mode control. It
 * docks open as a right-hand column on a viewport at least 1400 px wide and stays collapsed below
 * that, until the player opens or closes it: that choice is a setting (`coachDrawer`), kept at
 * every width. Collapsed, the drawer's body is `hidden` (out of the page and the accessibility
 * tree) while its children stay mounted, so the guide's state and the history's scroll survive.
 * The toggle is a disclosure button in the top bar (`CoachToggle`); a close button in the
 * drawer's head does the same.
 */

/** The drawer's id, for the toggles' `aria-controls`. */
export const COACH_DRAWER_ID = 'coach-drawer'

/** Whether the drawer is open: the player's choice, or by the viewport under `auto`. */
export function useCoachDrawerOpen(): boolean {
  const pref = useSettingsState((state) => state.coachDrawer)
  // Without media queries (the unit tests) the drawer renders open, its wide-screen form.
  const wide = useMediaQuery(DOCKED_DRAWER_QUERY, true)
  return pref === 'open' || (pref === 'auto' && wide)
}

/** Opens or closes the drawer and keeps the choice (`coachDrawer`). */
function useToggleDrawer(): (open: boolean) => void {
  const { settings } = useStores()
  return (open) => settings.getState().update({ coachDrawer: open ? 'open' : 'closed' })
}

export function CoachPanel({ children }: { children: ReactNode }) {
  const open = useCoachDrawerOpen()
  const setOpen = useToggleDrawer()
  return (
    <aside
      className="coach"
      id={COACH_DRAWER_ID}
      aria-labelledby="coach-title"
      data-open={open}
      hidden={!open}
    >
      <div className="coach-head">
        <h2 className="coach-title" id="coach-title">
          Coach
        </h2>
        <button
          type="button"
          className="coach-close"
          aria-label="Close the coach"
          onClick={() => {
            setOpen(false)
            document.getElementById('coach-toggle')?.focus()
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="toggles">
        <GuideToggle />
        <CoachModeControl />
      </div>
      {children}
    </aside>
  )
}

/** The top bar's disclosure button for the drawer: "Coach", pressed open or collapsed. */
export function CoachToggle() {
  const open = useCoachDrawerOpen()
  const setOpen = useToggleDrawer()
  return (
    <button
      type="button"
      id="coach-toggle"
      className="coach-toggle"
      aria-expanded={open}
      aria-controls={COACH_DRAWER_ID}
      data-testid="coach-toggle"
      onClick={() => setOpen(!open)}
    >
      Coach
    </button>
  )
}

/** The next-step guide's on/off toggle (plan §0 #18): the guide's Hide control hands it focus. */
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
