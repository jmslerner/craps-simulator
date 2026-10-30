import type { StoreApi } from 'zustand/vanilla'
import {
  PRESETS,
  compileConfig,
  hashJson,
  isPresetId,
  makeRoll,
  parseDollars,
} from '../../engine/index.ts'
import type {
  Cents,
  Dice,
  MachineConfig,
  MachineConfigInput,
  PresetId,
  TableState,
} from '../../engine/index.ts'
import { zoneBadges } from '../../coach/badges.ts'
import { formatCoachNumber } from '../../coach/format.ts'
import type { Grade } from '../../coach/types.ts'
import type { GameState, ViewPhase } from '../state/gameStore.ts'
import type { SessionHead } from '../../persistence/sessionRepo.ts'
import { KEYS, safeGet } from '../../persistence/storage.ts'
import type { DiceMode } from '../../persistence/settings.ts'
import type { DiceDomeController } from '../../dome/domeController.ts'

/**
 * The e2e test hooks (plan §6): `window.__CRAPS_TEST__` and the boot URL parameters. They exist
 * only in `vite build --mode e2e` builds: the app loads this module through a dynamic import
 * guarded by a static `import.meta.env.MODE === 'e2e'` check, so production builds contain none of
 * it (`scripts/check-bundle.ts` asserts the absence). `installTestHooks` additionally refuses to
 * install outside that mode, as defence in depth.
 *
 * Scripted dice go only through the store's queue, which `beginRoll` plays through
 * `rollWindow(ws, cfg, dice)` — the one scripted-dice door the engine has.
 *
 * `domeReadout` reads the 3D dice as drawn, independently of the remap tables the dome draws them
 * with (plan §6 test hooks; M10 audit MINOR-2): for each die mesh it finds the geometry group whose
 * averaged normal, turned by the mesh's world matrix, points most nearly up, counts the pips
 * painted on that group's texture, and projects that face's corners with the scene camera's own
 * matrices — never `AXIS_FACE`. The App registers its dome here (`registerDome`) in e2e builds.
 */

export interface CrapsTestState {
  readonly phase: ViewPhase | null
  readonly bankroll: Cents | null
  readonly rollIndex: number | null
  readonly pendingActions: number
  readonly committedRolls: number
  readonly machineId: string | null
  readonly state: TableState | null
}

/** What the reload specs read from the stored `session:<id>:head` blob (plan §8). */
export interface StoredHeadProbe {
  readonly pendingReveal: boolean
  readonly windowCount: number
  readonly stateHash: string
}

/** What `analyze` answers for one zone: the badge text the coach must show, and its grade. */
export interface ZoneBadgeProbe {
  /** The formatted edge, exactly as the zone badge renders it. */
  readonly badge: string
  readonly grade: Grade
  /** The exact-unit stake, in cents, the badge's edge is priced at. */
  readonly amount: number
}

export interface CrapsTestApi {
  getState(): CrapsTestState
  /** `hashJson` of the session's table: what a reload must restore identically (plan §10 M8). */
  sessionHash(): string | null
  /** Queues scripted dice: `"1-1,3-3"` or `[[1, 1], [3, 3]]`. False when the text is junk. */
  queueDice(dice: string | readonly (readonly [number, number])[]): boolean
  /**
   * The stored session head's flags, straight from IndexedDB: how the reload specs wait for a
   * committed roll (`pendingReveal: true`, written before any animation) or a flushed betting
   * save, without sleeping. Null while nothing is stored.
   */
  storedHead(): Promise<StoredHeadProbe | null>
  /**
   * Recomputes a zone's coach badge on the main thread from the live session's config (plan §10
   * M9a): the e2e badge check reads each rendered `data-coach-badge` and this must equal it,
   * character for character. Null while no game is running or the spot has no badge.
   */
  analyze(typeId: string, number?: number | null): ZoneBadgeProbe | null
  /** The 3D dice as drawn (see the module comment); null while no 3D renderer is live. */
  domeReadout(): DomeReadout | null
}

