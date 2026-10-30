import { describe, expect, it } from 'vitest'
import {
  ENGINE_VERSION,
  PRESETS,
  cents,
  compileConfig,
  dispatchBetting,
  hashJson,
  newSession,
} from '../engine/index.ts'
import type { Action, WindowedSession } from '../engine/index.ts'
import {
  PENDING_MIRROR_CORRUPT_KEY,
  PENDING_MIRROR_KEY,
  clearPendingMirror,
  restorePendingMirror,
  writePendingMirror,
  type MirrorStorage,
} from './pendingMirror.ts'
import type { SessionMeta } from './sessionRepo.ts'

/**
 * The synchronous pending mirror (plan §8): written on every betting change, restored at boot only
 * when the hash chain validates — a tail that extends the stored head replayed onto it, a shorter
 * or different window (an undo or clear inside the debounce after a flush, M9 audit) replayed from
 * the window's start — with junk quarantined and never a throw.
 */

const cfg = compileConfig(PRESETS.craplessBubble)
const META: SessionMeta = { id: 'mirror-test-1', createdAt: 1_730_000_000_000, divergent: false }

function memoryStorage(): MirrorStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

function bet(amount: number, typeId = 'pass'): Action {
  return { type: 'place', typeId, amount: cents(amount) }
}

function play(...actions: readonly Action[]): WindowedSession {
  let session = newSession(cfg, 'mirror-test')
  for (const action of actions) {
    const result = dispatchBetting(session, action, cfg)
    if (!result.ok) throw new Error(`test action refused: ${result.rejection.code}`)
    session = result.session
  }
  return session
}

describe('writePendingMirror', () => {
  it('mirrors the open window synchronously, as JSON under its own key', () => {
    const storage = memoryStorage()
    const session = play(bet(500), bet(600, 'field'))
    writePendingMirror(META, session, storage)
    const stored = JSON.parse(storage.map.get(PENDING_MIRROR_KEY)!) as Record<string, unknown>
    expect(stored).toMatchObject({
      v: 1,
      id: META.id,
      windowCount: 0,
      stateHash: hashJson(session.state),
    })
    expect(stored.pending).toHaveLength(2)
  })

  it('never throws when storage is full or missing', () => {
    const broken: MirrorStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => writePendingMirror(META, play(bet(500)), broken)).not.toThrow()
    expect(() => clearPendingMirror(broken)).not.toThrow()
    expect(() => restorePendingMirror(META, play(bet(500)), cfg, broken)).not.toThrow()
  })
})

