import { beforeAll, describe, expect, it } from 'vitest'
import { diceGap, domeGap, floorGap } from './gap.ts'
import { analyticHop } from './hop.ts'
import { DEFAULT_PARAMS } from './params.ts'
import { snapFrame, synthesizeRest } from './plan.ts'
import { createPrng, deriveSeed, inDisc, onCircle, onSphere, type Prng } from './prng.ts'
import { angleBetween, fromAxisAngle, multiply, normalize, yawFromHalfAngle } from './quat.ts'
import type { Vec3 } from './quat.ts'
import { framePose, hashRecording, touchesAt, TOUCH_DIE, type Recording } from './recording.ts'
import { flatOrientation, posesOf, restOf, tiltDeg, type DicePoses, type Pose } from './restPose.ts'
import { simulateThrow } from './simulate.ts'
import { checkRecording, checkStart } from './validity.ts'
import { initPhysics } from './world.ts'

const params = DEFAULT_PARAMS
const { die } = params

/**
 * Moves `pose` from `from` along `direction` to where `gap` changes sign, by bisection, and
 * returns it on the clear side, touching. Either way round: a die slid out of its partner starts
 * overlapping and comes clear (the dice gap grows with distance), while a die slid out to the
 * wall starts clear and runs into it (the dome gap shrinks).
 */
function slideUntilTouching(pose: Pose, from: Vec3, direction: Vec3, gap: (p: Pose) => number) {
  const at = (t: number): Pose => ({
    ...pose,
    p: [from[0] + direction[0] * t, from[1] + direction[1] * t, from[2] + direction[2] * t],
  })
  const startsClear = gap(at(0)) >= 0
  let clear = startsClear ? 0 : 8
  let blocked = startsClear ? 8 : 0
  if (!(gap(at(clear)) >= 0 && gap(at(blocked)) < 0)) throw new Error('no contact within 8 u')
  for (let k = 0; k < 60; k++) {
    const mid = (clear + blocked) / 2
    if (gap(at(mid)) >= 0) clear = mid
    else blocked = mid
  }
  return at(clear)
}

const flat = (prng: Prng, p: Vec3): Pose => {
  const [c, s] = onCircle(prng)
  return { p, q: flatOrientation(Math.floor(prng.next() * 24), yawFromHalfAngle(c, s)) }
}

/** A die leaning 10° to 45° about a random level axis, with its lowest point on the floor. */
const leaning = (prng: Prng): Pose => {
  const [c, s] = onCircle(prng)
  const q = normalize(
    multiply(fromAxisAngle([c, 0, s], prng.range(0.17, 0.79)), flat(prng, [0, 0, 0]).q),
  )
  return { q, p: [0, 1 - floorGap({ q, p: [0, 1, 0] }, die), 0] }
}

const toWall = (pose: Pose, [c, s]: readonly [number, number]) =>
  slideUntilTouching(pose, pose.p, [c, 0, s], (moved) => domeGap(moved, params))

type Partner = 'across' | 'inside' | 'beside'

/** A die against the wall, flat or cocked, and its partner (`mate`), in either body order. */
interface WallStart {
  readonly start: DicePoses
  readonly wall: Pose
  readonly mate: Pose
  readonly cocked: boolean
  readonly partner: Partner
}

/**
 * Dice against the dome wall, both ways up, with a partner across the floor, touching the wall die
 * from the inside, or against the wall beside it and touching it: its bearing is bisected until
 * the gap between the two closes.
 */
function wallStarts(): WallStart[] {
  const prng = createPrng(23)
  const list: WallStart[] = []
  for (let k = 0; k < 48; k++) {
    const isCocked = k % 2 === 1
    const partner = (['across', 'inside', 'beside'] as const)[Math.floor(k / 2) % 3] ?? 'across'
    const [c, s] = onCircle(prng)
    const wall = toWall(isCocked ? leaning(prng) : flat(prng, [0, 0.5, 0]), [c, s])
    const other = flat(prng, [0, 0.5, 0])
    const touchingWall = (pose: Pose) => diceGap(wall, pose, die)
    let mate: Pose
    if (partner === 'across') {
      mate = { ...other, p: [-2 * c, 0.5, -2 * s] }
    } else if (partner === 'inside') {
      mate = slideUntilTouching(other, [wall.p[0], 0.5, wall.p[2]], [-c, 0, -s], touchingWall)
    } else {
      const along = (turn: number) =>
        toWall(other, [
          c * Math.cos(turn) - s * Math.sin(turn),
          s * Math.cos(turn) + c * Math.sin(turn),
        ])
      let apart = Math.PI / 2
      let overlapping = 0
      for (let step = 0; step < 50; step++) {
        const mid = (apart + overlapping) / 2
        if (touchingWall(along(mid)) >= 0) apart = mid
        else overlapping = mid
      }
      mate = along(apart)
    }
    const start: DicePoses = k % 4 < 2 ? [wall, mate] : [mate, wall]
    list.push({ start, wall, mate, cocked: isCocked, partner })
  }
  return list
}

const walls = wallStarts()

