import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from './params.ts'
import { createSettleTracker, isStill } from './settle.ts'

const { settle, timestep } = DEFAULT_PARAMS
const zero = { x: 0, y: 0, z: 0 }

describe('isStill', () => {
  it('needs both speeds strictly under the limits', () => {
    expect(isStill({ x: 0.03, y: 0.03, z: 0 }, { x: 0.07, y: 0, z: 0.07 }, settle)).toBe(true)
    expect(isStill({ x: 0.05, y: 0, z: 0 }, zero, settle)).toBe(false)
    expect(isStill(zero, { x: 0, y: 0.1, z: 0 }, settle)).toBe(false)
  })
})

describe('createSettleTracker', () => {
  const hold = Math.round(settle.hold / timestep)

  it('settles after the hold time of stillness and reports when the rest began', () => {
    const tracker = createSettleTracker(settle, timestep)
    for (let step = 1; step < 10; step++) expect(tracker.observe(step, false, false)).toBe(false)
    for (let step = 10; step < 10 + hold; step++) {
      expect(tracker.observe(step, true, false)).toBe(false)
      expect(tracker.restStep()).toBe(-1)
    }
    expect(tracker.observe(10 + hold, true, false)).toBe(true)
    expect(tracker.restStep()).toBe(10)
    expect(tracker.observe(11 + hold, false, false)).toBe(true)
  })

  it('starts the hold again whenever a die moves', () => {
    const tracker = createSettleTracker(settle, timestep)
    for (let step = 1; step < hold; step++) tracker.observe(step, true, false)
    tracker.observe(hold, false, false)
    expect(tracker.observe(2 * hold, true, false)).toBe(false)
    expect(tracker.observe(3 * hold, true, false)).toBe(true)
    expect(tracker.restStep()).toBe(2 * hold)
  })

  it('settles at once when both dice sleep', () => {
    const tracker = createSettleTracker(settle, timestep)
    tracker.observe(1, false, false)
    expect(tracker.observe(2, false, true)).toBe(true)
    expect(tracker.restStep()).toBe(2)
  })
})
