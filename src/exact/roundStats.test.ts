import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../engine/config/presets/index.ts'
import { Fraction } from '../engine/core/rational.ts'
import { roundStats } from './roundStats.ts'

// The round on its own (rules spec §1.3). Expected values are this file's own: ways to roll each
// total, and the spec's constants and identities.

const WAYS: Readonly<Record<number, number>> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
}

describe('roundStats', () => {
  it('gives the crapless and traditional constants of rules spec §1.3', () => {
    const crapless = roundStats(compileConfig(PRESETS.craplessBubble))
    expect(crapless.rollsPerDecision.toString()).toBe('9613/2310')
    expect(crapless.rollsPerHand.toString()).toBe('57678/7303')
    expect(crapless.comeOutShare.toString()).toBe('2310/9613')
    const traditional = roundStats(compileConfig(PRESETS.traditionalBubble))
    expect(traditional.rollsPerDecision.toString()).toBe('557/165')
    expect(traditional.rollsPerHand.toString()).toBe('1671/196')
    expect(traditional.comeOutShare.toString()).toBe('165/557')
  })

  it.each(PRESET_IDS)('holds the identities of rules spec §1.3 on %s', (id) => {
    const cfg = compileConfig(PRESETS[id])
    const stats = roundStats(cfg)
    // π(comeOut) = 1 / E[rolls per decision]; shares add up to 1.
    expect(stats.comeOutShare.equals(Fraction.ONE.div(stats.rollsPerDecision))).toBe(true)
    expect(Fraction.sum(stats.phases.map(({ share }) => share)).equals(Fraction.ONE)).toBe(true)
    // Rolls per hand = decisions per hand + 6; decisions per hand = rolls per hand × π(comeOut).
    const decisionsPerHand = stats.rollsPerHand.mul(stats.comeOutShare)
    expect(stats.rollsPerHand.sub(decisionsPerHand).toString()).toBe('6')
    for (const { phase, perDecision } of stats.phases) {
      if (phase.kind === 'comeOut') {
        expect(perDecision.toString()).toBe('1')
        continue
      }
      // A point is set with P = w/36 and lasts 36/(w + 6) rolls.
      const w = WAYS[phase.point] ?? 0
      expect(perDecision.toString(), `point ${phase.point}`).toBe(Fraction.of(w, w + 6).toString())
    }
    for (const { point, chance } of stats.established) {
      expect(chance.toString(), `point ${point}`).toBe(Fraction.of(WAYS[point] ?? 0, 36).toString())
    }
  })

  it('caches by config hash', () => {
    const cfg = compileConfig(PRESETS.craplessBubble)
    expect(roundStats(cfg)).toBe(roundStats(cfg))
  })
})
