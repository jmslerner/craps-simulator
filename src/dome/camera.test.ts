// @vitest-environment node
import { PerspectiveCamera, Vector3 } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { rollDice } from '../engine/core/dice.ts'
import { deriveSeed32, seedRng } from '../engine/index.ts'
import type { Vec3 } from '../physics/core/quat.ts'
import type { DicePoses, RestState } from '../physics/core/restPose.ts'
import { simulateThrow } from '../physics/core/simulate.ts'
import { initPhysics } from '../physics/core/world.ts'
import {
  CAMERA_MIN_RADIUS,
  DOME_FAR,
  DOME_FOV,
  DOME_NEAR,
  placeCamera,
  projectPoint,
  READ_MIN_DISTANCE,
  readFraming,
  reservedZones,
  safeAreas,
  THROW_SHOT,
  topFaceCorners,
  type CameraPose,
  type CanvasSize,
  type ScreenRect,
} from './camera.ts'
import { planThrow, restShowing } from './throws.ts'

/**
 * The dome's framing (M10 audit MAJOR-1): over 600 seeded throws, chained exactly as the dome
 * chains them — the physics seed `deriveSeed32(seed, 'physics', rollIndex, 0)`, each throw from the
 * last one's rest, planned onto the engine's own dice — both dice's top faces come to rest inside
 * the canvas and clear of every overlay, at every canvas size the layout gives the dome. The
 * projection is three's own `PerspectiveCamera`, placed with `placeCamera` exactly as the
 * renderer places it, at the R3F camera's field of view, near and far planes and aspect.
 */

/**
 * The dome is a 16:10 box: its canvas at the layout's widths (CSS px, inside a 1 px border). Since
 * the machine design (plan §0 #28) it is a compact panel: up to 300 px wide on a two-column felt
 * (620 to 859 px: tablets), and on the station's four-column felt (860 px and up) a column at the
 * top right of 236 to 276 px on a screen up to 860 px tall and 260 to 316 px on a taller one
 * (src/index.css `--dome-column`); on phones the felt's full width (the viewport less the 16 px
 * gutters, the felt's 3 px border and 8 px padding). The widest canvases before it stay as wider
 * cases.
 */
const CANVASES: readonly (CanvasSize & { readonly where: string })[] = [
  { where: '320 px phone', width: 264, height: 165 },
  { where: 'two-column felts (300 px panel)', width: 298, height: 186.25 },
  { where: '375 px phone (phone spec)', width: 319, height: 199.375 },
  { where: '390 px phone (the review size)', width: 334, height: 208.75 },
  { where: 'iPhone 15 (393 px)', width: 337, height: 210.625 },
  { where: 'Pixel 7 (412 px)', width: 356, height: 222.5 },
  { where: 'before the machine design: 1440 px column', width: 358, height: 223.75 },
  { where: 'before the machine design: 990 px, one column', width: 956, height: 597.5 },
  {
    where: 'station felt, narrowest dome (236 px: 1280 px with the drawer, 1024 px)',
    width: 234,
    height: 145.5,
  },
  {
    where: 'station felt, 1440 × 900 with the drawer docked (267 px)',
    width: 265,
    height: 164.875,
  },
  { where: 'station felt, 1280 × 800 (274 px)', width: 272, height: 169.25 },
  { where: 'station felt, widest dome (316 px)', width: 314, height: 195.5 },
]

const SEEDS = ['framing-a', 'framing-b', 'framing-c', 'framing-d', 'framing-e', 'framing-f']
const ROLLS = 100

interface Throw {
  readonly seed: string
  readonly rollIndex: number
  readonly rest: RestState
}

let throws: readonly Throw[] = []

beforeAll(async () => {
  await initPhysics()
  const played: Throw[] = []
  for (const seed of SEEDS) {
    let rng = seedRng(seed)
    // The dome's starting rest (domeController's idle dice), as a fresh session has it.
    let rest: RestState = restShowing({ d1: 3, d2: 4 })
    for (let rollIndex = 0; rollIndex < ROLLS; rollIndex++) {
      const [dice, next] = rollDice(rng)
      rng = next
      const physicsSeed = deriveSeed32(seed, 'physics', rollIndex, 0)
      const result = simulateThrow(physicsSeed, rest)
      const reply = {
        seed: physicsSeed,
        recording: result.recording,
        rest: result.rest,
        startedFromRequest: result.start.valid,
        attempts: result.attempts.length,
        source: result.recording.source,
      }
      rest = planThrow(reply, dice, rest, physicsSeed).plan.rest
      played.push({ seed, rollIndex, rest })
    }
  }
  throws = played
}, 300_000)

/** three's camera for the dome on a `size` canvas, placed as the renderer places it. */
function threeCamera(pose: CameraPose, size: CanvasSize): PerspectiveCamera {
  const camera = new PerspectiveCamera(DOME_FOV, size.width / size.height, DOME_NEAR, DOME_FAR)
  placeCamera(camera, pose)
  camera.updateProjectionMatrix()
  return camera
}

/** A world point on the canvas, CSS px, by three's projection. */
function onCanvas(camera: PerspectiveCamera, size: CanvasSize, point: Vec3): [number, number] {
  const ndc = new Vector3(point[0], point[1], point[2]).project(camera)
  return [((ndc.x + 1) / 2) * size.width, ((1 - ndc.y) / 2) * size.height]
}

interface FaceBox extends ScreenRect {
  /** The square root of the projected face's area: how big the die's face reads, px. */
  readonly size: number
}

