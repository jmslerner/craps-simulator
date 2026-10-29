/**
 * Small vector and quaternion helpers. Quaternions are [x, y, z, w], the order Rapier and three.js
 * use. Tuples keep poses JSON-safe, so they can be persisted and sent to and from the worker.
 */
export type Vec3 = readonly [number, number, number]
export type Quat = readonly [number, number, number, number]

export const IDENTITY: Quat = [0, 0, 0, 1]
export const UP: Vec3 = [0, 1, 0]

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function length3(v: Vec3): number {
  return Math.sqrt(dot3(v, v))
}

/** Hamilton product: rotating by `b` first, then by `a`. */
export function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

/** The inverse of a unit quaternion. */
export function conjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]]
}

export function normalize(q: Quat): Quat {
  const n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

/** Rotates `v` by the unit quaternion `q`, without building a matrix. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q
  const [vx, vy, vz] = v
  const tx = 2 * (y * vz - z * vy)
  const ty = 2 * (z * vx - x * vz)
  const tz = 2 * (x * vy - y * vx)
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ]
}

/** Rotation by `angle` radians about the unit vector `axis`. */
export function fromAxisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2)
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]
}

/** The angle in radians of the rotation taking `a` to `b`, in [0, π]. */
export function angleBetween(a: Quat, b: Quat): number {
  // atan2 stays accurate for tiny angles, where acos of the dot product loses most of its digits.
  const r = multiply(conjugate(a), b)
  return 2 * Math.atan2(Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]), Math.abs(r[3]))
}

/** Spherical interpolation along the shorter arc. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const sign = d < 0 ? -1 : 1
  d *= sign
  if (d > 0.9995) {
    return normalize([
      a[0] + (sign * b[0] - a[0]) * t,
      a[1] + (sign * b[1] - a[1]) * t,
      a[2] + (sign * b[2] - a[2]) * t,
      a[3] + (sign * b[3] - a[3]) * t,
    ])
  }
  const theta = Math.acos(d)
  const wa = Math.sin((1 - t) * theta) / Math.sin(theta)
  const wb = (sign * Math.sin(t * theta)) / Math.sin(theta)
  return [
    wa * a[0] + wb * b[0],
    wa * a[1] + wb * b[1],
    wa * a[2] + wb * b[2],
    wa * a[3] + wb * b[3],
  ]
}

/**
 * Rotation about world +Y from a unit 2-vector (c, s) = (cos(ψ/2), sin(ψ/2)). Taking the half
 * angle as input lets callers draw a uniform yaw by rejection sampling, with no trigonometry.
 */
export function yawFromHalfAngle(c: number, s: number): Quat {
  return [0, s, 0, c]
}
