import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { Dice } from '../../engine/index.ts'
import { sessionRepo, type SessionRepo } from '../../persistence/sessionRepo.ts'
import { gameStore, type GameState } from '../state/gameStore.ts'
import { machineStore, type MachineState } from '../state/machineStore.ts'
import { settingsStore, type SettingsState } from '../state/settingsStore.ts'

/**
 * The app's wiring as context (plan §6): the stores and services every component reads, defaulting
 * to the app singletons so `<App/>` needs no provider in production, while tests hand each render
 * its own stores. `UiContext` carries the per-render UI state the components share — the input
 * mode, the open dialog, the inspector, the roll controller and the live announcer — owned by
 * `App` as plain React state so parallel test renders never leak into each other.
 */

export interface AppStores {
  readonly game: StoreApi<GameState>
  readonly settings: StoreApi<SettingsState>
  readonly machine: StoreApi<MachineState>
  readonly repo: SessionRepo
}

export const DEFAULT_STORES: AppStores = {
  game: gameStore,
  settings: settingsStore,
  machine: machineStore,
  repo: sessionRepo,
}

const StoresContext = createContext<AppStores>(DEFAULT_STORES)
export const StoresProvider = StoresContext.Provider

export function useStores(): AppStores {
  return useContext(StoresContext)
}

export function useGameState<T>(selector: (state: GameState) => T): T {
  return useStore(useContext(StoresContext).game, selector)
}

export function useSettingsState<T>(selector: (state: SettingsState) => T): T {
  return useStore(useContext(StoresContext).settings, selector)
}

// ---------------------------------------------------------------------------------------------

/** How a tap on a zone is read: place the chip, open the inspector, or take the bet down. */
export type TapMode = 'bet' | 'info' | 'remove'

/** A layout spot the inspector is open on, resolved against `legalBets` on every render. */
export interface SpotRef {
  readonly typeId: string
  readonly number: number | null
  readonly parentId: string | null
}

export type DialogKind = 'newGame' | 'addCredit' | null

export interface UiState {
  readonly mode: TapMode
  readonly dialog: DialogKind
  readonly inspector: SpotRef | null
  /** The next-step guide's current highlight target (`zone:<typeId>`, `control:roll`, …). */
  readonly highlight: string | null
  setMode(mode: TapMode): void
  openDialog(dialog: Exclude<DialogKind, null>): void
  closeDialog(): void
  openInspector(spot: SpotRef): void
  closeInspector(): void
  /** Starts a roll through the roll flow, or skips the animation when one is playing. */
  roll(dice?: Dice): void
  /** Says `text` in the app's aria-live region. */
  announce(text: string): void
}

const NO_UI: UiState = {
  mode: 'bet',
  dialog: null,
  inspector: null,
  highlight: null,
  setMode: () => undefined,
  openDialog: () => undefined,
  closeDialog: () => undefined,
  openInspector: () => undefined,
  closeInspector: () => undefined,
  roll: () => undefined,
  announce: () => undefined,
}

const UiContext = createContext<UiState>(NO_UI)
export const UiProvider = UiContext.Provider

export function useUi(): UiState {
  return useContext(UiContext)
}
