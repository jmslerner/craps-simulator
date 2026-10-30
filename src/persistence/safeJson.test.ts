import { describe, expect, it } from 'vitest'
import { MAX_BATCH_DEPTH } from '../engine/session/window.ts'
import { MAX_JSON_DEPTH, deepestNesting, parseJsonSafely } from './safeJson.ts'

/** JSON text nested `depth` arrays deep around a zero. */
const nested = (depth: number) => `${'['.repeat(depth)}0${']'.repeat(depth)}`

describe('parseJsonSafely (M12: untrusted files)', () => {
  it('parses ordinary JSON to its value', () => {
    expect(parseJsonSafely('{"a":[1,2,{"b":"c"}]}')).toEqual({
      ok: true,
      value: { a: [1, 2, { b: 'c' }] },
    })
  })

  it('refuses empty, oversized and malformed text, never throwing', () => {
    expect(parseJsonSafely('   ')).toEqual({ ok: false, error: { kind: 'empty' } })
    expect(parseJsonSafely('[1,2,3]', { maxChars: 4 })).toEqual({
      ok: false,
      error: { kind: 'size', chars: 7, max: 4 },
    })
    const broken = parseJsonSafely('{"a": ')
    expect(broken.ok === false && broken.error.kind).toBe('json')
  })

  it('refuses nesting past the cap before JSON.parse sees it, however deep', () => {
    expect(parseJsonSafely(nested(MAX_JSON_DEPTH)).ok).toBe(true)
    expect(parseJsonSafely(nested(MAX_JSON_DEPTH + 1))).toEqual({
      ok: false,
      error: { kind: 'depth', max: MAX_JSON_DEPTH },
    })
    // Deep enough to overflow a recursive parser: still a plain refusal.
    expect(parseJsonSafely(nested(200_000))).toEqual({
      ok: false,
      error: { kind: 'depth', max: MAX_JSON_DEPTH },
    })
  })

  it('leaves room for the deepest batch a log may hold: two levels a batch, under the log’s own', () => {
    expect(MAX_JSON_DEPTH).toBeGreaterThan(2 * MAX_BATCH_DEPTH + 8)
  })

  it('counts only brackets outside strings', () => {
    expect(deepestNesting('{"a":"[[[[{{{{\\"]]]]","b":[1]}')).toBe(2)
    expect(deepestNesting('"\\\\"')).toBe(0)
    expect(deepestNesting(nested(10), 3)).toBe(4) // it stops one past the cap
  })

  it('refuses prototype keys at any depth', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const text = `{"format":"bubble-craps-machine","machines":[{"limits":{"${key}":{"polluted":true}}}]}`
      expect(parseJsonSafely(text), key).toEqual({ ok: false, error: { kind: 'key', key } })
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    // The words inside a value are only text.
    expect(parseJsonSafely('{"note":"__proto__ constructor prototype"}').ok).toBe(true)
  })
})
