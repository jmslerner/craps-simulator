/**
 * Exact gaps between a die and the floor, the dome and the other die, read from poses alone:
 * positive is clearance, negative is how deep the die presses in. A die is a rounded cube, the
 * Minkowski sum of a cube of half-extent h and a ball of radius r, so its reach along a unit
 * direction n is h·Σ|n·a_i| + r, where a_i are its world-frame axes.
 *
 * - Floor: exact, p_y − h·Σ|a_i,y| − r.
 * - Dome: exact for the trimesh collider (its flat chords, not the sphere): the nearest face plane.
 * - Dice: exact. Overlapping inner cubes get their depth from the 15 separating axes, which is
 *   exact for boxes; apart, the distance comes from every vertex-box and edge-edge pair.
 *
 * Far from contact the exact answer is rarely needed, so the dome and dice gaps take a `cutoff`:
 * below it they are exact, and at or above it they may return any lower bound that is ≥ cutoff.
 */
import { domeFaces } from './dome.ts'
import type { DieParams, PhysicsParams } from './params.ts'
import type { Quat } from './quat.ts'
import { contactByte, TOUCH_DIE, TOUCH_DOME, TOUCH_FLOOR } from './recording.ts'
import type { DicePoses, Pose } from './restPose.ts'

/** A rotation as its world-frame body axes, its matrix's columns: [a0x, a0y, a0z, a1x, ...]. */
type Axes = readonly number[]

/** The axes of a body turned by `q`, which need not be exactly unit, as stored frames are not. */
function axesOf(q: Quat): Axes {
  const [x, y, z, w] = q
  const s = 2 / (x * x + y * y + z * z + w * w)
  return [
    1 - s * (y * y + z * z),
    s * (x * y + z * w),
    s * (x * z - y * w),
    s * (x * y - z * w),
    1 - s * (x * x + z * z),
    s * (y * z + x * w),
    s * (x * z + y * w),
    s * (y * z - x * w),
    1 - s * (x * x + y * y),
  ]
}

const at = (axes: Axes, k: number) => axes[k] ?? Number.NaN

/** Σ|a_i·n| for a unit direction n: the inner cube's half-width along n, over h. */
function spread(axes: Axes, nx: number, ny: number, nz: number): number {
  let sum = 0
  for (let i = 0; i < 9; i += 3) {
    sum += Math.abs(at(axes, i) * nx + at(axes, i + 1) * ny + at(axes, i + 2) * nz)
  }
  return sum
}

/** The radius of the smallest ball about the centre that holds the die. */
export function circumradius(die: DieParams): number {
  return die.halfExtent * Math.sqrt(3) + die.borderRadius
}

/** How far the die's lowest point is above the floor (y = 0). */
export function floorGap(pose: Pose, die: DieParams): number {
  const [x, y, z, w] = pose.q
  const s = 2 / (x * x + y * y + z * z + w * w)
  const reach =
    Math.abs(s * (x * y + z * w)) +
    Math.abs(1 - s * (x * x + z * z)) +
    Math.abs(s * (y * z - x * w))
  return pose.p[1] - die.halfExtent * reach - die.borderRadius
}

/** How far the die is from the dome's nearest face. Exact below `cutoff`. */
export function domeGap(pose: Pose, params: PhysicsParams, cutoff = Infinity): number {
  const { planes, count, inradius } = domeFaces(params.dome)
  const { halfExtent, borderRadius } = params.die
  const [px, py, pz] = pose.p
  const reach = circumradius(params.die)
  // The die is inside its bounding ball, and the mesh contains the ball of its inradius.
  const bound = inradius - Math.sqrt(px * px + py * py + pz * pz) - reach
  if (bound >= cutoff) return bound
  const axes = axesOf(pose.q)
  let gap = Infinity
  for (let t = 0; t < 4 * count; t += 4) {
    const nx = planes[t] ?? Number.NaN
    const ny = planes[t + 1] ?? Number.NaN
    const nz = planes[t + 2] ?? Number.NaN
    const inside = (planes[t + 3] ?? Number.NaN) - (nx * px + ny * py + nz * pz)
    // Even at its widest the die cannot come nearer this plane than inside − reach.
    if (inside - reach >= gap) continue
    gap = Math.min(gap, inside - halfExtent * spread(axes, nx, ny, nz) - borderRadius)
  }
  return gap
}

