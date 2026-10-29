import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from './params.ts'
import { synthesizeRest } from './plan.ts'
import { posesOf } from './restPose.ts'
import { createScene, initPhysics } from './world.ts'

const start = posesOf(synthesizeRest(1, [1, 2]))

describe('before initPhysics', () => {
  // Runs first: the describe below initialises Rapier for the rest of the file.
  it('refuses to build a scene', () => {
    expect(() => createScene(start)).toThrow(/initPhysics/)
  })
})

describe('createScene', () => {
  beforeAll(() => initPhysics())

  it('shares one initialisation', () => {
    expect(initPhysics()).toBe(initPhysics())
  })

  it('builds a 480 Hz world with a floor, the dome and two CCD dice at their start poses', () => {
    const { world, dice } = createScene(start)
    try {
      expect(world.timestep).toBeCloseTo(1 / 480, 9)
      expect(world.numSolverIterations).toBe(8)
      expect(world.gravity.y).toBe(-516)
      const integration = world.integrationParameters
      const { contact } = DEFAULT_PARAMS
      expect(integration.numInternalPgsIterations).toBe(contact.pgsIterations)
      expect(integration.normalizedAllowedLinearError).toBeCloseTo(contact.allowedError, 9)
      expect(integration.maxCcdSubsteps).toBe(contact.ccdSubsteps)
      // The contact frequency has no getter; the stiffness Rapier derives from it rises with it.
      const softer = createScene(start, {
        ...DEFAULT_PARAMS,
        contact: { ...contact, frequency: 30 },
      })
      expect(integration.contact_erp).toBeGreaterThan(
        softer.world.integrationParameters.contact_erp,
      )
      softer.world.free()
      const shapes: number[] = []
      world.forEachCollider((collider) => shapes.push(collider.shapeType()))
      expect(shapes.sort((a, b) => a - b)).toEqual(
        [
          RAPIER.ShapeType.Cuboid,
          RAPIER.ShapeType.TriMesh,
          RAPIER.ShapeType.RoundCuboid,
          RAPIER.ShapeType.RoundCuboid,
        ].sort((a, b) => a - b),
      )
      dice.forEach((body, die) => {
        expect(body.isDynamic() && body.isCcdEnabled()).toBe(true)
        expect(body.softCcdPrediction()).toBeCloseTo(DEFAULT_PARAMS.die.softCcd, 6)
        expect(body.collider(0).contactSkin()).toBe(contact.skin)
        const p = body.translation()
        expect([p.x, p.y, p.z]).toEqual(start[die]?.p.map((x) => Math.fround(x)))
      })
    } finally {
      world.free()
    }
  })
})
