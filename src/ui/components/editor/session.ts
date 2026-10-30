import type { StoreApi } from 'zustand/vanilla'
import { replayHistory } from '../../../engine/index.ts'
import type { Cents, MachineConfig } from '../../../engine/index.ts'
import type { ImportedFile } from '../../../persistence/exchange.ts'
import { clearPendingMirror, type MirrorStorage } from '../../../persistence/pendingMirror.ts'
import { MAX_IMPORT_CHARS } from '../../../persistence/safeJson.ts'
import type { SessionMeta, SessionRepo } from '../../../persistence/sessionRepo.ts'
import { newSessionSeed } from '../../services/seed.ts'
import type { GameState } from '../../state/gameStore.ts'
import { historyFromWindows } from '../../state/rollHistory.ts'
import type { SettingsState } from '../../state/settingsStore.ts'

/**
 * Starting and loading games outside the preset path (M12): a game on one of the player's own
 * machines, and a game loaded from a file. Both do what `startNewGame` does for a preset — the
 * stored session is archived and replaced, the pending-bet mirror cleared, the store switched at
 * once — so a reload resumes the new game like any other. Plus the browser's file plumbing: a
 * download from text, and a picked file read as text with its size checked first.
 */

export interface GameDeps {
  readonly store: StoreApi<GameState>
  readonly settings: StoreApi<SettingsState>
  readonly repo: SessionRepo
  readonly now?: () => number
  /** The pending-bet mirror's storage; null disables it (tests), undefined uses localStorage. */
  readonly mirror?: MirrorStorage | null
}

/** A new game on `cfg` (a saved machine, its buy-in applied), remembered as the last machine. */
export async function startMachineGame(
  cfg: MachineConfig,
  options: { readonly machineId: string; readonly bankroll: Cents | null; readonly seed?: string },
  deps: GameDeps,
): Promise<void> {
  const now = deps.now ?? (() => Date.now())
  const seed = options.seed ?? newSessionSeed()
  const meta: SessionMeta = { id: `${seed}-${now()}`, createdAt: now(), divergent: false }
  const remembered = { machineId: options.machineId }
  deps.settings
    .getState()
    .update(
      options.bankroll === null
        ? remembered
        : { ...remembered, startingBankroll: options.bankroll },
    )
  clearPendingMirror(deps.mirror)
  deps.store.getState().startGame(cfg, seed, { meta })
  const session = deps.store.getState().session
  if (session !== null) await deps.repo.startSession(meta, session)
}

/**
 * An imported game (`importFileText`) put in play: stored as the active session (its whole log),
 * its roll history rebuilt, and a cross-version notice shown when it was recorded on another
 * engine version and replayed the same here.
 */
export async function loadImportedGame(
  file: Extract<ImportedFile, { kind: 'session' }>,
  deps: GameDeps,
): Promise<void> {
  const now = deps.now ?? (() => Date.now())
  const { session, cfg, notice } = file
  const meta: SessionMeta = {
    id: `${session.header.seed}-import-${now()}`,
    createdAt: now(),
    divergent: false,
  }
  const history = historyFromWindows(
    replayHistory(session.header, session.committed, { anyEngineVersion: true }),
    undefined,
    cfg,
  )
  clearPendingMirror(deps.mirror)
  deps.store.getState().restoreGame({ cfg, session, meta, notice, history })
  await deps.repo.startSession(meta, session)
}

/** Offers `text` as a file download named `name` (JSON). */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked after the click has handed the URL to the download.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export type FileText =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string }

/** A picked file as text, refused before reading when it is larger than any trainer file. */
export async function readFileText(file: Blob, maxChars = MAX_IMPORT_CHARS): Promise<FileText> {
  // A character takes at most four bytes, so a file over four bytes a character cannot fit.
  if (file.size > maxChars * 4) {
    return { ok: false, error: 'The file is too large to be a trainer file.' }
  }
  try {
    return { ok: true, text: await file.text() }
  } catch {
    return { ok: false, error: 'The file could not be read.' }
  }
}
