import { describe, expect, it } from 'vitest'
import { createPrng, deriveSeed, inDisc, onCircle, onSphere } from './prng.ts'

describe('createPrng', () => {
  it('repeats its sequence for a seed and differs across seeds', () => {
    const draw = (seed: number) => {
      const prng = createPrng(seed)
      return Array.from({ length: 8 }, () => prng.nextUint32())
    }
    expect(draw(42)).toEqual(draw(42))
    expect(draw(42)).not.toEqual(draw(43))
    // Pinned so a change to the generator, which would change every recording, is noticed.
    expect(draw(0).slice(0, 4)).toEqual([1144304738, 1416247, 958946056, 627933444])
  })

  it('draws within its ranges', () => {
    const prng = createPrng(7)
    for (let i = 0; i < 10_000; i++) {
      const u = prng.next()
      expect(u >= 0 && u < 1).toBe(true)
      const r = prng.range(-3, 5)
      expect(r >= -3 && r < 5).toBe(true)
    }
  })
})

describe('deriveSeed', () => {
  it('gives distinct uint32 streams for distinct salts and seeds', () => {
    const seeds = new Set<number>()
    for (let salt = 0; salt < 1000; salt++) {
      const seed = deriveSeed(123, salt)
      expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32).toBe(true)
      seeds.add(seed)
    }
    expect(seeds.size).toBe(1000)
    expect(deriveSeed(1, 5)).not.toBe(deriveSeed(2, 5))
  })
})

describe('random directions', () => {
  it('draws points in the unit disc and unit vectors on the circle and sphere', () => {
    const prng = createPrng(99)
    const mean = [0, 0, 0]
    const n = 20_000
    for (let i = 0; i < n; i++) {
      const [x, z] = inDisc(prng)
      expect(x * x + z * z).toBeLessThanOrEqual(1)
      expect(Math.hypot(...onCircle(prng))).toBeCloseTo(1, 12)
      const v = onSphere(prng)
      expect(Math.hypot(...v)).toBeCloseTo(1, 12)
      v.forEach((c, k) => (mean[k] = (mean[k] ?? 0) + c / n))
    }
    // Uniform on the sphere: each coordinate averages 0 with σ = 1/√(3n) ≈ 0.004.
    for (const m of mean) expect(Math.abs(m)).toBeLessThan(0.02)
  })
})
