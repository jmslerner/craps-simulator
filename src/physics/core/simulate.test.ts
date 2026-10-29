import { beforeAll, describe, expect, it } from 'vitest'
import { DIE_FACES } from './cube.ts'
import { touching } from './gap.ts'
import { DEFAULT_PARAMS, paramsFingerprint, type PhysicsParams } from './params.ts'
import { synthesizeRest } from './plan.ts'
import { deriveSeed } from './prng.ts'
import { angleBetween, normalize } from './quat.ts'
import { framePose, hashRecording, readPoses, touchesAt, TOUCH_FLOOR } from './recording.ts'
import { naturalTopFace, posesOf, type DicePoses } from './restPose.ts'
import { simulateAttempt, simulateThrow, type ThrowResult } from './simulate.ts'
import { checkRecording } from './validity.ts'
import { initPhysics } from './world.ts'

/** Pinned so that any failure reproduces. */
const BASE_SEED = 0x5eed1
const POOL = 500
const SESSION = 25
const SURFACES = ['floor', 'dome', 'dice'] as const

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
  const attempts = () => pool.flatMap((p) => p.result.attempts)

  it('never lets a die escape or a value go non-finite, in any attempt', () => {
    for (const { validity } of attempts()) {
      expect(validity.reasons).not.toContain('escaped')
      expect(validity.reasons).not.toContain('nonfinite')
    }
  })

  it('keeps exact depths into the floor, the dome and the other die small', () => {
    // Measured on these seeds (deepest at any frame / in sustained contact / at rest, u):
    // floor 0.065 / 0.011 / 0.0014, dome 0.034 / 0.007 / 0.0011, dice 0.068 / 0.005 / 0.
    for (const surface of SURFACES) {
      for (const attempt of attempts()) {
        const depths = attempt.depths[surface]
        // An impact may sink a die briefly; a shown recording never more than maxOverlap.
        expect(depths.deepest).toBeLessThan(0.15)
        if (attempt.validity.valid) {
          expect(depths.deepest).toBeLessThanOrEqual(DEFAULT_PARAMS.validity.maxOverlap)
        }
        // Resting, sliding or rolling contact: well under the ~0.05 u that would be visible.
        expect(depths.sustained).toBeLessThan(0.03)
        if (attempt.validity.valid) expect(depths.atRest).toBeLessThan(0.005)
      }
    }
  })

  it('settles within 4.5 s of simulated time at the 95th percentile', () => {
    const times = pool
      .map((p) => p.result.attempts[0]?.settleTime ?? -1)
      .map((time) => (time < 0 ? Infinity : time))
      .sort((a, b) => a - b)
    expect(times[Math.ceil(0.95 * times.length) - 1]).toBeLessThanOrEqual(4.5)
  })
})

describe('realism, over the 500 pooled throws', () => {
  // Validity alone would accept a "throw" that never left the floor; these would not.
  it('throws: every first attempt lifts both dice at least 3 u', () => {
    // Measured: the lower die of the lowest throw rose to 3.53 u.
    for (const { result } of pool) {
      for (const apex of result.attempts[0]?.apex ?? []) expect(apex).toBeGreaterThanOrEqual(3)
    }
  })

  it('rolls fair natural faces: χ² on 5 degrees of freedom passes at p = .01', () => {
    const counts = new Map(DIE_FACES.map((face) => [face, 0]))
    for (const { result } of pool) {
      for (const pose of result.recording.finalPoses) {
        const face = naturalTopFace(pose.q)
        counts.set(face, (counts.get(face) ?? 0) + 1)
      }
    }
    const expected = (2 * POOL) / 6
    const chi2 = [...counts.values()].reduce((sum, k) => sum + (k - expected) ** 2 / expected, 0)
    // Measured: 6.32.
    expect(chi2).toBeLessThan(15.09)
  })

  it('tumbles: the face that ends on top does not follow the face that started there', () => {
    let same = 0
    let opposite = 0
    for (const { start, result } of pool) {
      for (const die of [0, 1] as const) {
        const before = naturalTopFace(start[die].q)
        const after = naturalTopFace(result.recording.finalPoses[die].q)
        if (after === before) same++
        if (after + before === 7) opposite++
      }
    }
    // Each is 1/6 for a fair tumble (σ ≈ 0.012 here); measured 0.181 and 0.144.
    expect(Math.abs(same / (2 * POOL) - 1 / 6)).toBeLessThan(0.05)
    expect(Math.abs(opposite / (2 * POOL) - 1 / 6)).toBeLessThan(0.05)
  })
})

