import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { canonicalJson, fnv1a64, hashJson } from './hash.ts'
import { Fraction } from './rational.ts'

/** Straight from the FNV spec: bigint state, one UTF-8 byte at a time. */
function referenceFnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

/** A deep copy with every object's keys inserted in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value).reverse()
  return Object.fromEntries(entries.map(([key, item]) => [key, reverseKeys(item)]))
}

describe('fnv1a64', () => {
  it('matches the published FNV-1a 64-bit test vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325')
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c')
    expect(fnv1a64('foobar')).toBe('85944171f73967e8')
    expect(fnv1a64('chongo was here!\n')).toBe('46810940eff5f915')
  })

  it('hashes the UTF-8 bytes, matching a bigint reference on any UTF-16 text', () => {
    const codeUnits = fc.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 40 })
    const text = fc.oneof(
      fc.string({ unit: 'binary', maxLength: 40 }),
      codeUnits.map((units) => String.fromCharCode(...units)), // includes lone surrogates
    )
    fc.assert(
      fc.property(text, (value) => {
        expect(fnv1a64(value)).toBe(referenceFnv1a64(value))
      }),
      { seed: 20261028, numRuns: 2000 },
    )
  })
})

describe('canonicalJson', () => {
  it('sorts keys by code unit at every level and drops whitespace', () => {
    const value = { b: [1, 'x', null, { d: true, c: -2.5 }], a: { 10: 1, 2: 2, B: 3 } }
    expect(canonicalJson(value)).toBe(
      '{"a":{"10":1,"2":2,"B":3},"b":[1,"x",null,{"c":-2.5,"d":true}]}',
    )
  })

  it('writes scalars as JSON does', () => {
    expect(canonicalJson('é"\n')).toBe(JSON.stringify('é"\n'))
    expect(canonicalJson('\ud800')).toBe('"\\ud800"')
    expect(canonicalJson(1e21)).toBe('1e+21')
    expect(canonicalJson(-0)).toBe('0')
    expect(canonicalJson(false)).toBe('false')
    expect(canonicalJson(null)).toBe('null')
  })

  it('leaves out undefined properties, as a JSON round trip would', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('accepts null-prototype objects and shared (non-circular) references', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { k: 1 })
    expect(canonicalJson(bare)).toBe('{"k":1}')
    const shared = { n: 1 }
    expect(canonicalJson([shared, shared])).toBe('[{"n":1},{"n":1}]')
  })

  it('preserves the data and ignores key order (fast-check)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = canonicalJson(value)
        expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(value)))
        expect(canonicalJson(reverseKeys(value))).toBe(text)
        expect(canonicalJson(JSON.parse(text))).toBe(text)
      }),
      { seed: 20261028, numRuns: 1000 },
    )
  })

  it('rejects values that JSON would change or drop, naming where they are', () => {
    class Point {
      x = 1
    }
    const cases: [unknown, RegExp][] = [
      [1n, /^\$ is a bigint/],
      [{ a: [0, { b: 2n }] }, /^\$\.a\[1\]\.b is a bigint/],
      [new Map([['a', 1]]), /^\$ is a Map\b/],
      [{ seen: new Set([1]) }, /^\$\.seen is a Set\b/],
      [[Fraction.ONE], /^\$\[0\] is a Fraction\b/],
      [new Point(), /^\$ is a Point\b/],
      [new Date(0), /^\$ is a Date\b/],
      [new Uint8Array(2), /^\$ is a Uint8Array\b/],
      [[1, undefined], /^\$\[1\] is undefined/],
      [[1, , 3], /^\$\[1\] is undefined or a hole/], // eslint-disable-line no-sparse-arrays
      [undefined, /^\$ is undefined, which JSON would drop/],
      [{ n: Number.NaN }, /^\$\.n is NaN/],
      [[Infinity], /^\$\[0\] is Infinity/],
      [{ f: () => 1 }, /^\$\.f is a function/],
      [Symbol('s'), /^\$ is a symbol/],
    ]
    for (const [value, message] of cases) {
      expect(() => canonicalJson(value)).toThrow(TypeError)
      expect(() => canonicalJson(value)).toThrow(message)
    }
  })

  it('rejects circular references instead of recursing forever', () => {
    const loop: Record<string, unknown> = { a: 1 }
    loop.self = loop
    expect(() => canonicalJson(loop)).toThrow(/^\$\.self refers back to an enclosing value/)
    const list: unknown[] = []
    list.push([list])
    expect(() => canonicalJson(list)).toThrow(TypeError)
  })
})

describe('hashJson', () => {
  it('ignores key order', () => {
    const a = {
      id: 'craplessBubble',
      money: { betIncrement: 100, payoutRounding: 'floor' },
      x: [1],
    }
    const b = {
      x: [1],
      money: { payoutRounding: 'floor', betIncrement: 100 },
      id: 'craplessBubble',
    }
    expect(hashJson(b)).toBe(hashJson(a))
  })

  it('is 16 hex digits of FNV-1a over the canonical JSON', () => {
    const value = { b: 2, a: [1, 'é'] }
    expect(hashJson(value)).toMatch(/^[0-9a-f]{16}$/)
    expect(hashJson(value)).toBe(referenceFnv1a64('{"a":[1,"é"],"b":2}'))
  })

  it('tells different data apart', () => {
    const values: unknown[] = [{ a: 1 }, { a: '1' }, [1, 2], [2, 1], { a: [] }, { a: {} }, {}, []]
    expect(new Set(values.map(hashJson)).size).toBe(values.length)
  })

  it('rejects non-JSON-safe values', () => {
    expect(() => hashJson({ rng: [1n, 2n] })).toThrow(TypeError)
  })
})
