import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import { domeFaces, domeMesh } from './dome.ts'
import { circumradius, diceGap, domeGap, floorGap, insideDome, touching } from './gap.ts'
import { DEFAULT_PARAMS } from './params.ts'
import { createPrng, onSphere, type Prng } from './prng.ts'
import {
  conjugate,
  cross,
  dot3,
  fromAxisAngle,
  IDENTITY,
  length3,
  normalize,
  rotate,
  UP,
  type Quat,
  type Vec3,
} from './quat.ts'
import { TOUCH_DIE, TOUCH_DOME, TOUCH_FLOOR } from './recording.ts'
import type { Pose } from './restPose.ts'
import { initPhysics } from './world.ts'

const params = DEFAULT_PARAMS
const { die } = params
const h = die.halfExtent
const r = die.borderRadius
const deg = (d: number) => (d * Math.PI) / 180
const at = (p: Vec3, q: Quat = IDENTITY): Pose => ({ p, q })
const randomQ = (prng: Prng) => normalize(fromAxisAngle(onSphere(prng), prng.range(0, Math.PI)))

describe('floorGap', () => {
  it('is the height of the lowest point for a known height and tilt', () => {
    expect(floorGap(at([0.3, 0.6, -2]), die)).toBeCloseTo(0.1, 12)
    expect(floorGap(at([0, 0.45, 0]), die)).toBeCloseTo(-0.05, 12)
    // Tilted by θ about x, the lowest edge sits h·(cos θ + sin θ) + r below the centre.
    for (const tilt of [10, 30, 45, 80]) {
      const q = fromAxisAngle([1, 0, 0], deg(tilt))
      const reach = h * (Math.cos(deg(tilt)) + Math.sin(deg(tilt))) + r
      expect(floorGap(at([1, 0.8, 1], q), die)).toBeCloseTo(0.8 - reach, 12)
    }
    // Balanced on a corner, the body diagonal is vertical and the reach is the circumradius.
    const diagonal: Vec3 = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]
    const axis = cross(diagonal, UP)
    const corner = fromAxisAngle(
      [axis[0] / length3(axis), axis[1] / length3(axis), axis[2] / length3(axis)],
      Math.acos(dot3(diagonal, UP)),
    )
    expect(rotate(corner, diagonal)[1]).toBeCloseTo(1, 12)
    expect(floorGap(at([0, circumradius(die), 0], corner), die)).toBeCloseTo(0, 12)
  })

  it('takes stored, slightly non-unit quaternions as the rotation they mean', () => {
    const q = fromAxisAngle([0, 0, 1], deg(30))
    const scaled: Quat = [q[0] * 1.001, q[1] * 1.001, q[2] * 1.001, q[3] * 1.001]
    expect(floorGap(at([0, 0.7, 0], scaled), die)).toBeCloseTo(
      floorGap(at([0, 0.7, 0], q), die),
      12,
    )
  })
})

