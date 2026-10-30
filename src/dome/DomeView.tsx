import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MeshBasicMaterial,
  PMREMGenerator,
  Quaternion,
  Vector3,
  WebGLRenderer,
  type Mesh,
  type Texture,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { useStore } from 'zustand'
import { AXIS_FACE, nearestAxis, type DieFace } from '../physics/core/cube.ts'
import { DOME_FAR, DOME_FOV, DOME_NEAR, placeCamera, THROW_SHOT } from './camera.ts'
import type { DiceDomeController } from './domeController.ts'
import type { VisualPose } from './playback.ts'
import { TIERS, type TierSpec } from './quality.ts'
import { createDieMaterials, disposeMaterials, feltTexture, shadowTexture } from './scene.ts'
import { webglOptions } from './webgl.ts'

/**
 * The dome's renderer (plan §7 Rendering, Playback, Quality): the lazy chunk with three and R3F. A
 * demand frameloop draws only when asked — once at rest, every frame while a throw plays — and the
 * frame loop writes matrices straight to the meshes from `controller.sample`, never React state.
 * The scene is the station view of a bubble machine: felt, a brass ring, two red dice under a
 * glass dome lit by `RoomEnvironment` (no network), with blob shadows. The die mesh is a
 * `RoundedBoxGeometry` whose six material groups carry the pip faces in `AXIS_FACE` order, so the
 * drawn pips are the faces the remap arithmetic names. After each drawn frame at rest the loop
 * reads the face on top of each mesh from its world quaternion and reports it: that is what
 * `data-dice` shows. The camera is the controller's (camera.ts): each frame places three's camera
 * at the pose it samples for this canvas's size — wide for the throw, the read framing at rest —
 * and the dice are not drawn while the dome is idle (no roll yet). The renderer also shows the
 * controller its meshes, camera and canvas (`inspect`), which only the e2e readout reads.
 *
 * The quality tier (quality.ts) sets the pixel ratio, the mesh detail and whether shadows are
 * drawn, all live; MSAA is fixed at creation from the tier the dome mounted on. The glass is the
 * same thin, faint shell at every tier: its reflections stay dim, so no glare sits on the dice
 * the camera reads through it. A lost WebGL context (`webglcontextlost` on the canvas) is
 * reported to the controller, which hands the slot back to 2D; this view is then unmounted and
 * disposed.
 */

export default function DomeView({ controller }: { controller: DiceDomeController }) {
  const tier = useStore(controller.quality, (quality) => quality.tier)
  const spec = TIERS[tier]
  // Fixed at creation: the context attributes and MSAA, from the tier the dome mounted on.
  const [created] = useState(() => ({ ...webglOptions(), antialias: TIERS[tier].antialias }))
  // Image-based lighting from a generated room (no texture to fetch), owned here for disposal.
  const environment = useRef<Texture | null>(null)
  const unlisten = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      environment.current?.dispose()
      environment.current = null
      unlisten.current?.()
      unlisten.current = null
    },
    [],
  )
  return (
    <Canvas
      className="dome-canvas"
      frameloop="demand"
      dpr={created.preserveDrawingBuffer ? 1 : spec.dpr}
      camera={{ fov: DOME_FOV, near: DOME_NEAR, far: DOME_FAR, position: THROW_SHOT.position }}
      gl={(props) =>
        new WebGLRenderer({
          ...props,
          alpha: true,
          antialias: created.antialias,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: created.failIfMajorPerformanceCaveat,
          preserveDrawingBuffer: created.preserveDrawingBuffer,
        })
      }
      onCreated={({ gl, scene, camera, invalidate }) => {
        const pmrem = new PMREMGenerator(gl)
        const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
        pmrem.dispose()
        environment.current?.dispose()
        environment.current = texture
        scene.environment = texture
        placeCamera(camera, THROW_SHOT)
        // three keeps drawing nothing on a lost context; the dome goes back to 2D instead.
        const canvas = gl.domElement
        const onLost = (): void => controller.contextLost()
        canvas.addEventListener('webglcontextlost', onLost)
        unlisten.current?.()
        unlisten.current = () => canvas.removeEventListener('webglcontextlost', onLost)
        invalidate()
      }}
    >
      <DiceScene controller={controller} spec={spec} />
    </Canvas>
  )
}

const DOME_RADIUS = 7.5

