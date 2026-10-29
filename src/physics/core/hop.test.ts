import { beforeAll, describe, expect, it } from 'vitest'
import { diceGap, domeGap, floorGap } from './gap.ts'
import { analyticHop } from './hop.ts'
import { DEFAULT_PARAMS } from './params.ts'
import { snapFrame, synthesizeRest } from './plan.ts'
import { createPrng, deriveSeed, inDisc, onCircle, onSphere, type Prng } from './prng.ts'
import { angleBetween, fromAxisAngle, multiply, normalize, yawFromHalfAngle } from './quat.ts'
import type { Vec3 } from './quat.ts'
import { framePose, hashRecording, touchesAt, TOUCH_DIE, type Recording } from './recording.ts'
import { flatOrientation, posesOf, tiltDeg, type DicePoses, type Pose } from './restPose.ts'
import { simulateThrow } from './simulate.ts'
import { checkRecording } from './validity.ts'
import { initPhysics } from './world.ts'

const params = DEFAULT_PARAMS
const { die } = params

/** Moves `pose` along `direction` from `from` until `gap(pose)` is 0, by bisection. */
function slideUntilTouching(pose: Pose, from: Vec3, direction: Vec3, gap: (p: Pose) => number) {
  let near = 0
  let far = 8
  for (let k = 0; k < 60; k++) {
    const mid = (near + far) / 2
    const p: Vec3 = [
      from[0] + direction[0] * mid,
      from[1] + direction[1] * mid,
      from[2] + direction[2] * mid,
    ]
    if (gap({ ...pose, p }) < 0) near = mid
    else far = mid
  }
  const p: Vec3 = [
    from[0] + direction[0] * far,
    from[1] + direction[1] * far,
    from[2] + direction[2] * far,
  ]
  return { ...pose, p }
}

const flat = (prng: Prng, p: Vec3): Pose => {
  const [c, s] = onCircle(prng)
  return { p, q: flatOrientation(Math.floor(prng.next() * 24), yawFromHalfAngle(c, s)) }
}

/**
 * Starts that the hop must survive, all with gaps of at least 0: dice touching each other in any
 * direction and yaw, a die touching the wall, stacked dice, a cocked die balanced on an edge.
 */
function adversarialStarts(): DicePoses[] {
  const prng = createPrng(17)
  const list: DicePoses[] = []
  for (let k = 0; k < 40; k++) list.push(posesOf(synthesizeRest(deriveSeed(17, k), [1, 6])))
  for (let k = 0; k < 60; k++) {
    // Within 4.5 u of the centre, so the partner slid against it is still inside the dome.
    const [x, z] = inDisc(prng)
    const a = flat(prng, [4.5 * x, 0.5, 4.5 * z])
    const [c, s] = onCircle(prng)
    const b = slideUntilTouching(flat(prng, a.p), a.p, [c, 0, s], (pose) => diceGap(a, pose, die))
    list.push(k % 2 === 0 ? [a, b] : [b, a])
  }
  for (let k = 0; k < 40; k++) {
    const [c, s] = onCircle(prng)
    const wall = slideUntilTouching(flat(prng, [0, 0.5, 0]), [0, 0.5, 0], [c, 0, s], (pose) =>
      domeGap(pose, params),
    )
    // Its partner is either across the floor or touching it on the inside.
    const inward: Vec3 = [-c, 0, -s]
    const partner =
      k % 2 === 0
        ? flat(prng, [-2 * c, 0.5, -2 * s])
        : slideUntilTouching(flat(prng, wall.p), wall.p, inward, (pose) => diceGap(wall, pose, die))
    list.push([wall, partner])
  }
  for (let k = 0; k < 20; k++) {
    const a = flat(prng, [prng.range(-3, 3), 0.5, prng.range(-3, 3)])
    const stacked = flat(prng, [a.p[0], 1.5, a.p[2]])
    const tilted = normalize(multiply(fromAxisAngle(onSphere(prng), 0.6), a.q))
    const cocked = { q: tilted, p: [a.p[0], 0.5, a.p[2]] as Vec3 }
    const raised = { ...cocked, p: [a.p[0], 0.5 - floorGap(cocked, die), a.p[2]] as Vec3 }
    const other = flat(prng, [-a.p[0], 0.5, -a.p[2] + (Math.abs(a.p[2]) < 1 ? 3 : 0)])
    list.push([stacked, a], [a, stacked], [raised, other])
  }
  return list
}

interface Case {
  readonly start: DicePoses
  readonly rec: Recording
}

const real: Case[] = []
const synthetic: Case[] = adversarialStarts().map((start, k) => ({
  start,
  rec: analyticHop(deriveSeed(9, k), start),
}))

