import { describe, expect, it } from 'vitest'
import { createSeededRng, randomInt, xoshiro128ss, type Rng } from './rng.ts'

const take = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.nextUint32())

describe('xoshiro128**', () => {
  it('matches the reference output for state (1, 2, 3, 4)', () => {
    expect(take(xoshiro128ss(1, 2, 3, 4), 4)).toEqual([11520, 0, 5927040, 70819200])
  })
})

describe('createSeededRng', () => {
  it('is reproducible for the same seed', () => {
    expect(take(createSeededRng('vegas'), 20)).toEqual(take(createSeededRng('vegas'), 20))
    expect(take(createSeededRng(42), 20)).toEqual(take(createSeededRng(42), 20))
  })

  it('differs between seeds', () => {
    expect(take(createSeededRng('vegas'), 5)).not.toEqual(take(createSeededRng('vegaS'), 5))
  })

  it('produces unsigned 32-bit integers', () => {
    for (const value of take(createSeededRng('range'), 1000)) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(2 ** 32)
    }
  })
})

describe('randomInt', () => {
  it('rejects draws from the biased tail', () => {
    // 2^32 mod 6 = 4, so the top 4 values must be rejected.
    const draws = [2 ** 32 - 1, 2 ** 32 - 4, 5]
    const rng: Rng = { nextUint32: () => draws.shift() ?? 0 }
    expect(randomInt(rng, 6)).toBe(5)
    expect(draws).toEqual([])
  })

  it('validates the range', () => {
    const rng = createSeededRng(1)
    expect(() => randomInt(rng, 0)).toThrow(RangeError)
    expect(() => randomInt(rng, 2.5)).toThrow(RangeError)
  })

  it('is uniform over die faces (chi-square, 5 dof)', () => {
    const rng = createSeededRng('uniformity')
    const counts = new Array<number>(6).fill(0)
    const n = 60_000
    for (let i = 0; i < n; i++) counts[randomInt(rng, 6)]! += 1
    const expected = n / 6
    const chiSquare = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0)
    expect(chiSquare).toBeLessThan(20.52) // p = 0.001
  })
})
