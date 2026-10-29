/**
 * The exact module's caches, all keyed by config hash (and, below it, by everything else an
 * answer depends on), so a stale entry can never be served. They are registered here so that one
 * call empties them all: tests time cold computations with it, and an app can free memory.
 */

const caches: { clear(): void }[] = []

/** A new cache map, emptied by `clearAnalysisCache`. */
export function analysisCache<K, V>(): Map<K, V> {
  const cache = new Map<K, V>()
  caches.push(cache)
  return cache
}

/** Adds `value`, first dropping the oldest entry when the cache holds `limit` already. */
export function remember<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  if (cache.size >= limit) {
    const oldest = cache.keys().next()
    if (oldest.done !== true) cache.delete(oldest.value)
  }
  cache.set(key, value)
}

/** Empties every cache of the exact module. */
export function clearAnalysisCache(): void {
  for (const cache of caches) cache.clear()
}
