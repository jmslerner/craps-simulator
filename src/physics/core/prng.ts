/**
 * The physics PRNG. It is deliberately separate from the engine's dice RNG: the UI derives a
 * uint32 physics seed and passes it in, and nothing drawn here can change an outcome.
 * Vectors are drawn by rejection sampling rather than trigonometry, so the draws are exact
 * IEEE arithmetic and come out the same in every JavaScript engine.
 */
import type { Vec3 } from './quat.ts'

export interface Prng {
  nextUint32(): number
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform in [min, max). */
  range(min: number, max: number): number
}

/** mulberry32: tiny, fast and well mixed, which is all jitter needs. */
export function createPrng(seed: number): Prng {
  let state = seed >>> 0
  const nextUint32 = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
  const next = () => nextUint32() / 2 ** 32
  return { nextUint32, next, range: (min, max) => min + (max - min) * next() }
}

/**
 * A well-mixed uint32 from a seed and a salt (splitmix32's finaliser), for independent streams
 * such as the retries of one throw.
 */
export function deriveSeed(seed: number, salt: number): number {
  let z = ((seed >>> 0) + Math.imul((salt >>> 0) + 1, 0x9e3779b9)) >>> 0
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
  return (z ^ (z >>> 16)) >>> 0
}

/** A point drawn uniformly from the unit disc, as [x, z]. */
export function inDisc(prng: Prng): [number, number] {
  for (;;) {
    const x = prng.range(-1, 1)
    const z = prng.range(-1, 1)
    if (x * x + z * z <= 1) return [x, z]
  }
}

/** A direction drawn uniformly from the unit circle, as [c, s]. */
export function onCircle(prng: Prng): [number, number] {
  for (;;) {
    const [x, z] = inDisc(prng)
    const r = Math.sqrt(x * x + z * z)
    if (r > 1e-3) return [x / r, z / r]
  }
}

/** A direction drawn uniformly from the unit sphere. */
export function onSphere(prng: Prng): Vec3 {
  for (;;) {
    const x = prng.range(-1, 1)
    const y = prng.range(-1, 1)
    const z = prng.range(-1, 1)
    const r2 = x * x + y * y + z * z
    if (r2 <= 1 && r2 > 1e-6) {
      const r = Math.sqrt(r2)
      return [x / r, y / r, z / r]
    }
  }
}
