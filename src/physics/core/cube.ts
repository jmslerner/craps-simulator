/**
 * Die faces and the 24 proper rotations of a cube. A die's visual orientation is
 * q_vis = q_body · R[o], where o indexes CUBE_ROTATIONS (§7 Face remap), so the face a die shows
 * can change without touching the physics body.
 */
import type { Quat, Vec3 } from './quat.ts'

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6

export const DIE_FACES: readonly DieFace[] = [1, 2, 3, 4, 5, 6]

/** A body-local axis: 0 +X, 1 −X, 2 +Y, 3 −Y, 4 +Z, 5 −Z. */
export type AxisIndex = 0 | 1 | 2 | 3 | 4 | 5

export const AXES: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

export const AXIS_UP: AxisIndex = 2

/**
 * Outward pip-face normals in the die mesh's own frame. The die is right-handed (n1 × n2 = n3)
 * and opposite faces sum to 7. The dome's pip textures must use this same table.
 */
export const FACE_NORMALS: Readonly<Record<DieFace, Vec3>> = {
  1: [0, 1, 0],
  6: [0, -1, 0],
  2: [0, 0, 1],
  5: [0, 0, -1],
  3: [1, 0, 0],
  4: [-1, 0, 0],
}

/** FACE_NORMALS as axis indices. */
export const FACE_AXIS: Readonly<Record<DieFace, AxisIndex>> = {
  1: 2,
  6: 3,
  2: 4,
  5: 5,
  3: 0,
  4: 1,
}

/** The face whose normal is each axis, indexed by AxisIndex: the inverse of FACE_AXIS. */
export const AXIS_FACE: readonly DieFace[] = [3, 4, 1, 6, 2, 5]

export interface CubeRotation {
  /** Row-major 3×3 signed permutation matrix with determinant +1. */
  readonly matrix: readonly number[]
  readonly quat: Quat
  /** `axisMap[a]` is the axis this rotation takes axis `a` to. */
  readonly axisMap: readonly AxisIndex[]
}

/** The 24 proper cube rotations, in a fixed order; index 0 is the identity. */
export const CUBE_ROTATIONS: readonly CubeRotation[] = buildRotations()

export const IDENTITY_OFFSET = 0

/** The axis index of a vector that is (up to rounding) one of the six axes. */
export function nearestAxis(v: Vec3): AxisIndex {
  let best: AxisIndex = 0
  let bestDot = -Infinity
  AXES.forEach((axis, index) => {
    const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2]
    if (d > bestDot) {
      bestDot = d
      best = index as AxisIndex
    }
  })
  return best
}

/**
 * The angle between two cube rotations in whole degrees: 0, 90, 120 or 180. It is read from
 * trace(Aᵀ·B), which is an exact integer here, so ties between candidates compare exactly.
 */
export function rotationAngleDeg(a: number, b: number): number {
  const ma = rotationAt(a).matrix
  const mb = rotationAt(b).matrix
  let trace = 0
  for (let i = 0; i < 9; i++) trace += (ma[i] ?? 0) * (mb[i] ?? 0)
  const angle = TRACE_ANGLE.get(trace)
  if (angle === undefined) throw new RangeError(`not a pair of cube rotations: ${a}, ${b}`)
  return angle
}

const TRACE_ANGLE = new Map([
  [3, 0],
  [1, 90],
  [0, 120],
  [-1, 180],
])

export function rotationAt(index: number): CubeRotation {
  const rotation = CUBE_ROTATIONS[index]
  if (rotation === undefined) throw new RangeError(`cube rotation index out of range: ${index}`)
  return rotation
}

function buildRotations(): CubeRotation[] {
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]
  const rotations: CubeRotation[] = []
  for (const perm of permutations) {
    for (let bits = 0; bits < 8; bits++) {
      const signs = [bits & 4 ? -1 : 1, bits & 2 ? -1 : 1, bits & 1 ? -1 : 1]
      const matrix = Array.from({ length: 9 }, () => 0)
      perm.forEach((column, row) => {
        matrix[row * 3 + column] = signs[row] ?? 1
      })
      if (determinant(matrix) !== 1) continue
      const axisMap = AXES.map((axis) => nearestAxis(apply(matrix, axis)))
      rotations.push({ matrix, quat: matrixToQuat(matrix), axisMap })
    }
  }
  return rotations
}

function apply(m: readonly number[], v: Vec3): Vec3 {
  const at = (i: number) => m[i] ?? 0
  return [
    at(0) * v[0] + at(1) * v[1] + at(2) * v[2],
    at(3) * v[0] + at(4) * v[1] + at(5) * v[2],
    at(6) * v[0] + at(7) * v[1] + at(8) * v[2],
  ]
}

function determinant(m: readonly number[]): number {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0] = m
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}

/** Shepperd's method, which stays exact for the 0°, 90°, 120° and 180° rotations here. */
function matrixToQuat(m: readonly number[]): Quat {
  const [m00 = 0, m01 = 0, m02 = 0, m10 = 0, m11 = 0, m12 = 0, m20 = 0, m21 = 0, m22 = 0] = m
  const trace = m00 + m11 + m22
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2
  return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]
}
