import { act, render, type RenderResult } from '@testing-library/react'
import type { StoreApi } from 'zustand/vanilla'
import type { Dice, MachineConfig } from '../../engine/index.ts'
import { createSessionRepo } from '../../persistence/sessionRepo.ts'
import { App } from '../App.tsx'
import type { AppStores } from '../components/context.tsx'
import { createGameStore, type GameState } from '../state/gameStore.ts'
import { createMachineStore } from '../state/machineStore.ts'
import { createSettingsStore, type SettingsState } from '../state/settingsStore.ts'
import { CRAPLESS } from './game.ts'

/**
 * Renders the App over fresh, isolated stores (components read them through context), with a
 * started crapless session unless a test starts its own. `meta` stays null, so the roll flow never
 * writes to storage from component tests; the persistence path has its own suites. Rolls in tests
 * drive the store directly (`beginRoll` → `reveal` → `finishReveal`), which re-renders the tree
 * exactly as the roll flow would.
 */

export interface TestApp extends RenderResult {
  readonly stores: AppStores
  readonly game: StoreApi<GameState>
  readonly settings: StoreApi<SettingsState>
  /** Rolls scripted dice through the store and reveals, as the roll flow does. */
  roll(dice: Dice): void
  /** Runs store calls inside React's act, so subscribers re-render before assertions. */
  run(play: (state: GameState) => void): void
}

export interface RenderAppOptions {
  readonly start?: boolean
  readonly seed?: string
  readonly cfg?: MachineConfig
  readonly settings?: Partial<Parameters<typeof createSettingsStore>[0]>
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const kept = new Map<string, string>()
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, value)
    },
  }
}

export function testStores(): AppStores {
  return {
    game: createGameStore(),
    settings: createSettingsStore({ storage: memoryStorage() }),
    machine: createMachineStore(),
    repo: createSessionRepo({ now: () => 1_730_000_000_000 }),
  }
}

export function renderApp(options: RenderAppOptions = {}): TestApp {
  const stores = testStores()
  const cfg = options.cfg ?? CRAPLESS
  if (options.start !== false) {
    stores.game.getState().startGame(cfg, options.seed ?? 'ui-component-test')
  }
  const rendered = render(<App stores={stores} boot={false} />)
  const run = (play: (state: GameState) => void): void => {
    act(() => {
      play(stores.game.getState())
    })
  }
  const roll = (dice: Dice): void => {
    run((state) => {
      const outcome = state.beginRoll(dice)
      if (!outcome.ok) throw new Error(`test roll refused: ${outcome.rejection.code}`)
      stores.game.getState().reveal()
      stores.game.getState().finishReveal()
    })
  }
  return { ...rendered, stores, game: stores.game, settings: stores.settings, roll, run }
}
