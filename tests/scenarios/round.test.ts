import { describe, it } from 'vitest'
import { PRESETS, PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import type { Variant } from '../../src/engine/config/rulesets.ts'
import { scenario } from './dsl.ts'

// Round-level machine facts (rules spec §0.1 hand, §2.1 round transitions and counters, §3.5
// crapless differences), one scenario each, on every built-in machine they apply to. A fact that
// rests on a config value also checks that value's provenance.

const machines = (variant: Variant): PresetId[] =>
  PRESET_IDS.filter((id) => PRESETS[id].variant === variant)

describe.each(machines('crapless'))('crapless: %s', (id) => {
  it('a come-out 11 sets the point at 11 [V]', () => {
    scenario(id)
      .expectProvenance('/rules/points', 'verified')
      .roll(5, 6)
      .expect({ transition: 'pointEstablished', point: 11, handIndex: 0, handRolls: 1 })
  })

  it('a come-out 2 sets the point at 2 [V]', () => {
    scenario(id)
      .expectProvenance('/rules/points', 'verified')
      .roll(1, 1)
      .expect({ transition: 'pointEstablished', point: 2 })
  })

  it('a come-out 3 or 12 sets the point too: nothing loses on the come-out [V]', () => {
    scenario(id)
      .expectProvenance('/rules/craps', 'verified')
      .roll(1, 2)
      .expect({ transition: 'pointEstablished', point: 3 })
    scenario(id).roll(6, 6).expect({ transition: 'pointEstablished', point: 12 })
  })

  it('only 7 is a natural on the come-out [V]', () => {
    scenario(id)
      .expectProvenance('/rules/naturals', 'verified')
      .roll(3, 4)
      .expect({ transition: 'natural', point: null, handIndex: 0 })
  })

  it('the point 11 is made by another 11, and 2 by another 2', () => {
    scenario(id)
      .roll(6, 5)
      .roll(2, 2)
      .expect({ transition: 'none', point: 11 })
      .roll(5, 6)
      .expect({ transition: 'pointMade', point: null, pointsMade: [11] })
      .roll(1, 1)
      .roll(1, 1)
      .expect({ transition: 'pointMade', point: null, pointsMade: [2, 11] })
  })
})

describe.each(machines('traditional'))('traditional: %s', (id) => {
  it('a come-out 11 is a natural [V]', () => {
    scenario(id)
      .expectProvenance('/rules/naturals', 'verified')
      .roll(5, 6)
      .expect({ transition: 'natural', point: null, handIndex: 0, handRolls: 1 })
  })

  it('a come-out 2, 3 or 12 is craps, and the same hand goes on [V]', () => {
    scenario(id)
      .expectProvenance('/rules/craps', 'verified')
      .roll(1, 1)
      .expect({ transition: 'craps', point: null, handIndex: 0, handRolls: 1 })
      .roll(1, 2)
      .expect({ transition: 'craps', point: null, handIndex: 0, handRolls: 2 })
      .roll(6, 6)
      .expect({ transition: 'craps', point: null, handIndex: 0, handRolls: 3, endedHand: null })
  })

  it('2, 3, 11 and 12 do nothing to the round once a point is on', () => {
    const s = scenario(id).roll(4, 5).expect({ transition: 'pointEstablished', point: 9 })
    s.roll(1, 1).roll(2, 1).roll(6, 5).roll(6, 6)
    s.expect({ transition: 'none', point: 9, handRolls: 5, totalsSinceSeven: [2, 3, 9, 11, 12] })
  })
})

describe.each(PRESET_IDS)('every machine: %s', (id) => {
  it('a point made sets its bit and returns to the come-out, in the same hand', () => {
    scenario(id)
      .roll(3, 3)
      .expect({ transition: 'pointEstablished', point: 6, pointsMade: [] })
      .roll(5, 1)
      .expect({ transition: 'pointMade', point: null, pointsMade: [6], handIndex: 0 })
      .roll(4, 4)
      .roll(5, 3)
      .expect({ transition: 'pointMade', point: null, pointsMade: [6, 8] })
      // Making 6 again leaves one bit for it.
      .roll(2, 4)
      .roll(1, 5)
      .expect({ transition: 'pointMade', pointsMade: [6, 8], handRolls: 6 })
  })

  it('a seven-out moves to the next hand and resets its counters', () => {
    scenario(id)
      .roll(3, 3) // the point is 6
      .roll(2, 2) // 4: nothing
      .roll(5, 1) // 6 is made
      .roll(4, 6) // the point is 10
      .roll(6, 1) // seven-out
      .expect({
        transition: 'sevenOut',
        point: null,
        handIndex: 1,
        handRolls: 0,
        pointsMade: [],
        endedHand: { index: 0, rolls: 5, pointsMade: [6] },
        rolls: 5,
        rollsSinceSeven: 0,
        totalsSinceSeven: [],
      })
      .roll(3, 4)
      .expect({ transition: 'natural', handIndex: 1, handRolls: 1, endedHand: null })
  })

  it('a come-out 7 resets the since-seven counters but keeps the hand', () => {
    scenario(id)
      .roll(2, 2)
      .roll(1, 3)
      .expect({ transition: 'pointMade', rollsSinceSeven: 2, totalsSinceSeven: [4] })
      .roll(3, 4)
      .expect({
        transition: 'natural',
        handIndex: 0,
        handRolls: 3,
        pointsMade: [4],
        rollsSinceSeven: 0,
        totalsSinceSeven: [],
      })
  })
})