describe('diceGap', () => {
  it('is exact for faces, edges and corners that meet, apart or overlapping', () => {
    const gap = (p: Vec3, q: Quat = IDENTITY, qa: Quat = IDENTITY) =>
      diceGap(at([0, 1, 0], qa), at([p[0], 1 + p[1], p[2]], q), die)
    // Face to face along x.
    expect(gap([1.3, 0, 0])).toBeCloseTo(0.3, 12)
    expect(gap([1, 0, 0])).toBeCloseTo(0, 12)
    expect(gap([0.95, 0, 0])).toBeCloseTo(-0.05, 12)
    // Inner cubes overlapping by 0.34 along x: the rounded dice overlap by 0.5.
    expect(gap([0.5, 0, 0])).toBeCloseTo(-0.5, 12)
    // Corner to corner along the body diagonal.
    for (const d of [1.7, 1.6]) {
      const k = d / Math.sqrt(3)
      expect(gap([k, k, k])).toBeCloseTo(d - 2 * h * Math.sqrt(3) - 2 * r, 12)
    }
    // Edge to edge: both turned 45° about z, so their vertical edges point at each other.
    const turned = fromAxisAngle([0, 0, 1], deg(45))
    expect(gap([1.5, 0, 0], turned, turned)).toBeCloseTo(1.5 - 2 * h * Math.SQRT2 - 2 * r, 12)
  })

  it('matches an independent solver: alternating projections onto the two cubes', () => {
    const prng = createPrng(7)
    const project = (x: Vec3, c: Vec3, q: Quat): Vec3 => {
      const local = rotate(conjugate(q), [x[0] - c[0], x[1] - c[1], x[2] - c[2]])
      const w = rotate(q, local.map((u) => Math.max(-h, Math.min(h, u))) as unknown as Vec3)
      return [w[0] + c[0], w[1] + c[1], w[2] + c[2]]
    }
    let checked = 0
    while (checked < 40) {
      const a = at([0, 1, 0], randomQ(prng))
      const d = onSphere(prng)
      const length = prng.range(1.1, 1.7)
      const b = at([d[0] * length, 1 + d[1] * length, d[2] * length], randomQ(prng))
      const gap = diceGap(a, b, die)
      if (gap <= 0.01) continue
      checked++
      let x: Vec3 = a.p
      let y: Vec3 = b.p
      for (let k = 0; k < 4000; k++) {
        x = project(y, a.p, a.q)
        y = project(x, b.p, b.q)
      }
      const truth = Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) - 2 * r
      expect(gap).toBeCloseTo(truth, 7)
      expect(diceGap(b, a, die)).toBeCloseTo(gap, 12)
    }
  })

  it('answers at or above a cutoff with a lower bound that is at least the cutoff', () => {
    const prng = createPrng(8)
    for (let k = 0; k < 200; k++) {
      const a = at([0, 1, 0], randomQ(prng))
      const d = onSphere(prng)
      const length = prng.range(0.6, 4)
      const b = at([d[0] * length, 1 + d[1] * length, d[2] * length], randomQ(prng))
      const exact = diceGap(a, b, die)
      const quick = diceGap(a, b, die, 0.25)
      if (exact < 0.25) expect(quick).toBe(exact)
      else expect(quick >= 0.25 && quick <= exact + 1e-12).toBe(true)
    }
  })
})

describe('domeGap', () => {
  const { radius, segments, rings } = params.dome
  const { inradius, maxSagitta } = domeFaces(params.dome)

  it('measures the trimesh, whose chords sit up to 0.025 u inside the sphere', () => {
    expect(maxSagitta).toBeGreaterThan(0.02)
    expect(maxSagitta).toBeLessThan(0.03)
    expect(inradius).toBeCloseTo(radius - maxSagitta, 12)
  })

  it('is exact for a die squarely facing a column of wall faces', () => {
    // The quads between azimuth 0 and 360°/segments, ring by ring; face their middle squarely.
    const { vertices } = domeMesh(params.dome)
    const v = (i: number): Vec3 => [
      vertices[3 * i] ?? 0,
      vertices[3 * i + 1] ?? 0,
      vertices[3 * i + 2] ?? 0,
    ]
    const planes = Array.from({ length: rings - 1 }, (_, ring) => {
      const [a, b, c] = [v(ring * segments), v(ring * segments + 1), v((ring + 1) * segments)]
      const inward = cross(
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
      )
      const n: Vec3 = [-inward[0], -inward[1], -inward[2]].map(
        (x) => x / length3(inward),
      ) as unknown as Vec3
      return { n, d: dot3(n, a) }
    })
    const azimuth = Math.PI / segments
    const yaw = fromAxisAngle([0, 1, 0], -azimuth)
    for (const centre of [6.6, 6.8, 6.95]) {
      const p: Vec3 = [centre * Math.cos(azimuth), 0.5, centre * Math.sin(azimuth)]
      // Flat and turned to face the wall, its reach along a face's n is h·(|n_radial| + |n_y|) + r;
      // the die is 1 u tall, so the ring above the floor's can be the nearer face.
      const gaps = planes.map(
        ({ n, d }) => d - dot3(n, p) - h * (Math.hypot(n[0], n[2]) + Math.abs(n[1])) - r,
      )
      // Float32 vertices leave a quad's two triangles a hair off coplanar.
      expect(domeGap(at(p, yaw), params)).toBeCloseTo(Math.min(...gaps), 6)
    }
  })

  it('is never below the sphere bound that subtracts the largest sagitta', () => {
    const prng = createPrng(11)
    for (let k = 0; k < 300; k++) {
      const dir = onSphere(prng)
      const length = prng.range(0, 6.8)
      const p: Vec3 = [dir[0] * length, Math.max(Math.abs(dir[1]) * length, 0.5), dir[2] * length]
      const gap = domeGap(at(p, randomQ(prng)), params)
      expect(gap).toBeGreaterThanOrEqual(
        radius - maxSagitta - Math.hypot(...p) - circumradius(die) - 1e-12,
      )
    }
  })
})

