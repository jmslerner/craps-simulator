import { coachModeName, type CoachModeName } from '../../coach/policy.ts'
import type { CoachMode } from '../../persistence/settings.ts'
import { useSettingsState, useStores, useUi } from './context.tsx'

/**
 * The coach-mode control (plan §5.6: Off / Quiet / Coach; M9 audit MAJOR-2): three pressed-state
 * buttons in the topbar that write `settingsStore.coachMode`, the one setting every coach surface
 * reads — zone badges (`ZoneButton`), the recap math, no-action lines and lessons
 * (`RollHistoryPanel`), the cost meter, the cheat sheet and the inspector's coach section. Each
 * change is announced in the app's live region with what the mode shows, and the choice is
 * remembered with the other settings (`persistence/settings.ts`), so it survives a reload. Plain
 * buttons keep it keyboard-reachable; the pressed state is the `aria-pressed` the tap modes use.
 */

export interface CoachModeOption {
  readonly name: CoachModeName
  /** The stored setting value (`'off' | 'hints' | 'full'`, plan names Off / Quiet / Coach). */
  readonly setting: CoachMode
  readonly label: string
  readonly title: string
  /** Said in the live region when the mode is chosen: what the player will now see. */
  readonly announce: string
}

export const COACH_MODE_OPTIONS: readonly CoachModeOption[] = [
  {
    name: 'off',
    setting: 'off',
    label: 'Off',
    title: 'No coaching: the machine’s own labels, pays and history only',
    announce:
      'Coach off: edge badges, recap math, lessons, advice, the cost meter and the cheat sheet are hidden.',
  },
  {
    name: 'quiet',
    setting: 'hints',
    label: 'Quiet',
    title:
      'Only the big things: poor and awful badges, one recap line per bet, a compact cost meter',
    announce:
      'Coach quiet: only poor and awful badges, one recap line per bet, a compact cost meter and only the strongest advice.',
  },
  {
    name: 'coach',
    setting: 'full',
    label: 'On',
    title: 'Everything: every badge, full recaps with lessons, the cost meter and all advice',
    announce: 'Coach on: every badge, full recaps with lessons, the cost meter and all advice.',
  },
]

export function CoachModeControl() {
  const { settings } = useStores()
  const ui = useUi()
  const current = useSettingsState((state) => coachModeName(state.coachMode))

  const choose = (option: CoachModeOption): void => {
    if (option.name === current) return
    settings.getState().update({ coachMode: option.setting })
    ui.announce(option.announce)
  }

  return (
    <div
      className="modes coach-modes"
      role="group"
      aria-label="Coach mode"
      data-testid="coach-mode"
    >
      <span className="coach-modes-name" aria-hidden="true">
        Coach
      </span>
      {COACH_MODE_OPTIONS.map((option) => (
        <button
          key={option.name}
          type="button"
          aria-pressed={current === option.name}
          aria-label={`Coach ${option.label.toLowerCase()}`}
          title={option.title}
          data-testid={`coach-mode-${option.name}`}
          onClick={() => choose(option)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
