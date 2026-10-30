import type { StoreApi } from 'zustand/vanilla'
import { DEFAULT_PRESET_ID, cents, compileConfig, replayHistory } from '../../engine/index.ts'
import type { Cents, MachineConfig, PresetId, WindowedSession } from '../../engine/index.ts'
import {
  clearPendingMirror,
  restorePendingMirror,
  writePendingMirror,
  type MirrorStorage,
} from '../../persistence/pendingMirror.ts'
import { sessionRepo, type SessionMeta, type SessionRepo } from '../../persistence/sessionRepo.ts'
import { gameStore, type GameState } from '../state/gameStore.ts'
import { gameConfig, rememberedMachine } from '../state/machineStore.ts'
import { settingsStore, type SettingsState } from '../state/settingsStore.ts'
import { emptyHistory, historyFromWindows } from '../state/rollHistory.ts'
import { newSessionSeed } from './seed.ts'

/**
 * Boot and autosave (plan §8): resume the stored session or start a fresh one, and keep the open
 * betting window saved — debounced by 250 ms, flushed the moment the page hides, and mirrored
 * synchronously to localStorage on every change (`persistence/pendingMirror.ts`), so a betting
 * action inside the debounce survives even an instant reload, whose teardown abandons the async
 * IndexedDB flush. The roll itself is persisted by `rollFlow` before any animation; this service
 * only covers the betting actions between rolls. In e2e builds the boot first reads the test URL
 * parameters and installs `window.__CRAPS_TEST__`; that module is loaded through a dynamic import
 * behind a static mode check, so production builds contain none of it.
 */

export interface BootDeps {
  readonly store?: StoreApi<GameState>
  readonly settings?: StoreApi<SettingsState>
  readonly repo?: SessionRepo
  /** The page's query string; e2e boots read it, production ignores it. */
  readonly search?: string
  readonly now?: () => number
  /** The synchronous mirror's storage; null disables it (tests), undefined uses localStorage. */
  readonly mirror?: MirrorStorage | null
}

/** What the boot calls on the e2e test-hooks module (`testHooks.ts`, in e2e builds only). */
interface E2eHooks {
  installTestHooks(store: StoreApi<GameState>): boolean
}

export interface BootResult {
  /** 'resumed' continues the stored session; anything else started fresh. */
  readonly started: 'resumed' | 'new' | 'fresh-after-corrupt' | 'fresh-after-error'
  /** A reload during `pendingReveal` must reveal instantly and never re-roll (plan §8). */
  readonly pendingReveal: boolean
}

export interface NewGameOptions {
  readonly presetId?: PresetId
  /** The chosen buy-in (plan §0 #19); remembered in settings for the next New game. */
  readonly bankroll?: Cents | null
  readonly seed?: string
}

/** Starts a new session (plan §0 #19), archiving the stored one; the store switches at once. */
export async function startNewGame(
  options: NewGameOptions = {},
  deps: BootDeps = {},
): Promise<void> {
  const store = deps.store ?? gameStore
  const settings = deps.settings ?? settingsStore
  const repo = deps.repo ?? sessionRepo
  const now = deps.now ?? (() => Date.now())
  // Like the bankroll: an explicit machine is remembered, no machine plays the remembered one.
  const presetId = options.presetId ?? rememberedMachine(settings.getState().machineId)
  const bankroll =
    options.bankroll !== undefined ? options.bankroll : settings.getState().startingBankroll
  // e2e builds play the e2e preset variant (M4 → M8 hand-off): the same machine with the pass
  // pinned to return-after-win, built by the test-hooks module only those builds contain.
  const cfg: MachineConfig =
    import.meta.env.MODE === 'e2e'
      ? (await import('./testHooks.ts')).e2eMachine(
          presetId,
          bankroll === null ? null : cents(bankroll),
        )
      : gameConfig(presetId, bankroll === null ? null : cents(bankroll))
  const seed = options.seed ?? newSessionSeed()
  const meta: SessionMeta = { id: `${seed}-${now()}`, createdAt: now(), divergent: false }
  if (options.bankroll !== undefined && options.bankroll !== null) {
    settings.getState().update({ startingBankroll: options.bankroll })
  }
  if (options.presetId !== undefined) {
    settings.getState().update({ machineId: options.presetId })
  }
  // Any mirrored tail belongs to the session this new game replaces.
  clearPendingMirror(deps.mirror)
  store.getState().startGame(cfg, seed, { meta })
  const session = store.getState().session
  if (session !== null) await repo.startSession(meta, session)
}