function DiceScene({ controller, spec }: { controller: DiceDomeController; spec: TierSpec }) {
  const invalidate = useThree((state) => state.invalidate)
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  const die0 = useRef<Mesh>(null)
  const die1 = useRef<Mesh>(null)
  const shadow0 = useRef<Mesh>(null)
  const shadow1 = useRef<Mesh>(null)
  /** What the last frame drew: the controller's scene version, and whether anything moved. */
  const drawn = useRef({ version: -1, playing: true })

  const dieSegments = spec.segments.die
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, dieSegments, 0.08), [dieSegments])
  const materials = useMemo(() => createDieMaterials(), [])
  const shadows = useMemo(
    () =>
      [0, 1].map(
        () =>
          new MeshBasicMaterial({
            map: shadowTexture(),
            transparent: true,
            depthWrite: false,
            opacity: 0.5,
          }),
      ) as [MeshBasicMaterial, MeshBasicMaterial],
    [],
  )
  const felt = useMemo(() => feltTexture(), [])
  const scratch = useMemo(() => ({ q: new Quaternion(), v: new Vector3() }), [])

  // A tier change replaces the die geometry; the old one is freed on its own.
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(
    () => () => {
      disposeMaterials(materials)
      disposeMaterials(shadows)
      felt.dispose()
    },
    [materials, shadows, felt],
  )

  useEffect(
    () =>
      controller.attach({
        invalidate: () => invalidate(),
        inspect: () =>
          die0.current === null || die1.current === null
            ? null
            : {
                dice: [die0.current, die1.current],
                camera,
                canvas,
                // At rest, and the frame drew the scene the controller holds now.
                still: !drawn.current.playing && drawn.current.version === controller.version,
              },
      }),
    [controller, invalidate, camera, canvas],
  )

  useFrame((state) => {
    const frame = controller.sample(performance.now(), state.size)
    placeCamera(state.camera, frame.camera)
    place(die0.current, shadow0.current, shadows[0], frame.poses[0], frame.visible)
    place(die1.current, shadow1.current, shadows[1], frame.poses[1], frame.visible)
    drawn.current = { version: frame.version, playing: frame.playing }
    if (frame.playing) {
      state.invalidate()
      return
    }
    if (frame.visible && die0.current !== null && die1.current !== null) {
      controller.reportFaces([
        topFace(die0.current.quaternion, scratch),
        topFace(die1.current.quaternion, scratch),
      ])
    }
  })

  const { dome, ring, felt: feltSegments } = spec.segments
  return (
    <>
      <mesh ref={die0} geometry={geometry} material={materials} />
      <mesh ref={die1} geometry={geometry} material={materials} />
      {spec.shadows && (
        <>
          <mesh ref={shadow0} material={shadows[0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.7, 1.7]} />
          </mesh>
          <mesh ref={shadow1} material={shadows[1]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.7, 1.7]} />
          </mesh>
        </>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <circleGeometry args={[DOME_RADIUS + 0.45, feltSegments]} />
        <meshStandardMaterial map={felt} roughness={0.95} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <torusGeometry args={[DOME_RADIUS + 0.25, 0.3, ring[0], ring[1]]} />
        <meshStandardMaterial color="#d8b25c" metalness={1} roughness={0.28} />
      </mesh>
      <Glass segments={dome} />
      <directionalLight position={[4, 12, 6]} intensity={0.6} />
      <ambientLight intensity={0.12} />
    </>
  )
}

/**
 * The acrylic dome, drawn last and without depth writes so the dice read through it: a faint
 * tint whose environment reflections are scaled down with its opacity, so the room's lights
 * show as a soft sheen on the shell, never a white patch over a die.
 */
function Glass({ segments }: { segments: readonly [number, number] }) {
  return (
    <mesh renderOrder={10}>
      <sphereGeometry
        args={[DOME_RADIUS, segments[0], segments[1], 0, Math.PI * 2, 0, Math.PI / 2]}
      />
      <meshStandardMaterial
        color="#bfe3ff"
        transparent
        opacity={0.13}
        roughness={0.05}
        metalness={0.3}
        depthWrite={false}
        envMapIntensity={1.2}
      />
    </mesh>
  )
}

/**
 * Writes a drawn pose to a die and, when drawn, its blob shadow (fainter and wider the higher);
 * both are hidden while the dome is idle.
 */
function place(
  die: Mesh | null,
  shadow: Mesh | null,
  material: MeshBasicMaterial,
  pose: VisualPose,
  visible: boolean,
): void {
  if (die === null) return
  die.visible = visible
  die.position.set(pose.p[0], pose.p[1], pose.p[2])
  die.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3])
  if (shadow === null) return
  shadow.visible = visible
  const height = Math.max(0, pose.p[1] - 0.5)
  shadow.position.set(pose.p[0], 0.004, pose.p[2])
  const spread = 1 + 0.12 * height
  shadow.scale.set(spread, spread, 1)
  material.opacity = Math.max(0.08, 0.55 - 0.09 * height)
}

/** The face on top of a drawn die: its local axis nearest world up, as `FACE_NORMALS` names it. */
function topFace(q: Quaternion, scratch: { q: Quaternion; v: Vector3 }): DieFace {
  scratch.q.copy(q).invert()
  scratch.v.set(0, 1, 0).applyQuaternion(scratch.q)
  return AXIS_FACE[nearestAxis([scratch.v.x, scratch.v.y, scratch.v.z])] ?? 1
}