describe('against Rapier', () => {
  beforeAll(() => initPhysics())

  // Rapier works in Float32, so it agrees to about 1e-4; the exact checks above are the reference.
  it("agrees on the floor and the dome to Rapier's Float32 precision", () => {
    const prng = createPrng(5)
    const shape = new RAPIER.RoundCuboid(h, h, h, r)
    const slab = new RAPIER.Cuboid(2, 0.5, 2)
    const mesh = domeMesh(params.dome)
    const dome = new RAPIER.TriMesh(
      mesh.vertices,
      mesh.indices,
      RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
    )
    const vec = (p: Vec3) => ({ x: p[0], y: p[1], z: p[2] })
    const rot = (q: Quat) => ({ x: q[0], y: q[1], z: q[2], w: q[3] })
    const still = { x: 0, y: 0, z: 0, w: 1 }
    let domes = 0
    for (let k = 0; k < 400; k++) {
      const q = randomQ(prng)
      const low: Vec3 = [prng.range(-1, 1), prng.range(0.55, 0.9), prng.range(-1, 1)]
      const floor = shape.contactShape(vec(low), rot(q), slab, { x: 0, y: -0.5, z: 0 }, still, 1)
      expect(floor?.distance).toBeCloseTo(floorGap(at(low, q), die), 3)
      const dir = onSphere(prng)
      const length = prng.range(6.4, 6.9)
      const wall: Vec3 = [
        dir[0] * length,
        Math.max(Math.abs(dir[1]) * length, 0.9),
        dir[2] * length,
      ]
      const gap = domeGap(at(wall, q), params)
      const contact = shape.contactShape(vec(wall), rot(q), dome, { x: 0, y: 0, z: 0 }, still, 1)
      if (contact === null || gap < 0.005) continue
      domes++
      expect(contact.distance).toBeCloseTo(gap, 3)
    }
    expect(domes).toBeGreaterThan(100)
  })
})

describe('touching and insideDome', () => {
  it('flag what each die is within touchGap of', () => {
    const flat = (p: Vec3) => at(p)
    expect(touching([flat([0, 0.5, 0]), flat([3, 0.5, 0])], params)).toBe(
      TOUCH_FLOOR | (TOUCH_FLOOR << 3),
    )
    expect(touching([flat([0, 2, 0]), flat([1.003, 2, 0])], params)).toBe(
      TOUCH_DIE | (TOUCH_DIE << 3),
    )
    expect(touching([flat([0, 2, 0]), flat([1.01, 2, 0])], params)).toBe(0)
    const wall = 7.5 - domeFaces(params.dome).maxSagitta - 0.5
    const atWall = touching(
      [flat([0, 2, 0]), at([0, 0.5, wall - 0.2], fromAxisAngle([0, 1, 0], 0))],
      params,
    )
    expect(atWall).toBe(TOUCH_FLOOR << 3)
    const pressed = touching([flat([0, 2, 0]), flat([0, 0.5, wall + 0.05])], params)
    expect(pressed).toBe((TOUCH_FLOOR | TOUCH_DOME) << 3)
  })

  it('tell a centre inside the dome from one past the floor or the mesh', () => {
    expect(insideDome([0, 0.5, 0], params)).toBe(true)
    expect(insideDome([0, -0.01, 0], params)).toBe(false)
    expect(insideDome([7.45, 0.3, 0], params)).toBe(true)
    expect(insideDome([7.49, 0.3, 0], params)).toBe(false)
    expect(insideDome([0, 7.49, 0], params)).toBe(true)
    expect(insideDome([0, 7.51, 0], params)).toBe(false)
    expect(insideDome([0, Number.NaN, 0], params)).toBe(false)
  })
})
