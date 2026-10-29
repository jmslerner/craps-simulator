import { describe, expect, it } from 'vitest'
import { domeGap, touching } from './gap.ts'
import { DEFAULT_PARAMS, paramsFingerprint } from './params.ts'
import { synthesizeRest } from './plan.ts'
import { fromAxisAngle, multiply, type Vec3 } from './quat.ts'
import {
  FLOATS_PER_DIE,
  FLOATS_PER_FRAME,
  readPoses,
  type DieIndex,
  type Recording,
} from './recording.ts'
import { posesOf, upAxis, type DicePoses, type Pose } from './restPose.ts'
import { apexHeights, checkRecording, depthProfile } from './validity.ts'

const params = DEFAULT_PARAMS
const STEPS = params.stepsPerFrame

/** A second of the dice at `poses` frame by frame (one pose pair for all, or one per frame). */
function recorded(poses: DicePoses | readonly DicePoses[], settleFrame = 10): Recording {
  const frameCount = 60
  const at = (frame: number): DicePoses =>
    Array.isArray(poses[0])
      ? ((poses as readonly DicePoses[])[frame] ?? (poses as DicePoses))
      : (poses as DicePoses)
  const frames = new Float32Array(frameCount * FLOATS_PER_FRAME)
  const contacts = new Uint8Array((frameCount - 1) * STEPS + 1)
  for (let frame = 0; frame < frameCount; frame++) {
    at(frame).forEach((pose, die) => {
      frames.set([...pose.p, ...pose.q], frame * FLOATS_PER_FRAME + die * FLOATS_PER_DIE)
    })
    const flags = touching(readPoses(frames, frame), params)
    contacts.fill(flags, Math.max(0, (frame - 1) * STEPS + 1), frame * STEPS + 1)
  }
  const finalPoses = readPoses(frames, frameCount - 1)
  const finalUpAxis = [upAxis(finalPoses[0].q), upAxis(finalPoses[1].q)] as const
  return {
    frames,
    frameCount,
    frameRate: 60,
    stepsPerFrame: STEPS,
    contacts,
    settleFrame,
    finalPoses,
    finalUpAxis,
    source: 'pop',
    seed: 0,
    paramsFingerprint: paramsFingerprint(params),
  }
}

const rest = posesOf(synthesizeRest(3, [2, 5]))
const withDie = (die: DieIndex, change: Partial<Pose>): DicePoses =>
  die === 0 ? [{ ...rest[0], ...change }, rest[1]] : [rest[0], { ...rest[1], ...change }]
const reasons = (rec: Recording) => checkRecording(rec).reasons

/** Die 1, flat with its own yaw, moved out along +z until it presses `depth` into the wall. */
function atWall(depth: number): DicePoses {
  let inside = 6
  let outside = 7.5
  for (let k = 0; k < 60; k++) {
    const mid = (inside + outside) / 2
    if (domeGap({ ...rest[1], p: [0, 0.5, mid] }, params) > -depth) inside = mid
    else outside = mid
  }
  return withDie(1, { p: [0, 0.5, inside] })
}