/** One drawn die, read off its mesh. */
export interface DieReadout {
  /** Whether the mesh is drawn at all (the dome draws no dice before the first roll). */
  readonly visible: boolean
  /** The pips painted on the face whose normal points most nearly up. */
  readonly face: number
  /** How nearly that face points up: the cosine of its normal's angle from world up. */
  readonly up: number
  /** That face's four corners on the canvas, CSS pixels from its top-left corner. */
  readonly corners: readonly (readonly [number, number])[]
}

/** The 3D dome as drawn: what the e2e checks against the engine and the overlays. */
export interface DomeReadout {
  readonly state: 'idle' | 'playing' | 'settled'
  /** The last frame drawn was at rest: no throw playing and the camera arrived. */
  readonly still: boolean
  /** The body (mesh) drawing the engine's d1. */
  readonly d1Body: 0 | 1
  /** The canvas in CSS pixels. */
  readonly canvas: { readonly width: number; readonly height: number }
  /** Both dice, in body order. */
  readonly dice: readonly [DieReadout, DieReadout]
}

declare global {
  interface Window {
    __CRAPS_TEST__?: CrapsTestApi
  }
}

/** What the boot reads from the URL (plan §6): `?seed=&preset=&dice=&script=1-1,3-3&bankroll=`. */
export interface TestBootParams {
  readonly seed: string | null
  readonly presetId: PresetId | null
  readonly diceMode: DiceMode | null
  readonly script: readonly Dice[] | null
  /** Dollars in the URL (`bankroll=600` or `600.50`), held as cents. */
  readonly bankroll: Cents | null
}

export function isE2EMode(): boolean {
  return import.meta.env.MODE === 'e2e'
}

/** `"1-1,3-3"` → dice pairs; null when any pair is not two faces 1–6. */
export function parseDiceScript(text: string): readonly Dice[] | null {
  const parts = text.split(',').filter((part) => part.length > 0)
  if (parts.length === 0) return null
  const dice: Dice[] = []
  for (const part of parts) {
    const match = /^([1-6])-([1-6])$/.exec(part.trim())
    if (match === null) return null
    dice.push(makeRoll(Number(match[1]), Number(match[2])))
  }
  return dice
}

/** The boot parameters in `search` (a `location.search` string); junk fields come back null. */
export function readTestParams(search: string): TestBootParams {
  const params = new URLSearchParams(search)
  const seed = params.get('seed')
  const preset = params.get('preset')
  const dice = params.get('dice')
  const script = params.get('script')
  const bankroll = params.get('bankroll')
  let parsedBankroll: Cents | null = null
  if (bankroll !== null) {
    try {
      parsedBankroll = parseDollars(bankroll)
    } catch {
      parsedBankroll = null
    }
  }
  return {
    seed: seed !== null && seed.length > 0 ? seed : null,
    presetId: preset !== null && isPresetId(preset) ? preset : null,
    diceMode: dice === 'instant' || dice === '2d' || dice === '3d' ? dice : null,
    script: script === null ? null : parseDiceScript(script),
    bankroll: parsedBankroll,
  }
}

export interface InstallTarget {
  __CRAPS_TEST__?: CrapsTestApi
}

/**
 * Installs `window.__CRAPS_TEST__` over the store. Returns false (and installs nothing) outside
 * e2e mode or without a window-like target.
 */
