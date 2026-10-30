import { nextUint32, type RngState } from '../engine/core/rng.ts'
import type { Fraction } from '../engine/index.ts'

/**
 * Exact uniform draws over the engine's RNG (plan §9 item 9). Monte Carlo needs two draws the
 * engine does not provide: a uniform integer below a small bound (a dice index), and a pick from a
 * list of exact rational weights (a start phase from `typicalStart`). Both use rejection sampling
 * on `nextUint32`, so they are exactly uniform — no float ever enters — and both are pure: each
 * returns the state after its draws, like `rollDie`.
 */

const TWO_32 = 4_294_967_296

/** A uniform integer in [0, n), 1 ≤ n ≤ 2^32, by rejection sampling as `rollDie` does it. */
export function nextBelow(n: number, state: RngState): [number, RngState] {
  if (!Number.isInteger(n) || n < 1 || n > TWO_32) {
    throw new RangeError(`nextBelow needs an integer bound in [1, 2^32], got ${n}`)
  }
  // Draws at or above the largest multiple of n would favour the low values, so they are redrawn.
  const rejectFrom = TWO_32 - (TWO_32 % n)
  let current = state
  for (;;) {
    const [value, next] = nextUint32(current)
    current = next
    if (value < rejectFrom) return [value % n, current]
  }
}

/**
 * A prepared pick over exact rational weights: each weight as an integer share of one common
 * denominator, cumulative, so a uniform integer below the denominator picks an index with exactly
 * its weight's probability.
 */
export interface WeightedPick {
  /** Cumulative integer thresholds; the last equals `den`. */
  readonly thresholds: readonly bigint[]
  readonly den: bigint
  /** Bits in `den`: how many random bits each draw assembles before rejection. */
  readonly bits: number
}

/** Prepares a pick over `weights`, which must be positive and sum to 1. */
export function prepareWeightedPick(weights: readonly Fraction[]): WeightedPick {
  if (weights.length === 0) throw new RangeError('prepareWeightedPick needs at least one weight')
  let den = 1n
  for (const weight of weights) {
    if (weight.num <= 0n) throw new RangeError(`Weights must be positive, got ${weight.toString()}`)
    den = lcm(den, weight.den)
  }
  const thresholds: bigint[] = []
  let sum = 0n
  for (const weight of weights) {
    sum += weight.num * (den / weight.den)
    thresholds.push(sum)
  }
  if (sum !== den) throw new RangeError('Weights must sum to exactly 1')
  return { thresholds, den, bits: den.toString(2).length }
}

/** One index drawn from a prepared pick, and the state after the draws it used. */
export function pickWeighted(pick: WeightedPick, state: RngState): [number, RngState] {
  if (pick.thresholds.length === 1) return [0, state]
  const { value, state: next } = nextBigBelow(pick, state)
  const index = pick.thresholds.findIndex((threshold) => value < threshold)
  return [index, next]
}

/**
 * A uniform bigint in [0, den): `bits` random bits assembled from 32-bit words, redrawn while the
 * value is den or more. den > 2^(bits-1), so each try accepts with probability above one half.
 */
function nextBigBelow(pick: WeightedPick, state: RngState): { value: bigint; state: RngState } {
  const words = Math.ceil(pick.bits / 32)
  const topBits = BigInt(pick.bits - (words - 1) * 32)
  let current = state
  for (;;) {
    let value = 0n
    for (let word = 0; word < words; word++) {
      const [drawn, next] = nextUint32(current)
      current = next
      const keep = word === words - 1 ? BigInt(drawn) & ((1n << topBits) - 1n) : BigInt(drawn)
      value = (value << (word === words - 1 ? topBits : 32n)) | keep
    }
    if (value < pick.den) return { value, state: current }
  }
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) [x, y] = [y, x % y]
  return x
}

function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b
}
