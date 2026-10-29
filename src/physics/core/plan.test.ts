import { beforeAll, describe, expect, it } from 'vitest'
import { DIE_FACES, FACE_NORMALS, rotationAngleDeg, rotationAt, type DieFace } from './cube.ts'
import { domeFaces } from './dome.ts'
import { circumradius, domeGap, touching } from './gap.ts'
import { analyticHop } from './hop.ts'
import { DEFAULT_PARAMS, type PhysicsParams } from './params.ts'
import {
  airborne,
  buildPlaybackPlan,
  clearance,
  faceShown,
  offsetAt,
  snapFrame,
  synthesizeRest,
  visualRotation,
  type DicePair,
  type PlaybackPlan,
} from './plan.ts'
import { createPrng, deriveSeed, type Prng } from './prng.ts'
import { chooseEndOffset, remapCandidates } from './remap.ts'
import {
  angleBetween,
  fromAxisAngle,
  IDENTITY,
  multiply,
  normalize,
  rotate,
  type Quat,
  type Vec3,
} from './quat.ts'
import {
  FLOATS_PER_DIE,
  FLOATS_PER_FRAME,
  framePose,
  readPoses,
  type Recording,
} from './recording.ts'
import { posesOf, tiltDeg, visualTopFace, type DicePoses, type RestState } from './restPose.ts'
import { simulateThrow } from './simulate.ts'
import { initPhysics } from './world.ts'

/** Pinned so that any failure reproduces. */
const META_SEED = 0xd1ce
const PLANS = 1000
const SESSION = 25
const COS_4_DEG = Math.cos((4 * Math.PI) / 180)
const params = DEFAULT_PARAMS

interface Sample {
  readonly plan: PlaybackPlan
  readonly prevRest: RestState
  readonly dice: DicePair
}

const face = (prng: Prng): DieFace => DIE_FACES[Math.floor(prng.next() * 6)] ?? 1
const dice = [0, 1] as const

const samples: Sample[] = []

beforeAll(async () => {
  await initPhysics()
  const prng = createPrng(META_SEED)
  let rest = synthesizeRest(META_SEED, [face(prng), face(prng)])
  for (let index = 0; index < PLANS; index++) {
    if (index % SESSION === 0) {
      rest = synthesizeRest(deriveSeed(META_SEED, index), [face(prng), face(prng)])
    }
    const seed = prng.nextUint32()
    const roll = { d1: face(prng), d2: face(prng) }
    const { recording } = simulateThrow(seed, posesOf(rest))
    const plan = buildPlaybackPlan(recording, roll, rest, 'snap')
    samples.push({ plan, prevRest: rest, dice: roll })
    rest = plan.rest
  }
}, 60_000)

/** A recording of the dice at the given poses, one pair per frame, with its contacts flagged. */
function recordingOf(frames: readonly DicePoses[], settleFrame = frames.length - 1): Recording {
  const { stepsPerFrame } = params
  const frameCount = frames.length
  const data = new Float32Array(frameCount * FLOATS_PER_FRAME)
  const contacts = new Uint8Array((frameCount - 1) * stepsPerFrame + 1)
  frames.forEach((poses, frame) => {
    poses.forEach(({ p, q }, die) => {
      data.set([...p, ...q], frame * FLOATS_PER_FRAME + die * FLOATS_PER_DIE)
    })
    const flags = touching(readPoses(data, frame), params)
    contacts.fill(flags, Math.max(0, (frame - 1) * stepsPerFrame + 1), frame * stepsPerFrame + 1)
  })
  const rec = analyticHop(1, frames[0] ?? posesOf(synthesizeRest(1, [1, 1])))
  return {
    ...rec,
    frames: data,
    frameCount,
    contacts,
    settleFrame,
    finalPoses: readPoses(data, frameCount - 1),
  }
}

