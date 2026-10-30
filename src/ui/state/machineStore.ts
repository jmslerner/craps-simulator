import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { DEFAULT_PRESET_ID, PRESETS, PRESET_IDS, cents, compileConfig } from '../../engine/index.ts'
import type { Cents, MachineConfig, MachineConfigInput, PresetId } from '../../engine/index.ts'

/**
 * The machines (plan §6): the built-in presets compiled once at module scope and shared. Compiling
 * is the expensive step and `compileConfig`'s memo is keyed by the raw input object (M5/M6 → M8
 * hand-off), so nothing here compiles per render or per call: the UI always receives one of these
 * shared `MachineConfig` objects. Custom configs and the machine editor are M12.
 */

/** Every preset compiled once; the module throws at load if a preset stops compiling. */
export const COMPILED_PRESETS: Readonly<Record<PresetId, MachineConfig>> = Object.freeze(
  Object.fromEntries(PRESET_IDS.map((id) => [id, compileConfig(PRESETS[id])])) as Record<
    PresetId,
    MachineConfig
  >,
)

/**
 * A preset with a player-chosen buy-in (plan §0 #19): the same machine, its
 * `/money/startingBankroll` replaced and marked assumed, compiled once per (preset, amount) and
 * cached. New game passes the remembered amount; null plays the preset as written.
 */
const bankrollVariants = new Map<string, MachineConfig>()

export function gameConfig(
  presetId: PresetId,
  startingBankroll: Cents | null = null,
): MachineConfig {
  const preset = COMPILED_PRESETS[presetId]
  if (startingBankroll === null || startingBankroll === preset.startingBankroll) return preset
  const key = `${presetId}:${startingBankroll}`
  const cached = bankrollVariants.get(key)
  if (cached !== undefined) return cached
  const input = PRESETS[presetId]
  const variant: MachineConfigInput = {
    ...input,
    money: { ...input.money, startingBankroll },
    provenance: {
      ...input.provenance,
      '/money/startingBankroll': {
        status: 'assumed',
        note: 'Player-chosen buy-in (New game); not a machine value.',
      },
    },
  }
  const compiled = compileConfig(variant)
  bankrollVariants.set(key, compiled)
  return compiled
}

export interface MachineState {
  readonly selectedId: PresetId
  select(id: PresetId): void
}

export function createMachineStore(initial: PresetId = DEFAULT_PRESET_ID): StoreApi<MachineState> {
  return createStore<MachineState>()((set) => ({
    selectedId: initial,
    select: (id) => set({ selectedId: id }),
  }))
}

/** The app's machine store; changing machines starts a new session (plan §4.9). */
export const machineStore: StoreApi<MachineState> = createMachineStore()

export function useMachine<T>(selector: (state: MachineState) => T): T {
  return useStore(machineStore, selector)
}

// --- Selectors (pure over MachineState; shared by hooks and services) ---

export const selectSelectedId = (state: MachineState): PresetId => state.selectedId

/** The selected machine, compiled and shared. */
export const selectMachine = (state: MachineState): MachineConfig =>
  COMPILED_PRESETS[state.selectedId]

/**
 * The values the selected machine sets that the engine does not model (plan §0 #23): non-empty
 * means the UI shows the approximation note (today only Shoot To Win's `/offBets/consumeCredit`).
 */
export const selectNotModelled = (state: MachineState): readonly string[] =>
  COMPILED_PRESETS[state.selectedId].notModelled

/** The machine's own buy-in, what New game offers when settings remember nothing. */
export const selectDefaultBankroll = (state: MachineState): Cents =>
  cents(COMPILED_PRESETS[state.selectedId].startingBankroll)
