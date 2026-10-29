/**
 * The Rapier scene for one throw: a felt floor, the acrylic dome and two dice. Each throw gets a
 * fresh World, so nothing carries over between throws and a recording depends only on its inputs.
 */
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import type { RigidBody, World } from '@dimforge/rapier3d-deterministic-compat'
import { domeMesh } from './dome.ts'
import { DEFAULT_PARAMS, type PhysicsParams } from './params.ts'
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
export function createScene(start: DicePoses, params: PhysicsParams = DEFAULT_PARAMS): Scene {
  if (!ready) throw new Error('Rapier is not initialised: await initPhysics() first')
  const world = new RAPIER.World({ x: 0, y: params.gravity, z: 0 })
  world.timestep = params.timestep
  world.numSolverIterations = params.solverIterations
  const { contact } = params
  const integration = world.integrationParameters
  integration.contact_natural_frequency = contact.frequency
  integration.numInternalPgsIterations = contact.pgsIterations
  integration.normalizedAllowedLinearError = contact.allowedError
  integration.maxCcdSubsteps = contact.ccdSubsteps

  const { floor, dome, die } = params
  // A box, not the cylinder of the plan: Rapier's cylinder contact let a die wedged against the
  // dome wall sink through the floor (107 of 864 wedge trials); a box has 0 such failures.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(floor.halfWidth, floor.thickness / 2, floor.halfWidth)
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
        .setCcdEnabled(true)
        .setSoftCcdPrediction(die.softCcd),
    )
    const h = die.halfExtent
    world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(h, h, h, die.borderRadius)
        .setContactSkin(contact.skin)
        .setFriction(die.friction)
        .setRestitution(die.restitution),
      body,
    )
    return body
  }
  return { world, dice: [createDie(start[0]), createDie(start[1])] }
}
