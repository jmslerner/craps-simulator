import { describe, expect, it } from 'vitest'
import type { Rng } from '../../engine/core/rng.ts'
import { createCryptoRng } from './seed.ts'

const take = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.nextUint32())

describe('createCryptoRng', () => {
  it('produces unsigned 32-bit integers', () => {
    const values = take(createCryptoRng(), 200)
    expect(values.every((v) => Number.isInteger(v) && v >= 0 && v < 2 ** 32)).toBe(true)
    expect(new Set(values).size).toBeGreaterThan(190)
  })
})