export function installTestHooks(
  store: StoreApi<GameState>,
  target: InstallTarget | null = typeof window === 'undefined' ? null : window,
): boolean {
  if (!isE2EMode() || target === null) return false
  const api: CrapsTestApi = {
    getState: () => {
      const { session, view } = store.getState()
      return {
        phase: view?.phase ?? null,
        bankroll: session?.state.ledger.bankroll ?? null,
        rollIndex: session?.state.round.rollIndex ?? null,
        pendingActions: session?.pending.length ?? 0,
        committedRolls: session?.committed.length ?? 0,
        machineId: session?.header.config.id ?? null,
        state: session?.state ?? null,
      }
    },
    sessionHash: () => {
      const { session } = store.getState()
      return session === null ? null : hashJson(session.state)
    },
    queueDice: (dice) => {
      const parsed = typeof dice === 'string' ? parseDiceScript(dice) : parsePairs(dice)
      if (parsed === null) return false
      store.getState().enqueueDice(parsed)
      return true
    },
    storedHead: async () => {
      const current = await safeGet<string>(KEYS.current)
      if (!current.ok || current.value === undefined) return null
      const head = await safeGet<SessionHead>(KEYS.head(current.value))
      if (!head.ok || head.value === undefined) return null
      const { pendingReveal, windowCount, stateHash } = head.value
      return { pendingReveal, windowCount, stateHash }
    },
    analyze: (typeId, number = null) => {
      const { cfg } = store.getState()
      return cfg === null ? null : analyzeZone(cfg, typeId, number)
    },
    domeReadout: () => (registeredDome === null ? null : readDome(registeredDome)),
  }
  target.__CRAPS_TEST__ = api
  return true
}

let registeredDome: DiceDomeController | null = null

/** The App's dome, for `domeReadout` (e2e builds only: the App calls this behind the mode check). */
export function registerDome(dome: DiceDomeController): void {
  registeredDome = dome
}

/** three's objects as the readout touches them; structural, so this module never imports three. */
interface MatrixLike {
  readonly elements: ArrayLike<number>
}

interface MeshLike {
  readonly visible: boolean
  readonly matrixWorld: MatrixLike
  updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void
  readonly geometry: {
    readonly groups: readonly {
      readonly start: number
      readonly count: number
      readonly materialIndex?: number
    }[]
    readonly index: { readonly array: ArrayLike<number> } | null
    readonly attributes: { readonly normal: { readonly array: ArrayLike<number> } }
  }
  readonly material: readonly { readonly map?: { readonly image?: unknown } | null }[]
}

interface ViewCameraLike {
  readonly matrixWorldInverse: MatrixLike
  readonly projectionMatrix: MatrixLike
}

interface CanvasElementLike {
  readonly clientWidth: number
  readonly clientHeight: number
}

interface PixelSource {
  readonly width: number
  readonly height: number
  getContext(type: '2d'): {
    getImageData(x: number, y: number, w: number, h: number): { readonly data: ArrayLike<number> }
  } | null
}

type Vec3 = readonly [number, number, number]

/** Reads the registered dome's drawn dice; null while no 3D renderer is live. */
export function readDome(dome: DiceDomeController): DomeReadout | null {
  const scene = dome.inspect()
  if (scene === null) return null
  const meshes = scene.dice as readonly [MeshLike, MeshLike]
  const camera = scene.camera as ViewCameraLike
  const canvas = scene.canvas as CanvasElementLike
  const size = { width: canvas.clientWidth, height: canvas.clientHeight }
  const { state, d1Body } = dome.store.getState()
  return {
    state,
    still: scene.still,
    d1Body,
    canvas: size,
    dice: [readDie(meshes[0], camera, size), readDie(meshes[1], camera, size)],
  }
}

/** Pip counts by texture, so each is counted once. */
const pipCache = new WeakMap<object, number>()