describe('restorePendingMirror', () => {
  it('restores a tail that cleanly extends the stored head, consuming the mirror', () => {
    const storage = memoryStorage()
    const head = play(bet(500))
    const full = play(bet(500), bet(600, 'field'), { type: 'deposit', amount: cents(10_000) })
    writePendingMirror(META, full, storage)

    const restored = restorePendingMirror(META, head, cfg, storage)
    expect(restored).not.toBeNull()
    expect(restored?.pending).toHaveLength(3)
    expect(hashJson(restored!.state)).toBe(hashJson(full.state))
    // One shot: the mirror was consumed as it was read.
    expect(storage.map.has(PENDING_MIRROR_KEY)).toBe(false)
    expect(storage.map.has(PENDING_MIRROR_CORRUPT_KEY)).toBe(false)
  })

  it('restores a SHRUNK window: an undo inside the debounce after a flush replaces the stored tail (M9 audit)', () => {
    const storage = memoryStorage()
    const flushed = play(bet(500), bet(600, 'field')) // the stored head, saved before the undo
    const undone = play(bet(500)) // the live window after Undo, mirrored synchronously
    writePendingMirror(META, undone, storage)

    const restored = restorePendingMirror(META, flushed, cfg, storage)
    expect(restored).not.toBeNull()
    expect(restored?.pending).toHaveLength(1)
    expect(hashJson(restored!.state)).toBe(hashJson(undone.state))
    expect(restored!.state.bets.some((b) => b.typeId === 'field')).toBe(false)
    expect(storage.map.has(PENDING_MIRROR_KEY)).toBe(false)
  })

  it('restores an EMPTIED window: a clear inside the debounce brings the table back to the window start', () => {
    const storage = memoryStorage()
    const flushed = play(bet(500), bet(600, 'field'))
    const cleared = play()
    writePendingMirror(META, cleared, storage)
    const restored = restorePendingMirror(META, flushed, cfg, storage)
    expect(restored).not.toBeNull()
    expect(restored?.pending).toEqual([])
    expect(hashJson(restored!.state)).toBe(hashJson(flushed.windowStart))
  })

  it('restores a REPLACED window: cleared and re-bet inside the debounce, neither a prefix of the other', () => {
    const storage = memoryStorage()
    const flushed = play(bet(500), bet(600, 'field'))
    const rebet = play(bet(700, 'field'), bet(500))
    writePendingMirror(META, rebet, storage)
    const restored = restorePendingMirror(META, flushed, cfg, storage)
    expect(restored).not.toBeNull()
    expect(hashJson(restored!.state)).toBe(hashJson(rebet.state))
    expect(restored!.pending).toEqual(rebet.pending)
  })

  it('drops a shrunk or replaced mirror whose recorded hash the replay does not reach', () => {
    const storage = memoryStorage()
    const flushed = play(bet(500), bet(600, 'field'))
    const undone = play(bet(500))
    writePendingMirror(META, undone, storage)
    const text = storage.map.get(PENDING_MIRROR_KEY)!
    storage.setItem(
      PENDING_MIRROR_KEY,
      JSON.stringify({ ...(JSON.parse(text) as object), stateHash: '0123456789abcdef' }),
    )
    expect(restorePendingMirror(META, flushed, cfg, storage)).toBeNull()
    expect(storage.map.has(PENDING_MIRROR_KEY)).toBe(false)
  })

  it('returns null when the mirror only equals the head (nothing to extend)', () => {
    const storage = memoryStorage()
    const head = play(bet(500))
    writePendingMirror(META, head, storage)
    expect(restorePendingMirror(META, head, cfg, storage)).toBeNull()
  })

  it('quarantines junk instead of throwing: not JSON', () => {
    const storage = memoryStorage()
    storage.setItem(PENDING_MIRROR_KEY, '{nope')
    expect(restorePendingMirror(META, play(bet(500)), cfg, storage)).toBeNull()
    expect(storage.map.has(PENDING_MIRROR_KEY)).toBe(false)
    expect(JSON.parse(storage.map.get(PENDING_MIRROR_CORRUPT_KEY)!)).toMatchObject({
      error: 'not JSON',
    })
  })

  it('quarantines junk instead of throwing: wrong shape', () => {
    const storage = memoryStorage()
    storage.setItem(PENDING_MIRROR_KEY, JSON.stringify({ v: 1, id: 'x' }))
    expect(restorePendingMirror(META, play(bet(500)), cfg, storage)).toBeNull()
    expect(storage.map.has(PENDING_MIRROR_CORRUPT_KEY)).toBe(true)
  })

  it('drops a mirror from another session, engine stamp or window count', () => {
    const storage = memoryStorage()
    const session = play(bet(500), bet(600, 'field'))
    writePendingMirror(META, session, storage)
    expect(
      restorePendingMirror({ ...META, id: 'another-session' }, play(bet(500)), cfg, storage),
    ).toBeNull()
    expect(storage.map.has(PENDING_MIRROR_KEY)).toBe(false) // consumed, not reapplied later

    // A stale engine stamp is dropped the same way.
    writePendingMirror(META, session, storage)
    const text = storage.map.get(PENDING_MIRROR_KEY)!
    storage.setItem(
      PENDING_MIRROR_KEY,
      JSON.stringify({ ...(JSON.parse(text) as object), engineVersion: 999 }),
    )
    expect(restorePendingMirror(META, play(bet(500)), cfg, storage)).toBeNull()

    // A window count from before a committed roll no longer matches the head.
    writePendingMirror(META, session, storage)
    storage.setItem(
      PENDING_MIRROR_KEY,
      JSON.stringify({ ...(JSON.parse(text) as object), windowCount: 3 }),
    )
    expect(restorePendingMirror(META, play(bet(500)), cfg, storage)).toBeNull()
  })

  it('a differing window is rebuilt from the window start — and dropped when the engine refuses it', () => {
    const storage = memoryStorage()
    const mirrored = play(bet(500), bet(600, 'field'))
    writePendingMirror(META, mirrored, storage)
    // The head holds a different first action: the mirror is no prefix extension, so the whole
    // mirrored window is replayed from the start and restored on its hash.
    const restored = restorePendingMirror(META, play(bet(700)), cfg, storage)
    expect(restored).not.toBeNull()
    expect(hashJson(restored!.state)).toBe(hashJson(mirrored.state))

    // The same shape with an action the table refuses restores nothing.
    const refused = {
      v: 1,
      id: META.id,
      engineVersion: ENGINE_VERSION,
      configHash: mirrored.header.configHash,
      windowCount: 0,
      pending: [bet(99_999_900)], // far over the $500 per-bet maximum
      stateHash: hashJson(mirrored.state),
    }
    storage.setItem(PENDING_MIRROR_KEY, JSON.stringify(refused))
    expect(restorePendingMirror(META, play(bet(700)), cfg, storage)).toBeNull()
  })

  it('drops a tail the engine refuses, and one that misses its recorded state hash', () => {
    const storage = memoryStorage()
    const head = play(bet(500))
    const refused = {
      v: 1,
      id: META.id,
      engineVersion: ENGINE_VERSION,
      configHash: head.header.configHash,
      windowCount: 0,
      pending: [...head.pending, bet(99_999_900)], // far over the $500 per-bet maximum
      stateHash: hashJson(head.state),
    }
    storage.setItem(PENDING_MIRROR_KEY, JSON.stringify(refused))
    expect(restorePendingMirror(META, head, cfg, storage)).toBeNull()

    const full = play(bet(500), bet(600, 'field'))
    storage.setItem(
      PENDING_MIRROR_KEY,
      JSON.stringify({
        ...refused,
        pending: full.pending,
        stateHash: '0000000000000000',
      }),
    )
    expect(restorePendingMirror(META, head, cfg, storage)).toBeNull()
  })
})