/**
 * Starts that the hop must survive, all with gaps of at least 0: dice touching each other in any
 * direction and yaw, dice against the wall (see wallStarts), stacked dice, a cocked die balanced
 * on an edge.
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
  list.push(...walls.map((wall) => wall.start))
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
  rec: analyticHop(deriveSeed(9, k), restOf(start)),
}))

beforeAll(async () => {
  // Rest poses the physics really leaves, chained as the app chains throws.
  await initPhysics()
  let start = posesOf(synthesizeRest(5, [2, 2]))
  for (let k = 0; k < 300; k++) {
    start = simulateThrow(deriveSeed(31, k), restOf(start)).recording.finalPoses
    real.push({ start, rec: analyticHop(deriveSeed(10, k), restOf(start)) })
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

describe('the awkward starts', () => {
  it('put each wall die against the wall, and each touching partner against it', () => {
    expect(walls.map(({ cocked, partner }) => `${cocked}:${partner}`).sort()).toEqual(
      ['across', 'beside', 'inside']
        .flatMap((partner) => [
          ...Array.from({ length: 8 }, () => `false:${partner}`),
          ...Array.from({ length: 8 }, () => `true:${partner}`),
        ])
        .sort(),
    )
    for (const { wall, mate, cocked, partner } of walls) {
      expect(Math.abs(domeGap(wall, params))).toBeLessThan(1e-6)
      expect(Math.hypot(wall.p[0], wall.p[2])).toBeGreaterThan(6.5)
      expect(Math.abs(floorGap(wall, die))).toBeLessThan(1e-9)
      expect(tiltDeg(wall.q) > 5).toBe(cocked)
      const between = diceGap(wall, mate, die)
      expect(between).toBeGreaterThanOrEqual(-1e-12)
      if (partner === 'across') expect(between).toBeGreaterThan(1)
      else expect(between).toBeLessThan(1e-6)
      if (partner === 'beside') expect(Math.abs(domeGap(mate, params))).toBeLessThan(1e-6)
      else expect(domeGap(mate, params)).toBeGreaterThan(0.1)
    }
  })

  it('never overlap anything to begin with, beyond rounding', () => {
    for (const { start } of synthetic) {
      expect(diceGap(start[0], start[1], die)).toBeGreaterThanOrEqual(-1e-12)
      for (const pose of start) {
        expect(floorGap(pose, die)).toBeGreaterThanOrEqual(-1e-12)
        expect(domeGap(pose, params)).toBeGreaterThanOrEqual(-1e-12)
      }
    }
  })
})

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

  it('adds no overlap with the floor, the dome or the other die, at any step', () => {
    for (const hop of all()) {
      const { begin, worst } = worstGaps(hop)
      // A gap may shrink, but below zero only as far as it began, as for a die resting a hair deep
      // in the floor. Float32 frames round the start poses by up to an ulp; the steps are exact.
      for (const surface of ['floor', 'dome', 'dice'] as const) {
        expect(worst[surface]).toBeGreaterThanOrEqual(Math.min(begin[surface], 0) - 1e-6)
        expect(hop.rec.stepDepths[surface]).toBeLessThanOrEqual(Math.max(-begin[surface], 0) + 1e-9)
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

  it('lands the dice 2 u apart along their start bearing, in order', () => {
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
    const again = analyticHop(deriveSeed(9, 0), restOf(first.start))
    expect(hashRecording(again)).toBe(hashRecording(first.rec))
  })
})

describe('analyticHop from starts that overlap', () => {
  const limit = params.validity.maxOverlap
  /**
   * Seeded starts on both sides of the limit: a die slid into its partner, sunk into the floor or
   * pushed into the wall by up to twice `maxOverlap`, or with its centre beyond the wall.
   */
  const starts = (() => {
    const prng = createPrng(29)
    return Array.from({ length: 160 }, (_, k): DicePoses => {
      const deep = prng.range(0, 2 * limit)
      const [c, s] = onCircle(prng)
      const r = prng.range(0, 3)
      const a = flat(prng, [r * c, 0.5, r * s])
      // Across the floor from `a`, at least 4 u from it.
      const far = flat(prng, [-4 * c, 0.5, -4 * s])
      if (k % 4 === 0) {
        const [bc, bs] = onCircle(prng)
        const b = slideUntilTouching(flat(prng, a.p), a.p, [bc, 0, bs], (pose) =>
          diceGap(a, pose, die),
        )
        return [a, { ...b, p: [b.p[0] - bc * deep, 0.5, b.p[2] - bs * deep] }]
      }
      if (k % 4 === 1) return [{ ...a, p: [a.p[0], 0.5 - deep, a.p[2]] }, far]
      if (k % 4 === 2) {
        const wall = toWall(a, [c, s])
        return [far, { ...wall, p: [wall.p[0] + c * deep, 0.5, wall.p[2] + s * deep] }]
      }
      return [a, { ...far, p: [-(7.5 + deep) * c, 0.5, -(7.5 + deep) * s] }]
    })
  })()

  it('is valid exactly when checkStart accepts the start, so simulateThrow can rely on it', () => {
    const accepted = starts.map((start, k) => {
      const rest = restOf(start)
      const valid = checkStart(rest).valid
      expect(checkRecording(analyticHop(deriveSeed(41, k), rest)).valid, `start ${k}`).toBe(valid)
      return valid
    })
    // Both sides of the limit are tried, for each way of overlapping.
    for (const kind of [0, 1, 2]) {
      const verdicts = accepted.filter((_, k) => k % 4 === kind)
      expect(verdicts.filter(Boolean).length, `kind ${kind}`).toBeGreaterThan(10)
      expect(verdicts.filter((valid) => !valid).length, `kind ${kind}`).toBeGreaterThan(10)
    }
    expect(accepted.filter((_, k) => k % 4 === 3)).not.toContain(true)
  })
})
