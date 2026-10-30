import { MAX_BATCH_DEPTH } from '../engine/session/window.ts'

/**
 * Untrusted JSON in, a plain value out — or why not, never a throw (M12: files the player
 * imports). Three guards run before anything reads the value:
 *
 * - **Size:** a file larger than any session the trainer writes is refused before it is read.
 * - **Nesting:** the text is scanned for its deepest bracket before `JSON.parse` sees it, so a
 *   crafted file nested a hundred thousand deep is refused instead of exhausting the stack. The
 *   cap leaves room for the deepest log the engine can write: a batch nested `MAX_BATCH_DEPTH`
 *   deep is two JSON levels a batch (the object and its `actions` array) under a few of the log's
 *   own; the batch depth itself is checked exactly afterwards (`batchDepthOf`).
 * - **Keys:** `__proto__`, `constructor` and `prototype` appear in no file the trainer writes, and
 *   an object built from them can reach a prototype once copied with assignment, so any key so
 *   named, at any depth, refuses the whole file.
 */

/** The largest import accepted: a 200-roll session is about 100 kB; this is far beyond any. */
export const MAX_IMPORT_CHARS = 8_000_000

/** The deepest bracket nesting accepted (see the module comment). */
export const MAX_JSON_DEPTH = 2 * MAX_BATCH_DEPTH + 32

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

export type JsonGuardError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'size'; readonly chars: number; readonly max: number }
  | { readonly kind: 'depth'; readonly max: number }
  | { readonly kind: 'json'; readonly message: string }
  | { readonly kind: 'key'; readonly key: string }

export type SafeJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: JsonGuardError }

export interface JsonLimits {
  readonly maxChars?: number
  readonly maxDepth?: number
}

/** `text` parsed behind the three guards (see the module comment). */
export function parseJsonSafely(text: string, limits: JsonLimits = {}): SafeJsonResult {
  const maxChars = limits.maxChars ?? MAX_IMPORT_CHARS
  const maxDepth = limits.maxDepth ?? MAX_JSON_DEPTH
  if (text.trim() === '') return { ok: false, error: { kind: 'empty' } }
  if (text.length > maxChars) {
    return { ok: false, error: { kind: 'size', chars: text.length, max: maxChars } }
  }
  if (deepestNesting(text, maxDepth) > maxDepth) {
    return { ok: false, error: { kind: 'depth', max: maxDepth } }
  }
  let forbidden: string | null = null
  let value: unknown
  try {
    value = JSON.parse(text, (key: string, item: unknown) => {
      if (forbidden === null && FORBIDDEN_KEYS.has(key)) forbidden = key
      return item
    })
  } catch (error) {
    return {
      ok: false,
      error: { kind: 'json', message: error instanceof Error ? error.message : String(error) },
    }
  }
  if (forbidden !== null) return { ok: false, error: { kind: 'key', key: forbidden } }
  return { ok: true, value }
}

/**
 * The deepest `{`/`[` nesting in JSON text, brackets inside strings ignored; it stops counting
 * one past `stopAt`, so a hostile text costs one linear scan at most.
 */
export function deepestNesting(text: string, stopAt = Number.MAX_SAFE_INTEGER): number {
  let depth = 0
  let deepest = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (inString) {
      if (escaped) escaped = false
      else if (code === 0x5c) escaped = true
      else if (code === 0x22) inString = false
      continue
    }
    if (code === 0x22) {
      inString = true
    } else if (code === 0x7b || code === 0x5b) {
      depth += 1
      if (depth > deepest) {
        deepest = depth
        if (deepest > stopAt) return deepest
      }
    } else if (code === 0x7d || code === 0x5d) {
      depth -= 1
    }
  }
  return deepest
}

/** A plain JSON object (not an array, not null). */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
