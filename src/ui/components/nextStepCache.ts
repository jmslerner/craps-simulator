import type { TableState } from '../../engine/index.ts'
import { selectNextStep, type GameState } from '../state/gameStore.ts'
import type { NextStep, NextStepSettings } from '../state/nextStep.ts'

/**
 * `selectNextStep` with a stable result per (shown table, chip settings), so it can sit inside a
 * zustand `useStore` selector: `useSyncExternalStore` requires the snapshot to be referentially
 * stable while the state is unchanged, and the guide rebuilds its step object on every call.
 */

const cache = new WeakMap<TableState, Map<string, NextStep | null>>()

export function cachedNextStep(state: GameState, settings: NextStepSettings): NextStep | null {
  if (state.view === null || state.view.phase !== 'betting') return null
  const shown = state.view.shown
  const key = `${settings.selectedChip ?? ''}|${settings.chips?.join(',') ?? ''}`
  let perTable = cache.get(shown)
  if (perTable === undefined) {
    perTable = new Map()
    cache.set(shown, perTable)
  }
  if (perTable.has(key)) return perTable.get(key) ?? null
  const step = selectNextStep(state, settings)
  perTable.set(key, step)
  return step
}
