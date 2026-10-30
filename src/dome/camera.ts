import { AXES } from '../physics/core/cube.ts'
import { normalize, rotate, type Vec3 } from '../physics/core/quat.ts'
import type { DicePoses, Pose } from '../physics/core/restPose.ts'

/**
 * The dome's camera (plan §7 Rendering; M10 audit MAJOR-1): where the station view looks, so both
 * dice's top faces always come to rest on the canvas and clear of the overlays. A static camera
 * cannot do that on a 16:10 canvas a few hundred pixels wide: the dice rest anywhere on a floor 15
 * dice across, and framing all of it leaves each die about 14 px. So the camera works like a
 * broadcast one, at one fixed pitch, moving only along its own axes:
 *
 * - the throw shot (`THROW_SHOT`) shows most of the floor while the dice fly;
 * - the read framing (`readFraming`) is solved for the dice where they rest: the closest camera
 *   whose view puts every corner of both dice — the whole cubes, so certainly both top faces —
 *   inside a safe area — the canvas less the overlays' reserved zones (`reservedZones`) — no
 *   closer than `READ_MIN_DISTANCE`, and outside the glass;
 * - between the two the pose eases (`easeCamera`), so the throw is seen wide and the result read
 *   up close; a snap to rest (reduced motion, a restore, a mode switch) jumps straight there.
 *
 * Everything here is plain math over numbers, shared by the renderer (`placeCamera` on three's
 * camera) and the Node framing test, which projects with three's own `PerspectiveCamera`. The
 * reserved zones restate the overlay CSS (index.css `.dome-puck`, `.callout`; the 3D toggle and
 * the quality pin sit under the box, dome.css `.dome-controls`); the chromium-3d e2e checks the
 * drawn overlays sit inside them and the drawn top faces stay clear of the overlays themselves.
 * Since the machine design (plan §0 #28) the recent rolls are the felt's history strip, so the
 * dome keeps no band along its top, and its puck and callout are the compact ones.
 */

/** The perspective camera R3F builds for the dome: vertical field of view, degrees. */
export const DOME_FOV = 35
export const DOME_NEAR = 0.5
export const DOME_FAR = 80

/** Every camera pose looks down at this pitch, degrees below the horizon, facing −z. */
export const CAMERA_PITCH_DEG = 55
/** The read framing comes no closer than this to the dice (a zoom cap), in die edges. */
export const READ_MIN_DISTANCE = 9
/** The camera stays this far from the dome's centre: outside the glass (7.5) and its ring. */
export const CAMERA_MIN_RADIUS = 8.6

/** Half a die's edge: the top face's corners sit this far from its centre along two axes. */
const HALF_EDGE = 0.5

export interface CameraPose {
  readonly position: Vec3
  /** A point on the line of sight: the camera looks at it (three's `lookAt`). */
  readonly target: Vec3
}

/** The canvas in CSS pixels. */
export interface CanvasSize {
  readonly width: number
  readonly height: number
}

/** A rectangle on the canvas, CSS pixels from its top-left corner. */
export interface ScreenRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

const PITCH = (CAMERA_PITCH_DEG * Math.PI) / 180
/** The camera's own axes at the fixed pitch, as three's `lookAt` builds them (up = +y). */
const FORWARD: Vec3 = [0, -Math.sin(PITCH), -Math.cos(PITCH)]
const RIGHT: Vec3 = [1, 0, 0]
const UP: Vec3 = [0, Math.cos(PITCH), -Math.sin(PITCH)]

/**
 * The throw shot: the floor out to about 6.5 die edges from the centre — inside which 19 dice in
 * 20 come to rest — fills the canvas, with the near side a little larger. A die may leave it at
 * the top of a high bounce or by the wall; the read framing finds it afterwards.
 */
export const THROW_SHOT: CameraPose = poseAt([0, 1, 1.2], 17)

/** A camera at the fixed pitch, `distance` back from `target` along its line of sight. */
function poseAt(target: Vec3, distance: number): CameraPose {
  return {
    position: [
      target[0] - FORWARD[0] * distance,
      target[1] - FORWARD[1] * distance,
      target[2] - FORWARD[2] * distance,
    ],
    target,
  }
}

/**
 * The overlays' reserved zones on a canvas of `size`, each with a few pixels to spare: the ON/OFF
 * puck (46 px at 8, 8) and the callout along the bottom (30 px tall at 8; as wide as its words, up
 * to the width less 24 px). The puck's zone comes first, the callout's band second.
 */
export function reservedZones(size: CanvasSize): readonly ScreenRect[] {
  const { width, height } = size
  return [
    { left: 0, top: 0, right: PUCK_ZONE, bottom: PUCK_ZONE },
    { left: 0, top: height - BOTTOM_BAND, right: width, bottom: height },
  ]
}

/** The puck's zone: its 46 px square at 8 px from the corner, plus 8 px. */
export const PUCK_ZONE = 62
/** The callout's band: 8 px up, 30 px tall, plus 6 px. */
export const BOTTOM_BAND = 44
/** The dice keep this far from the canvas's edges outside the zones (left, right and top). */
export const SIDE_MARGIN = 6

