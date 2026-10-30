import type { StoreApi } from 'zustand/vanilla'
import {
  PRESETS,
  compileConfig,
  hashJson,
  isPresetId,
  makeRoll,
  parseDollars,
} from '../../engine/index.ts'
import type {
  Cents,
  Dice,
  MachineConfig,
  MachineConfigInput,
  PresetId,
  TableState,
} from '../../engine/index.ts'
import type { GameState, ViewPhase } from '../state/gameStore.ts'
import type { SessionHead } from '../../persistence/sessionRepo.ts'
import { KEYS, safeGet } from '../../persistence/storage.ts'
import type { DiceMode } from '../../persistence/settings.ts'

/**
 * The e2e test hooks (plan §6): `window.__CRAPS_TEST__` and the boot URL parameters. They exist
 * only in `vite build --mode e2e` builds: the app loads this module through a dynamic import
 * guarded by a static `import.meta.env.MODE === 'e2e'` check, so production builds contain none of
 * it (`scripts/check-bundle.ts` asserts the absence). `installTestHooks` additionally refuses to
 * install outside that mode, as defence in depth.
 *
 * Scripted dice go only through the store's queue, which `beginRoll` plays through
 * `rollWindow(ws, cfg, dice)` — the one scripted-dice door the engine has.
 */

export interface CrapsTestState {
  readonly phase: ViewPhase | null
  readonly bankroll: Cents | null
  readonly rollIndex: number | null
  readonly pendingActions: number
  readonly committedRolls: number
  readonly machineId: string | null
  readonly state: TableState | null
}

/** What the reload specs read from the stored `session:<id>:head` blob (plan §8). */
export interface StoredHeadProbe {
  readonly pendingReveal: boolean
  readonly windowCount: number
  readonly stateHash: string
}

export interface CrapsTestApi {
  getState(): CrapsTestState
  /** `hashJson` of the session's table: what a reload must restore identically (plan §10 M8). */
  sessionHash(): string | null
  /** Queues scripted dice: `"1-1,3-3"` or `[[1, 1], [3, 3]]`. False when the text is junk. */
  queueDice(dice: string | readonly (readonly [number, number])[]): boolean
  /**
   * The stored session head's flags, straight from IndexedDB: how the reload specs wait for a
   * committed roll (`pendingReveal: true`, written before any animation) or a flushed betting
   * save, without sleeping. Null while nothing is stored.
   */
  storedHead(): Promise<StoredHeadProbe | null>
}

declare global {
  interface Window {
    __CRAPS_TEST__?: CrapsTestApi
  }
}

/** What the boot reads from the URL (plan §6): `?seed=&preset=&dice=&script=1-1,3-3&bankroll=`. */
export interface TestBootParams {
  readonly seed: string | null
  readonly presetId: PresetId | null
  readonly diceMode: DiceMode | null
  readonly script: readonly Dice[] | null
  /** Dollars in the URL (`bankroll=600` or `600.50`), held as cents. */
  readonly bankroll: Cents | null
}

export function isE2EMode(): boolean {
  return import.meta.env.MODE === 'e2e'
}

/** `"1-1,3-3"` → dice pairs; null when any pair is not two faces 1–6. */
export function parseDiceScript(text: string): readonly Dice[] | null {
  const parts = text.split(',').filter((part) => part.length > 0)
  if (parts.length === 0) return null
  const dice: Dice[] = []
  for (const part of parts) {
    const match = /^([1-6])-([1-6])$/.exec(part.trim())
    if (match === null) return null
    dice.push(makeRoll(Number(match[1]), Number(match[2])))
  }
  return dice
}

/** The boot parameters in `search` (a `location.search` string); junk fields come back null. */
export function readTestParams(search: string): TestBootParams {
  const params = new URLSearchParams(search)
  const seed = params.get('seed')
  const preset = params.get('preset')
  const dice = params.get('dice')
  const script = params.get('script')
  const bankroll = params.get('bankroll')
  let parsedBankroll: Cents | null = null
  if (bankroll !== null) {
    try {
      parsedBankroll = parseDollars(bankroll)
    } catch {
      parsedBankroll = null
    }
  }
  return {
    seed: seed !== null && seed.length > 0 ? seed : null,
    presetId: preset !== null && isPresetId(preset) ? preset : null,
    diceMode: dice === 'instant' || dice === '2d' || dice === '3d' ? dice : null,
    script: script === null ? null : parseDiceScript(script),
    bankroll: parsedBankroll,
  }
}

