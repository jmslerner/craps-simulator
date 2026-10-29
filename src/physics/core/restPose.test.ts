import { describe, expect, it } from 'vitest'
import { CUBE_ROTATIONS, DIE_FACES, FACE_NORMALS, rotationAt } from './cube.ts'
import { fromAxisAngle, multiply, rotate, yawFromHalfAngle } from './quat.ts'
import {
  flatOrientation,
  naturalTopFace,
  rotationShowing,
  tiltDeg,
  upAxis,
  visualTopFace,
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
