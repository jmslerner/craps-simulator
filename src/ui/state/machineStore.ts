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
import { machineRepo, type MachineRepo, type SavedMachine } from '../../persistence/machineRepo.ts'
import type { RepoWrite } from '../../persistence/sessionRepo.ts'

/**
 * The machines (plan §6): the built-in presets compiled once at module scope and shared, and the
 * player's own machines (M12) — made in the machine editor or Match My Machine, or imported —
 * loaded from the machine repo (`machines:v1`). Compiling is the expensive step and
 * `compileConfig`'s memo is keyed by the raw input object (M5/M6 → M8 hand-off), so nothing here
 * compiles per render: a preset is one of the shared `MachineConfig` objects, and a saved machine
 * compiles once per stored object.
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
  const compiled = compileConfig(withBuyIn(PRESETS[presetId], startingBankroll))
  bankrollVariants.set(key, compiled)
  return compiled
}

/** `input` with the player's buy-in as its starting bankroll, marked as the player's choice. */
function withBuyIn(input: MachineConfigInput, startingBankroll: Cents): MachineConfigInput {
  return {
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
}

/** A saved machine compiled, once per stored object; null if it no longer compiles. */
const savedCompiled = new WeakMap<SavedMachine, MachineConfig | null>()

export function savedConfig(machine: SavedMachine): MachineConfig | null {
  if (savedCompiled.has(machine)) return savedCompiled.get(machine) ?? null
  let compiled: MachineConfig | null
  try {
    compiled = compileConfig(machine.config)
  } catch {
    compiled = null
  }
  savedCompiled.set(machine, compiled)
  return compiled
}

/** A saved machine with the player's buy-in (as `gameConfig` does for a preset). */
export function savedGameConfig(
  machine: SavedMachine,
  startingBankroll: Cents | null = null,
): MachineConfig | null {
  const base = savedConfig(machine)
  if (base === null) return null
  if (startingBankroll === null || startingBankroll === base.startingBankroll) return base
  try {
    return compileConfig(withBuyIn(machine.config, startingBankroll))
  } catch {
    return null
  }
}

export interface MachineState {
  readonly selectedId: PresetId
  select(id: PresetId): void
  /** The player's saved machines (M12), newest first; empty until `loadCustom` has run. */
  readonly custom: readonly SavedMachine[]
  /** Whether the saved machines have been read at least once. */
  readonly customLoaded: boolean
  /** Reads the saved machines from the repo; a failed read keeps what the store has. */
  loadCustom(): Promise<void>
  /** Saves a machine (replacing one with its id) and lists it first. */
  saveCustom(machine: SavedMachine): Promise<RepoWrite>
  removeCustom(id: string): Promise<RepoWrite>
}

export function createMachineStore(
  initial: PresetId = DEFAULT_PRESET_ID,
  repo: MachineRepo = machineRepo,
): StoreApi<MachineState> {
  return createStore<MachineState>()((set, get) => ({
    selectedId: initial,
    select: (id) => set({ selectedId: id }),
    custom: [],
    customLoaded: false,
    loadCustom: async () => {
      const listed = await repo.list()
      if (listed.ok) set({ custom: listed.machines, customLoaded: true })
      else set({ customLoaded: true })
    },
    saveCustom: async (machine) => {
      const written = await repo.save(machine)
      if (written.ok) {
        set({ custom: [machine, ...get().custom.filter((saved) => saved.id !== machine.id)] })
      }
      return written
    },
    removeCustom: async (id) => {
      const written = await repo.remove(id)
      if (written.ok) set({ custom: get().custom.filter((saved) => saved.id !== id) })
      return written
    },
  }))
}

/** The app's machine store; changing machines starts a new session (plan §4.9). */
export const machineStore: StoreApi<MachineState> = createMachineStore()

export function useMachine<T>(selector: (state: MachineState) => T): T {
  return useStore(machineStore, selector)
}

// --- Selectors (pure over MachineState; shared by hooks and services) ---

export const selectSelectedId = (state: Pick<MachineState, 'selectedId'>): PresetId =>
  state.selectedId

/** The selected machine, compiled and shared. */
export const selectMachine = (state: Pick<MachineState, 'selectedId'>): MachineConfig =>
  COMPILED_PRESETS[state.selectedId]

/**
 * The values the selected machine sets that the engine does not model (plan §0 #23): non-empty
 * means the UI shows the approximation note (today only Shoot To Win's: `/offBets/consumeCredit`
 * and `/flow/shooter/mode`).
 */
export const selectNotModelled = (state: Pick<MachineState, 'selectedId'>): readonly string[] =>
  COMPILED_PRESETS[state.selectedId].notModelled

/** The machine's own buy-in, what New game offers when settings remember nothing. */
export const selectDefaultBankroll = (state: Pick<MachineState, 'selectedId'>): Cents =>
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

export interface MachineSummary<Id extends string = PresetId> {
  readonly id: Id
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

/** A machine's picker row, from its compiled config. */
export function summaryOf<Id extends string>(id: Id, cfg: MachineConfig): MachineSummary<Id> {
  return { id, name: cfg.name, variant: cfg.ruleset.variant, stakes: stakesOf(cfg) }
}

/** One row per preset, in preset order, computed once at module scope from the compiled configs. */
export const MACHINE_SUMMARIES: readonly MachineSummary[] = Object.freeze(
  PRESET_IDS.map((id) => summaryOf(id, COMPILED_PRESETS[id])),
)

/** The remembered machine when it is still a preset of this build; the default otherwise. */
export function rememberedMachine(machineId: string | null): PresetId {
  return machineId !== null && isPresetId(machineId) ? machineId : DEFAULT_PRESET_ID
}

/**
 * A machine id for a saved machine: from its name, unique among the presets and the saved
 * machines (`taken`), and valid as a config id (letters, digits and dashes).
 */
export function uniqueMachineId(name: string, taken: readonly string[]): string {
  const stem =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'my-machine'
  const used = new Set([...PRESET_IDS, ...taken])
  if (!used.has(stem)) return stem
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}`
    if (!used.has(candidate)) return candidate
  }
}
