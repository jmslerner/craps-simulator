import type { DieFace } from './dice.ts'

/**
 * The whole dice-generator state: four xoshiro128** words as unsigned 32-bit integers. It is a
 * plain JSON-safe tuple so `TableState` can hold it, and nothing here mutates it: each draw
 * returns the next state, which is what makes replay and undo reproduce the same dice.
 */
export type RngState = readonly [number, number, number, number]

/** A pure source of uniform uint32 draws over some state: `nextUint32` in play, stubs in tests. */
export type Draw<S> = (state: S) => readonly [number, S]

/**
 * Seeds the dice stream from a session seed: FNV-1a of the string, then four splitmix32 outputs.
 * This is exactly how the pre-M1 `createSeededRng` seeded strings, so recorded seeds keep their
 * dice (see rng.snapshot.test.ts).
 */
export function seedRng(seed: string): RngState {
  let counter = fnv1a32(seed)
  const splitmix32 = (): number => {
    counter = (counter + 0x9e3779b9) >>> 0
    return mix32(counter)
  }
  const s0 = splitmix32()
  const s1 = splitmix32()
  const s2 = splitmix32()
  const s3 = splitmix32()
  return [s0, s1, s2, s3]
}

/** One xoshiro128** step: a uniform uint32 and the state after it. */
export function nextUint32(state: RngState): [number, RngState] {
  let [a, b, c, d] = state
  // splitmix32 never yields four zeros; this only catches a corrupted or hand-built state.
  if ((a | b | c | d) === 0) throw new RangeError('xoshiro128** state must not be all zero')
  const result = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0
  const t = b << 9
  c ^= a
  d ^= b
  b ^= c
  a ^= d
  c ^= t
  d = rotl(d, 11)
  return [result, [a >>> 0, b >>> 0, c >>> 0, d >>> 0]]
}

/** 2^32 - (2^32 mod 6). Draws at or above this would favour faces 1-4, so they are redrawn. */
const DIE_REJECT_FROM = 4294967292

/** One fair die from the dice stream, and the state after the draws it used. */
export function rollDie(state: RngState): [DieFace, RngState] {
  return rollDieWith(nextUint32, state)
}

/** The rejection sampling behind `rollDie`, over any draw source so tests can stub the draws. */
export function rollDieWith<S>(draw: Draw<S>, state: S): [DieFace, S] {
  let current = state
  for (;;) {
    const [value, next] = draw(current)
    current = next
    if (value < DIE_REJECT_FROM) return [((value % 6) + 1) as DieFace, current]
  }
}

/**
 * A 32-bit seed for physics or animation, derived from labelled parts such as
 * `(sessionSeed, 'physics', rollIndex, attempt)`. It never reads or advances the dice stream, so
 * however many throws the dome simulates, the engine's dice stay the same.
 */
export function deriveSeed32(...parts: (string | number)[]): number {
  let text = 'deriveSeed32'
  for (const part of parts) {
    if (typeof part === 'number' && !Number.isSafeInteger(part)) {
      throw new RangeError(`deriveSeed32 parts must be strings or safe integers, got ${part}`)
    }
    const value = String(part)
    // A type tag and a length prefix keep ('ab', 'c') apart from ('a', 'bc'), and 1 from '1'.
    text += `|${typeof part === 'number' ? 'n' : 's'}${value.length}:${value}`
  }
  // FNV-1a mixes its last characters poorly; the finalizer spreads them over all 32 bits.
  return mix32(fnv1a32(text))
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k))
}

/** The murmur3 finalizer that splitmix32 uses: a bijection on uint32 with full avalanche. */
function mix32(value: number): number {
  let z = value
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
  return (z ^ (z >>> 16)) >>> 0
}

/** 32-bit FNV-1a over UTF-16 code units rather than UTF-8 bytes, as the pre-M1 seeding did. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
