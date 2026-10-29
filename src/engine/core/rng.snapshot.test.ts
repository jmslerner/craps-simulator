import { describe, expect, it } from 'vitest'
import { rollDice } from './dice.ts'
import { nextUint32, seedRng, type RngState } from './rng.ts'

/**
 * Recorded from the mutable `createSeededRng` before M1 made the RNG pure. Saved sessions, replay
 * fixtures and shared seeds all depend on these exact streams, so the literals must never change:
 * a refactor may only change how the values are drawn.
 */
const SNAPSHOT_UINT32 = [
  1162631658, 3328594343, 1817028570, 2284972275, 3423187933, 1471804691, 4088677703, 3847395219,
  2751432432, 2251266348, 2974098173, 1016636314, 802382051, 2983778048, 1212632637, 2452012808,
  547100078, 1373767896, 3680036297, 3153981534,
]

/** The first 50 rolls (100 dice) as `d1d2`, in draw order. */
const SNAPSHOT_ROLLS = [
  '16 14 26 64 11 65 63 43 31 61',
  '62 54 13 44 53 34 26 13 51 31',
  '22 12 25 36 62 61 65 15 64 35',
  '44 21 15 65 53 53 45 32 66 41',
  '61 62 51 56 45 44 46 21 61 24',
].join(' ')

describe("seed snapshot for 'snapshot'", () => {
  it('draws the recorded first 20 uint32 values', () => {
    let state: RngState = seedRng('snapshot')
    const values = Array.from({ length: 20 }, () => {
      const [value, next] = nextUint32(state)
      state = next
      return value
    })
    expect(values).toEqual(SNAPSHOT_UINT32)
  })

  it('rolls the recorded first 50 rolls', () => {
    let state: RngState = seedRng('snapshot')
    const rolls = Array.from({ length: 50 }, () => {
      const [{ d1, d2 }, next] = rollDice(state)
      state = next
      return `${d1}${d2}`
    })
    expect(rolls.join(' ')).toBe(SNAPSHOT_ROLLS)
  })
})