function readDie(
  mesh: MeshLike,
  camera: ViewCameraLike,
  size: { readonly width: number; readonly height: number },
): DieReadout {
  mesh.updateWorldMatrix(true, false)
  const m = mesh.matrixWorld.elements
  const turn = (v: Vec3): Vec3 => [
    (m[0] ?? 0) * v[0] + (m[4] ?? 0) * v[1] + (m[8] ?? 0) * v[2],
    (m[1] ?? 0) * v[0] + (m[5] ?? 0) * v[1] + (m[9] ?? 0) * v[2],
    (m[2] ?? 0) * v[0] + (m[6] ?? 0) * v[1] + (m[10] ?? 0) * v[2],
  ]
  const groups = groupNormals(mesh.geometry)
  let top = groups[0]
  let up = -Infinity
  for (const group of groups) {
    const world = turn(group.normal)
    const length = Math.hypot(world[0], world[1], world[2]) || 1
    if (world[1] / length > up) {
      up = world[1] / length
      top = group
    }
  }
  if (top === undefined) return { visible: mesh.visible, face: 0, up: 0, corners: [] }
  const image = mesh.material[top.materialIndex]?.map?.image
  const face = image === undefined ? 0 : pipsOn(image as PixelSource)
  // The face's corners in the mesh's frame: its centre half an edge out along the normal, and
  // half an edge along the two group normals that lie in its plane.
  const n = top.normal
  const inPlane = groups
    .map((group) => group.normal)
    .filter((normal) => Math.abs(normal[0] * n[0] + normal[1] * n[1] + normal[2] * n[2]) < 0.5)
  const u = inPlane[0] ?? [1, 0, 0]
  const v = inPlane.find(
    (normal) => Math.abs(normal[0] * u[0] + normal[1] * u[1] + normal[2] * u[2]) < 0.5,
  ) ?? [0, 0, 1]
  const corners = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([a = 0, b = 0]) => {
    const local: Vec3 = [
      0.5 * (n[0] + a * u[0] + b * v[0]),
      0.5 * (n[1] + a * u[1] + b * v[1]),
      0.5 * (n[2] + a * u[2] + b * v[2]),
    ]
    return toCanvas(camera, size, transform(m, local))
  })
  return { visible: mesh.visible, face, up, corners }
}

/** Each geometry group's material and its normals' average, unit length, in the mesh's frame. */
function groupNormals(
  geometry: MeshLike['geometry'],
): readonly { readonly materialIndex: number; readonly normal: Vec3 }[] {
  const normals = geometry.attributes.normal.array
  const index = geometry.index?.array ?? null
  return geometry.groups.map((group) => {
    let x = 0
    let y = 0
    let z = 0
    for (let k = group.start; k < group.start + group.count; k++) {
      const vertex = index === null ? k : (index[k] ?? 0)
      x += normals[3 * vertex] ?? 0
      y += normals[3 * vertex + 1] ?? 0
      z += normals[3 * vertex + 2] ?? 0
    }
    const length = Math.hypot(x, y, z) || 1
    return { materialIndex: group.materialIndex ?? 0, normal: [x / length, y / length, z / length] }
  })
}

/** A point through a column-major 4×4 matrix (w = 1). */
function transform(m: ArrayLike<number>, p: Vec3): Vec3 {
  const at = (k: number) => m[k] ?? 0
  return [
    at(0) * p[0] + at(4) * p[1] + at(8) * p[2] + at(12),
    at(1) * p[0] + at(5) * p[1] + at(9) * p[2] + at(13),
    at(2) * p[0] + at(6) * p[1] + at(10) * p[2] + at(14),
  ]
}

/** A world point on the canvas, CSS pixels, through the camera's view and projection matrices. */
function toCanvas(
  camera: ViewCameraLike,
  size: { readonly width: number; readonly height: number },
  world: Vec3,
): readonly [number, number] {
  const view = transform(camera.matrixWorldInverse.elements, world)
  const p = camera.projectionMatrix.elements
  const at = (k: number) => p[k] ?? 0
  const x = at(0) * view[0] + at(4) * view[1] + at(8) * view[2] + at(12)
  const y = at(1) * view[0] + at(5) * view[1] + at(9) * view[2] + at(13)
  const w = at(3) * view[0] + at(7) * view[1] + at(11) * view[2] + at(15)
  return [((x / w + 1) / 2) * size.width, ((1 - y / w) / 2) * size.height]
}

/** The pips painted on a face texture, counted once per texture. */
function pipsOn(image: PixelSource): number {
  const cached = pipCache.get(image)
  if (cached !== undefined) return cached
  const context = typeof image.getContext === 'function' ? image.getContext('2d') : null
  if (context === null) return 0
  const { data } = context.getImageData(0, 0, image.width, image.height)
  const count = countPips(data, image.width, image.height)
  pipCache.set(image, count)
  return count
}

