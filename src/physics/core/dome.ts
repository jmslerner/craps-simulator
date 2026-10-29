/**
 * The dome's geometry, shared by the Rapier scene and the gap measurements. The collider is a
 * trimesh, so its surface is made of flat chords that sit up to a sagitta inside the sphere of
 * `dome.radius`; anything that measures clearance from the dome must use these faces, not the
 * sphere. Pure: no Rapier, so validity and plan code can use it without initialising physics.
 */
import type { DomeParams } from './params.ts'

export interface Mesh {
  readonly vertices: Float32Array
  readonly indices: Uint32Array
}

const meshes = new WeakMap<DomeParams, Mesh>()

/**
 * The dome's inner surface: `rings` bands of `segments` quads from the floor up to a single pole
 * vertex. Triangles are wound so their normals face the dice, which FIX_INTERNAL_EDGES relies on.
 */
export function domeMesh(dome: DomeParams): Mesh {
  const cached = meshes.get(dome)
  if (cached) return cached
  const { radius, segments, rings } = dome
  const vertices: number[] = []
  for (let j = 0; j < rings; j++) {
    const elevation = (j / rings) * (Math.PI / 2)
    for (let i = 0; i < segments; i++) {
      const azimuth = (i / segments) * 2 * Math.PI
      vertices.push(
        radius * Math.cos(elevation) * Math.cos(azimuth),
        radius * Math.sin(elevation),
        radius * Math.cos(elevation) * Math.sin(azimuth),
      )
    }
  }
  vertices.push(0, radius, 0)
  const pole = rings * segments
  const at = (j: number, i: number) => j * segments + (i % segments)
  const indices: number[] = []
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      if (j === rings - 1) {
        indices.push(at(j, i), at(j, i + 1), pole)
      } else {
        indices.push(at(j, i), at(j, i + 1), at(j + 1, i))
        indices.push(at(j, i + 1), at(j + 1, i + 1), at(j + 1, i))
      }
    }
  }
  const mesh = { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) }
  meshes.set(dome, mesh)
  return mesh
}

/**
 * The dome's triangles as planes n·x = d with n the unit normal pointing out of the dome, so the
 * inside is n·x ≤ d. The mesh is convex (every vertex lies on the sphere), so a body inside it is
 * as far from the dome as from the nearest of these planes.
 */
export interface DomeFaces {
  /** [nx, ny, nz, d] per triangle, in the mesh's index order. */
  readonly planes: Float64Array
  readonly count: number
  /** The radius of the largest ball about the floor centre that the mesh contains: min d. */
  readonly inradius: number
  /** How far the chords sit inside the sphere at most: radius − inradius. */
  readonly maxSagitta: number
}

const faceCache = new WeakMap<DomeParams, DomeFaces>()

export function domeFaces(dome: DomeParams): DomeFaces {
  const cached = faceCache.get(dome)
  if (cached) return cached
  const { vertices, indices } = domeMesh(dome)
  const count = indices.length / 3
  const planes = new Float64Array(4 * count)
  const vertex = (k: number, axis: number) => vertices[3 * (indices[k] ?? 0) + axis] ?? Number.NaN
  let inradius = Infinity
  for (let t = 0; t < count; t++) {
    const [ax, ay, az] = [vertex(3 * t, 0), vertex(3 * t, 1), vertex(3 * t, 2)]
    const ux = vertex(3 * t + 1, 0) - ax
    const uy = vertex(3 * t + 1, 1) - ay
    const uz = vertex(3 * t + 1, 2) - az
    const vx = vertex(3 * t + 2, 0) - ax
    const vy = vertex(3 * t + 2, 1) - ay
    const vz = vertex(3 * t + 2, 2) - az
    // The winding makes u × v face the dice; the outward normal is its opposite.
    let nx = -(uy * vz - uz * vy)
    let ny = -(uz * vx - ux * vz)
    let nz = -(ux * vy - uy * vx)
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= length
    ny /= length
    nz /= length
    const d = nx * ax + ny * ay + nz * az
    planes.set([nx, ny, nz, d], 4 * t)
    inradius = Math.min(inradius, d)
  }
  const faces = { planes, count, inradius, maxSagitta: dome.radius - inradius }
  faceCache.set(dome, faces)
  return faces
}
