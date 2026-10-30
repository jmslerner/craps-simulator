import { z } from 'zod'
import {
  ENGINE_VERSION,
  ReplayError,
  hashJson,
  lastWindowOf,
  resumeSession,
} from '../engine/index.ts'
import type {
  Action,
  Ledger,
  MachineConfigInput,
  ReplayFailure,
  SessionHeader,
  TableState,
  WindowRecord,
  WindowedSession,
} from '../engine/index.ts'
import {
  KEYS,
  SESSION_CHUNK,
  requestPersistence,
  safeDelMany,
  safeGet,
  safeKeys,
  safeSet,
  safeSetMany,
} from './storage.ts'

/**
 * The session store (plan §8): one active session slot in IndexedDB, written before anything is
 * revealed and read back at boot.
 *
 * - `session:<id>:head` holds everything but the committed log: the header, the open window and
 *   the current table. `commitRoll` writes it with `pendingReveal: true` together with the latest
 *   log chunk in one atomic `setMany`, BEFORE any animation (plan §6 roll flow step 2), so a
 *   reload mid-animation reveals the stored outcome and never re-rolls.
 * - `session:<id>:log:<k>` holds up to 100 committed windows each.
 * - Loading resumes with `resumeSession(header, committed, pending, { expectHash })`, replayed and
 *   hash-checked. A log from another `ENGINE_VERSION` is verified with `{ anyEngineVersion: true }`;
 *   on divergence the stored state is kept, the head marked divergent, and the notice surfaced as
 *   data (plan §8). Junk in storage never throws out of the repo: an invalid blob is moved to
 *   `corrupt:<ts>` and the load reports `corrupt`, so the shell starts fresh.
 * - A new game archives the old session as a `LastResult` summary and reuses the single slot.
 */

/** The shell's handle on the stored session: identity and the divergence mark, plain data. */
export interface SessionMeta {
  readonly id: string
  readonly createdAt: number
  /** The log no longer replays on this engine; the stored state is the session's truth. */
  readonly divergent: boolean
}

/** The notice a resume can surface (plan §8); data for the UI, never a throw. */
export type SessionNotice =
  | { readonly kind: 'engineVersion'; readonly from: number; readonly to: number }
  | { readonly kind: 'divergence'; readonly from: number; readonly failure: ReplayFailure }

/** The `session:<id>:head` blob. */
export interface SessionHead {
  readonly id: string
  readonly createdAt: number
  readonly divergent: boolean
  /** What made the log divergent, kept so later loads surface the same notice. */
  readonly divergence: ReplayFailure | null
  readonly header: SessionHeader
  /** Committed windows in the log chunks. */
  readonly windowCount: number
  readonly windowStart: TableState
  readonly pending: readonly Action[]
  readonly state: TableState
  /** `hashJson(state)`: the integrity check for loads that do not replay. */
  readonly stateHash: string
  /** A roll is stored but not yet shown; a reload reveals it instantly and never re-rolls. */
  readonly pendingReveal: boolean
  /** The dome's rest pose (M10); stored and returned untouched. */
  readonly diceRest?: unknown
}

/** The previous session's summary, kept when a new game takes the slot. */
export interface LastResult {
  readonly id: string
  readonly endedAt: number
  readonly machineId: string
  readonly machineName: string
  readonly rolls: number
  readonly hands: number
  readonly ledger: Ledger
}

export type RepoWrite = { readonly ok: true } | { readonly ok: false; readonly error: string }

export type ActiveLoad =
  | { readonly kind: 'none' }
  /** Junk was found and quarantined; the shell starts fresh. */
  | { readonly kind: 'corrupt'; readonly error: string }
  /** Storage itself failed; the shell starts fresh and plays unpersisted. */
  | { readonly kind: 'error'; readonly error: string }
  | {
      readonly kind: 'active'
      readonly meta: SessionMeta
      readonly session: WindowedSession
      readonly head: SessionHead
      readonly pendingReveal: boolean
      readonly notice: SessionNotice | null
    }

const isPlainObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const HeadSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  divergent: z.boolean(),
  divergence: z.custom<ReplayFailure>(isPlainObject).nullable(),
  header: z.object({
    engineVersion: z.int().min(1),
    configHash: z.string().regex(/^[0-9a-f]{16}$/),
    seed: z.string(),
    config: z.custom<MachineConfigInput>(isPlainObject),
  }),
  windowCount: z.int().min(0),
  windowStart: z.custom<TableState>(isPlainObject),
  pending: z.array(z.custom<Action>(isPlainObject)),
  state: z.custom<TableState>(isPlainObject),
  stateHash: z.string().regex(/^[0-9a-f]{16}$/),
  pendingReveal: z.boolean(),
  diceRest: z.unknown().optional(),
})

function isWindowRecord(value: unknown): value is WindowRecord {
  if (!isPlainObject(value)) return false
  const record = value as Partial<Record<keyof WindowRecord, unknown>>
  return (
    Array.isArray(record.actions) &&
    isPlainObject(record.roll) &&
    (record.roll as { readonly type?: unknown }).type === 'roll' &&
    typeof record.hashAfter === 'string'
  )
}

function metaOf(head: SessionHead): SessionMeta {
  return { id: head.id, createdAt: head.createdAt, divergent: head.divergent }
}

function buildHead(
  meta: SessionMeta,
  session: WindowedSession,
  options: {
    readonly pendingReveal: boolean
    readonly divergence?: ReplayFailure | null
    readonly diceRest?: unknown
  },
): SessionHead {
  return {
    id: meta.id,
    createdAt: meta.createdAt,
    divergent: meta.divergent,
    divergence: options.divergence ?? null,
    header: session.header,
    windowCount: session.committed.length,
    windowStart: session.windowStart,
    pending: session.pending,
    state: session.state,
    stateHash: hashJson(session.state),
    pendingReveal: options.pendingReveal,
    diceRest: options.diceRest ?? null,
  }
}

/** The stored session without a replay: the divergent path keeps the state the head holds. */
function storedSession(head: SessionHead, committed: readonly WindowRecord[]): WindowedSession {
  return {
    header: head.header,
    committed,
    windowStart: head.windowStart,
    pending: head.pending,
    state: head.state,
    lastWindow: lastWindowOf(committed),
  }
}

/** Moves an invalid blob aside (`corrupt:<ts>`) so the next load starts fresh; best effort. */
async function quarantine(
  error: string,
  blobs: readonly (readonly [string, unknown])[],
  now: () => number,
): Promise<ActiveLoad> {
  await safeSet(KEYS.corrupt(now()), { error, blobs })
  await safeDelMany([KEYS.current, ...blobs.map(([key]) => key)])
  return { kind: 'corrupt', error }
}

export interface SessionRepo {
  /** Takes the slot for a new session: archives the old one, then writes head and pointer. */
  startSession(meta: SessionMeta, session: WindowedSession): Promise<RepoWrite>
  /** Saves the open window (debounced by the caller; flushed on hide). */
  saveBetting(meta: SessionMeta, session: WindowedSession): Promise<RepoWrite>
  /**
   * Commits a roll: the head (`pendingReveal: true`) and the latest log chunk, in one atomic
   * `setMany`, before any animation (plan §6 roll flow step 2). `session` is the session the roll
   * returned, `record` the committed window.
   */
  commitRoll(meta: SessionMeta, session: WindowedSession, record: WindowRecord): Promise<RepoWrite>
  /** After the reveal: the head again with `pendingReveal: false`. */
  clearPendingReveal(meta: SessionMeta, session: WindowedSession): Promise<RepoWrite>
  /** The active session, resumed and verified; never throws. */
  loadActive(): Promise<ActiveLoad>
  readLastResult(): Promise<LastResult | null>
}

export interface SessionRepoOptions {
  /** The clock for `corrupt:<ts>` keys and `LastResult.endedAt`; injectable for tests. */
  readonly now?: () => number
}