/**
 * Rectangles clear of every reserved zone, where the read framing may put the dice: right of the
 * puck from the top, or below the puck across the whole width. Each is a whole pixel inside the
 * zones, so a framing that touches its edge still clears them.
 */
export function safeAreas(size: CanvasSize): readonly ScreenRect[] {
  const { width, height } = size
  const bottom = height - BOTTOM_BAND - 1
  const right = width - SIDE_MARGIN
  return [
    { left: PUCK_ZONE + 1, top: SIDE_MARGIN, right, bottom },
    { left: SIDE_MARGIN, top: PUCK_ZONE + 1, right, bottom },
  ]
}

/** The eight corners of a die's cube at `pose` (world coordinates): its whole silhouette. */
export function dieCorners(pose: Pose): readonly Vec3[] {
  const q = normalize(pose.q)
  const corners: Vec3[] = []
  for (const x of [-HALF_EDGE, HALF_EDGE]) {
    for (const y of [-HALF_EDGE, HALF_EDGE]) {
      for (const z of [-HALF_EDGE, HALF_EDGE]) {
        const [rx, ry, rz] = rotate(q, [x, y, z])
        corners.push([pose.p[0] + rx, pose.p[1] + ry, pose.p[2] + rz])
      }
    }
  }
  return corners
}

/** The four corners of the face on top of a die at rest (world coordinates). */
export function topFaceCorners(pose: Pose): readonly Vec3[] {
  const q = normalize(pose.q)
  const axes = AXES.map((axis) => rotate(q, axis))
  let up = 0
  axes.forEach((axis, index) => {
    if (axis[1] > (axes[up]?.[1] ?? -Infinity)) up = index
  })
  const normal = axes[up] ?? [0, 1, 0]
  // The two in-plane axes: the first pair perpendicular to the normal and to each other.
  const side = axes.filter((axis) => Math.abs(dot(axis, normal)) < 0.5)
  const u = side[0] ?? [1, 0, 0]
  const v = side.find((axis) => Math.abs(dot(axis, u)) < 0.5) ?? [0, 0, 1]
  const centre: Vec3 = [
    pose.p[0] + normal[0] * HALF_EDGE,
    pose.p[1] + normal[1] * HALF_EDGE,
    pose.p[2] + normal[2] * HALF_EDGE,
  ]
  const corner = (a: number, b: number): Vec3 => [
    centre[0] + (u[0] * a + v[0] * b) * HALF_EDGE,
    centre[1] + (u[1] * a + v[1] * b) * HALF_EDGE,
    centre[2] + (u[2] * a + v[2] * b) * HALF_EDGE,
  ]
  return [corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)]
}

/**
 * The read framing for dice resting at `poses` on a canvas of `size`: the camera at the fixed
 * pitch that shows every corner of both dice — the whole cubes, so no die even tucks a side under
 * an overlay, and so certainly both top faces — inside one of the safe areas, as close as the zoom
 * cap and the glass allow, the dice centred in that area. Of the safe areas the one that lets the
 * camera come closest wins. Falls back to the throw shot only when no area can hold the dice at
 * any distance, which a canvas too small for the overlays alone would mean.
 */
export function readFraming(poses: DicePoses, size: CanvasSize): CameraPose {
  if (!(size.width > 0 && size.height > 0)) return THROW_SHOT
  const points = [...dieCorners(poses[0]), ...dieCorners(poses[1])]
  let best: { readonly pose: CameraPose; readonly back: number } | null = null
  for (const area of safeAreas(size)) {
    const framed = frameIn(points, size, area)
    if (framed !== null && (best === null || framed.back < best.back)) best = framed
  }
  return best?.pose ?? THROW_SHOT
}

/**
 * The closest camera at the fixed pitch that projects every point into `area`. With the camera at
 * c_r·RIGHT + c_u·UP − back·FORWARD, a point's depth is its FORWARD component plus `back`, and
 * keeping its projection inside the area bounds c_r and c_u to intervals that only widen as the
 * camera backs off — so the closest feasible `back` is found by bisection, and the camera sits at
 * the middle of both intervals there.
 */
