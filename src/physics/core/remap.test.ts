import { describe, expect, it } from 'vitest'
import { CUBE_ROTATIONS, DIE_FACES, FACE_NORMALS, rotationAngleDeg, rotationAt } from './cube.ts'
import { fromAxisAngle, multiply, normalize, rotate } from './quat.ts'
import { chooseEndOffset, remapCandidates } from './remap.ts'
import { upAxis, visualTopFace } from './restPose.ts'

// A die resting with each of the 24 cube orientations, turned by an arbitrary yaw and a small
// tilt, as real rest poses are.
const restingBodies = CUBE_ROTATIONS.map((rotation, index) =>
  normalize(
    multiply(
      multiply(fromAxisAngle([0, 1, 0], 0.37 * index), fromAxisAngle([1, 0, 0], 0.03)),
      rotation.quat,
    ),
  ),
)

describe('remap, exhaustive over 24 orientations × 6 targets × 24 start offsets', () => {
  it('always has exactly 4 candidates, and each one draws the target on top', () => {
    for (const body of restingBodies) {
      const aUp = upAxis(body)
      for (const target of DIE_FACES) {
        const candidates = remapCandidates(aUp, target)
        expect(candidates).toHaveLength(4)
        for (const offset of candidates) {
          expect(visualTopFace(body, offset)).toBe(target)
          // The rendered check: the target's pip normal, drawn at q_body · R[o], points up.
          const normal = rotate(multiply(body, rotationAt(offset).quat), FACE_NORMALS[target])
          expect(normal[1]).toBeGreaterThan(Math.cos((4 * Math.PI) / 180))
        }
      }
    }
  })

  it('chooses the candidate nearest the start offset, keeping it when it already fits', () => {
    for (const body of restingBodies) {
      const aUp = upAxis(body)
      for (const target of DIE_FACES) {
        const candidates = remapCandidates(aUp, target)
        CUBE_ROTATIONS.forEach((_, start) => {
          const end = chooseEndOffset(aUp, target, start)
          expect(candidates).toContain(end)
          expect(visualTopFace(body, end)).toBe(target)
          const nearest = Math.min(...candidates.map((c) => rotationAngleDeg(start, c)))
          expect(rotationAngleDeg(start, end)).toBe(nearest)
          if (visualTopFace(body, start) === target) expect(end).toBe(start)
        })
      }
    }
  })

  it('turns 0° for the face on top, 90° for a side face and 180° for the face underneath', () => {
    const body = restingBodies[5] ?? CUBE_ROTATIONS[0]?.quat ?? [0, 0, 0, 1]
    const aUp = upAxis(body)
    const costs = DIE_FACES.map((target) =>
      rotationAngleDeg(0, chooseEndOffset(aUp, target, 0)),
    ).sort((a, b) => a - b)
    expect(costs).toEqual([0, 90, 90, 90, 90, 180])
  })
})