/**
 * The contact byte for a pair of poses (see recording.ts): what each die is within
 * `contact.touchGap` of. Physics recordings and the analytic hop flag contacts this same way.
 */
export function touching(poses: DicePoses, params: PhysicsParams): number {
  const { touchGap } = params.contact
  // Above this cutoff the gap functions may return a bound instead, but never one this small.
  const cutoff = 2 * touchGap
  const between = diceGap(poses[0], poses[1], params.die, cutoff) <= touchGap ? TOUCH_DIE : 0
  const of = (pose: Pose) =>
    (floorGap(pose, params.die) <= touchGap ? TOUCH_FLOOR : 0) |
    (domeGap(pose, params, cutoff) <= touchGap ? TOUCH_DOME : 0) |
    between
  return contactByte([of(poses[0]), of(poses[1])])
}

/** Whether a point is inside the dome's mesh and above the floor. */
export function insideDome(p: readonly number[], params: PhysicsParams): boolean {
  const [x = Number.NaN, y = Number.NaN, z = Number.NaN] = p
  if (!(y >= 0)) return false
  const { planes, count, inradius } = domeFaces(params.dome)
  if (x * x + y * y + z * z <= inradius * inradius) return true
  for (let t = 0; t < 4 * count; t += 4) {
    const outward = (planes[t] ?? 0) * x + (planes[t + 1] ?? 0) * y + (planes[t + 2] ?? 0) * z
    if (!(outward <= (planes[t + 3] ?? Number.NaN))) return false
  }
  return true
}

/**
 * How far apart the two dice are, or minus the depth they overlap by. Exact below `cutoff`.
 */
export function diceGap(a: Pose, b: Pose, die: DieParams, cutoff = Infinity): number {
  const h = die.halfExtent
  const rounding = 2 * die.borderRadius
  const tx = b.p[0] - a.p[0]
  const ty = b.p[1] - a.p[1]
  const tz = b.p[2] - a.p[2]
  const bound = Math.sqrt(tx * tx + ty * ty + tz * tz) - 2 * circumradius(die)
  if (bound >= cutoff) return bound
  const axesA = axesOf(a.q)
  const axesB = axesOf(b.q)
  // The largest separation of the inner cubes along the 15 axes of the separating-axis test.
  let separation = -Infinity
  const along = (lx: number, ly: number, lz: number) => {
    const projection = Math.abs(tx * lx + ty * ly + tz * lz)
    const halfWidths = h * (spread(axesA, lx, ly, lz) + spread(axesB, lx, ly, lz))
    separation = Math.max(separation, projection - halfWidths)
  }
  for (let i = 0; i < 9; i += 3) {
    along(at(axesA, i), at(axesA, i + 1), at(axesA, i + 2))
    along(at(axesB, i), at(axesB, i + 1), at(axesB, i + 2))
  }
  for (let i = 0; i < 9; i += 3) {
    for (let j = 0; j < 9; j += 3) {
      const [ax, ay, az] = [at(axesA, i), at(axesA, i + 1), at(axesA, i + 2)]
      const [bx, by, bz] = [at(axesB, j), at(axesB, j + 1), at(axesB, j + 2)]
      const cx = ay * bz - az * by
      const cy = az * bx - ax * bz
      const cz = ax * by - ay * bx
      const length = Math.sqrt(cx * cx + cy * cy + cz * cz)
      // Parallel edges give no new axis; the face normals already cover them.
      if (length > 1e-9) along(cx / length, cy / length, cz / length)
    }
  }
  // Overlapping cubes: no axis separates them, and the shallowest overlap is the exact depth.
  // Apart, the separation along one axis is only a lower bound on their distance.
  if (separation <= 0 || separation - rounding >= cutoff) return separation - rounding
  return cubeDistance(a.p, axesA, b.p, axesB, h) - rounding
}

/**
 * The distance between two disjoint solid cubes of half-extent h. Two convex polyhedra are
 * nearest at a vertex of one and the other solid, or at a pair of edges, so this checks all
 * 16 vertex-cube and 144 edge-edge pairs.
 */
