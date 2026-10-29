import { describe, expect, it } from 'vitest'
import { domeFaces, domeMesh } from './dome.ts'
import { DEFAULT_PARAMS } from './params.ts'
import { cross, dot3, length3, type Vec3 } from './quat.ts'

const { radius, segments, rings } = DEFAULT_PARAMS.dome
const mesh = domeMesh(DEFAULT_PARAMS.dome)
const vertex = (i: number): Vec3 => [
  mesh.vertices[3 * i] ?? Number.NaN,
  mesh.vertices[3 * i + 1] ?? Number.NaN,
  mesh.vertices[3 * i + 2] ?? Number.NaN,
]
const vertexCount = mesh.vertices.length / 3
const triangles = Array.from({ length: mesh.indices.length / 3 }, (_, t) =>
  [0, 1, 2].map((k) => vertex(mesh.indices[3 * t + k] ?? -1)),
)

describe('domeMesh', () => {
  it('is a 48 × 16 hemisphere: 769 vertices on the inner radius, 1488 triangles', () => {
    expect(vertexCount).toBe(segments * rings + 1)
    expect(triangles).toHaveLength(segments * (2 * rings - 1))
    for (let i = 0; i < vertexCount; i++) {
      expect(length3(vertex(i))).toBeCloseTo(radius, 5)
      expect(vertex(i)[1]).toBeGreaterThanOrEqual(0)
    }
  })

  it('winds every triangle to face the dice, which FIX_INTERNAL_EDGES relies on', () => {
    let area = 0
    for (const [a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0]] of triangles) {
      const normal = cross(
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
      )
      const centroid: Vec3 = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ]
      expect(dot3(normal, centroid)).toBeLessThan(0)
      area += length3(normal) / 2
    }
    // Chords sit just inside the sphere, so the area is a little under 2πR².
    expect(area / (2 * Math.PI * radius ** 2)).toBeGreaterThan(0.99)
    expect(area / (2 * Math.PI * radius ** 2)).toBeLessThan(1)
  })

  it('is built once per dome', () => {
    expect(domeMesh(DEFAULT_PARAMS.dome)).toBe(mesh)
  })
})

describe('domeFaces', () => {
  const faces = domeFaces(DEFAULT_PARAMS.dome)
  const plane = (t: number) => {
    const at = (k: number) => faces.planes[4 * t + k] ?? Number.NaN
    return { n: [at(0), at(1), at(2)] as const, d: at(3) }
  }

  it('gives each triangle its unit outward normal and offset', () => {
    expect(faces.count).toBe(triangles.length)
    triangles.forEach((corners, t) => {
      const { n, d } = plane(t)
      expect(length3(n)).toBeCloseTo(1, 12)
      for (const corner of corners) expect(dot3(n, corner)).toBeCloseTo(d, 5)
      // Outward: the floor centre, inside the dome, is on the inner side.
      expect(d).toBeGreaterThan(0)
    })
  })

  it('is convex, so the nearest face plane is the nearest face', () => {
    for (let t = 0; t < faces.count; t++) {
      const { n, d } = plane(t)
      for (let i = 0; i < vertexCount; i++) expect(dot3(n, vertex(i))).toBeLessThanOrEqual(d + 1e-5)
    }
  })

  it('knows its inradius and largest sagitta, the most a chord sits inside the sphere', () => {
    let nearest = Infinity
    for (let t = 0; t < faces.count; t++) nearest = Math.min(nearest, plane(t).d)
    expect(faces.inradius).toBe(nearest)
    expect(faces.maxSagitta).toBeCloseTo(radius - nearest, 12)
    // The biggest quads are the rim's: 7.5° by 5.625°, so about R·(1 − cos 4.7°).
    expect(faces.maxSagitta).toBeCloseTo(radius * (1 - Math.cos((4.69 * Math.PI) / 180)), 3)
    expect(domeFaces(DEFAULT_PARAMS.dome)).toBe(faces)
  })
})
