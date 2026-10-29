import { describe, expect, it } from 'vitest'
import { CUBE_ROTATIONS, DIE_FACES, FACE_NORMALS, IDENTITY_OFFSET, rotationAt } from './cube.ts'
import { synthesizeRest } from './plan.ts'
import { fromAxisAngle, multiply, rotate, yawFromHalfAngle, type Quat, type Vec3 } from './quat.ts'
import {
  flatOrientation,
  hashRest,
  naturalTopFace,
  posesOf,
  restOf,
  rotationShowing,
  tiltDeg,
  upAxis,
  visualTopFace,
  type RestState,
} from './restPose.ts'

describe('rest-pose questions', () => {
  it('read the up axis and the tilt of a leaning die', () => {
    for (const deg of [0, 0.5, 3.99, 10, 44]) {
      const q = fromAxisAngle([0, 0, 1], (deg * Math.PI) / 180)
      expect(upAxis(q)).toBe(2)
      expect(tiltDeg(q)).toBeCloseTo(deg, 9)
    }
    // Past 45° another axis is nearer to up, and the lean is measured from that one.
    expect(upAxis(fromAxisAngle([0, 0, 1], (60 * Math.PI) / 180))).toBe(0)
    expect(tiltDeg(fromAxisAngle([0, 0, 1], (60 * Math.PI) / 180))).toBeCloseTo(30, 9)
  })

  it('name the drawn top face for any body orientation and offset', () => {
    CUBE_ROTATIONS.forEach((body, b) => {
      expect(naturalTopFace(body.quat)).toBe(visualTopFace(body.quat, 0))
      CUBE_ROTATIONS.forEach((offset, o) => {
        const drawn = multiply(body.quat, offset.quat)
        const top = DIE_FACES.find((face) => rotate(drawn, FACE_NORMALS[face])[1] > 0.99)
        expect(visualTopFace(body.quat, o)).toBe(top)
      })
      expect(rotationAt(b)).toBe(body)
    })
  })

  it('lay a die flat with a chosen face up at any yaw', () => {
    for (const face of DIE_FACES) {
      const q = flatOrientation(
        rotationShowing(face),
        yawFromHalfAngle(Math.cos(1.1), Math.sin(1.1)),
      )
      expect(naturalTopFace(q)).toBe(face)
      expect(tiltDeg(q)).toBeLessThan(1e-6)
    }
  })
})

describe('rest states', () => {
  const rest = synthesizeRest(12, [6, 2])
  const withDie = (die: 0 | 1, change: (r: RestState[number]) => RestState[number]): RestState =>
    die === 0 ? [change(rest[0]), rest[1]] : [rest[0], change(rest[1])]

  it('pair poses with offsets, by default each body showing its own faces', () => {
    const poses = posesOf(rest)
    expect(restOf(poses)).toEqual([
      { pose: poses[0], offset: IDENTITY_OFFSET },
      { pose: poses[1], offset: IDENTITY_OFFSET },
    ])
    expect(posesOf(restOf(poses, [3, 17]))).toEqual(poses)
    expect(restOf(poses, [3, 17]).map((die) => die.offset)).toEqual([3, 17])
  })

  it('hash alike when Float32 cannot tell them apart, or JSON carries them', () => {
    const hash = hashRest(rest)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(hashRest(JSON.parse(JSON.stringify(rest)) as RestState)).toBe(hash)
    const rounded = withDie(1, (die) => ({
      ...die,
      pose: { p: die.pose.p.map(Math.fround) as unknown as Vec3, q: die.pose.q },
    }))
    expect(hashRest(rounded)).toBe(hash)
    // The same rotation, written as the negated quaternion.
    const negated = withDie(0, (die) => ({
      ...die,
      pose: { ...die.pose, q: die.pose.q.map((x) => -x) as unknown as Quat },
    }))
    expect(hashRest(negated)).toBe(hash)
    const zero = (z: number): RestState =>
      restOf([
        { p: [1, 0.5, z], q: [0, 0, 0, 1] },
        { p: [-1, 0.5, 0], q: [0, z, 0, 1] },
      ])
    expect(hashRest(zero(-0))).toBe(hashRest(zero(0)))
  })

  it('hash differently for another offset, position or rotation', () => {
    const hashes = [
      rest,
      withDie(0, (die) => ({ ...die, offset: (die.offset + 1) % 24 })),
      withDie(1, (die) => ({ ...die, offset: (die.offset + 5) % 24 })),
      withDie(1, (die) => ({
        ...die,
        pose: { ...die.pose, p: [die.pose.p[0] + 1e-4, 0.5, die.pose.p[2]] },
      })),
      withDie(0, (die) => ({
        ...die,
        pose: { ...die.pose, q: multiply(fromAxisAngle([0, 1, 0], 1e-3), die.pose.q) },
      })),
      [rest[1], rest[0]] as const,
    ].map(hashRest)
    expect(new Set(hashes).size).toBe(hashes.length)
  })
})