beforeAll(async () => {
  // Rest poses the physics really leaves, chained as the app chains throws.
  await initPhysics()
  let start = posesOf(synthesizeRest(5, [2, 2]))
  for (let k = 0; k < 300; k++) {
    start = simulateThrow(deriveSeed(31, k), start).recording.finalPoses
    real.push({ start, rec: analyticHop(deriveSeed(10, k), start) })
  }
}, 60_000)

/** The gaps at every frame, against the gaps the dice started with. */
function worstGaps({ start, rec }: Case) {
  const begin = {
    floor: Math.min(...start.map((pose) => floorGap(pose, die))),
    dome: Math.min(...start.map((pose) => domeGap(pose, params))),
    dice: diceGap(start[0], start[1], die),
  }
  const worst = { floor: Infinity, dome: Infinity, dice: Infinity }
  for (let frame = 0; frame < rec.frameCount; frame++) {
    const poses = [framePose(rec, frame, 0), framePose(rec, frame, 1)] as const
    worst.dice = Math.min(worst.dice, diceGap(poses[0], poses[1], die))
    for (const pose of poses) {
      worst.floor = Math.min(worst.floor, floorGap(pose, die))
      worst.dome = Math.min(worst.dome, domeGap(pose, params))
    }
  }
  return { begin, worst }
}

describe('analyticHop', () => {
  const all = () => [...real, ...synthetic]

  it('is valid by construction, from real rests and from awkward starts', () => {
    expect(real).toHaveLength(300)
    for (const { rec } of all()) {
      expect(checkRecording(rec)).toEqual({ valid: true, reasons: [] })
      expect(rec.source).toBe('hop')
      for (const pose of rec.finalPoses) expect(tiltDeg(pose.q)).toBeLessThan(1e-4)
    }
  })

  it('never brings a die nearer the floor, the dome or the other die than it started', () => {
    for (const hop of all()) {
      const { begin, worst } = worstGaps(hop)
      // Float32 frames round the start poses by up to an ulp.
      for (const surface of ['floor', 'dome', 'dice'] as const) {
        expect(worst[surface]).toBeGreaterThanOrEqual(Math.min(begin[surface], 0) - 1e-6)
      }
    }
  })

  it('never lets the dice touch at any physics step unless they started touching', () => {
    for (const { start, rec } of all()) {
      const touchedAtStart = diceGap(start[0], start[1], die) <= params.contact.touchGap
      for (let step = 0; step < rec.contacts.length; step++) {
        const both = touchesAt(rec, step, 0) & touchesAt(rec, step, 1) & TOUCH_DIE
        if (both !== 0) expect(touchedAtStart && step < rec.contacts.length / 4).toBe(true)
      }
    }
  })

  it('flies free between take-off and landing', () => {
    for (const { rec } of all()) {
      const landing = rec.settleFrame * rec.stepsPerFrame
      // Touching nothing from a fifth of the flight to four fifths of it.
      for (let step = Math.ceil(landing / 5); step < (4 * landing) / 5; step++) {
        expect([touchesAt(rec, step, 0), touchesAt(rec, step, 1)]).toEqual([0, 0])
      }
      expect(touchesAt(rec, rec.contacts.length - 1, 0)).not.toBe(0)
    }
  })

  it('lands the dice apart along their start separation, in the same order', () => {
    for (const { start, rec } of real) {
      const [a, b] = rec.finalPoses
      const landed: Vec3 = [b.p[0] - a.p[0], 0, b.p[2] - a.p[2]]
      const began: Vec3 = [start[1].p[0] - start[0].p[0], 0, start[1].p[2] - start[0].p[2]]
      expect(Math.hypot(...landed)).toBeCloseTo(2 * params.hop.landing, 5)
      const cos =
        (landed[0] * began[0] + landed[2] * began[2]) /
        (Math.hypot(...landed) * Math.hypot(...began))
      expect(cos).toBeCloseTo(1, 5)
    }
  })

  it('begins exactly where the dice were', () => {
    for (const { start, rec } of all()) {
      for (const d of [0, 1] as const) {
        const pose = framePose(rec, 0, d)
        expect(pose.p).toEqual(start[d].p.map((x) => Math.fround(x)))
        expect(angleBetween(pose.q, normalize(start[d].q))).toBeLessThan(1e-6)
      }
    }
  })

  it('gives the face snap a hidden switch: airborne and turning fast', () => {
    for (const { rec } of all()) {
      for (const d of [0, 1] as const) {
        const snap = snapFrame(rec, d, params)
        expect(snap.hidden).toBe(true)
        expect(snap.turnRate).toBeGreaterThan(12)
      }
    }
  })

  it('repeats for a seed', () => {
    const [first] = synthetic
    if (!first) throw new Error('no cases')
    const again = analyticHop(deriveSeed(9, 0), first.start)
    expect(hashRecording(again)).toBe(hashRecording(first.rec))
  })
})