export interface InstallTarget {
  __CRAPS_TEST__?: CrapsTestApi
}

/**
 * Installs `window.__CRAPS_TEST__` over the store. Returns false (and installs nothing) outside
 * e2e mode or without a window-like target.
 */
export function installTestHooks(
  store: StoreApi<GameState>,
  target: InstallTarget | null = typeof window === 'undefined' ? null : window,
): boolean {
  if (!isE2EMode() || target === null) return false
  const api: CrapsTestApi = {
    getState: () => {
      const { session, view } = store.getState()
      return {
        phase: view?.phase ?? null,
        bankroll: session?.state.ledger.bankroll ?? null,
        rollIndex: session?.state.round.rollIndex ?? null,
        pendingActions: session?.pending.length ?? 0,
        committedRolls: session?.committed.length ?? 0,
        machineId: session?.header.config.id ?? null,
        state: session?.state ?? null,
      }
    },
    sessionHash: () => {
      const { session } = store.getState()
      return session === null ? null : hashJson(session.state)
    },
    queueDice: (dice) => {
      const parsed = typeof dice === 'string' ? parseDiceScript(dice) : parsePairs(dice)
      if (parsed === null) return false
      store.getState().enqueueDice(parsed)
      return true
    },
    storedHead: async () => {
      const current = await safeGet<string>(KEYS.current)
      if (!current.ok || current.value === undefined) return null
      const head = await safeGet<SessionHead>(KEYS.head(current.value))
      if (!head.ok || head.value === undefined) return null
      const { pendingReveal, windowCount, stateHash } = head.value
      return { pendingReveal, windowCount, stateHash }
    },
  }
  target.__CRAPS_TEST__ = api
  return true
}

function parsePairs(pairs: readonly (readonly [number, number])[]): readonly Dice[] | null {
  try {
    return pairs.map(([d1, d2]) => makeRoll(d1, d2))
  } catch {
    return null
  }
}

/**
 * The e2e machines (plan §10 M8; M4 → M8 hand-off): the preset with `/catalog/pass/afterWin`
 * pinned to `return`, so the §10 scripted run banks the winning pass and the bankroll reads
 * exactly $631.00 ($621 with the preset's own `stay`), plus the chosen buy-in, as in
 * `gameConfig`'s variants. Both pins are marked assumed in provenance. Compiled once per
 * (preset, buy-in) and cached, so the UI's per-config memos keep holding. This module exists
 * only in `--mode e2e` builds, so production machines are never pinned.
 */
const e2eMachines = new Map<string, MachineConfig>()

export function e2eMachine(presetId: PresetId, startingBankroll: Cents | null): MachineConfig {
  const key = `${presetId}:${startingBankroll ?? 'preset'}`
  const cached = e2eMachines.get(key)
  if (cached !== undefined) return cached
  const input = PRESETS[presetId]
  let variant: MachineConfigInput = input
  const pass = input.catalog['pass']
  if (pass !== undefined && pass.family === 'line' && pass.afterWin !== 'return') {
    variant = {
      ...variant,
      catalog: { ...variant.catalog, pass: { ...pass, afterWin: 'return' } },
      provenance: {
        ...variant.provenance,
        '/catalog/pass/afterWin': {
          status: 'assumed',
          note: 'e2e test preset: a winning pass returns, so the §10 run banks $631.',
        },
      },
    }
  }
  if (startingBankroll !== null && startingBankroll !== input.money.startingBankroll) {
    variant = {
      ...variant,
      money: { ...variant.money, startingBankroll },
      provenance: {
        ...variant.provenance,
        '/money/startingBankroll': {
          status: 'assumed',
          note: 'Player-chosen buy-in (New game); not a machine value.',
        },
      },
    }
  }
  const compiled = compileConfig(variant)
  e2eMachines.set(key, compiled)
  return compiled
}
