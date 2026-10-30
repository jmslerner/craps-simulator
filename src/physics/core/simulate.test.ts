import { beforeAll, describe, expect, it } from 'vitest'
import { DIE_FACES } from './cube.ts'
import { diceGap, touching } from './gap.ts'
import { DEFAULT_PARAMS, paramsFingerprint, type PhysicsParams } from './params.ts'
import { buildPlaybackPlan, synthesizeRest } from './plan.ts'
import { deriveSeed } from './prng.ts'
import { angleBetween, IDENTITY, normalize, type Vec3 } from './quat.ts'
import { framePose, hashRecording, readPoses, touchesAt, TOUCH_FLOOR } from './recording.ts'
import {
  hashRest,
  naturalTopFace,
  posesOf,
  restOf,
  visualTopFace,
  type DicePoses,
  type RestState,
} from './restPose.ts'
import { simulateAttempt, simulateThrow, type AttemptLog, type ThrowResult } from './simulate.ts'
import { checkRecording, checkStart, depthProfile } from './validity.ts'
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

/**
 * Sessions as the app plays them: each throw starts where the previous one came to rest. These are
 * the throws `physics-stats --seeds count --chain session --base base` makes. `from` skips to a
 * later throw by replaying only its session.
 */
function playSessions(base: number, count: number, session: number, from = 0): Played[] {
  const played: Played[] = []
  let start = posesOf(synthesizeRest(base, [1, 1]))
  for (let index = from - (from % session); index < count; index++) {
    if (index % session === 0) start = posesOf(synthesizeRest(deriveSeed(base, index), [1, 1]))
    const result = simulateThrow(deriveSeed(base, count + index), restOf(start))
    if (index >= from) played.push({ start, result })
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

  it('starts every chained throw where the last one came to rest', () => {
    for (const { start, result } of pool.slice(0, 300)) {
      expect(result.start).toEqual({ valid: true, reasons: [] })
      expect(posesOf(result.rest)).toEqual(start)
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
    // Measured on these seeds, u, deepest at any physics step / at any 60 Hz frame / in sustained
    // contact per 60 Hz frame / at rest per 60 Hz frame: floor 0.142 / 0.065 / 0.011 / 0.0014,
    // dome 0.043 / 0.034 / 0.007 / 0.0011, dice 0.118 / 0.068 / 0.005 / 0.0011. Sustained contact
    // reached 0.036 u per frame in 6000 throws (physics-stats --seeds 6000; 0.024 and 0.023 u from
    // bases 2 and 3).
    const { maxOverlap } = DEFAULT_PARAMS.validity
    for (const surface of SURFACES) {
      for (const attempt of attempts()) {
        const depths = attempt.depths[surface]
        // The frames are some of the steps.
        expect(depths.step).toBeGreaterThanOrEqual(depths.frame)
        // An impact may sink a die briefly, never through anything; a shown recording sinks no
        // more than maxOverlap at any step.
        expect(depths.step).toBeLessThan(0.2)
        if (attempt.validity.valid) expect(depths.step).toBeLessThanOrEqual(maxOverlap)
        // Resting, sliding or rolling contact: under the 0.05 u (1 mm) that would show.
        expect(depths.sustained).toBeLessThan(0.05)
        if (attempt.validity.valid) expect(depths.atRest).toBeLessThan(0.005)
      }
    }
  })

  it('settles within a second of simulated time at the 95th percentile', () => {
    // Measured: 0.60 s on these seeds, 0.62 to 0.63 s over 6000 throws; the deadline is 4.5 s.
    const times = pool
      .map((p) => p.result.attempts[0]?.settleTime ?? -1)
      .map((time) => (time < 0 ? Infinity : time))
      .sort((a, b) => a - b)
    expect(times[Math.ceil(0.95 * times.length) - 1]).toBeLessThanOrEqual(1)
  })
})

describe('overlap between frames', () => {
  /** The deepest frame and the deepest step of an attempt, over every surface. */
  const deepest = ({ depths }: AttemptLog) => ({
    frame: Math.max(depths.floor.frame, depths.dome.frame, depths.dice.frame),
    step: Math.max(depths.floor.step, depths.dome.step, depths.dice.step),
  })
  const { maxOverlap } = DEFAULT_PARAMS.validity

  it('rejects a throw that sinks too deep only between frames, and throws again', () => {
    // The audit's probe: pool throw 116 went 0.142 u into the floor and 0.118 u into the other
    // die at single steps, while its frames show at most 0.068 u.
    const played = pool[116]
    if (!played) throw new Error('no throw 116')
    const { attempts, recording } = played.result
    const [first] = attempts
    if (!first) throw new Error('no attempt')
    expect(first.seed).toBe(3941621094)
    expect(first.depths.floor.step).toBeCloseTo(0.1417, 4)
    expect(first.depths.dice.step).toBeCloseTo(0.118, 3)
    expect(deepest(first).frame).toBeLessThan(maxOverlap)
    expect(first.validity.reasons).toEqual(['overlap'])
    expect(attempts.length).toBeGreaterThan(1)
    expect(checkRecording(recording)).toEqual({ valid: true, reasons: [] })
  })

  it('sees dice pass into each other between frames', () => {
    // The audit's other probe, physics-stats --seeds 300 throw 124: the dice met 0.110 u deep at
    // a step, while the frames show 0.003 u at most, into the floor.
    const [played] = playSessions(1, 300, 10, 124)
    const first = played?.result.attempts[0]
    if (!first) throw new Error('no attempt')
    expect(first.seed).toBe(1499903179)
    expect(first.depths.dice.step).toBeCloseTo(0.1103, 4)
    expect(deepest(first).frame).toBeLessThan(0.005)
    expect(first.validity.reasons).toEqual(['overlap'])
  })

  it('keeps the deepest step of every attempt, which the frames can miss by a lot', () => {
    // Measured on these seeds: the deepest step went up to 0.096 u deeper than any frame.
    const gaps = pool
      .flatMap((p) => p.result.attempts)
      .map((attempt) => {
        const { frame, step } = deepest(attempt)
        return step - frame
      })
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...gaps)).toBeGreaterThan(0.05)
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
    // Measured: 6.28.
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
  const rest = synthesizeRest(21, [4, 4])
  const start = posesOf(rest)

  it('records at 60 Hz from the start poses until the dice have rested for 0.3 s', () => {
    const rec = simulateAttempt(77, rest, 'pop')
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
    const rec = simulateAttempt(77, rest, 'pop')
    expect(rec.contacts).toHaveLength((rec.frameCount - 1) * rec.stepsPerFrame + 1)
    for (let frame = 0; frame < rec.frameCount; frame++) {
      expect(rec.contacts[frame * rec.stepsPerFrame]).toBe(
        touching(readPoses(rec.frames, frame), DEFAULT_PARAMS),
      )
    }
    // The deepest overlaps of all steps, which include every frame, read from the same gaps.
    const frames = depthProfile(rec)
    for (const surface of SURFACES) {
      expect(rec.stepDepths[surface]).toBeGreaterThanOrEqual(frames[surface].frame)
      expect(frames[surface].step).toBe(rec.stepDepths[surface])
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
    const rec = simulateAttempt(78, rest, 'pop')
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
    const a = simulateAttempt(11, rest, 'pop')
    simulateAttempt(12, rest, 'pop')
    simulateAttempt(13, rest, 'drop')
    const b = simulateAttempt(11, rest, 'pop')
    expect(hashRecording(b)).toBe(hashRecording(a))
  })

  it('stamps the rest it was thrown from, offsets and all', () => {
    const rec = simulateAttempt(11, rest, 'pop')
    expect(rec.restHash).toBe(hashRest(rest))
    const otherOffsets = restOf(start, [rest[0].offset, (rest[1].offset + 1) % 24])
    expect(simulateAttempt(11, otherOffsets, 'pop').restHash).not.toBe(rec.restHash)
    // The offsets change only the stamp: the physics never sees which faces are drawn.
    expect(simulateAttempt(11, otherOffsets, 'pop').frames).toEqual(rec.frames)
  })

  it('makes drops gentle enough to be valid nearly always', () => {
    const drops = pool.slice(0, 100).map((p, k) => simulateAttempt(k, restOf(p.start), 'drop'))
    const valid = drops.filter((rec) => checkRecording(rec).valid).length
    expect(valid).toBeGreaterThanOrEqual(95)
  })
})

describe('golden recording', () => {
  // Re-pin only on purpose: any change to params, the popper, contact flags or Rapier changes
  // every throw. Checked in Node only; browsers may differ in Math.sin/cos, which builds the dome.
  // The hash covers the frames, the contact bytes, the per-step depths, the params fingerprint and
  // the rest hash. Re-pinned in P1c, when it began to cover the last two of those: the frames and
  // contacts are bit for bit those P1b pinned as 16720c1589ac738c.
  it('reproduces the pinned hash for a pinned seed and start', () => {
    const { recording, attempts } = simulateThrow(0xc0ffee, synthesizeRest(7, [3, 4]))
    expect(attempts).toHaveLength(1)
    // Re-pinned in M10b from 6030a138dfc5ffd7: only the params fingerprint it covers changed
    // (the new `handoff` thresholds); frames, contacts and depths are bit-identical.
    expect(hashRecording(recording)).toBe('ea86e16b9a2178b8')
  })
})

describe('the fallback chain', () => {
  it('refuses non-finite start poses, and a quaternion without a length', () => {
    const [a, b] = posesOf(synthesizeRest(5, [6, 6]))
    const broken = { ...b, q: [0, Number.NaN, 0, 1] as const }
    expect(() => simulateThrow(5, restOf([a, broken]))).toThrow(RangeError)
    const zero = { ...b, q: [0, 0, 0, 0] as const }
    expect(() => simulateThrow(5, restOf([a, zero]))).toThrow(RangeError)
  })

  it('runs the pop, 8 re-pops, 4 drops, then the hop, which lands valid', () => {
    // A resting die sinks about 0.001 u into the floor (params.ts), so no physics attempt stays
    // within 1e-6 u of it, while the scripted hop lands flat at restHeight to Float32 rounding.
    const strict: PhysicsParams = {
      ...DEFAULT_PARAMS,
      validity: { ...DEFAULT_PARAMS.validity, maxOverlap: 1e-6 },
    }
    const result = simulateThrow(5, synthesizeRest(5, [6, 6]), strict)
    expect(result.attempts.map((attempt) => attempt.source)).toEqual([
      ...Array.from({ length: 9 }, () => 'pop'),
      ...Array.from({ length: 4 }, () => 'drop'),
      'hop',
    ])
    for (const attempt of result.attempts.slice(0, -1)) {
      expect(attempt.validity.reasons).toEqual(['overlap'])
    }
    expect(new Set(result.attempts.map((attempt) => attempt.seed)).size).toBe(14)
    expect(result.recording.source).toBe('hop')
    expect(result.recording.paramsFingerprint).toBe(paramsFingerprint(strict))
    expect(checkRecording(result.recording, strict)).toEqual({ valid: true, reasons: [] })
  })

  it('throws rather than return an invalid hop, as params no flat landing meets make it', () => {
    // Nothing rests within -1° of flat, the hop's landing included.
    const impossible: PhysicsParams = {
      ...DEFAULT_PARAMS,
      validity: { ...DEFAULT_PARAMS.validity, maxTiltDeg: -1 },
    }
    expect(() => simulateThrow(5, synthesizeRest(5, [6, 6]), impossible)).toThrow(
      'simulateThrow: the analytic hop is invalid (tilted)',
    )
  })
})

describe('the start', () => {
  const VALID = { valid: true, reasons: [] }
  /** `rest` with die 1 moved to `p`. */
  const moved = (rest: RestState, p: Vec3): RestState => [
    rest[0],
    { ...rest[1], pose: { ...rest[1].pose, p } },
  ]
  const faces = (rest: RestState) => rest.map((die) => visualTopFace(die.pose.q, die.offset))

  it('starts from fresh poses when the dice start sunk into each other, as the audit found', () => {
    // The audit's repro: die 1 moved to die 0 plus 0.7 u along x, 0.467 u into it. Every attempt
    // failed with 'overlap' at its first frame, and the hop returned at the end failed as well.
    const asked = synthesizeRest(11, [3, 4])
    const [x, y, z] = asked[0].pose.p
    const sunk = moved(asked, [x + 0.7, y, z])
    expect(diceGap(sunk[0].pose, sunk[1].pose, DEFAULT_PARAMS.die)).toBeCloseTo(-0.4675, 4)
    const result = simulateThrow(5, sunk)
    expect(result.start).toEqual({ valid: false, reasons: ['overlap'] })
    expect(checkRecording(result.recording)).toEqual(VALID)
    // The fresh rest shows the same faces, and the recording starts from it, so the plan must too.
    expect(checkStart(result.rest)).toEqual(VALID)
    expect(faces(result.rest)).toEqual([3, 4])
    expect(result.recording.restHash).toBe(hashRest(result.rest))
    const dice = { d1: 5, d2: 2 } as const
    const plan = buildPlaybackPlan(result.recording, dice, result.rest, 'snap')
    expect(plan.tracks.map((track) => track.startOffset)).toEqual([0, 0])
    expect(() => buildPlaybackPlan(result.recording, dice, sunk, 'snap')).toThrow(RangeError)
    // As repeatable as any throw.
    expect(hashRecording(simulateThrow(5, sunk).recording)).toBe(hashRecording(result.recording))
  })

  it('keeps a start no deeper than maxOverlap, and replaces a deeper one', () => {
    const sideBySide = (apart: number): RestState =>
      restOf([
        { p: [-apart / 2, 0.5, 0], q: IDENTITY },
        { p: [apart / 2, 0.5, 0], q: IDENTITY },
      ])
    const shallow = sideBySide(0.91)
    const kept = simulateThrow(5, shallow)
    expect(kept.start).toEqual(VALID)
    expect(kept.rest).toBe(shallow)
    expect(kept.recording.restHash).toBe(hashRest(shallow))
    expect(checkRecording(kept.recording)).toEqual(VALID)
    const deep = sideBySide(0.89)
    const replaced = simulateThrow(5, deep)
    expect(replaced.start).toEqual({ valid: false, reasons: ['overlap'] })
    expect(replaced.rest).not.toBe(deep)
    expect(faces(replaced.rest)).toEqual(faces(deep))
    expect(checkRecording(replaced.recording)).toEqual(VALID)
  })

  it('starts from fresh poses when a die lies outside the dome', () => {
    const result = simulateThrow(9, moved(synthesizeRest(12, [1, 6]), [0, 0.5, 9]))
    expect(result.start).toEqual({ valid: false, reasons: ['escaped', 'overlap'] })
    expect(faces(result.rest)).toEqual([1, 6])
    expect(checkRecording(result.recording)).toEqual(VALID)
  })
})
