/**
 * Content hashes for configs, table states and replay windows: 64-bit FNV-1a over the UTF-8 bytes
 * of canonical JSON, as 16 hex digits.
 *
 * Canonical JSON sorts object keys, so values that are equal as JSON data hash the same whatever
 * order their keys were added in. Values that JSON would silently change or drop (bigint, Map,
 * Set, class instances, undefined in arrays, NaN) throw instead: a hash that skipped part of the
 * state would let a replay diverge unnoticed.
 */

/** 64-bit FNV-1a of `value`'s canonical JSON, as 16 lowercase hex digits. */
export function hashJson(value: unknown): string {
  return fnv1a64(canonicalJson(value))
}

/**
 * JSON with no whitespace and object keys sorted by UTF-16 code units, as RFC 8785 sorts them.
 * Object properties whose value is undefined are left out, as `JSON.stringify` does, so a value
 * hashes the same before and after a JSON round trip.
 */
export function canonicalJson(value: unknown): string {
  return write(value, '$', [])
}

/** 64-bit FNV-1a of the UTF-8 encoding of `text`, as 16 lowercase hex digits. */
export function fnv1a64(text: string): string {
  // The 64-bit state is kept as two uint32 halves, which is far faster than bigint per byte.
  let hi = 0xcbf29ce4
  let lo = 0x84222325
  const eat = (byte: number) => {
    lo = (lo ^ byte) >>> 0
    // h × (2^40 + 0x1b3) mod 2^64. lo × 0x1b3 < 2^41 is exact in a double, and its bits above 32
    // carry into hi; the 2^40 term only shifts lo into hi.
    const product = lo * 0x1b3
    const carry = (product - (product >>> 0)) / 0x100000000
    hi = (Math.imul(hi, 0x1b3) + carry + (lo << 8)) >>> 0
    lo = product >>> 0
  }
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i)
    const next = text.charCodeAt(i + 1) // NaN past the end, which fails both range checks
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
      i++
    } else if (code >= 0xd800 && code <= 0xdfff) {
      code = 0xfffd // a lone surrogate, encoded as TextEncoder does
    }
    if (code < 0x80) {
      eat(code)
    } else if (code < 0x800) {
      eat(0xc0 | (code >> 6))
      eat(0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      eat(0xe0 | (code >> 12))
      eat(0x80 | ((code >> 6) & 0x3f))
      eat(0x80 | (code & 0x3f))
    } else {
      eat(0xf0 | (code >> 18))
      eat(0x80 | ((code >> 12) & 0x3f))
      eat(0x80 | ((code >> 6) & 0x3f))
      eat(0x80 | (code & 0x3f))
    }
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0')
}

/** Writes `value` as canonical JSON; `path` names it in errors. */
function write(value: unknown, path: string, ancestors: object[]): string {
  if (value === null) return 'null'
  if (value === undefined) throw new TypeError(`${path} is undefined, which JSON would drop`)
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is ${value}, which JSON cannot hold`)
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} is a ${typeof value}, which is not JSON data`)
  }
  if (ancestors.includes(value)) throw new TypeError(`${path} refers back to an enclosing value`)
  ancestors.push(value)
  const prototype: unknown = Object.getPrototypeOf(value)
  let text: string
  if (Array.isArray(value) && prototype === Array.prototype) {
    const items: string[] = []
    for (let i = 0; i < value.length; i++) {
      const item: unknown = value[i]
      if (item === undefined) {
        throw new TypeError(`${path}[${i}] is undefined or a hole, which JSON would turn into null`)
      }
      items.push(write(item, `${path}[${i}]`, ancestors))
    }
    text = `[${items.join(',')}]`
  } else if (prototype === Object.prototype || prototype === null) {
    const record = value as Record<string, unknown>
    const entries: string[] = []
    for (const key of Object.keys(record).sort()) {
      const item = record[key]
      if (item === undefined) continue // left out, as JSON.stringify does
      entries.push(`${JSON.stringify(key)}:${write(item, `${path}.${key}`, ancestors)}`)
    }
    text = `{${entries.join(',')}}`
  } else {
    throw new TypeError(`${path} is ${describeInstance(value)}, which is not plain JSON data`)
  }
  ancestors.pop()
  return text
}

function describeInstance(value: object): string {
  const name: unknown = (value as { constructor?: { name?: unknown } }).constructor?.name
  return typeof name === 'string' && name !== '' ? `a ${name}` : 'an object with a custom prototype'
}
