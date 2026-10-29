import { describe, expect, it } from 'vitest'
import { craplessBubble } from '../../src/engine/config/presets/index.ts'
import type { DieFace } from '../../src/engine/core/dice.ts'
import { scenario } from './dsl.ts'

// A scenario that cannot fail proves nothing, so the DSL's own checks are tested here.

describe('the scenario DSL', () => {
  it('starts at the session start, on a preset id or a config', () => {
    for (const s of [scenario('craplessBubble'), scenario(craplessBubble)]) {
      expect(s.cfg.id).toBe('craplessBubble')
      s.expect({
        point: null,
        transition: null,
        handIndex: 0,
        handRolls: 0,
        pointsMade: [],
        endedHand: null,
        rolls: 0,
        rollsSinceSeven: 0,
        totalsSinceSeven: [],
      })
    }
  })

  it('checks only the facts it is given', () => {
    scenario('traditionalBubble')
      .roll(5, 6)
      .expect({ transition: 'natural' })
      .expect({ point: null, handRolls: 1 })
  })

  it('fails on a wrong fact, naming the machine and the rolls so far', () => {
    expect(() => scenario('craplessBubble').roll(5, 6).roll(2, 2).expect({ point: 4 })).toThrow(
      /craplessBubble, after 5-6, 2-2/,
    )
    expect(() => scenario('craplessBubble').expect({ handIndex: 1 })).toThrow(
      /craplessBubble, before any roll/,
    )
  })

  it('needs at least one fact to check', () => {
    expect(() => scenario('craplessBubble').expect({})).toThrow(/at least one fact/)
  })

  it('fails on a provenance status that differs, or a pointer that names no value', () => {
    scenario('craplessBubble').expectProvenance('/rules/points', 'verified')
    expect(() => scenario('craplessBubble').expectProvenance('/rules/points', 'assumed')).toThrow(
      /craplessBubble\/rules\/points/,
    )
    expect(() => scenario('craplessBubble').expectProvenance('/rules/pointz', 'verified')).toThrow(
      /names no value/,
    )
  })

  it('rolls only faces from 1 to 6', () => {
    expect(() => scenario('craplessBubble').roll(7 as DieFace, 1)).toThrow(RangeError)
  })

  it('exposes the round and the last transition for checks the facts don’t cover', () => {
    const s = scenario('craplessBubble').roll(5, 6)
    expect(s.round.phase).toEqual({ kind: 'point', point: 11 })
    expect(s.transition).toEqual({ kind: 'pointEstablished', point: 11 })
  })
})
