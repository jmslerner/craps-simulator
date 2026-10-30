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
 * `data-dice` shows.
 *
 * The quality tier (quality.ts) sets the pixel ratio, the glass (transmission or a plain shell),
 * the mesh detail and whether shadows are drawn, all live; MSAA is fixed at creation from the
 * tier the dome mounted on. A lost WebGL context (`webglcontextlost` on the canvas) is reported to
 * the controller, which hands the slot back to 2D; this view is then unmounted and disposed.
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
      camera={{ fov: 35, near: 0.5, far: 80, position: [0, 5.8, 8.6] }}
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
        camera.lookAt(LOOK_AT)
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

/** Where the camera looks: just above the floor centre, where the dice land. */
const LOOK_AT = new Vector3(0, 0.3, 0)
const DOME_RADIUS = 7.5

function DiceScene({ controller, spec }: { controller: DiceDomeController; spec: TierSpec }) {
  const invalidate = useThree((state) => state.invalidate)
  const die0 = useRef<Mesh>(null)
  const die1 = useRef<Mesh>(null)
  const shadow0 = useRef<Mesh>(null)
  const shadow1 = useRef<Mesh>(null)

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

  useEffect(() => controller.attach({ invalidate: () => invalidate() }), [controller, invalidate])

  useFrame((state) => {
    const frame = controller.sample(performance.now())
    place(die0.current, shadow0.current, shadows[0], frame.poses[0])
    place(die1.current, shadow1.current, shadows[1], frame.poses[1])
    if (frame.playing) {
      state.invalidate()
      return
    }
    if (die0.current !== null && die1.current !== null) {
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
      <Glass transmission={spec.transmission} segments={dome} />
      <directionalLight position={[4, 12, 6]} intensity={0.6} />
      <ambientLight intensity={0.12} />
    </>
  )
}

/** The acrylic dome, drawn last and without depth writes so the dice read through it. */
function Glass({
  transmission,
  segments,
}: {
  transmission: boolean
  segments: readonly [number, number]
}) {
  return (
    <mesh renderOrder={10}>
      <sphereGeometry
        args={[DOME_RADIUS, segments[0], segments[1], 0, Math.PI * 2, 0, Math.PI / 2]}
      />
      {transmission ? (
        <meshPhysicalMaterial
          transmission={1}
          ior={1.49}
          roughness={0.02}
          thickness={0.3}
          depthWrite={false}
        />
      ) : (
        <meshStandardMaterial
          color="#bfe3ff"
          transparent
          opacity={0.13}
          roughness={0.05}
          metalness={0.3}
          depthWrite={false}
          envMapIntensity={1.2}
        />
      )}
    </mesh>
  )
}

/** Writes a drawn pose to a die and, when drawn, its blob shadow (fainter and wider the higher). */
function place(
  die: Mesh | null,
  shadow: Mesh | null,
  material: MeshBasicMaterial,
  pose: VisualPose,
): void {
  if (die === null) return
  die.position.set(pose.p[0], pose.p[1], pose.p[2])
  die.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3])
  if (shadow === null) return
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