describe('checkRecording', () => {
  it('accepts dice lying flat on the floor, apart, settled in time', () => {
    expect(checkRecording(recorded(rest))).toEqual({ valid: true, reasons: [] })
  })

  it('allows a lean of up to 4° and rejects a cocked die', () => {
    const lean = (deg: number) =>
      multiply(fromAxisAngle([1, 0, 0], (deg * Math.PI) / 180), rest[1].q)
    // Leaning 3.9° about its centre, a die dips 0.028 u into the floor: within a contact's sink.
    expect(reasons(recorded(withDie(1, { q: lean(3.9) })))).toEqual([])
    expect(reasons(recorded(withDie(1, { q: lean(4.2) })))).toEqual(['tilted'])
  })

  it('rejects a die resting off the floor, as on top of the other die', () => {
    expect(reasons(recorded(withDie(0, { p: [rest[1].p[0], 1.5, rest[1].p[2]] })))).toEqual([
      'height',
    ])
    expect(reasons(recorded(withDie(0, { p: [rest[0].p[0], 0.475, rest[0].p[2]] })))).toEqual([])
  })

  it('rejects a die resting pressed into the dome wall, by the trimesh, not the sphere', () => {
    expect(reasons(recorded(atWall(0.07)))).toEqual(['outside'])
    expect(reasons(recorded(atWall(0.03)))).toEqual([])
    // Deeper than any solver contact goes, it has overlapped the wall as well.
    expect(reasons(recorded(atWall(0.2)))).toEqual(['overlap', 'outside'])
  })

  it('rejects a throw in which a die got out at any frame', () => {
    const below = recorded(rest)
    below.frames[30 * FLOATS_PER_FRAME + 1] = -0.2
    expect(reasons(below)).toEqual(['escaped', 'overlap'])
    const through = recorded(rest)
    through.frames.set([0, 0.5, 7.6], 12 * FLOATS_PER_FRAME + FLOATS_PER_DIE)
    expect(reasons(through)).toEqual(['escaped', 'overlap'])
  })

  it('rejects dice that pass into each other or a die that sinks, at any single frame', () => {
    const into = (p: Vec3) => {
      const frames = Array.from({ length: 60 }, (_, frame) =>
        frame === 25 ? withDie(1, { p }) : rest,
      )
      return reasons(recorded(frames))
    }
    const [x, , z] = rest[0].p
    expect(into([x + 0.5, 0.5, z])).toEqual(['overlap'])
    expect(into([x, 1.4, z])).toEqual(['overlap'])
    expect(into([x + 3, 0.35, z + 0.5])).toEqual(['overlap'])
    // A solver contact sinks a little at an impact, and that is allowed.
    expect(into([x + 3, 0.42, z + 0.5])).toEqual([])
    expect(into([x, 1.42, z])).toEqual([])
  })

  it('rejects a NaN anywhere', () => {
    const rec = recorded(rest)
    rec.frames[5 * FLOATS_PER_FRAME + 4] = Number.NaN
    expect(reasons(rec)).toContain('nonfinite')
  })

  it('rejects a throw that never settled, or settled after 4.5 s', () => {
    expect(reasons(recorded(rest, -1))).toEqual(['unsettled'])
    expect(reasons(recorded(rest, 4.5 * 60))).toEqual([])
    expect(reasons(recorded(rest, 4.5 * 60 + 1))).toEqual(['unsettled'])
  })
})

describe('depthProfile', () => {
  it('separates the deepest frame, sustained contact and the rest, per surface', () => {
    const height = (frame: number) =>
      frame < 20 ? 0.49 : frame < 30 ? 2 : frame === 30 ? 0.42 : frame === 31 ? 0.47 : 0.498
    const frames = Array.from({ length: 60 }, (_, frame) =>
      withDie(0, { p: [rest[0].p[0], height(frame), rest[0].p[2]] }),
    )
    const { floor, dome, dice } = depthProfile(recorded(frames, 40))
    expect(floor.deepest).toBeCloseTo(0.08, 6)
    // The impact at frame 30 came out of the air; only the first rest was sustained contact.
    expect(floor.sustained).toBeCloseTo(0.01, 6)
    expect(floor.atRest).toBeCloseTo(0.002, 6)
    for (const away of [dome, dice]) expect(away.deepest).toBeLessThan(0)
  })

  it('has no rest depth for a throw that never settled', () => {
    expect(depthProfile(recorded(rest, -1)).floor.atRest).toBeNaN()
  })
})

describe('apexHeights', () => {
  it('is how high each centre rose', () => {
    const frames = Array.from({ length: 60 }, (_, frame) =>
      withDie(1, { p: [rest[1].p[0], frame === 7 ? 4.25 : 0.5, rest[1].p[2]] }),
    )
    expect(apexHeights(recorded(frames))).toEqual([0.5, 4.25])
  })
})