describe('1000 random (seed, d1, d2) plans', () => {
  it('land showing the requested dice on top', () => {
    for (const { plan, dice: roll } of samples) {
      const last = plan.recording.frameCount - 1
      const wanted = plan.swapped ? [roll.d2, roll.d1] : [roll.d1, roll.d2]
      expect(plan.tracks.map((track) => track.face)).toEqual(wanted)
      for (const die of dice) {
        expect(faceShown(plan, die, last)).toBe(wanted[die])
        // Independently of the remap tables: the wanted face's pip normal, drawn, points up.
        const up = rotate(visualRotation(plan, die, last), FACE_NORMALS[wanted[die] ?? 1])
        expect(up[1]).toBeGreaterThan(COS_4_DEG)
      }
    }
  })

  it('show those faces from the moment the dice come to rest', () => {
    for (const { plan } of samples) {
      for (let frame = plan.recording.settleFrame; frame < plan.recording.frameCount; frame++) {
        for (const die of dice) expect(faceShown(plan, die, frame)).toBe(plan.tracks[die].face)
      }
    }
  })

  it('start from the drawn pose the previous throw left, so nothing jumps at frame 0', () => {
    for (const { plan, prevRest } of samples) {
      for (const die of dice) {
        const before = multiply(
          normalize(prevRest[die].pose.q),
          rotationAt(prevRest[die].offset).quat,
        )
        expect(angleBetween(visualRotation(plan, die, 0), before)).toBeLessThan(1e-6)
      }
    }
  })

  it('hide every switch they can: airborne, touching nothing, turning at least 6 rad/s', () => {
    const { minTurnRate } = params.snap
    let switches = 0
    let hidden = 0
    for (const { plan } of samples) {
      for (const die of dice) {
        const track = plan.tracks[die]
        expect(offsetAt(track, track.switchFrame - 1)).toBe(track.startOffset)
        expect(offsetAt(track, track.switchFrame)).toBe(track.endOffset)
        if (track.startOffset === track.endOffset) {
          expect(track.hidden).toBe(true)
          continue
        }
        switches++
        const snap = snapFrame(plan.recording, die, params)
        expect([snap.frame, snap.hidden]).toEqual([track.switchFrame, track.hidden])
        if (!track.hidden) continue
        hidden++
        expect(airborne(plan.recording, track.switchFrame - 1, die, params)).toBe(true)
        expect(airborne(plan.recording, track.switchFrame, die, params)).toBe(true)
        expect(snap.turnRate).toBeGreaterThanOrEqual(minTurnRate)
      }
    }
    expect(hidden / switches).toBeGreaterThanOrEqual(0.99)
  })

  it('switch where the dice turn fast: the turn rates at the switches', () => {
    const rates = samples
      .flatMap(({ plan }) =>
        dice.flatMap((die) => {
          const track = plan.tracks[die]
          if (track.startOffset === track.endOffset) return []
          const rec = plan.recording
          const turn = angleBetween(
            framePose(rec, track.switchFrame - 1, die).q,
            framePose(rec, track.switchFrame, die).q,
          )
          return [turn * rec.frameRate]
        }),
      )
      .sort((a, b) => a - b)
    const quantile = (q: number) => rates[Math.ceil(q * rates.length) - 1] ?? Number.NaN
    expect(rates.length).toBeGreaterThan(1000)
    // Measured on these seeds: 1477 of 1478 switches hidden; min 7.0, p1 13.0, p5 18.7 and
    // p50 32.3 rad/s.
    expect(quantile(0.01)).toBeGreaterThanOrEqual(params.snap.minTurnRate)
    expect(quantile(0.05)).toBeGreaterThan(12)
    expect(quantile(0.5)).toBeGreaterThan(24)
  })

  it('swap which body shows d1 only when that turns the drawn faces less', () => {
    let swaps = 0
    for (const { plan, dice: roll, prevRest } of samples) {
      // The assignment the plan did not take: each body's nearest offset for the other face.
      const faces = plan.swapped ? [roll.d1, roll.d2] : [roll.d2, roll.d1]
      const other = dice.reduce<number>((sum, die) => {
        const start = prevRest[die].offset
        const up = plan.recording.finalUpAxis[die]
        const end = chooseEndOffset(up, faces[die] ?? 1, start)
        return sum + rotationAngleDeg(start, end)
      }, 0)
      if (plan.swapped) {
        swaps++
        expect(cost(plan)).toBeLessThan(other)
      } else {
        expect(cost(plan)).toBeLessThanOrEqual(other)
      }
    }
    expect(swaps).toBeGreaterThan(0)
  })

  it('hand the next throw a rest at the final poses with the end offsets', () => {
    for (const { plan } of samples) {
      for (const die of dice) {
        expect(plan.rest[die]).toEqual({
          pose: plan.recording.finalPoses[die],
          offset: plan.tracks[die].endOffset,
        })
      }
    }
  })
})

