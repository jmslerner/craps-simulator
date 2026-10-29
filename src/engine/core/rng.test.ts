import { describe, expect, it } from 'vitest'
import {
  deriveSeed32,
  nextUint32,
  rollDie,
  rollDieWith,
  seedRng,
  type Draw,
  type RngState,
} from './rng.ts'

/** The first `n` uint32 draws from `state`. */
function take(state: RngState, n: number): number[] {
  const values: number[] = []
  let current = state
  for (let i = 0; i < n; i++) {
    const [value, next] = nextUint32(current)
    values.push(value)
    current = next
  }
  return values
}

/** A draw source that replays `draws` in order; its state is the index of the next draw. */
function stubbed(draws: readonly number[]): Draw<number> {
  return (index) => {
    const value = draws[index]
    if (value === undefined) throw new Error('rollDieWith ran past the stubbed draws')
    return [value, index + 1]
  }
}

/** Pearson's chi-square statistic for observed counts against a uniform expectation. */
function chiSquare(counts: readonly number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0)
  const expected = total / counts.length
  return counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0)
}

describe('xoshiro128**', () => {
  it('matches the reference output for state (1, 2, 3, 4)', () => {
    expect(take([1, 2, 3, 4], 4)).toEqual([11520, 0, 5927040, 70819200])
  })

  it('is pure: the same state gives the same draw and is never mutated', () => {
    const state: RngState = Object.freeze([1, 2, 3, 4] as const)
    const [first, next] = nextUint32(state)
    expect(nextUint32(state)).toEqual([first, next])
    expect(state).toEqual([1, 2, 3, 4])
    expect(next).not.toBe(state)
  })

  it('keeps every state word an unsigned 32-bit integer', () => {
    let state = seedRng('words')
    for (let i = 0; i < 1000; i++) {
      expect(state.every((word) => Number.isInteger(word) && word >= 0 && word < 2 ** 32)).toBe(
        true,
      )
      state = nextUint32(state)[1]
    }
  })

  it('rejects the all-zero state, which would never leave zero', () => {
    expect(() => nextUint32([0, 0, 0, 0])).toThrow(RangeError)
  })
})

describe('seedRng', () => {
  it('is reproducible for the same seed', () => {
    expect(seedRng('vegas')).toEqual(seedRng('vegas'))
    expect(take(seedRng('vegas'), 20)).toEqual(take(seedRng('vegas'), 20))
  })

  it('differs between seeds', () => {
    expect(take(seedRng('vegas'), 5)).not.toEqual(take(seedRng('vegaS'), 5))
    expect(take(seedRng(''), 5)).not.toEqual(take(seedRng(' '), 5))
  })

  it('produces unsigned 32-bit integers', () => {
    for (const value of take(seedRng('range'), 1000)) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(2 ** 32)
    }
  })

  it('is JSON-safe, so TableState can store it and resume the same stream', () => {
    const state = nextUint32(seedRng('json'))[1]
    const restored = JSON.parse(JSON.stringify(state)) as RngState
    expect(restored).toEqual(state)
    expect(take(restored, 10)).toEqual(take(state, 10))
  })
})

describe('rollDie', () => {
  it('rejects draws from the biased tail and returns the state after the accepted draw', () => {
    // 2^32 mod 6 = 4, so the top 4 values (4294967292 and up) must be redrawn.
    expect(rollDieWith(stubbed([2 ** 32 - 1, 2 ** 32 - 4, 5]), 0)).toEqual([6, 3])
    expect(rollDieWith(stubbed([2 ** 32 - 2, 2 ** 32 - 3, 4294967292, 0]), 0)).toEqual([1, 4])
  })

  it('accepts the last unbiased draw and maps u to u % 6 + 1', () => {
    expect(rollDieWith(stubbed([4294967291]), 0)).toEqual([6, 1])
    const draws = [0, 1, 2, 3, 4, 5, 6, 4294967290]
    const faces = draws.map((_, i) => rollDieWith(stubbed(draws), i)[0])
    expect(faces).toEqual([1, 2, 3, 4, 5, 6, 1, 5])
  })

  it('redraws on the real generator too', () => {
    // A draw is rotl(s1 * 5, 7) * 9, and 5 and 9 are invertible mod 2^32, so a state whose
    // first draw lands in the rejected tail can be built directly.
    const rotr = (x: number, k: number) => (x >>> k) | (x << (32 - k))
    const s1 = Math.imul(rotr(Math.imul(2 ** 32 - 1, 0x38e38e39), 7), 0xcccccccd) >>> 0
    const state: RngState = [0x12345678, s1, 0x9abcdef0, 0x0fedcba9]
    const [first, afterFirst] = nextUint32(state)
    expect(first).toBe(2 ** 32 - 1)
    const [second, afterSecond] = nextUint32(afterFirst)
    expect(second).toBeLessThan(4294967292)
    expect(rollDie(state)).toEqual([(second % 6) + 1, afterSecond])
  })

  it('is uniform over die faces (chi-square, 5 dof)', () => {
    let state = seedRng('uniformity')
    const counts = new Array<number>(6).fill(0)
    for (let i = 0; i < 60_000; i++) {
      const [face, next] = rollDie(state)
      counts[face - 1]! += 1
      state = next
    }
    expect(chiSquare(counts)).toBeLessThan(20.52) // p = 0.001
  })
})

