/**
 * Poses, rest states and the questions asked of a die lying on the floor: which body axis points
 * up, how far it leans, and which face is drawn on top.
 */
import {
  AXIS_FACE,
  AXIS_UP,
  AXES,
  CUBE_ROTATIONS,
  FACE_AXIS,
  nearestAxis,
  rotationAt,
  type AxisIndex,
  type DieFace,
} from './cube.ts'
import { conjugate, cross, dot3, length3, multiply, normalize, rotate, UP } from './quat.ts'
import type { Quat, Vec3 } from './quat.ts'

/** A rigid-body pose: position and unit quaternion. */
export interface Pose {
  readonly p: Vec3
  readonly q: Quat
}

/** One pose per die, in body order. */
export type DicePoses = readonly [Pose, Pose]

/** A die at rest, and the cube rotation drawn on its body: q_vis = q_body · R[offset]. */
export interface DieRest {
  readonly pose: Pose
  readonly offset: number
}

/**
 * Both dice at rest, in body order. Plain numbers only, so it can be saved with the session and
 * passed to and from the physics worker. The next throw starts from these poses.
 */
export type RestState = readonly [DieRest, DieRest]

/** The body-local axis that points closest to world up. */
export function upAxis(q: Quat): AxisIndex {
  return nearestAxis(rotate(conjugate(normalize(q)), UP))
}

/** How far the body's up axis leans from world up, in degrees. */
export function tiltDeg(q: Quat): number {
  const local = rotate(conjugate(normalize(q)), UP)
  const axis = AXES[upAxis(q)] ?? UP
  // atan2 of |sin| and cos stays accurate near 0°, where acos does not.
  const angle = Math.atan2(length3(cross(local, axis)), dot3(local, axis))
  return (angle * 180) / Math.PI
}

/** The face drawn on top of a die whose body has orientation `q` and offset `offset`. */
export function visualTopFace(q: Quat, offset: number): DieFace {
  const up = upAxis(q)
  // The drawn face f is on top when R[offset]·n_f = up.
  const from = rotationAt(offset).axisMap.indexOf(up)
  const face = AXIS_FACE[from]
  if (face === undefined) throw new RangeError(`offset ${offset} has no axis mapping to ${up}`)
  return face
}

/** The face on top before any remap: what the physics rolled. */
export function naturalTopFace(q: Quat): DieFace {
  return AXIS_FACE[upAxis(q)] ?? 1
}

/** The first cube rotation that turns `face`'s normal to world up. */
export function rotationShowing(face: DieFace): number {
  const from = FACE_AXIS[face]
  return CUBE_ROTATIONS.findIndex((rotation) => rotation.axisMap[from] === AXIS_UP)
}

/** A body orientation lying flat with cube rotation `index` applied, then turned by `yaw`. */
export function flatOrientation(index: number, yaw: Quat): Quat {
  return multiply(yaw, rotationAt(index).quat)
}

export function posesOf(rest: RestState): DicePoses {
  return [rest[0].pose, rest[1].pose]
}
