import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from '../../persistence/settings.ts'

/**
 * Player settings as a store (plan §6): loaded synchronously at module scope so the first render
 * already has them (plan §8), written back on every change, both behind try/catch in
 * `persistence/settings.ts`. Settings are conveniences: storage failures change nothing visible.
 */

export interface SettingsState extends Settings {
  /** Changes some settings and persists the result; unmentioned fields keep their values. */
  update(changes: Partial<Settings>): void
  /** Back to the defaults, persisted. */
  reset(): void
}

export interface SettingsStoreOptions {
  /** Injectable storage for tests; the default is the browser's localStorage. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'>
  readonly initial?: Settings
}

export function createSettingsStore(options: SettingsStoreOptions = {}): StoreApi<SettingsState> {
  const { storage } = options
  const initial = options.initial ?? loadSettings(storage)
  return createStore<SettingsState>()((set, get) => {
    const persist = (changes: Partial<Settings>) => {
      set(changes)
      const { update, reset, ...settings } = get()
      void update
      void reset
      saveSettings(settings, storage)
    }
    return {
      ...initial,
      update: (changes) => persist(changes),
      reset: () => persist(DEFAULT_SETTINGS),
    }
  })
}

/** The app's settings, read from localStorage at boot. */
export const settingsStore: StoreApi<SettingsState> = createSettingsStore()

export function useSettings<T>(selector: (state: SettingsState) => T): T {
  return useStore(settingsStore, selector)
}

/** The settings alone, without the actions: what services and the guide take as input. */
export function settingsOf(state: SettingsState): Settings {
  const { update, reset, ...settings } = state
  void update
  void reset
  return settings
}
