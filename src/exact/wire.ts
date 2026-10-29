import { Fraction } from '../engine/index.ts'

/**
 * The wire form of analysis results (plan §4.2, CLAUDE.md "State is JSON-safe"): results hold
 * exact `Fraction`s, whose class prototype a structured clone or JSON drops, so they cross worker
 * and IndexedDB boundaries as `{ $fraction: [num, den] }` (`Fraction.toWire`) and are rebuilt with
 * `Fraction.fromWire`, which rejects anything malformed. Everything else must already be plain
 * JSON: numbers (cents are whole numbers), strings, booleans, null, arrays and plain objects.
 */

export interface WireFraction {
  readonly $fraction: readonly [string, string]
}

type Primitive = string | number | boolean | null | undefined

/** The wire type of `T`: every `Fraction` inside it replaced by a `WireFraction`. */
export type Wire<T> = T extends Primitive
  ? T
  : T extends Fraction
    ? WireFraction
    : T extends readonly (infer U)[]
      ? readonly Wire<U>[]
      : { readonly [K in keyof T]: Wire<T[K]> }

/** `value` with every `Fraction` in it encoded; throws on anything that is not plain JSON. */
export function toWire<T>(value: T): Wire<T> {
  return encode(value, '$') as Wire<T>
}

/** Rebuilds what `toWire` encoded, checking every fraction. */
export function fromWire<T>(wire: Wire<T>): T {
  return decode(wire, '$') as T
}

function encode(value: unknown, path: string): unknown {
  if (value instanceof Fraction) return { $fraction: value.toWire() }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (value === undefined) return undefined
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is not a finite number`)
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => encode(item, `${path}[${index}]`))
  if (typeof value === 'object' && isPlain(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encode(item, `${path}.${key}`)]),
    )
  }
  throw new TypeError(`${path} is not plain JSON (${describe(value)})`)
}

function decode(value: unknown, path: string): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item, index) => decode(item, `${path}[${index}]`))
  const entries = Object.entries(value)
  if (entries.length === 1 && entries[0]?.[0] === '$fraction') {
    try {
      return Fraction.fromWire(entries[0][1] as readonly [string, string])
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new TypeError(`${path}: ${reason}`, { cause: error })
    }
  }
  return Object.fromEntries(entries.map(([key, item]) => [key, decode(item, `${path}.${key}`)]))
}

function isPlain(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function describe(value: unknown): string {
  if (typeof value === 'bigint') return 'a bigint'
  if (typeof value === 'object' && value !== null) return value.constructor.name
  return typeof value
}
