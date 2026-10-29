import { describe, expect, it } from 'vitest'
import {
  AXES,
  AXIS_FACE,
  CUBE_ROTATIONS,
  DIE_FACES,
  FACE_AXIS,
  FACE_NORMALS,
  IDENTITY_OFFSET,
  nearestAxis,
  rotationAngleDeg,
  rotationAt,
} from './cube.ts'
import { angleBetween, cross, multiply, rotate, type Vec3 } from './quat.ts'

/** Rounds away float noise and turns -0 into 0, so vectors compare exactly. */
const clean = (v: Vec3) => v.map((x) => Math.round(x * 1e9) / 1e9 + 0)
const scaled = (v: Vec3, k: number): Vec3 => [k * v[0], k * v[1], k * v[2]]

describe('FACE_NORMALS', () => {
  it('is the table from the plan', () => {
    expect(FACE_NORMALS).toEqual({
      1: [0, 1, 0],
      6: [0, -1, 0],
      2: [0, 0, 1],
      5: [0, 0, -1],
      3: [1, 0, 0],
      4: [-1, 0, 0],
    })
  })

  it('is a right-handed die whose opposite faces sum to 7', () => {
    expect(clean(cross(FACE_NORMALS[1], FACE_NORMALS[2]))).toEqual(FACE_NORMALS[3])
    for (const face of DIE_FACES) {
      const opposite = DIE_FACES.find((other) => other + face === 7) ?? face
      expect(clean(FACE_NORMALS[opposite])).toEqual(clean(scaled(FACE_NORMALS[face], -1)))
    }
  })

  it('agrees with FACE_AXIS and AXIS_FACE', () => {
    for (const face of DIE_FACES) {
      expect(AXES[FACE_AXIS[face]]).toEqual(FACE_NORMALS[face])
      expect(AXIS_FACE[FACE_AXIS[face]]).toBe(face)
    }
  })
})

describe('CUBE_ROTATIONS', () => {
  it('holds 24 distinct proper rotations, identity first', () => {
    expect(CUBE_ROTATIONS).toHaveLength(24)
    expect(rotationAt(IDENTITY_OFFSET).matrix).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
    expect(new Set(CUBE_ROTATIONS.map((r) => r.matrix.join(','))).size).toBe(24)
  })

  it('has unit quaternions that move each axis as the matrix and axisMap say', () => {
    for (const { matrix, quat, axisMap } of CUBE_ROTATIONS) {
      expect(Math.hypot(...quat)).toBeCloseTo(1, 12)
      AXES.forEach((axis, a) => {
        const column: Vec3 = [
          matrix[a >> 1] ?? 0,
          matrix[3 + (a >> 1)] ?? 0,
          matrix[6 + (a >> 1)] ?? 0,
        ]
        const sign = a % 2 === 0 ? 1 : -1
        expect(clean(rotate(quat, axis))).toEqual(clean(scaled(column, sign)))
        expect(axisMap[a]).toBe(nearestAxis(rotate(quat, axis)))
      })
    }
  })

  it('is closed under composition', () => {
    const keys = new Set(CUBE_ROTATIONS.map((r) => clean(rotate(r.quat, [1, 2, 3])).join(',')))
    for (const a of CUBE_ROTATIONS) {
      for (const b of CUBE_ROTATIONS) {
        expect(keys.has(clean(rotate(multiply(a.quat, b.quat), [1, 2, 3])).join(','))).toBe(true)
      }
    }
  })
})

describe('rotationAngleDeg', () => {
  it('matches the quaternion angle for all 576 pairs', () => {
    const seen = new Set<number>()
    CUBE_ROTATIONS.forEach((a, i) => {
      CUBE_ROTATIONS.forEach((b, j) => {
        const angle = rotationAngleDeg(i, j)
        seen.add(angle)
        expect(angle).toBeCloseTo((angleBetween(a.quat, b.quat) * 180) / Math.PI, 9)
        expect(rotationAngleDeg(j, i)).toBe(angle)
      })
    })
    expect([...seen].sort((x, y) => x - y)).toEqual([0, 90, 120, 180])
  })

  it('rejects indices outside the table', () => {
    expect(() => rotationAngleDeg(0, 24)).toThrow(RangeError)
  })
})