function cubeDistance(
  ca: readonly number[],
  axesA: Axes,
  cb: readonly number[],
  axesB: Axes,
  h: number,
): number {
  const cornersA = corners(ca, axesA, h)
  const cornersB = corners(cb, axesB, h)
  let best = Infinity
  for (let k = 0; k < 24; k += 3) {
    best = Math.min(best, pointToCube(cornersA, k, cb, axesB, h))
    best = Math.min(best, pointToCube(cornersB, k, ca, axesA, h))
  }
  const edgesA = edges(cornersA)
  const edgesB = edges(cornersB)
  for (let i = 0; i < edgesA.length; i += 6) {
    for (let j = 0; j < edgesB.length; j += 6) {
      best = Math.min(best, segmentDistance2(edgesA, i, edgesB, j))
    }
  }
  return Math.sqrt(best)
}

/** The 8 corners as [x, y, z] triples; corner k has signs from its bits (bit 2 for axis 0). */
function corners(c: readonly number[], axes: Axes, h: number): number[] {
  const out: number[] = []
  for (let k = 0; k < 8; k++) {
    const s0 = k & 4 ? -h : h
    const s1 = k & 2 ? -h : h
    const s2 = k & 1 ? -h : h
    for (let d = 0; d < 3; d++) {
      out.push(
        (c[d] ?? Number.NaN) + s0 * at(axes, d) + s1 * at(axes, 3 + d) + s2 * at(axes, 6 + d),
      )
    }
  }
  return out
}

/** The 12 edges as [start, direction] sextuples: corners differing in exactly one sign bit. */
function edges(corners: readonly number[]): number[] {
  const out: number[] = []
  for (let k = 0; k < 8; k++) {
    for (const bit of [4, 2, 1]) {
      if (k & bit) continue
      const m = k | bit
      for (let d = 0; d < 3; d++) out.push(corners[3 * k + d] ?? Number.NaN)
      for (let d = 0; d < 3; d++) {
        out.push((corners[3 * m + d] ?? Number.NaN) - (corners[3 * k + d] ?? Number.NaN))
      }
    }
  }
  return out
}

/** Squared distance from the point at `points[k..k+2]` to a solid cube. */
function pointToCube(
  points: readonly number[],
  k: number,
  c: readonly number[],
  axes: Axes,
  h: number,
): number {
  const dx = (points[k] ?? Number.NaN) - (c[0] ?? Number.NaN)
  const dy = (points[k + 1] ?? Number.NaN) - (c[1] ?? Number.NaN)
  const dz = (points[k + 2] ?? Number.NaN) - (c[2] ?? Number.NaN)
  let sum = 0
  for (let i = 0; i < 9; i += 3) {
    const outside = Math.abs(dx * at(axes, i) + dy * at(axes, i + 1) + dz * at(axes, i + 2)) - h
    if (outside > 0) sum += outside * outside
  }
  return sum
}

/**
 * Squared distance between segments p1 + s·d1 and p2 + t·d2, s and t in [0, 1] (Ericson,
 * Real-Time Collision Detection §5.1.9). Both segments have non-zero length here.
 */
function segmentDistance2(e1: readonly number[], i: number, e2: readonly number[], j: number) {
  const v = (e: readonly number[], k: number) => e[k] ?? Number.NaN
  const [p1x, p1y, p1z, d1x, d1y, d1z] = [
    v(e1, i),
    v(e1, i + 1),
    v(e1, i + 2),
    v(e1, i + 3),
    v(e1, i + 4),
    v(e1, i + 5),
  ]
  const [p2x, p2y, p2z, d2x, d2y, d2z] = [
    v(e2, j),
    v(e2, j + 1),
    v(e2, j + 2),
    v(e2, j + 3),
    v(e2, j + 4),
    v(e2, j + 5),
  ]
  const rx = p1x - p2x
  const ry = p1y - p2y
  const rz = p1z - p2z
  const a = d1x * d1x + d1y * d1y + d1z * d1z
  const e = d2x * d2x + d2y * d2y + d2z * d2z
  const b = d1x * d2x + d1y * d2y + d1z * d2z
  const c = d1x * rx + d1y * ry + d1z * rz
  const f = d2x * rx + d2y * ry + d2z * rz
  const denom = a * e - b * b
  // Parallel segments: any s works, and the clamping below finds the nearest pair from s = 0.
  let s = denom > 1e-12 * a * e ? clamp01((b * f - c * e) / denom) : 0
  let t = (b * s + f) / e
  if (t < 0) {
    t = 0
    s = clamp01(-c / a)
  } else if (t > 1) {
    t = 1
    s = clamp01((b - c) / a)
  }
  const x = rx + d1x * s - d2x * t
  const y = ry + d1y * s - d2y * t
  const z = rz + d1z * s - d2z * t
  return x * x + y * y + z * z
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