describe('the swap logic', () => {
  it('keeps 19 dice in 72 showing the face already on top, over every case', () => {
    // Every d1, d2 and face already on top of each body (with its start offset): 6^4 cases.
    // A body keeps its drawn face 1 time in 6 by itself; taking the cheaper of the two
    // assignments, with ties to the straight one, raises that to 684/2592 = 19/72 exactly.
    const rest = synthesizeRest(4, [5, 2])
    const recording = analyticHop(8, posesOf(rest))
    const showing = (die: 0 | 1, top: DieFace) =>
      remapCandidates(recording.finalUpAxis[die], top)[0] ?? 0
    let kept = 0
    let swaps = 0
    for (const d1 of DIE_FACES) {
      for (const d2 of DIE_FACES) {
        for (const top0 of DIE_FACES) {
          for (const top1 of DIE_FACES) {
            const prevRest: RestState = [
              { pose: rest[0].pose, offset: showing(0, top0) },
              { pose: rest[1].pose, offset: showing(1, top1) },
            ]
            expect(visualTopFace(recording.finalPoses[0].q, prevRest[0].offset)).toBe(top0)
            const plan = buildPlaybackPlan(recording, { d1, d2 }, prevRest, 'snap')
            if (plan.swapped) swaps++
            kept += plan.tracks.filter((track) => track.startOffset === track.endOffset).length
          }
        }
      }
    }
    expect(kept).toBe(684)
    expect(swaps).toBe(342)
  })

  it('handles doubles and the analytic hop', () => {
    const rest = synthesizeRest(4, [5, 2])
    const recording = analyticHop(8, posesOf(rest))
    for (const value of DIE_FACES) {
      const plan = buildPlaybackPlan(recording, { d1: value, d2: value }, rest, 'snap')
      expect(plan.swapped).toBe(false)
      const last = recording.frameCount - 1
      expect([faceShown(plan, 0, last), faceShown(plan, 1, last)]).toEqual([value, value])
    }
  })
})

describe('buildPlaybackPlan refuses a recording it cannot continue', () => {
  const rest = synthesizeRest(6, [1, 3])
  const recording = analyticHop(2, posesOf(rest))

  it('accepts the rest the recording started from, as Float32 rounds it', () => {
    const rounded: RestState = [
      {
        ...rest[0],
        pose: { p: rest[0].pose.p.map(Math.fround) as unknown as Vec3, q: rest[0].pose.q },
      },
      rest[1],
    ]
    expect(() => buildPlaybackPlan(recording, { d1: 2, d2: 4 }, rounded, 'snap')).not.toThrow()
  })

  it('throws a RangeError when frame 0 is not at prevRest', () => {
    const moved = (die: 0 | 1, p: Vec3, q: Quat = rest[die].pose.q): RestState => {
      const changed = { ...rest[die], pose: { p, q } }
      return die === 0 ? [changed, rest[1]] : [rest[0], changed]
    }
    const [x, y, z] = rest[1].pose.p
    const cases = [
      moved(1, [x + 1e-4, y, z]),
      moved(0, [rest[0].pose.p[0], rest[0].pose.p[1] + 0.01, rest[0].pose.p[2]]),
      moved(1, [x, y, z], multiply(fromAxisAngle([0, 1, 0], 1e-3), rest[1].pose.q)),
      synthesizeRest(7, [1, 3]),
    ]
    for (const prevRest of cases) {
      expect(() => buildPlaybackPlan(recording, { d1: 2, d2: 4 }, prevRest, 'snap')).toThrow(
        RangeError,
      )
    }
  })

  it('throws a RangeError for a recording made with other params, or planned with them', () => {
    const other: PhysicsParams = { ...params, snap: { ...params.snap, minTurnRate: 9 } }
    expect(() => buildPlaybackPlan(recording, { d1: 2, d2: 4 }, rest, 'snap', other)).toThrow(
      RangeError,
    )
    const made = analyticHop(2, posesOf(rest), other)
    expect(() => buildPlaybackPlan(made, { d1: 2, d2: 4 }, rest, 'snap')).toThrow(RangeError)
    expect(() => buildPlaybackPlan(made, { d1: 2, d2: 4 }, rest, 'snap', other)).not.toThrow()
  })
})

