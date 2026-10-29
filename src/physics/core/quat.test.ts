import { describe, expect, it } from 'vitest'
import {
  angleBetween,
  conjugate,
  fromAxisAngle,
  IDENTITY,
  multiply,
  normalize,
  rotate,
  slerp,
  yawFromHalfAngle,
  type Quat,
  type Vec3,
} from './quat.ts'

const near = (a: readonly number[], b: readonly number[], digits = 12) =>
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i] ?? Number.NaN, digits))

describe('quat', () => {
  const q = normalize([0.3, -0.5, 0.2, 0.8])
  const r = fromAxisAngle([0, 0, 1], Math.PI / 3)

  it('rotates vectors like the rotation it encodes', () => {
    near(rotate(fromAxisAngle([0, 0, 1], Math.PI / 2), [1, 0, 0]), [0, 1, 0])
    near(rotate(fromAxisAngle([1, 0, 0], Math.PI / 2), [0, 1, 0]), [0, 0, 1])
  })

  it('composes right to left and inverts with the conjugate', () => {
    const v: Vec3 = [0.4, -1.2, 2]
    near(rotate(multiply(q, r), v), rotate(q, rotate(r, v)))
    near(multiply(q, conjugate(q)), IDENTITY)
  })

  it('measures rotation angles, including tiny ones and either sign of quaternion', () => {
    expect(angleBetween(IDENTITY, r)).toBeCloseTo(Math.PI / 3, 12)
    const negated: Quat = [-r[0], -r[1], -r[2], -r[3]]
    expect(angleBetween(r, negated)).toBeCloseTo(0, 12)
    expect(angleBetween(IDENTITY, fromAxisAngle([0, 1, 0], 1e-7))).toBeCloseTo(1e-7, 18)
  })

  it('slerps along the shorter arc between its ends', () => {
    near(slerp(q, r, 0), q)
    near(slerp(q, r, 1), r)
    const half = slerp(IDENTITY, fromAxisAngle([0, 1, 0], 2), 0.5)
    expect(angleBetween(IDENTITY, half)).toBeCloseTo(1, 12)
    const far: Quat = [-r[0], -r[1], -r[2], -r[3]]
    expect(angleBetween(IDENTITY, slerp(IDENTITY, far, 0.5))).toBeCloseTo(Math.PI / 6, 12)
  })

  it('builds yaw from a half-angle direction', () => {
    const yaw = yawFromHalfAngle(Math.cos(0.4), Math.sin(0.4))
    near(yaw, fromAxisAngle([0, 1, 0], 0.8))
  })
})
