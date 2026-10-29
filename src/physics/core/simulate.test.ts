import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type PhysicsParams } from './params.ts'
import { synthesizeRest } from './plan.ts'
import { deriveSeed } from './prng.ts'
import { angleBetween, normalize } from './quat.ts'
import { framePose, hashRecording } from './recording.ts'
import { posesOf, type DicePoses } from './restPose.ts'
import { simulateAttempt, simulateThrow, type ThrowResult } from './simulate.ts'
import { checkRecording } from './validity.ts'
import { initPhysics } from './world.ts'

/** Pinned so that any failure reproduces. */
const BASE_SEED = 0x5eed1
const POOL = 500
const SESSION = 25

interface Played {
  readonly start: DicePoses
  readonly result: ThrowResult
}

/** Sessions as the app plays them: each throw starts where the previous one came to rest. */
function playSessions(base: number, count: number, session: number): Played[] {
  const played: Played[] = []
  let start = posesOf(synthesizeRest(base, [1, 1]))
  for (let index = 0; index < count; index++) {
    if (index % session === 0) start = posesOf(synthesizeRest(deriveSeed(base, index), [1, 1]))
    const result = simulateThrow(deriveSeed(base, count + index), start)
    played.push({ start, result })
    start = result.recording.finalPoses
  }
  return played
}

let pool: Played[] = []

beforeAll(async () => {
  await initPhysics()
  pool = playSessions(BASE_SEED, POOL, SESSION)
}, 60_000)

describe('over 300 seeds', () => {
  it('is valid on the first attempt at least 95% of the time', () => {
    const first = pool.slice(0, 300).filter((p) => p.result.attempts[0]?.validity.valid)
    expect(first.length / 300).toBeGreaterThanOrEqual(0.95)
  })

  it('is always valid after the fallback chain, which stops at the first valid attempt', () => {
    for (const { result } of pool.slice(0, 300)) {
      expect(checkRecording(result.recording)).toEqual({ valid: true, reasons: [] })
      const verdicts = result.attempts.map((attempt) => attempt.validity.valid)
      expect(verdicts).toEqual([...verdicts.slice(0, -1).map(() => false), true])
    }
  })
})

describe('over 500 seeds', () => {
  it('never lets a die escape or a value go non-finite, in any attempt', () => {
    const attempts = pool.flatMap((p) => p.result.attempts)
    for (const { validity } of attempts) {
      expect(validity.reasons).not.toContain('escaped')
      expect(validity.reasons).not.toContain('nonfinite')
    }
    // Stronger than "the centre stayed inside": no die ever sank into a surface by 0.1 u (1.9 mm).
    expect(Math.max(...attempts.map((attempt) => attempt.penetration))).toBeLessThan(0.1)
  })

  it('settles within 4.5 s of simulated time at the 95th percentile', () => {
    const times = pool
      .map((p) => p.result.attempts[0]?.settleTime ?? -1)
      .map((time) => (time < 0 ? Infinity : time))
      .sort((a, b) => a - b)
    expect(times[Math.ceil(0.95 * times.length) - 1]).toBeLessThanOrEqual(4.5)
  })
})

describe('simulateAttempt', () => {
  const start = posesOf(synthesizeRest(21, [4, 4]))

  it('records at 60 Hz from the start poses until the dice have rested for 0.3 s', () => {
    const rec = simulateAttempt(77, start, 'pop')
    expect(rec.frameRate).toBe(60)
    expect(rec.frames).toHaveLength(rec.frameCount * 14)
    for (const die of [0, 1] as const) {
      const first = framePose(rec, 0, die)
      expect(first.p).toEqual(start[die].p.map((x) => Math.fround(x)))
      expect(angleBetween(first.q, normalize(start[die].q))).toBeLessThan(1e-6)
      expect(framePose(rec, rec.frameCount - 1, die)).toEqual(rec.finalPoses[die])
    }
    expect(rec.settleFrame).toBeGreaterThan(0)
    expect(rec.frameCount - 1 - rec.settleFrame).toBeGreaterThanOrEqual(0.3 * 60 - 1)
  })

  it('is deterministic: a fresh world per throw, so earlier throws change nothing', () => {
    const a = simulateAttempt(11, start, 'pop')
    simulateAttempt(12, start, 'pop')
    simulateAttempt(13, start, 'drop')
    const b = simulateAttempt(11, start, 'pop')
    expect(hashRecording(b)).toBe(hashRecording(a))
  })

  it('makes drops gentle enough to be valid nearly always', () => {
    const drops = pool.slice(0, 100).map((p, k) => simulateAttempt(k, p.start, 'drop'))
    const valid = drops.filter((rec) => checkRecording(rec).valid).length
    expect(valid).toBeGreaterThanOrEqual(95)
  })
})

describe('golden recording', () => {
  // Re-pin only on purpose: any change to params, the popper or Rapier changes every throw.
  // Checked in Node only; browsers may differ in Math.sin/cos, which builds the dome.
  it('reproduces the pinned hash for a pinned seed and start', () => {
    const start = posesOf(synthesizeRest(7, [3, 4]))
    const { recording, attempts } = simulateThrow(0xc0ffee, start)
    expect(attempts).toHaveLength(1)
    expect(hashRecording(recording)).toBe('3e108626a432e120')
  })
})

describe('the fallback chain', () => {
  it('refuses non-finite start poses', () => {
    const [a, b] = posesOf(synthesizeRest(5, [6, 6]))
    const broken = { ...b, q: [0, Number.NaN, 0, 1] as const }
    expect(() => simulateThrow(5, [a, broken])).toThrow(RangeError)
  })

  it('runs the pop, 8 re-pops, 4 drops, then the hop, which lands valid', () => {
    // Nothing can rest within -1° of flat, so every attempt fails until the scripted hop.
    const impossible: PhysicsParams = {
      ...DEFAULT_PARAMS,
      validity: { ...DEFAULT_PARAMS.validity, maxTiltDeg: -1 },
    }
    const result = simulateThrow(5, posesOf(synthesizeRest(5, [6, 6])), impossible)
    expect(result.attempts.map((attempt) => attempt.source)).toEqual([
      ...Array.from({ length: 9 }, () => 'pop'),
      ...Array.from({ length: 4 }, () => 'drop'),
      'hop',
    ])
    expect(new Set(result.attempts.map((attempt) => attempt.seed)).size).toBe(14)
    expect(result.recording.source).toBe('hop')
    expect(checkRecording(result.recording)).toEqual({ valid: true, reasons: [] })
  })
})
