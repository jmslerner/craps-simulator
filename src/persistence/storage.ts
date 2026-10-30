import { createStore, del, delMany, get, keys, set, setMany, type UseStore } from 'idb-keyval'

/**
 * The IndexedDB key-value store (plan §8): idb-keyval on `createStore('bct', 'kv')`, behind
 * wrappers that never throw. Storage is the one part of the app that fails routinely (private
 * windows, cleared site data, quota), and a broken blob must never take the table down, so every
 * read and write returns a typed result instead of throwing, and the caller decides what a failure
 * means. `sessionRepo.ts` owns the session keys; `settings.ts` uses localStorage, not this store.
 */

export type StorageResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

/** Committed windows per `session:<id>:log:<k>` chunk (plan §8: up to 100 each). */
export const SESSION_CHUNK = 100

export const KEYS = {
  /** The one active session slot: the id whose head and log chunks are current. */
  current: 'session:current',
  /** The last finished session's summary (`LastResult`), written when a new game starts. */
  lastResult: 'session:lastResult',
  head: (id: string) => `session:${id}:head`,
  chunk: (id: string, index: number) => `session:${id}:log:${index}`,
  /** Every key of one session, as a prefix for cleanup. */
  sessionPrefix: (id: string) => `session:${id}:`,
  /** An invalid blob, moved aside so the next load starts fresh (plan §8). */
  corrupt: (timestamp: number) => `corrupt:${timestamp}`,
} as const

let store: UseStore | null = null
let storeError: string | null = null

/**
 * The shared store, created on first use. Creating it can itself throw (no `indexedDB` global in
 * some contexts), so even this is guarded; afterwards every call fails fast with the same error.
 */
function kvStore(): StorageResult<UseStore> {
  if (store !== null) return { ok: true, value: store }
  if (storeError !== null) return { ok: false, error: storeError }
  try {
    store = createStore('bct', 'kv')
    return { ok: true, value: store }
  } catch (error) {
    storeError = messageOf(error)
    return { ok: false, error: storeError }
  }
}

export async function safeGet<T>(key: string): Promise<StorageResult<T | undefined>> {
  const opened = kvStore()
  if (!opened.ok) return opened
  try {
    return { ok: true, value: await get<T>(key, opened.value) }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

export async function safeSet(key: string, value: unknown): Promise<StorageResult<undefined>> {
  const opened = kvStore()
  if (!opened.ok) return opened
  try {
    await set(key, value, opened.value)
    return { ok: true, value: undefined }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** Several writes in one transaction: idb-keyval's `setMany` is atomic (plan §8). */
export async function safeSetMany(
  entries: readonly (readonly [string, unknown])[],
): Promise<StorageResult<undefined>> {
  const opened = kvStore()
  if (!opened.ok) return opened
  try {
    await setMany(
      entries.map(([key, value]) => [key, value]),
      opened.value,
    )
    return { ok: true, value: undefined }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

export async function safeDel(key: string): Promise<StorageResult<undefined>> {
  const opened = kvStore()
  if (!opened.ok) return opened
  try {
    await del(key, opened.value)
    return { ok: true, value: undefined }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** Every key in the store, for prefix cleanups; string keys only (ours all are). */
export async function safeKeys(): Promise<StorageResult<readonly string[]>> {
  const opened = kvStore()
  if (!opened.ok) return opened
  try {
    const all = await keys(opened.value)
    return { ok: true, value: all.filter((key): key is string => typeof key === 'string') }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

export async function safeDelMany(targets: readonly string[]): Promise<StorageResult<undefined>> {
  const opened = kvStore()
  if (!opened.ok) return opened
  try {
    await delMany([...targets], opened.value)
    return { ok: true, value: undefined }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/**
 * Asks the browser to protect the store from eviction (plan §8). Best effort: some browsers
 * refuse, some lack the API, and nothing here depends on the answer.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
