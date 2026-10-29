import { describe, expect, it } from 'vitest'
import { rollDie, seedRng } from '../../engine/core/rng.ts'
import { newSessionSeed } from './seed.ts'

/** The first `count` dice that a session seed rolls, as a string of faces. */
function diceOf(seed: string, count: number): string {
  let state = seedRng(seed)
  let faces = ''
  for (let i = 0; i < count; i++) {
    const [face, next] = rollDie(state)
    faces += face
    state = next
  }
  return faces
}

describe('newSessionSeed', () => {
  it('returns 16 lowercase hex digits', () => {
    for (let i = 0; i < 50; i++) expect(newSessionSeed()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('differs between sessions', () => {
    const seeds = new Set(Array.from({ length: 200 }, () => newSessionSeed()))
    expect(seeds.size).toBe(200)
  })

  it('seeds the engine RNG reproducibly', () => {
    const seed = newSessionSeed()
    expect(diceOf(seed, 32)).toBe(diceOf(seed, 32))
  })

  it('gives different sessions different dice', () => {
    // 32 dice match by chance with odds 6^-32, so equal streams mean the seed was ignored.
    const [first, second] = [newSessionSeed(), newSessionSeed()]
    expect(diceOf(first, 32), `sessions ${first} and ${second}`).not.toBe(diceOf(second, 32))
    expect(diceOf('0000000000000000', 32)).not.toBe(diceOf('0000000000000001', 32))
  })
})
