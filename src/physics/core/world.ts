/**
 * The Rapier scene for one throw: a felt floor, the acrylic dome and two dice. Each throw gets a
 * fresh World, so nothing carries over between throws and a recording depends only on its inputs.
 */
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import type { RigidBody, World } from '@dimforge/rapier3d-deterministic-compat'
import type { DomeParams, PhysicsParams } from './params.ts'
import { normalize } from './quat.ts'
import type { DicePoses, Pose } from './restPose.ts'

let loading: Promise<void> | undefined
let ready = false

/** Loads Rapier's WebAssembly. Await it once before simulating; later calls share the promise. */
export function initPhysics(): Promise<void> {
  loading ??= RAPIER.init().then(() => {
    ready = true
  })
  return loading
}

export interface Scene {
  readonly world: World
  readonly dice: readonly [RigidBody, RigidBody]
}

/** Builds a world with the dice at `start`. The caller must free it with `scene.world.free()`. */
export function createScene(start: DicePoses, params: PhysicsParams): Scene {
  if (!ready) throw new Error('Rapier is not initialised: await initPhysics() first')
  const world = new RAPIER.World({ x: 0, y: params.gravity, z: 0 })
  world.timestep = params.timestep
  world.numSolverIterations = params.solverIterations

  const { floor, dome, die } = params
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(floor.thickness / 2, floor.radius)
      .setTranslation(0, -floor.thickness / 2, 0)
      .setFriction(floor.friction)
      .setRestitution(floor.restitution),
  )
  const mesh = domeMesh(dome)
  // FIX_INTERNAL_EDGES stops dice catching on the seams between the dome's triangles.
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(dome.friction)
      .setRestitution(dome.restitution),
  )

  const createDie = (pose: Pose): RigidBody => {
    const q = normalize(pose.q) // Rapier keeps whatever quaternion it is given
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pose.p[0], pose.p[1], pose.p[2])
        .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
        .setLinearDamping(die.linearDamping)
        .setAngularDamping(die.angularDamping)
        .setCcdEnabled(true),
    )
    const h = die.halfExtent
    world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(h, h, h, die.borderRadius)
        .setFriction(die.friction)
        .setRestitution(die.restitution),
      body,
    )
    return body
  }
  return { world, dice: [createDie(start[0]), createDie(start[1])] }
}

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
