import { CanvasTexture, MeshStandardMaterial, SRGBColorSpace, type Material } from 'three'
import { AXIS_FACE, type DieFace } from '../physics/core/cube.ts'

/**
 * The dome's drawn surfaces (plan §7 Rendering), all painted to canvases at run time so nothing is
 * fetched: the six pip faces of a die, the blob shadow under each die and the felt. The pip
 * textures are listed in BoxGeometry's group order — +X, −X, +Y, −Y, +Z, −Z — which is
 * `AXIS_FACE`, so the mesh shows exactly the faces `FACE_NORMALS` names (3 on +X, 1 on +Y, 2 on
 * +Z, and 4, 6, 5 opposite): the remap's face arithmetic and the drawn pips agree by construction.
 * This module lives in the lazy dome chunk: it imports three.
 */

export const DIE_RED = '#c9303c'
export const DIE_RED_EDGE = '#a4252f'
export const PIP_CREAM = '#fbf7ec'

/** Pip positions on a 3×3 grid, by face. */
const PIPS: Readonly<Record<DieFace, readonly (readonly [number, number])[]>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 1],
    [0, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
}

function canvas2d(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D canvas unavailable')
  return [canvas, context]
}

/** One pip face: a red field with cream pips, slightly darker towards the rounded edges. */
export function pipCanvas(face: DieFace, size = 256): HTMLCanvasElement {
  const [canvas, ctx] = canvas2d(size)
  const field = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.15,
    size / 2,
    size / 2,
    size * 0.75,
  )
  field.addColorStop(0, DIE_RED)
  field.addColorStop(1, DIE_RED_EDGE)
  ctx.fillStyle = field
  ctx.fillRect(0, 0, size, size)
  const radius = size * 0.085
  const slot = (index: number) => size * (0.22 + 0.28 * index)
  ctx.fillStyle = PIP_CREAM
  for (const [column, row] of PIPS[face]) {
    ctx.beginPath()
    ctx.arc(slot(column), slot(row), radius, 0, Math.PI * 2)
    ctx.fill()
    // A shaded rim gives the pip its dish.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)'
    ctx.lineWidth = size * 0.012
    ctx.stroke()
  }
  return canvas
}

export function pipTexture(face: DieFace, size = 256): CanvasTexture {
  const texture = new CanvasTexture(pipCanvas(face, size))
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** A die's materials in mesh group order, so group k shows face `AXIS_FACE[k]`. */
export function createDieMaterials(): MeshStandardMaterial[] {
  return AXIS_FACE.map(
    (face) =>
      new MeshStandardMaterial({
        map: pipTexture(face),
        roughness: 0.32,
        metalness: 0.04,
        envMapIntensity: 0.9,
      }),
  )
}

/** A soft dark disc that fades out: the blob shadow under a die. */
export function shadowTexture(size = 128): CanvasTexture {
  const [canvas, ctx] = canvas2d(size)
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.85)')
  gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.35)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** The felt under the dome: a deep green that darkens towards the rim, with a faint weave. */
export function feltTexture(size = 512): CanvasTexture {
  const [canvas, ctx] = canvas2d(size)
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, '#13704f')
  gradient.addColorStop(0.7, '#0e5a40')
  gradient.addColorStop(1, '#093b2a')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)'
  ctx.lineWidth = 1
  for (let k = 0; k < size; k += 6) {
    ctx.beginPath()
    ctx.moveTo(k, 0)
    ctx.lineTo(k, size)
    ctx.moveTo(0, k)
    ctx.lineTo(size, k)
    ctx.stroke()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Frees materials and the textures they own. */
export function disposeMaterials(materials: readonly Material[]): void {
  for (const material of materials) {
    const map = (material as { map?: { dispose(): void } | null }).map
    map?.dispose()
    material.dispose()
  }
}
