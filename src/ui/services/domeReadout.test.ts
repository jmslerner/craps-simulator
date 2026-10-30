import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Vector3,
  type Texture,
} from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDiceDome, type DomeInspection } from '../../dome/domeController.ts'
import { createPhysicsClient } from '../../dome/physicsClient.ts'
import { makeRoll } from '../../engine/index.ts'
import { createDice2D } from '../dice2d/diceController.ts'
import { createGameStore } from '../state/gameStore.ts'
import {
  countPips,
  installTestHooks,
  readDome,
  registerDome,
  type InstallTarget,
} from './testHooks.ts'

/**
 * The 3D readout (plan §6 test hooks; M10 audit MINOR-2) over real three objects: it finds the
 * geometry group facing up through the mesh's world matrix, counts the pips painted on that
 * group's texture — whatever face the material was made for, so it checks the remap tables rather
 * than repeating them — and projects the face's corners with the camera's own matrices.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

const SIZE = 64
const CREAM: readonly number[] = [251, 247, 236, 255]
const RED: readonly number[] = [201, 48, 60, 255]

/** RGBA pixels of a red face with `pips` cream squares of 12×12 px in a row, rimmed in red. */
function facePixels(pips: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) data.set(RED, 4 * i)
  for (let k = 0; k < pips; k++) {
    const left = 2 + (k % 3) * 20
    const top = 2 + Math.floor(k / 3) * 20
    for (let y = top; y < top + 12; y++) {
      for (let x = left; x < left + 12; x++) data.set(CREAM, 4 * (y * SIZE + x))
    }
  }
  return data
}

/** A canvas-like texture image whose 2D context hands back the painted pixels. */
function faceImage(pips: number) {
  const data = facePixels(pips)
  return {
    width: SIZE,
    height: SIZE,
    getContext: () => ({ getImageData: () => ({ data }) }),
  }
}

/** A die mesh like the dome's: a box whose material k carries a face of `faces[k]` pips. */
function dieMesh(faces: readonly number[]): Mesh {
  const materials = faces.map(
    (pips) => new MeshBasicMaterial({ map: { image: faceImage(pips) } as unknown as Texture }),
  )
  return new Mesh(new BoxGeometry(1, 1, 1), materials)
}

describe('countPips', () => {
  it('counts the cream blobs on a face, ignoring specks under the minimum area', () => {
    for (let pips = 1; pips <= 6; pips++) expect(countPips(facePixels(pips), SIZE, SIZE)).toBe(pips)
    const speck = facePixels(0)
    speck.set(CREAM, 4 * (10 * SIZE + 10))
    expect(countPips(speck, SIZE, SIZE)).toBe(0)
  })
})

describe('readDome', () => {
  const camera = new PerspectiveCamera(35, 1.6, 0.5, 80)
  camera.position.set(0, 6, 6)
  camera.lookAt(0, 0.5, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  const canvas = { clientWidth: 400, clientHeight: 250 }

  function domeShowing(meshes: readonly [Mesh, Mesh], still = true) {
    const dome = createDiceDome({
      fallback: createDice2D(),
      client: createPhysicsClient({ transport: () => new Promise(() => undefined) }),
      probe: () => true,
      documentLike: null,
      quality: { storage: null, device: 'medium', monitor: false },
    })
    const scene: DomeInspection = { dice: meshes, camera, canvas, still }
    dome.attach({ invalidate: () => undefined, inspect: () => scene })
    return dome
  }

  it('reads the pips on whichever group faces up, through the mesh’s rotation', () => {
    // Pip counts deliberately unlike any real die's layout: the readout must not assume one.
    const a = dieMesh([2, 5, 6, 1, 4, 3])
    const b = dieMesh([6, 6, 6, 6, 6, 6])
    a.position.set(-1, 0.5, 0)
    b.position.set(1.2, 0.5, 0.4)
    const dome = domeShowing([a, b])
    expect(readDome(dome)?.dice[0]).toMatchObject({ visible: true, face: 6 }) // +Y group (2)
    // −90° about x turns +Z (group 4) to the top.
    a.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
    const readout = readDome(dome)
    expect(readout?.dice[0].face).toBe(4)
    expect(readout?.dice[0].up).toBeCloseTo(1, 9)
    expect(readout?.dice[1].face).toBe(6)
    // A die leaning 30° still names its top group, with the lean in `up`.
    a.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 6))
    expect(readDome(dome)?.dice[0].face).toBe(4)
    expect(readDome(dome)?.dice[0].up).toBeLessThan(1)
  })

  it('projects the top face’s corners with the camera’s matrices, as three does', () => {
    const a = dieMesh([1, 2, 3, 4, 5, 6])
    const b = dieMesh([1, 2, 3, 4, 5, 6])
    a.position.set(0.3, 0.5, -0.8)
    b.position.set(-2, 0.5, 1)
    const readout = readDome(domeShowing([a, b]))
    expect(readout?.canvas).toStrictEqual({ width: 400, height: 250 })
    const corners = readout?.dice[0].corners ?? []
    expect(corners).toHaveLength(4)
    const expected = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ].map(([x = 0, z = 0]) => {
      const ndc = new Vector3(0.3 + x * 0.5, 1, -0.8 + z * 0.5).project(camera)
      return [((ndc.x + 1) / 2) * 400, ((1 - ndc.y) / 2) * 250]
    })
    // The same four points, in some order around the face.
    const key = (p: readonly number[]) => `${(p[0] ?? 0).toFixed(6)},${(p[1] ?? 0).toFixed(6)}`
    expect(new Set(corners.map(key))).toStrictEqual(new Set(expected.map(key)))
  })

  it('reports the dome’s state, which body shows d1, and hidden dice before the first roll', () => {
    const a = dieMesh([1, 2, 3, 4, 5, 6])
    const b = dieMesh([1, 2, 3, 4, 5, 6])
    a.visible = false
    b.visible = false
    const dome = domeShowing([a, b], false)
    expect(readDome(dome)).toMatchObject({ state: 'idle', still: false, d1Body: 0 })
    expect(readDome(dome)?.dice.map((die) => die.visible)).toStrictEqual([false, false])
    dome.view().showRest(makeRoll(4, 4))
    expect(readDome(dome)?.state).toBe('settled')
  })

  it('answers through window.__CRAPS_TEST__ once the App registers its dome; null without 3D', () => {
    vi.stubEnv('MODE', 'e2e')
    const target: InstallTarget = {}
    expect(installTestHooks(createGameStore(), target)).toBe(true)
    const dome = createDiceDome({
      fallback: createDice2D(),
      client: createPhysicsClient({ transport: () => new Promise(() => undefined) }),
      probe: () => true,
      documentLike: null,
      quality: { storage: null, device: 'medium', monitor: false },
    })
    registerDome(dome)
    // No renderer: nothing is drawn, so there is nothing to read.
    expect(target.__CRAPS_TEST__?.domeReadout()).toBeNull()
    dome.attach({
      invalidate: () => undefined,
      inspect: () => ({
        dice: [dieMesh([1, 1, 1, 1, 1, 1]), dieMesh([2, 2, 2, 2, 2, 2])],
        camera,
        canvas,
        still: true,
      }),
    })
    expect(target.__CRAPS_TEST__?.domeReadout()).toMatchObject({ still: true, state: 'idle' })
  })
})