/** Resumes the stored session, or starts fresh when there is none (or it cannot be trusted). */
export async function bootGame(deps: BootDeps = {}): Promise<BootResult> {
  const store = deps.store ?? gameStore
  const settings = deps.settings ?? settingsStore
  const repo = deps.repo ?? sessionRepo

  // The e2e parameters force a fresh, scripted session; the module only exists in e2e builds.
  let e2eHooks: E2eHooks | null = null
  if (import.meta.env.MODE === 'e2e') {
    const hooks = await import('./testHooks.ts')
    e2eHooks = hooks
    const search = deps.search ?? (typeof location === 'undefined' ? '' : location.search)
    const params = hooks.readTestParams(search)
    if (params.diceMode !== null) settings.getState().update({ diceMode: params.diceMode })
    const forced =
      params.seed !== null ||
      params.presetId !== null ||
      params.bankroll !== null ||
      params.script !== null
    if (forced) {
      await startNewGame(
        {
          presetId: params.presetId ?? DEFAULT_PRESET_ID,
          bankroll: params.bankroll,
          seed: params.seed ?? undefined,
        },
        deps,
      )
      if (params.script !== null) store.getState().enqueueDice(params.script)
      hooks.installTestHooks(store)
      return { started: 'new', pendingReveal: false }
    }
  }

  const loaded = await repo.loadActive()
  if (loaded.kind === 'active') {
    const { meta, notice, pendingReveal } = loaded
    const cfg = headerMachine(loaded.session)
    // A betting change inside the autosave debounce — a bet, an undo or a clear — survives an
    // instant reload in the synchronous mirror (plan §8). It is restored only onto a clean resume
    // (this engine, no divergence) and only when its hash chain validates; the repo then saves the
    // mirrored window over the stored one at once.
    let session = loaded.session
    if (notice === null && !meta.divergent) {
      const extended = restorePendingMirror(meta, session, cfg, deps.mirror)
      if (extended !== null) {
        session = extended
        await repo.saveBetting(meta, session)
      }
    } else {
      clearPendingMirror(deps.mirror)
    }
    const history =
      meta.divergent || notice?.kind === 'divergence'
        ? emptyHistory(true)
        : historyFromWindows(
            replayHistory(session.header, session.committed, { anyEngineVersion: true }),
            undefined,
            cfg,
          )
    store.getState().restoreGame({ cfg, session, meta, notice, history })
    // e2e builds: the hooks go in with the resumed table, synchronously and before the writes
    // below, so a spec that sees the resumed table can always read it through them (a reload
    // during pendingReveal once showed the revealed dice before the hooks existed).
    if (import.meta.env.MODE === 'e2e') e2eHooks?.installTestHooks(store)
    // The stored state already holds the roll, so showing it IS the instant reveal (plan §8:
    // never re-roll); the flag has done its work and comes off.
    if (pendingReveal) await repo.clearPendingReveal(meta, session)
    // A version-stamped header (a verified cross-version resume) is saved back under this engine.
    if (notice?.kind === 'engineVersion') await repo.saveBetting(meta, session)
    return { started: 'resumed', pendingReveal }
  }

  await startNewGame({}, deps)
  if (import.meta.env.MODE === 'e2e') e2eHooks?.installTestHooks(store)
  return {
    started:
      loaded.kind === 'corrupt'
        ? 'fresh-after-corrupt'
        : loaded.kind === 'error'
          ? 'fresh-after-error'
          : 'new',
    pendingReveal: false,
  }
}

/** The compiled machine of a resumed session: the header's config, compiled once and reused. */
function headerMachine(session: WindowedSession): MachineConfig {
  return compileConfig(session.header.config)
}

export const BETTING_SAVE_DEBOUNCE_MS = 250

export interface AutosaveHandle {
  /** Writes any unsaved betting state now (also runs on `visibilitychange: hidden`/`pagehide`). */
  flush(): Promise<void>
  /** Stops saving and removes the listeners. */
  stop(): void
}

export interface AutosaveDeps {
  readonly store?: StoreApi<GameState>
  readonly repo?: SessionRepo
  readonly debounceMs?: number
  /** Event target for the hide listeners; null skips them (tests). */
  readonly pageEvents?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null
  readonly documentLike?: Pick<Document, 'visibilityState'> | null
  /** The synchronous mirror's storage; null disables it (tests), undefined uses localStorage. */
  readonly mirror?: MirrorStorage | null
}

/**
 * Saves the open betting window: on every session change in the `betting` phase, debounced, and
 * flushed when the page hides (plan §8). Rolls are not saved here — `rollFlow` commits them.
 */
export function wireAutosave(deps: AutosaveDeps = {}): AutosaveHandle {
  const store = deps.store ?? gameStore
  const repo = deps.repo ?? sessionRepo
  const debounceMs = deps.debounceMs ?? BETTING_SAVE_DEBOUNCE_MS
  const pageEvents =
    deps.pageEvents !== undefined ? deps.pageEvents : typeof window === 'undefined' ? null : window
  const documentLike =
    deps.documentLike !== undefined
      ? deps.documentLike
      : typeof document === 'undefined'
        ? null
        : document

  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false

  const save = async (): Promise<void> => {
    dirty = false
    const { meta, session, view } = store.getState()
    if (meta === null || session === null || view?.phase !== 'betting') return
    await repo.saveBetting(meta, session)
  }

  const schedule = (): void => {
    dirty = true
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void save()
    }, debounceMs)
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.session === previous.session) return
    if (state.view?.phase !== 'betting') return
    // The synchronous mirror first — an instant reload keeps the tail — then the debounced save.
    if (state.meta !== null && state.session !== null) {
      writePendingMirror(state.meta, state.session, deps.mirror)
    }
    schedule()
  })

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (dirty) await save()
  }

  const onHide = (): void => {
    if (documentLike === null || documentLike.visibilityState === 'hidden') void flush()
  }
  pageEvents?.addEventListener('visibilitychange', onHide)
  pageEvents?.addEventListener('pagehide', onHide)

  return {
    flush,
    stop: () => {
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
      timer = null
      pageEvents?.removeEventListener('visibilitychange', onHide)
      pageEvents?.removeEventListener('pagehide', onHide)
    },
  }
}