describe('simulateAttempt', () => {
  const start = posesOf(synthesizeRest(21, [4, 4]))

  it('records at 60 Hz from the start poses until the dice have rested for 0.3 s', () => {
    const rec = simulateAttempt(77, start, 'pop')
    expect(rec.frameRate).toBe(60)
    expect(rec.stepsPerFrame).toBe(8)
    expect(rec.frames).toHaveLength(rec.frameCount * 14)
    expect(rec.paramsFingerprint).toBe(paramsFingerprint(DEFAULT_PARAMS))
    for (const die of [0, 1] as const) {
      const first = framePose(rec, 0, die)
      expect(first.p).toEqual(start[die].p.map((x) => Math.fround(x)))
      expect(angleBetween(first.q, normalize(start[die].q))).toBeLessThan(1e-6)
      expect(framePose(rec, rec.frameCount - 1, die)).toEqual(rec.finalPoses[die])
    }
    expect(rec.settleFrame).toBeGreaterThan(0)
    expect(rec.frameCount - 1 - rec.settleFrame).toBeGreaterThanOrEqual(0.3 * 60 - 1)
  })

  it('records a contact byte for every step, agreeing with the exact gaps', () => {
    const rec = simulateAttempt(77, start, 'pop')
    expect(rec.contacts).toHaveLength((rec.frameCount - 1) * rec.stepsPerFrame + 1)
    for (let frame = 0; frame < rec.frameCount; frame++) {
      expect(rec.contacts[frame * rec.stepsPerFrame]).toBe(
        touching(readPoses(rec.frames, frame), DEFAULT_PARAMS),
      )
    }
    // On the floor at the start and at rest, and free of everything for a while in between.
    for (const die of [0, 1] as const) {
      expect(touchesAt(rec, 0, die)).toBe(TOUCH_FLOOR)
      expect(touchesAt(rec, rec.contacts.length - 1, die) & TOUCH_FLOOR).toBe(TOUCH_FLOOR)
      let free = 0
      for (let step = 0; step < rec.contacts.length; step++) {
        if (touchesAt(rec, step, die) === 0) free++
      }
      expect(free).toBeGreaterThan(rec.stepsPerFrame * 6)
    }
  })

  it('can be transferred: frames and contacts each own a whole buffer', () => {
    const rec = simulateAttempt(78, start, 'pop')
    const hash = hashRecording(rec)
    for (const array of [rec.frames, rec.contacts]) {
      expect(array.byteOffset).toBe(0)
      expect(array.buffer.byteLength).toBe(array.byteLength)
    }
    const moved = structuredClone(rec, { transfer: [rec.frames.buffer, rec.contacts.buffer] })
    expect(hashRecording(moved)).toBe(hash)
    expect(rec.frames).toHaveLength(0)
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
  // Re-pin only on purpose: any change to params, the popper, contact flags or Rapier changes
  // every throw. Checked in Node only; browsers may differ in Math.sin/cos, which builds the dome.
  // The hash covers the frames, the contact bytes and the params fingerprint.
  it('reproduces the pinned hash for a pinned seed and start', () => {
    const start = posesOf(synthesizeRest(7, [3, 4]))
    const { recording, attempts } = simulateThrow(0xc0ffee, start)
    expect(attempts).toHaveLength(1)
    expect(hashRecording(recording)).toBe('16720c1589ac738c')
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
    expect(result.recording.paramsFingerprint).toBe(paramsFingerprint(impossible))
    expect(checkRecording(result.recording)).toEqual({ valid: true, reasons: [] })
  })
})