/**
 * Cream pips on a die face's RGBA pixels: the 4-connected bright, unsaturated blobs of at least
 * `minArea` pixels (the red field and the pips' dark rims are never cream). Exported for its test.
 */
export function countPips(
  data: ArrayLike<number>,
  width: number,
  height: number,
  minArea = 100,
): number {
  const cream = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const r = data[4 * i] ?? 0
    const g = data[4 * i + 1] ?? 0
    const b = data[4 * i + 2] ?? 0
    cream[i] = r > 200 && g > 190 && b > 170 ? 1 : 0
  }
  let blobs = 0
  const stack: number[] = []
  for (let i = 0; i < width * height; i++) {
    if (cream[i] !== 1) continue
    let area = 0
    cream[i] = 2
    stack.push(i)
    while (stack.length > 0) {
      const p = stack.pop() ?? 0
      area++
      const x = p % width
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        p >= width ? p - width : -1,
        p < width * (height - 1) ? p + width : -1,
      ]
      for (const q of neighbours) {
        if (q >= 0 && cream[q] === 1) {
          cream[q] = 2
          stack.push(q)
        }
      }
    }
    if (area >= minArea) blobs++
  }
  return blobs
}

function parsePairs(pairs: readonly (readonly [number, number])[]): readonly Dice[] | null {
  try {
    return pairs.map(([d1, d2]) => makeRoll(d1, d2))
  } catch {
    return null
  }
}

/**
 * One zone's badge, recomputed from the config through the same coach pipeline the worker runs
 * (`zoneBadges` → `catalogRow`), so the e2e equality check pins the rendered text to the exact
 * solver's answer for this very config. Exported for its unit test; the api closes over the store.
 */
export function analyzeZone(
  cfg: MachineConfig,
  typeId: string,
  number: number | null,
): ZoneBadgeProbe | null {
  const badge =
    zoneBadges(cfg).find((b) => b.typeId === typeId && (b.number ?? null) === number) ?? null
  if (badge === null) return null
  return { badge: formatCoachNumber(badge.edge), grade: badge.grade, amount: badge.amount }
}

/**
 * The e2e machines (plan §10 M8; M4 → M8 hand-off): the preset with `/catalog/pass/afterWin`
 * pinned to `return`, so the §10 scripted run banks the winning pass and the bankroll reads
 * exactly $631.00 ($621 with the preset's own `stay`), plus the chosen buy-in, as in
 * `gameConfig`'s variants. Both pins are marked assumed in provenance. Compiled once per
 * (preset, buy-in) and cached, so the UI's per-config memos keep holding. This module exists
 * only in `--mode e2e` builds, so production machines are never pinned.
 */
const e2eMachines = new Map<string, MachineConfig>()

export function e2eMachine(presetId: PresetId, startingBankroll: Cents | null): MachineConfig {
  const key = `${presetId}:${startingBankroll ?? 'preset'}`
  const cached = e2eMachines.get(key)
  if (cached !== undefined) return cached
  const input = PRESETS[presetId]
  let variant: MachineConfigInput = input
  const pass = input.catalog['pass']
  if (pass !== undefined && pass.family === 'line' && pass.afterWin !== 'return') {
    variant = {
      ...variant,
      catalog: { ...variant.catalog, pass: { ...pass, afterWin: 'return' } },
      provenance: {
        ...variant.provenance,
        '/catalog/pass/afterWin': {
          status: 'assumed',
          note: 'e2e test preset: a winning pass returns, so the §10 run banks $631.',
        },
      },
    }
  }
  if (startingBankroll !== null && startingBankroll !== input.money.startingBankroll) {
    variant = {
      ...variant,
      money: { ...variant.money, startingBankroll },
      provenance: {
        ...variant.provenance,
        '/money/startingBankroll': {
          status: 'assumed',
          note: 'Player-chosen buy-in (New game); not a machine value.',
        },
      },
    }
  }
  const compiled = compileConfig(variant)
  e2eMachines.set(key, compiled)
  return compiled
}
