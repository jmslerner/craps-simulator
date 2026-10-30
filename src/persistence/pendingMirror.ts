import { z } from 'zod'
import { ENGINE_VERSION, clearWindow, dispatchBetting, hashJson } from '../engine/index.ts'
import type { Action, MachineConfig, WindowedSession } from '../engine/index.ts'
import type { SessionMeta } from './sessionRepo.ts'

/**
 * The synchronous mirror of the open betting window (plan §8). The autosave's IndexedDB write is
 * debounced and asynchronous, so a betting change in the last ~250 ms before an instant reload
 * would die with the page: the browser abandons the transaction at teardown. `localStorage` writes
 * are synchronous, so `wireAutosave` mirrors the whole open window here on every betting change —
 * a bet placed, and just as much an undo or a clear — and the next boot restores THAT window over
 * the stored one, but ONLY when the hash chain validates: same session, same engine version, same
 * config, same committed-window count, the mirrored actions re-played through `dispatchBetting`
 * from the stored window (a tail that extends it) or from the window's start (a shorter or
 * different pending: an undo or clear inside the debounce after a flush, M9 audit MINOR-4), and
 * the resulting state hash equal to the one the mirror recorded. Anything else is discarded (junk
 * is quarantined aside), and nothing in here ever throws: the mirror is a safety net, never a
 * second source of truth. Committed rolls never need it — `commitRoll` is awaited before any
 * animation.
 */

export const PENDING_MIRROR_KEY = 'bct:v1:pendingMirror'
/** Junk found under the mirror key is moved here (best effort), so a bad blob is kept for debugging. */
export const PENDING_MIRROR_CORRUPT_KEY = 'bct:v1:pendingMirror:corrupt'

export interface PendingMirror {
  readonly v: 1
  /** `SessionMeta.id` of the session the window belongs to. */
  readonly id: string
  readonly engineVersion: number
  readonly configHash: string
  /** Committed windows at mirror time; a roll in between makes the mirror stale. */
  readonly windowCount: number
  /** The whole open window as it is now, not a diff: it may extend, shorten or replace the stored one. */
  readonly pending: readonly Action[]
  /** `hashJson` of the table the window left: the restore must reproduce it exactly. */
  readonly stateHash: string
}

const isPlainObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const MirrorSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  engineVersion: z.int().min(1),
  configHash: z.string().regex(/^[0-9a-f]{16}$/),
  windowCount: z.int().min(0),
  pending: z.array(z.custom<Action>(isPlainObject)),
  stateHash: z.string().regex(/^[0-9a-f]{16}$/),
})

export type MirrorStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): MirrorStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Mirrors the open window now, synchronously; failures (quota, no storage) change nothing. */
export function writePendingMirror(
  meta: SessionMeta,
  session: WindowedSession,
  storage: MirrorStorage | null = defaultStorage(),
): void {
  if (storage === null) return
  const mirror: PendingMirror = {
    v: 1,
    id: meta.id,
    engineVersion: ENGINE_VERSION,
    configHash: session.header.configHash,
    windowCount: session.committed.length,
    pending: session.pending,
    stateHash: hashJson(session.state),
  }
  try {
    storage.setItem(PENDING_MIRROR_KEY, JSON.stringify(mirror))
  } catch {
    // A mirror that cannot be written must not linger stale; losing it only loses the net.
    clearPendingMirror(storage)
  }
}

export function clearPendingMirror(storage: MirrorStorage | null = defaultStorage()): void {
  if (storage === null) return
  try {
    storage.removeItem(PENDING_MIRROR_KEY)
  } catch {
    // Nothing to do: the mirror is best effort.
  }
}

/**
 * Consumes the mirror (one shot: it is removed as it is read) and returns the window it describes,
 * rebuilt onto the stored session, or null when there is nothing safe to restore. A mirror that
 * extends the stored pending replays only the tail; one that shortens or differs from it (an undo
 * or clear inside the debounce after a flush) replays its whole pending from the window's start.
 * Either way the result must hash to what the mirror recorded, so a stale or tampered mirror can
 * neither resurrect an undone bet nor invent one. The caller saves the returned window over the
 * stored head (replacing its tail). Junk under the key is quarantined to
 * `PENDING_MIRROR_CORRUPT_KEY`; a mirror equal to the stored window is simply dropped. Never throws.
 */
export function restorePendingMirror(
  meta: SessionMeta,
  session: WindowedSession,
  cfg: MachineConfig,
  storage: MirrorStorage | null = defaultStorage(),
): WindowedSession | null {
  if (storage === null) return null
  try {
    const text = storage.getItem(PENDING_MIRROR_KEY)
    if (text === null) return null
    storage.removeItem(PENDING_MIRROR_KEY)

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      quarantine(storage, text, 'not JSON')
      return null
    }
    const checked = MirrorSchema.safeParse(parsed)
    if (!checked.success) {
      quarantine(storage, text, 'wrong shape')
      return null
    }
    const mirror = checked.data

    // The mirror must describe exactly this stored session, on this engine and config.
    if (
      mirror.id !== meta.id ||
      mirror.engineVersion !== ENGINE_VERSION ||
      mirror.configHash !== session.header.configHash ||
      mirror.windowCount !== session.committed.length
    ) {
      return null
    }
    const stored = hashJson(session.pending)
    // The stored window already is the mirrored one: nothing to restore.
    if (mirror.pending.length === session.pending.length && hashJson(mirror.pending) === stored) {
      return null
    }

    // A tail that extends the stored pending replays from the stored table; anything else (an
    // undo, a clear, a cleared-and-rebet window) replays the mirrored window from its start.
    const extends_ =
      mirror.pending.length > session.pending.length &&
      hashJson(mirror.pending.slice(0, session.pending.length)) === stored
    let rebuilt = extends_ ? session : clearWindow(session, cfg)
    const replay = extends_ ? mirror.pending.slice(session.pending.length) : mirror.pending
    for (const action of replay) {
      const result = dispatchBetting(rebuilt, action, cfg)
      if (!result.ok) return null
      rebuilt = result.session
    }
    if (hashJson(rebuilt.state) !== mirror.stateHash) return null
    return rebuilt
  } catch {
    return null
  }
}

function quarantine(storage: MirrorStorage, text: string, error: string): void {
  try {
    storage.setItem(PENDING_MIRROR_CORRUPT_KEY, JSON.stringify({ error, text }))
  } catch {
    // Best effort only.
  }
}
