import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  DEFAULT_PRESET_ID,
  PRESETS,
  PRESET_IDS,
  cents,
  compileConfig,
  isPresetId,
  smallestBet,
  statusAt,
  typeLimits,
} from '../../engine/index.ts'
import type {
  Cents,
  MachineConfig,
  MachineConfigInput,
  PresetId,
  ProvenanceStatus,
} from '../../engine/index.ts'

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

// ---------------------------------------------------------------------------------------------
// The machine picker's rows (New game dialog): each preset's variant and real stakes, computed
// from the compiled config through `typeLimits` — never a typed-in dollar amount — with the
// weakest provenance of the values shown, so the dialog can mark assumptions the way the rest of
// the UI does.
// ---------------------------------------------------------------------------------------------

/** The stakes a machine posts, read from its line bet's limits and the table maximum. */
export interface MachineStakes {
  /** The machine's label for its line bet ("Pass Line"). */
  readonly lineLabel: string
  /** The smallest line bet the machine takes (`smallestBet` of its limits), in cents. */
  readonly min: Cents
  /** The largest line bet, in cents. */
  readonly max: Cents
  /** The most the whole layout holds, or null when the machine sets no table maximum. */
  readonly tableMax: Cents | null
  /** The minimum total of working bets a roll needs, or null (plan §4.6). */
  readonly minTotal: Cents | null
  /** The weakest provenance among the values shown: how sure the trainer is of these stakes. */
  readonly provenance: ProvenanceStatus
}

export interface MachineSummary {
  readonly id: PresetId
  readonly name: string
  readonly variant: 'crapless' | 'traditional'
  readonly stakes: MachineStakes
}

const PROVENANCE_RANK: Readonly<Record<ProvenanceStatus, number>> = {
  verified: 0,
  reported: 1,
  assumed: 2,
}

function weakest(statuses: readonly ProvenanceStatus[]): ProvenanceStatus {
  return statuses.reduce((worst, status) =>
    PROVENANCE_RANK[status] > PROVENANCE_RANK[worst] ? status : worst,
  )
}

function stakesOf(cfg: MachineConfig): MachineStakes {
  const line = typeLimits(cfg, 'pass')
  const pointers = ['/limits/min', '/limits/max']
  if (cfg.limits.tableMax !== null) pointers.push('/limits/tableMax')
  if (cfg.limits.minTotal !== null) pointers.push('/limits/minTotal/amount')
  return {
    lineLabel: cfg.catalog.get('pass')?.label ?? 'Pass',
    min: smallestBet(line),
    max: cents(line.max),
    tableMax: cfg.limits.tableMax,
    minTotal: cfg.limits.minTotal === null ? null : cents(cfg.limits.minTotal.amount),
    provenance: weakest(pointers.map((pointer) => statusAt(cfg.provenance, pointer))),
  }
}

/** One row per preset, in preset order, computed once at module scope from the compiled configs. */
export const MACHINE_SUMMARIES: readonly MachineSummary[] = Object.freeze(
  PRESET_IDS.map((id) => {
    const cfg = COMPILED_PRESETS[id]
    return {
      id,
      name: cfg.name,
      variant: cfg.ruleset.variant,
      stakes: stakesOf(cfg),
    }
  }),
)

/** The remembered machine when it is still a preset of this build; the default otherwise. */
export function rememberedMachine(machineId: string | null): PresetId {
  return machineId !== null && isPresetId(machineId) ? machineId : DEFAULT_PRESET_ID
}