describe('clearance, for hand-placed poses', () => {
  const far: DicePoses[number] = { p: [-4, 3, 0], q: IDENTITY }
  const one = (pose: DicePoses[number]) => recordingOf([[pose, far]])
  const { halfExtent: h, borderRadius: r } = params.die

  it('is the floor gap for a die at a known height and tilt', () => {
    expect(clearance(one({ p: [1, 0.9, 0], q: IDENTITY }), 0, 0, params)).toBeCloseTo(0.4, 6)
    for (const deg of [15, 30, 45]) {
      const q = fromAxisAngle([1, 0, 0], (deg * Math.PI) / 180)
      const lowest = h * (Math.cos((deg * Math.PI) / 180) + Math.sin((deg * Math.PI) / 180)) + r
      expect(clearance(one({ p: [1, 1, 0], q }), 0, 0, params)).toBeCloseTo(1 - lowest, 6)
    }
  })

  it('is the gap between the dice for a known separation', () => {
    const pair = (gap: number) =>
      recordingOf([
        [
          { p: [0, 3, 0], q: IDENTITY },
          { p: [1 + gap, 3, 0], q: IDENTITY },
        ],
      ])
    for (const gap of [0.25, 0.05, 0, -0.03]) {
      expect(clearance(pair(gap), 0, 0, params)).toBeCloseTo(gap, 6)
      expect(clearance(pair(gap), 0, 1, params)).toBeCloseTo(gap, 6)
    }
  })

  it('measures a die near the wall against the trimesh, at or above the sagitta bound', () => {
    const { inradius, maxSagitta } = domeFaces(params.dome)
    for (const target of [0.3, 0.1, 0.02]) {
      // Slide a raised, tilted die out along +x until its exact dome gap is `target`.
      const q = normalize(
        fromAxisAngle(normalize([1, 2, 3, 0]).slice(0, 3) as unknown as Vec3, 0.7),
      )
      let inside = 3
      let outside = 7.4
      for (let k = 0; k < 60; k++) {
        const mid = (inside + outside) / 2
        if (domeGap({ p: [mid, 2, 0], q }, params) > target) inside = mid
        else outside = mid
      }
      const p: Vec3 = [inside, 2, 0]
      const value = clearance(one({ p, q }), 0, 0, params)
      expect(value).toBeCloseTo(target, 5)
      // The sphere of radius R less the deepest chord is a lower bound on the same gap.
      const bound = params.dome.radius - maxSagitta - Math.hypot(...p) - circumradius(params.die)
      expect(value).toBeGreaterThanOrEqual(bound)
      expect(inradius).toBeCloseTo(params.dome.radius - maxSagitta, 12)
    }
  })

  it('is exact below its cutoff and a lower bound of at least the cutoff above it', () => {
    const rec = one({ p: [0, 2.5, 0], q: IDENTITY })
    expect(clearance(rec, 0, 0, params, 5)).toBeCloseTo(2, 6)
    const quick = clearance(rec, 0, 0, params, 0.5)
    expect(quick >= 0.5 && quick <= 2 + 1e-9).toBe(true)
  })
})

describe('snapFrame', () => {
  /** Die 0 at `height`, turning about y by `turn(frame)` radians per frame, then landed flat. */
  function spinning(turn: (frame: number) => number, height = 3): Recording {
    let q: Quat = IDENTITY
    const frames: DicePoses[] = []
    for (let frame = 0; frame < 40; frame++) {
      if (frame < 30) q = normalize(multiply(fromAxisAngle([0, 1, 0], turn(frame)), q))
      const y = frame < 30 ? height : 0.5
      frames.push([
        { p: [0, y, 0], q },
        { p: [3, 0.5, 3], q: IDENTITY },
      ])
    }
    return recordingOf(frames, 32)
  }

  it('takes the fastest airborne frame turning at least the floor, and calls it hidden', () => {
    const snap = snapFrame(
      spinning((frame) => (frame === 12 ? 0.5 : 0.05)),
      0,
      params,
    )
    expect(snap).toEqual({ frame: 12, turnRate: expect.closeTo(30, 4), hidden: true })
  })

  it('says a slow airborne turn cannot hide the switch, and takes the fastest frame', () => {
    // At most 0.08 rad a frame, 4.8 rad/s: under the 6 rad/s floor.
    const snap = snapFrame(
      spinning((frame) => (frame === 20 ? 0.08 : 0.05)),
      0,
      params,
    )
    expect(snap).toEqual({ frame: 20, turnRate: expect.closeTo(4.8, 4), hidden: false })
  })

  it('does not count a fast turn while touching the floor as hidden', () => {
    const snap = snapFrame(
      spinning((frame) => (frame === 12 ? 0.5 : 0.05), 0.5),
      0,
      params,
    )
    expect(snap).toEqual({ frame: 12, turnRate: expect.closeTo(30, 4), hidden: false })
  })
})

describe('synthesizeRest', () => {
  it('lays both dice flat, apart and near the centre, showing the faces asked for', () => {
    const prng = createPrng(3)
    const { spread, minSeparation } = params.rest
    for (let seed = 0; seed < 300; seed++) {
      const faces = [face(prng), face(prng)] as const
      const rest = synthesizeRest(seed, faces)
      for (const die of dice) {
        const { pose, offset } = rest[die]
        expect(visualTopFace(pose.q, offset)).toBe(faces[die])
        expect(tiltDeg(pose.q)).toBeLessThan(1e-6)
        expect(pose.p[1]).toBe(0.5)
        expect(Math.hypot(pose.p[0], pose.p[2])).toBeLessThanOrEqual(spread)
      }
      const [a, b] = rest
      const apart = Math.hypot(a.pose.p[0] - b.pose.p[0], a.pose.p[2] - b.pose.p[2])
      expect(apart).toBeGreaterThanOrEqual(minSeparation)
      expect(synthesizeRest(seed, faces)).toEqual(rest)
    }
  })
})

/** Total turn of the drawn faces, in degrees. */
function cost(plan: PlaybackPlan): number {
  return plan.tracks.reduce(
    (sum, track) => sum + rotationAngleDeg(track.startOffset, track.endOffset),
    0,
  )
}