function frameIn(
  points: readonly Vec3[],
  size: CanvasSize,
  area: ScreenRect,
): { readonly pose: CameraPose; readonly back: number } | null {
  const tan = Math.tan((DOME_FOV * Math.PI) / 360)
  const kx = tan * (size.width / size.height)
  const ky = tan
  // The area in normalised device coordinates (x right, y up).
  const x0 = (2 * area.left) / size.width - 1
  const x1 = (2 * area.right) / size.width - 1
  const y0 = 1 - (2 * area.bottom) / size.height
  const y1 = 1 - (2 * area.top) / size.height
  if (!(x0 < x1 && y0 < y1)) return null
  const along = points.map((point) => ({
    r: dot(point, RIGHT),
    u: dot(point, UP),
    f: dot(point, FORWARD),
  }))
  const intervals = (back: number): { readonly r: number; readonly u: number } | null => {
    let rLow = -Infinity
    let rHigh = Infinity
    let uLow = -Infinity
    let uHigh = Infinity
    for (const point of along) {
      const depth = point.f + back
      if (!(depth > DOME_NEAR)) return null
      rLow = Math.max(rLow, point.r - x1 * kx * depth)
      rHigh = Math.min(rHigh, point.r - x0 * kx * depth)
      uLow = Math.max(uLow, point.u - y1 * ky * depth)
      uHigh = Math.min(uHigh, point.u - y0 * ky * depth)
    }
    if (rLow > rHigh || uLow > uHigh) return null
    return { r: (rLow + rHigh) / 2, u: (uLow + uHigh) / 2 }
  }
  const centroid = along.reduce((sum, point) => sum + point.f, 0) / along.length
  // The zoom cap: the dice's centre at least READ_MIN_DISTANCE in front of the camera.
  let low = READ_MIN_DISTANCE - centroid
  let high = low + 400
  if (intervals(high) === null) return null
  if (intervals(low) === null) {
    for (let step = 0; step < 60; step++) {
      const middle = (low + high) / 2
      if (intervals(middle) === null) low = middle
      else high = middle
    }
    low = high
  }
  let back = low
  let offsets = intervals(back)
  const place = (at: number, by: { readonly r: number; readonly u: number }): Vec3 => [
    RIGHT[0] * by.r + UP[0] * by.u - FORWARD[0] * at,
    RIGHT[1] * by.r + UP[1] * by.u - FORWARD[1] * at,
    RIGHT[2] * by.r + UP[2] * by.u - FORWARD[2] * at,
  ]
  if (offsets === null) return null
  let position = place(back, offsets)
  // Outside the glass: back off along the line of sight (which only widens the intervals).
  for (let step = 0; step < 400 && length(position) < CAMERA_MIN_RADIUS; step++) {
    back += 0.05
    offsets = intervals(back)
    if (offsets === null) return null
    position = place(back, offsets)
  }
  // Look at the point where the line of sight crosses the height of the top faces.
  const reach = (position[1] - HALF_EDGE * 2) / -FORWARD[1]
  const target: Vec3 = [
    position[0] + FORWARD[0] * reach,
    position[1] + FORWARD[1] * reach,
    position[2] + FORWARD[2] * reach,
  ]
  return { pose: { position, target }, back }
}

/**
 * Where `point` lands on a `size` canvas seen from `pose`, in CSS pixels, plus its depth in front
 * of the camera: the arithmetic of three's `PerspectiveCamera` (`lookAt` with +y up, vertical
 * field of view `DOME_FOV`, no zoom or view offset), which the framing test checks against three.
 */
export function projectPoint(
  pose: CameraPose,
  size: CanvasSize,
  point: Vec3,
): readonly [number, number, number] {
  const forward = unit(sub(pose.target, pose.position))
  const right = unit(cross(forward, [0, 1, 0]))
  const up = cross(right, forward)
  const d = sub(point, pose.position)
  const depth = dot(d, forward)
  const tan = Math.tan((DOME_FOV * Math.PI) / 360)
  const ndcX = dot(d, right) / (depth * tan * (size.width / size.height))
  const ndcY = dot(d, up) / (depth * tan)
  return [((ndcX + 1) / 2) * size.width, ((1 - ndcY) / 2) * size.height, depth]
}

/** Smoothstep's quintic cousin: eases in and out, flat at both ends. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/** The pose `t` of the way from `from` to `to` (eased), both ends included. */
export function easeCamera(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const k = easeInOut(t)
  const mix = (a: Vec3, b: Vec3): Vec3 => [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ]
  return { position: mix(from.position, to.position), target: mix(from.target, to.target) }
}

/** The parts of three's camera the dome moves; structural, so this module never imports three. */
export interface CameraLike {
  readonly position: { set(x: number, y: number, z: number): unknown }
  lookAt(x: number, y: number, z: number): void
  updateMatrixWorld(force?: boolean): void
}

/** Puts three's camera at `pose`: the one way the renderer and the framing test place it. */
export function placeCamera(camera: CameraLike, pose: CameraPose): void {
  camera.position.set(pose.position[0], pose.position[1], pose.position[2])
  camera.lookAt(pose.target[0], pose.target[1], pose.target[2])
  camera.updateMatrixWorld(true)
}

/** The same pose, to within `epsilon` in every coordinate. */
export function samePose(a: CameraPose, b: CameraPose, epsilon = 1e-9): boolean {
  for (let k = 0; k < 3; k++) {
    if (Math.abs((a.position[k] ?? 0) - (b.position[k] ?? 0)) > epsilon) return false
    if (Math.abs((a.target[k] ?? 0) - (b.target[k] ?? 0)) > epsilon) return false
  }
  return true
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}

function unit(a: Vec3): Vec3 {
  const l = length(a)
  return [a[0] / l, a[1] / l, a[2] / l]
}
