import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { Fraction } from '../engine/core/rational.ts'
import { ExactError, type WeightedPhase } from './chain.ts'
import { roundStats } from './roundStats.ts'
import { afterTravel, startAt, startKey, typicalStart } from './start.ts'

const cfg = compileConfig(PRESETS.craplessBubble)

const phases = (list: readonly WeightedPhase[]) =>
  list.map(
    ({ phase, weight }) =>
      `${phase.kind === 'comeOut' ? 'co' : `p${phase.point}`}=${weight.toString()}`,
  )

const total = (list: readonly WeightedPhase[]) => Fraction.sum(list.map(({ weight }) => weight))

describe('typicalStart', () => {
  it('puts line bets on the come-out, or on their point', () => {
    expect(phases(typicalStart({ typeId: 'pass', number: null }, cfg).phases)).toEqual(['co=1'])
    expect(phases(typicalStart({ typeId: 'pass', number: 4 }, cfg).phases)).toEqual(['p4=1'])
    expect(phases(typicalStart({ typeId: 'passOdds', number: 4 }, cfg).phases)).toEqual(['p4=1'])
  })

  it('makes come bets on a point-phase roll, each point by its share of them', () => {
    const start = typicalStart({ typeId: 'come', number: null }, cfg).phases
    expect(start).toHaveLength(10)
    expect(total(start).equals(Fraction.ONE)).toBe(true)
    const stats = roundStats(cfg)
    for (const { phase, weight } of start) {
      const share = stats.phases.find(
        (entry) =>
          entry.phase.kind === 'point' &&
          phase.kind === 'point' &&
          entry.phase.point === phase.point,
      )?.share
      expect(share?.div(stats.pointShare).equals(weight)).toBe(true)
    }
  })

  it('puts come odds just after the come bet travelled: the come-out if that made the point', () => {
    const start = afterTravel(6, cfg)
    expect(total(start).equals(Fraction.ONE)).toBe(true)
    const keys = phases(start).map((entry) => entry.split('=')[0])
    expect(keys).toContain('co')
    expect(keys).not.toContain('p6')
    expect(phases(typicalStart({ typeId: 'comeOdds', number: 6 }, cfg).phases)).toEqual(
      phases(start),
    )
  })

  it('places number bets on any roll, and one-roll bets with no phase', () => {
    const place = typicalStart({ typeId: 'place', number: 6 }, cfg).phases
    expect(place).toHaveLength(11)
    expect(total(place).equals(Fraction.ONE)).toBe(true)
    expect(phases(typicalStart({ typeId: 'field', number: null }, cfg).phases)).toEqual(['co=1'])
  })

  it('carries the toggles it is given, and refuses a bet that is not offered', () => {
    const start = typicalStart({ typeId: 'place', number: 6 }, cfg, {
      working: false,
      globalOff: true,
    })
    expect([start.carried, start.working, start.globalOff]).toEqual([false, false, true])
    expect(() => typicalStart({ typeId: 'lay', number: 4 }, cfg)).toThrow(ExactError)
  })
})

describe('startKey', () => {
  it('names the phases, weights and working inputs', () => {
    const base = startAt({ kind: 'point', point: 5 })
    expect(startKey(base)).toBe('p5=1|false|null|null')
    expect(startKey(startAt({ kind: 'point', point: 5 }, { carried: true, working: false }))).toBe(
      'p5=1|true|false|null',
    )
  })
})
