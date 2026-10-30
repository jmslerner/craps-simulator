import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { SettingsState } from '../ui/state/settingsStore.ts'
import './dome.css'

/**
 * The 2D ↔ 3D switch in the row under the dome: a pressed toggle button over `settings.diceMode`.
 * On it plays `'3d'` (the default, plan §0 #27); off plays `'2d'` (instant stays instant until the
 * player turns 3D on). The setting is a convenience, persisted by the settings store; the dome
 * falls back to 2D by itself when WebGL is unavailable, whatever the switch says.
 */

export function DiceModeToggle({ settings }: { settings: StoreApi<SettingsState> }) {
  const mode = useStore(settings, (state) => state.diceMode)
  const on = mode === '3d'
  return (
    <button
      type="button"
      className="dome-mode"
      aria-pressed={on}
      title={on ? 'Switch to the 2D dice' : 'Switch to the 3D dice dome'}
      onClick={() => settings.getState().update({ diceMode: on ? '2d' : '3d' })}
    >
      3D dice
    </button>
  )
}