export function createSessionRepo(options: SessionRepoOptions = {}): SessionRepo {
  const now = options.now ?? (() => Date.now())

  async function archiveCurrent(): Promise<void> {
    const current = await safeGet<string>(KEYS.current)
    if (!current.ok || current.value === undefined) return
    const id = current.value
    const head = await safeGet<unknown>(KEYS.head(id))
    if (head.ok && head.value !== undefined) {
      const parsed = HeadSchema.safeParse(head.value)
      if (parsed.success) {
        const old = parsed.data as SessionHead
        const result: LastResult = {
          id: old.id,
          endedAt: now(),
          machineId: old.header.config.id,
          machineName: old.header.config.name,
          rolls: old.state.round.rollIndex,
          hands: old.state.round.hand.index + 1,
          ledger: old.state.ledger,
        }
        await safeSet(KEYS.lastResult, result)
      }
    }
    // The slot is single, so the old session's keys go; `keys()` also sweeps older leftovers.
    const all = await safeKeys()
    if (all.ok) {
      const stale = all.value.filter((key) => key.startsWith(KEYS.sessionPrefix(id)))
      if (stale.length > 0) await safeDelMany(stale)
    }
  }

  return {
    async startSession(meta, session) {
      await archiveCurrent()
      const head = buildHead(meta, session, { pendingReveal: false })
      // A new game has no committed windows; a session handed over with some (an import, a test)
      // stores its whole log here, so the head's windowCount always has its chunks.
      const chunks: (readonly [string, unknown])[] = []
      for (let index = 0; index * SESSION_CHUNK < session.committed.length; index++) {
        chunks.push([
          KEYS.chunk(meta.id, index),
          session.committed.slice(index * SESSION_CHUNK, (index + 1) * SESSION_CHUNK),
        ])
      }
      const written = await safeSetMany([
        [KEYS.head(meta.id), head],
        ...chunks,
        [KEYS.current, meta.id],
      ])
      if (!written.ok) return written
      await requestPersistence()
      return { ok: true }
    },

    async saveBetting(meta, session) {
      const head = buildHead(meta, session, { pendingReveal: false })
      return safeSet(KEYS.head(meta.id), head)
    },

    async commitRoll(meta, session, record) {
      const windows = session.committed
      if (windows.length === 0 || windows[windows.length - 1] !== record) {
        return { ok: false, error: 'commitRoll needs the session the roll returned' }
      }
      const chunk = Math.trunc((windows.length - 1) / SESSION_CHUNK)
      const head = buildHead(meta, session, { pendingReveal: true })
      return safeSetMany([
        [KEYS.head(meta.id), head],
        [KEYS.chunk(meta.id, chunk), windows.slice(chunk * SESSION_CHUNK)],
      ])
    },

    async clearPendingReveal(meta, session) {
      const head = buildHead(meta, session, { pendingReveal: false })
      return safeSet(KEYS.head(meta.id), head)
    },

    async loadActive() {
      const current = await safeGet<string>(KEYS.current)
      if (!current.ok) return { kind: 'error', error: current.error }
      if (current.value === undefined) return { kind: 'none' }
      const id = current.value
      if (typeof id !== 'string' || id.length === 0) {
        return quarantine('session:current is not an id', [[KEYS.current, id]], now)
      }

      const headBlob = await safeGet<unknown>(KEYS.head(id))
      if (!headBlob.ok) return { kind: 'error', error: headBlob.error }
      if (headBlob.value === undefined) {
        return quarantine(`session ${id} has no head`, [], now)
      }
      const parsedHead = HeadSchema.safeParse(headBlob.value)
      if (!parsedHead.success) {
        const error = `session ${id} head is invalid: ${parsedHead.error.issues
          .map((issue) => issue.path.join('.') || '/')
          .join(', ')}`
        return quarantine(error, [[KEYS.head(id), headBlob.value]], now)
      }
      const head = parsedHead.data as SessionHead

      const committed: WindowRecord[] = []
      const chunkCount = Math.ceil(head.windowCount / SESSION_CHUNK)
      for (let index = 0; index < chunkCount; index++) {
        const chunk = await safeGet<unknown>(KEYS.chunk(id, index))
        if (!chunk.ok) return { kind: 'error', error: chunk.error }
        if (!Array.isArray(chunk.value) || !chunk.value.every(isWindowRecord)) {
          return quarantine(
            `session ${id} log chunk ${index} is invalid`,
            [
              [KEYS.head(id), headBlob.value],
              [KEYS.chunk(id, index), chunk.value],
            ],
            now,
          )
        }
        committed.push(...chunk.value)
      }
      if (committed.length < head.windowCount) {
        return quarantine(
          `session ${id} log holds ${committed.length} of ${head.windowCount} windows`,
          [[KEYS.head(id), headBlob.value]],
          now,
        )
      }
      // A chunk can hold windows from after the head was written; the head's count is the truth.
      committed.length = head.windowCount

      // A session already marked divergent is not replayed again: the stored state is its truth,
      // checked against the head's own hash.
      if (head.divergent) {
        if (hashJson(head.state) !== head.stateHash) {
          return quarantine(
            `session ${id} stored state does not match its hash`,
            [[KEYS.head(id), headBlob.value]],
            now,
          )
        }
        return {
          kind: 'active',
          meta: metaOf(head),
          session: storedSession(head, committed),
          head,
          pendingReveal: head.pendingReveal,
          notice: {
            kind: 'divergence',
            from: head.header.engineVersion,
            failure: head.divergence ?? {
              kind: 'engineVersion',
              logged: head.header.engineVersion,
              current: ENGINE_VERSION,
            },
          },
        }
      }

      try {
        const session = resumeSession(head.header, committed, head.pending, {
          expectHash: head.stateHash,
        })
        return {
          kind: 'active',
          meta: metaOf(head),
          session,
          head,
          pendingReveal: head.pendingReveal,
          notice: null,
        }
      } catch (error) {
        if (!(error instanceof ReplayError)) throw error
        if (error.failure.kind !== 'engineVersion') {
          return quarantine(
            `session ${id} does not replay: ${error.message}`,
            [[KEYS.head(id), headBlob.value]],
            now,
          )
        }
      }

      // The log is from another engine version (plan §8): verify it still plays the same here.
      const from = head.header.engineVersion
      try {
        const session = resumeSession(head.header, committed, head.pending, {
          expectHash: head.stateHash,
          anyEngineVersion: true,
        })
        return {
          kind: 'active',
          meta: metaOf(head),
          session,
          head,
          pendingReveal: head.pendingReveal,
          notice: { kind: 'engineVersion', from, to: ENGINE_VERSION },
        }
      } catch (error) {
        if (!(error instanceof ReplayError)) throw error
        // Divergence: keep the stored state, mark the session, and surface the notice as data.
        if (hashJson(head.state) !== head.stateHash) {
          return quarantine(
            `session ${id} stored state does not match its hash`,
            [[KEYS.head(id), headBlob.value]],
            now,
          )
        }
        const divergent: SessionHead = {
          ...head,
          divergent: true,
          divergence: error.failure,
        }
        await safeSet(KEYS.head(id), divergent)
        return {
          kind: 'active',
          meta: metaOf(divergent),
          session: storedSession(divergent, committed),
          head: divergent,
          pendingReveal: divergent.pendingReveal,
          notice: { kind: 'divergence', from, failure: error.failure },
        }
      }
    },

    async readLastResult() {
      const stored = await safeGet<unknown>(KEYS.lastResult)
      if (!stored.ok || stored.value === undefined || !isPlainObject(stored.value)) return null
      const result = stored.value as Partial<LastResult>
      if (typeof result.id !== 'string' || !isPlainObject(result.ledger)) return null
      return stored.value as LastResult
    },
  }
}

/** The app's repo; tests build their own with a pinned clock. */
export const sessionRepo: SessionRepo = createSessionRepo()