describe('deriveSeed32', () => {
  it('is a pure uint32 function of its parts', () => {
    const seed = deriveSeed32('a1b2c3d4e5f60718', 'physics', 3, 0)
    expect(deriveSeed32('a1b2c3d4e5f60718', 'physics', 3, 0)).toBe(seed)
    expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32).toBe(true)
  })

  it('is pinned, because golden physics recordings depend on it', () => {
    expect(deriveSeed32('snapshot', 'physics', 0, 0)).toBe(21485760)
    expect(deriveSeed32()).toBe(2898899937)
  })

  it('keeps parts apart: boundaries, types and order all count', () => {
    const seeds = [
      deriveSeed32('ab', 'c'),
      deriveSeed32('a', 'bc'),
      deriveSeed32('abc'),
      deriveSeed32(1),
      deriveSeed32('1'),
      deriveSeed32('s', 'physics', 1, 0),
      deriveSeed32('s', 'physics', 0, 1),
      deriveSeed32('s', 'physics', 10),
      deriveSeed32('s', 'physics', 1, 0, 0),
      deriveSeed32('s', 'animation', 1, 0),
    ]
    expect(new Set(seeds).size).toBe(seeds.length)
  })

  it('spreads sequential roll indices over the low and high bits (chi-square, 15 dof)', () => {
    const low = new Array<number>(16).fill(0)
    const high = new Array<number>(16).fill(0)
    for (let rollIndex = 0; rollIndex < 16_000; rollIndex++) {
      const seed = deriveSeed32('session', 'physics', rollIndex, 0)
      low[seed & 15]! += 1
      high[seed >>> 28]! += 1
    }
    expect(chiSquare(low)).toBeLessThan(37.7) // p = 0.001
    expect(chiSquare(high)).toBeLessThan(37.7)
  })

  it('leaves the dice alone however many seeds are derived between rolls', () => {
    // Seed 'snapshot': its first 20 rolls as recorded before M1 (see rng.snapshot.test.ts), and
    // the physics seeds of its first four rolls.
    const recordedRolls = '16 14 26 64 11 65 63 43 31 61 62 54 13 44 53 34 26 13 51 31'
    const physicsSeeds = [2744758145, 2039615380, 3553214236, 3825405985]
    let state = seedRng('snapshot')
    const rolls: string[] = []
    const seeds: number[] = []
    for (let rollIndex = 0; rollIndex < 20; rollIndex++) {
      // A roll as the ui plays it: the engine draws the dice and the dome derives the throw's
      // seed, here even between the two draws, followed by a varying number of other seeds.
      const [d1, afterFirst] = rollDie(state)
      seeds.push(deriveSeed32('snapshot', 'physics', rollIndex))
      const [d2, afterSecond] = rollDie(afterFirst)
      for (let attempt = 0; attempt < rollIndex % 4; attempt++) {
        deriveSeed32('snapshot', 'animation', rollIndex, attempt)
      }
      rolls.push(`${d1}${d2}`)
      state = afterSecond
    }
    expect(rolls.join(' ')).toBe(recordedRolls)
    expect(seeds.slice(0, 4)).toEqual(physicsSeeds)
  })

  it('rejects numbers that are not safe integers', () => {
    expect(() => deriveSeed32('s', 1.5)).toThrow(RangeError)
    expect(() => deriveSeed32('s', Number.NaN)).toThrow(RangeError)
    expect(() => deriveSeed32('s', 2 ** 53)).toThrow(RangeError)
  })
})
