import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../engine/config/presets/index.ts'
import { DICE_CLASSES } from '../engine/core/dice.ts'
import { Fraction } from '../engine/core/rational.ts'
import { advanceRound } from '../engine/round/round.ts'
import { COME_OUT, ExactError, roundAt, type WeightedPhase } from './chain.ts'
import { roundStats } from './roundStats.ts'
import { afterTravel, roundWeightedStart, startAt, startKey, typicalStart } from './start.ts'

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

  it("adds a side bet's progress only when it has some (M11), so older keys are unchanged", () => {
    expect(startKey(startAt(COME_OUT, { carried: true, progress: 0 }))).toBe('co=1|true|null|null')
    const carried = startAt(COME_OUT, { carried: true, progress: 60 })
    expect(carried.progress).toBe(60)
    expect(startKey(carried)).toBe('co=1|true|null|null|g60')
    expect('progress' in startAt(COME_OUT)).toBe(false)
  })
})

describe('typicalStart for side bets (M11)', () => {
  it('starts Interblock-style windows at the come-out, Shoot To Win’s Lucky Roller on any roll', () => {
    expect(phases(typicalStart({ typeId: 'luckyRollerLow', number: null }, cfg).phases)).toEqual([
      'co=1',
    ])
    const stw = compileConfig(PRESETS.traditionalBubble)
    const any = typicalStart({ typeId: 'luckyRollerAll', number: null }, stw).phases
    expect(any).toHaveLength(7)
    expect(total(any).toString()).toBe('1')
    expect(phases(any)).toEqual(
      phases(roundStats(stw).phases.map((p) => ({ ...p, weight: p.share }))),
    )
    expect(phases(typicalStart({ typeId: 'hotShooter', number: null }, stw).phases)).toEqual([
      'co=1',
    ])
    const strict = compileConfig(PRESETS.strictBubble)
    expect(phases(typicalStart({ typeId: 'luckyShooter', number: null }, strict).phases)).toEqual([
      'co=1',
    ])
    const live = compileConfig(PRESETS.traditionalLive345)
    expect(phases(typicalStart({ typeId: 'fire', number: null }, live).phases)).toEqual(['co=1'])
  })

  it('follows the engine: every roll that opens an after-7 or new-hand window leaves a come-out', () => {
    // The windows read the counters (`sinceSeven.rolls`, `hand.rolls`); the start reads the phase.
    // They agree because any 7 — a come-out natural or a seven-out — and only a seven-out resets
    // them, and both leave the round on the come-out.
    for (const id of PRESET_IDS) {
      const machine = compileConfig(PRESETS[id])
      const starts = [
        COME_OUT,
        ...machine.ruleset.points.map((point) => ({ kind: 'point' as const, point })),
      ]
      for (const phase of starts) {
        for (const dice of DICE_CLASSES) {
          const { next, transition } = advanceRound(roundAt(phase), dice, machine.ruleset)
          if (next.sinceSeven.rolls === 0 || next.hand.rolls === 0) {
            expect(next.phase).toEqual(COME_OUT)
          }
          expect(next.hand.rolls === 0).toBe(transition.kind === 'sevenOut')
        }
      }
    }
  })

  it('weights by π only the Lucky Roller taken on any roll whose chain follows the round', () => {
    expect(roundWeightedStart({ typeId: 'luckyRollerLow', number: null }, cfg)).toBe(false)
    const stw = compileConfig(PRESETS.traditionalBubble)
    // Any roll, but any 7 ends it, so the phase weights collapse into one state.
    expect(roundWeightedStart({ typeId: 'luckyRollerLow', number: null }, stw)).toBe(false)
    expect(roundWeightedStart({ typeId: 'hotShooter', number: null }, stw)).toBe(false)
    const sevenOut = compileConfig({
      ...PRESETS.traditionalBubble,
      id: 'stwSevenOut',
      sideBets: {
        ...PRESETS.traditionalBubble.sideBets,
        luckyRollerLow: {
          ...PRESETS.traditionalBubble.sideBets.luckyRollerLow!,
          endsOn: 'sevenOut',
        },
      },
    } as typeof PRESETS.traditionalBubble)
    expect(roundWeightedStart({ typeId: 'luckyRollerLow', number: null }, sevenOut)).toBe(true)
  })
})