function faceBoxes(rest: RestState, size: CanvasSize): readonly FaceBox[] {
  const poses: DicePoses = [rest[0].pose, rest[1].pose]
  const camera = threeCamera(readFraming(poses, size), size)
  return poses.map((pose) => {
    const corners = topFaceCorners(pose).map((corner) => onCanvas(camera, size, corner))
    const xs = corners.map(([x]) => x)
    const ys = corners.map(([, y]) => y)
    let area = 0
    corners.forEach(([x1, y1], k) => {
      const [x2, y2] = corners[(k + 1) % corners.length] ?? [0, 0]
      area += x1 * y2 - x2 * y1
    })
    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
      size: Math.sqrt(Math.abs(area) / 2),
    }
  })
}

const overlaps = (a: ScreenRect, b: ScreenRect): boolean =>
  a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom

describe(`the read framing over ${SEEDS.length * ROLLS} seeded throws`, () => {
  it('chains real throws: the rests spread to the wall, as the audit found', () => {
    expect(throws).toHaveLength(SEEDS.length * ROLLS)
    const radii = throws
      .flatMap(({ rest }) => rest.map(({ pose }) => Math.hypot(pose.p[0], pose.p[2])))
      .sort((a, b) => a - b)
    // Far beyond what the M10a station camera could see (|x| ≤ ~5, z ≤ ~4.6 for a top face).
    expect(radii.at(-1)).toBeGreaterThan(6)
    expect(radii[Math.floor(radii.length * 0.9)]).toBeGreaterThan(5)
  })

  for (const canvas of CANVASES) {
    it(`puts both top faces on the canvas and clear of the overlays: ${canvas.where}`, () => {
      const zones = reservedZones(canvas)
      const misses: string[] = []
      const sizes: number[] = []
      for (const { seed, rollIndex, rest } of throws) {
        for (const [die, box] of faceBoxes(rest, canvas).entries()) {
          sizes.push(box.size)
          const where = `${seed} roll ${rollIndex} die ${die}`
          if (box.left < 0 || box.top < 0 || box.right > canvas.width || box.bottom > canvas.height)
            misses.push(`${where}: off the canvas`)
          for (const zone of zones) {
            if (overlaps(box, zone)) misses.push(`${where}: under an overlay zone`)
          }
        }
      }
      expect(misses).toStrictEqual([])
      // Readable: the median face reads at least 18 px (about 30 px on the 358 px desktop
      // canvas). Dice at opposite walls must share one view, so the smallest faces are a fraction
      // of that, but never off the canvas or under an overlay.
      sizes.sort((a, b) => a - b)
      expect(sizes[Math.floor(sizes.length / 2)]).toBeGreaterThan(18)
    })
  }
})

describe('the camera module', () => {
  it('projects exactly as three does, for the throw shot and a read framing', () => {
    const size = CANVASES[1] ?? { width: 298, height: 186.25 }
    const rest = restShowing({ d1: 6, d2: 2 })
    for (const pose of [THROW_SHOT, readFraming([rest[0].pose, rest[1].pose], size)]) {
      const camera = threeCamera(pose, size)
      for (const point of [
        [0, 0, 0],
        [3, 1, -2],
        [-6, 0.5, 5],
        [1.5, 7, 0.25],
      ] as Vec3[]) {
        const [x, y] = projectPoint(pose, size, point)
        const [tx, ty] = onCanvas(camera, size, point)
        expect(Math.abs(x - tx)).toBeLessThan(1e-6)
        expect(Math.abs(y - ty)).toBeLessThan(1e-6)
      }
    }
  })

  it('keeps the camera outside the glass and no closer than the zoom cap', () => {
    const size = CANVASES[1] ?? { width: 298, height: 186.25 }
    for (const { rest } of throws.slice(0, 200)) {
      const pose = readFraming([rest[0].pose, rest[1].pose], size)
      expect(Math.hypot(...pose.position)).toBeGreaterThanOrEqual(CAMERA_MIN_RADIUS - 1e-9)
      // The dice's centres, on average, at least the zoom cap in front of the camera.
      const depths = rest.map(({ pose: body }) => projectPoint(pose, size, body.p)[2])
      const mean = depths.reduce((sum, depth) => sum + depth, 0) / depths.length
      expect(mean).toBeGreaterThanOrEqual(READ_MIN_DISTANCE - 1e-6)
    }
  })

  it('reserves the puck and the callout row, and leaves the rest', () => {
    const size = { width: 298, height: 186.25 }
    const zones = reservedZones(size)
    expect(zones).toHaveLength(2)
    for (const area of safeAreas(size)) {
      for (const zone of zones) expect(overlaps(area, zone)).toBe(false)
      expect(area.left).toBeGreaterThanOrEqual(0)
      expect(area.top).toBeGreaterThanOrEqual(0)
      expect(area.right).toBeLessThanOrEqual(size.width)
      expect(area.bottom - area.top).toBeGreaterThan(70)
    }
  })

  it('throws the dice wide and reads them up close', () => {
    const size = CANVASES[1] ?? { width: 298, height: 186.25 }
    const rest = restShowing({ d1: 1, d2: 5 })
    const read = readFraming([rest[0].pose, rest[1].pose], size)
    // How many pixels one die edge spans where the dice lie.
    const [x, , z] = rest[0].pose.p
    const spread = (pose: CameraPose) => {
      const [a] = projectPoint(pose, size, [x - 0.5, 1, z])
      const [b] = projectPoint(pose, size, [x + 0.5, 1, z])
      return b - a
    }
    expect(spread(read)).toBeGreaterThan(spread(THROW_SHOT) * 1.25)
  })
})
