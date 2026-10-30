import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Dice } from '../engine/index.ts'
import type { DieFace } from '../physics/core/cube.ts'
import type { PlaybackPlan } from '../physics/core/plan.ts'
import type { RestState } from '../physics/core/restPose.ts'
import { TUMBLE, TUMBLE_FAST, type Dice2DController } from '../ui/dice2d/diceController.ts'
import type { DicePlayRequest, DiceView } from '../ui/services/rollFlow.ts'
import { readFraming, THROW_SHOT, type CameraPose, type CanvasSize } from './camera.ts'
import { createPhysicsClient, type PhysicsClient } from './physicsClient.ts'
import {
  cameraAt,
  createClock,
  LEAD_IN_MS,
  playbackMs,
  restPoses,
  sampleAt,
  SPEED,
  type PlaybackClock,
  type PlaybackSpeed,
  type VisualPose,
} from './playback.ts'
import {
  createFrameMonitor,
  createQualityStore,
  type QualityOptions,
  type QualityState,
} from './quality.ts'
import { facesOf, planThrow, restShowing, showsDice, type ThrowShown } from './throws.ts'
import { force3d, probeWebGL, webglOptions } from './webgl.ts'

/**
 * The 3D dome's state and its `DiceView` adapter (plan §6 roll flow, §7): the object the roll flow
 * drives, kept out of React so the frame loop writes no state per frame. The engine has decided
 * the dice before `play` is called; everything here is cosmetic and never blocks a reveal:
 *
 * - `play` takes the prefetched recording (waiting at most `takeTimeoutMs` for one in flight),
 *   plans it onto the engine's dice (`planThrow`: a worker recording, else the analytic hop, in
 *   handoff mode) and plays it through the renderer's frame loop. It settles — resolves — when
 *   the throw has come to rest and been read, when SKIP aborts the signal (jump to the end), when
 *   the page hides, when the WebGL context is lost, or when the watchdog fires because frames
 *   stopped coming. An already-aborted signal snaps to rest at once. Without a live renderer it
 *   rejects, and the roll flow's `showRest` reveals instead.
 * - `showRest` snaps the dice to a rest showing the engine's dice: the rest a finished plan left
 *   when it already shows them, fresh synthesised poses otherwise (restores, instant reveals). It
 *   is the one way every view reveals a roll — the App routes the 2D and instant views' reveals
 *   here too — so the dome always holds the last roll, whichever mode rolled it, and switching to
 *   3D shows it (M10 audit CRITICAL-1).
 * - Before the session's first roll, and after `reset` (a new game), the dome is idle: the dice
 *   are not drawn (`DomeFrame.visible`), so no stale or made-up result can be read; the first
 *   throw brings them in as it pops.
 * - The camera (camera.ts) shows the throw wide and the result up close: the frame carries its
 *   pose — the throw shot while idle, the read framing of the rest at rest (for the canvas size
 *   the renderer passes), and during a throw the eased moves between them (playback.ts).
 * - The 2D controller is the fallback: `view().mode` reads `'2d'` until a renderer is attached,
 *   so while the dome chunk loads, after WebGL fails or while its context is lost, the 2D tumble
 *   plays, and `showRest` keeps both views in step so either can be shown.
 * - `quality` is the tier the renderer draws at (quality.ts): the frame loop's `sample` feeds the
 *   frame-time monitor while a throw plays, and a slow median drops a tier.
 * - `contextLost` (the renderer's `webglcontextlost`) hands the slot back to 2D with a retry;
 *   `retry` probes WebGL again and, when it is back, the renderer re-attaches. `markUnavailable`
 *   is the one-way door for a renderer that cannot be created at all.
 *
 * Rests chain roll to roll: the plan's `rest` is the next throw's start, and the prefetch asks the
 * worker for exactly that pair (seed, rest). `data-dice` comes from `faces`: the faces the plan or
 * rest shows, overwritten by what the renderer reads off the meshes once they are drawn, listed
 * in the engine's order (`d1Body` says which body shows d1).
 */

export interface DomeSnapshot {
  readonly state: 'idle' | 'playing' | 'settled'
  /** What the dice show now, in body order; null while idle. */
  readonly faces: readonly [DieFace, DieFace] | null
  /** The body showing the engine's d1 (the other shows d2): the plan may swap them. */
  readonly d1Body: 0 | 1
  /** How the last rest was reached: a worker plan, the hop fallback, or a snap to rest. */
  readonly shown: ThrowShown | null
  /** How many dice (0–2) blend their face change over a handoff window in the last plan. */
  readonly handoff: number
  /** A finished throw for the next roll is held, so `play` will start at once. */
  readonly ready: boolean
  /** A 3D renderer is attached and drawing. */
  readonly live: boolean
  /** `lost` is a live dome whose WebGL context went away: 2D until `retry` brings it back. */
  readonly webgl: 'unknown' | 'ok' | 'unavailable' | 'lost'
}

export interface DomeFrame {
  /** The scene this frame draws (`DiceDomeController.version` when it was sampled). */
  readonly version: number
  readonly poses: readonly [VisualPose, VisualPose]
  /** False while idle (no roll yet): the dice are not drawn. */
  readonly visible: boolean
  /** Where the camera is, for the canvas size the renderer passed. */
  readonly camera: CameraPose
  /** True while a throw plays or the camera moves: the renderer must ask for another frame. */
  readonly playing: boolean
}

/**
 * What the renderer shows the e2e readout (ui/services/testHooks.ts): the drawn die meshes in
 * body order, three's camera and the canvas, as opaque objects, and whether the last frame drawn
 * was at rest.
 */
export interface DomeInspection {
  readonly dice: readonly [unknown, unknown]
  readonly camera: unknown
  readonly canvas: unknown
  readonly still: boolean
}

export interface DomeRenderer {
  /** Asks the renderer for a frame (R3F's `invalidate` under `frameloop="demand"`). */
  invalidate(): void
  /** The drawn scene, for the e2e readout; renderers that cannot show it leave it out. */
  inspect?(): DomeInspection | null
}

export interface DiceDomeController {
  readonly store: StoreApi<DomeSnapshot>
  /** The quality tier, its override and the monitor's verdicts (quality.ts). */
  readonly quality: StoreApi<QualityState>
  /** The 2D dice behind the dome: shown while the dome loads, and whenever WebGL fails. */
  readonly fallback: Dice2DController
  readonly client: PhysicsClient
  /** The dice at rest now: the next throw starts from these poses. */
  readonly rest: RestState
  /**
   * Counts the changes to what the dome shows — a snap, a throw starting or ending, a reset — so
   * a renderer can tell whether its last frame drew the current scene.
   */
  readonly version: number
  /** The `DiceView` the roll flow drives; `mode` reads `'3d'` only while a renderer is live. */
  view(speed?: PlaybackSpeed): DiceView
  /** The frame loop's read: what to draw at `nowMs` on a canvas of `size`, advancing the clock. */
  sample(nowMs: number, size?: CanvasSize): DomeFrame
  /** Back to idle for a new game: no dice drawn, no faces, the camera wide. */
  reset(): void
  /** Registers the renderer; returns the detach. */
  attach(renderer: DomeRenderer): () => void
  /** The live renderer's scene for the e2e readout; null without one. */
  inspect(): DomeInspection | null
  /** What the renderer read off the drawn meshes, in body order: the truth `data-dice` shows. */
  reportFaces(faces: readonly [DieFace, DieFace]): void
  /** Pre-simulates the next throw for `seed` from the current rest; null asks for nothing. */
  prefetch(seed: number | null): void
  /** Decides WebGL availability once (the result is cached). */
  probe(): 'ok' | 'unavailable'
  /** WebGL failed after the probe (renderer creation): back to 2D for good. */
  markUnavailable(): void
  /** The renderer's WebGL context was lost: back to 2D, a throw in flight reveals, retry offered. */
  contextLost(): void
  /** After a loss: probe WebGL again; when it is there, the renderer mounts and attaches again. */
  retry(): void
  dispose(): void
}

export interface DiceDomeOptions {
  readonly fallback: Dice2DController
  readonly client?: PhysicsClient
  /** The WebGL probe; the default asks the browser. */
  readonly probe?: () => boolean
  /** How long `play` waits for a throw still in flight before falling back (plan §7: 150 ms). */
  readonly takeTimeoutMs?: number
  /** The page's visibility, for the hide-while-playing reveal; null skips it (tests). */
  readonly documentLike?: Pick<
    Document,
    'addEventListener' | 'removeEventListener' | 'visibilityState'
  > | null
  /** The quality tier's storage, device class, monitor switch and pin (quality.ts). */
  readonly quality?: QualityOptions
}

export const TAKE_TIMEOUT_MS = 150
/** The watchdog allows slow frames (the clock caps each at 50 ms) before it reveals anyway. */
export const WATCHDOG_SLACK_MS = 2000
export const WATCHDOG_FACTOR = 2.5

/** The canvas the camera is framed for when the renderer passes no size (tests). */
export const NOMINAL_CANVAS: CanvasSize = { width: 388, height: 242.5 }

/** Where the hidden dice lie before the first roll: an arbitrary, fixed pair, never drawn. */
const IDLE_DICE: Dice = { d1: 3, d2: 4 }

interface Playback {
  readonly plan: PlaybackPlan
  readonly shown: Exclude<ThrowShown, 'rest'>
  readonly handoff: number
  readonly clock: PlaybackClock
  /** The dice were hidden when the throw began: they appear as it pops, after the lead-in. */
  readonly fromHidden: boolean
  /** Where the camera was when the throw began; fixed at the first frame (it needs the size). */
  from: CameraPose | null
  finish(reason: string): void
}

export function createDiceDome(options: DiceDomeOptions): DiceDomeController {
  const { fallback } = options
  const client = options.client ?? createPhysicsClient()
  const takeTimeoutMs = options.takeTimeoutMs ?? TAKE_TIMEOUT_MS
  const documentLike =
    options.documentLike !== undefined
      ? options.documentLike
      : typeof document === 'undefined'
        ? null
        : document
  const quality = createQualityStore(options.quality)
  const monitored = options.quality?.monitor ?? !force3d()
  const monitor = createFrameMonitor()
  const store = createStore<DomeSnapshot>()(() => ({
    state: 'idle',
    faces: null,
    d1Body: 0,
    shown: null,
    handoff: 0,
    ready: false,
    live: false,
    webgl: 'unknown',
  }))

  let rest: RestState = restShowing(IDLE_DICE)
  /** No roll yet (or a new game): the dice are not drawn and the camera stays wide. */
  let hidden = true
  let version = 0
  let renderer: DomeRenderer | null = null
  let playback: Playback | null = null
  let nextSeed: number | null = null
  let probed: 'ok' | 'unavailable' | null = null
  /** The read framing of one rest at one canvas size, kept while both stay the same. */
  let framed: { rest: RestState; width: number; height: number; pose: CameraPose } | null = null

  const readPose = (of: RestState, size: CanvasSize): CameraPose => {
    if (
      framed !== null &&
      framed.rest === of &&
      framed.width === size.width &&
      framed.height === size.height
    ) {
      return framed.pose
    }
    const pose = readFraming([of[0].pose, of[1].pose], size)
    framed = { rest: of, width: size.width, height: size.height, pose }
    return pose
  }
  /** The camera while nothing plays: wide while idle, the read framing of the rest otherwise. */
  const restingCamera = (size: CanvasSize): CameraPose =>
    hidden ? THROW_SHOT : readPose(rest, size)

  const updateReady = (): void => {
    const ready = nextSeed !== null && client.has(nextSeed, rest)
    if (store.getState().ready !== ready) store.setState({ ready })
  }
  const unsubscribeClient = client.subscribe(updateReady)

  /** Asks the worker for the next throw from the dice as they rest now, if there is one to ask. */
  const refetch = (): void => {
    if (nextSeed !== null && probed !== 'unavailable' && !client.broken) {
      client.prefetch(nextSeed, rest)
    }
    updateReady()
  }

  /** Which body shows `dice.d1` when `at` shows the pair (body 0 for a double). */
  const d1BodyOf = (at: RestState, dice: Dice): 0 | 1 => {
    const [first] = facesOf(at)
    return first === dice.d1 ? 0 : 1
  }

  /**
   * The dice at rest showing `dice`: the rest we have if it already does (a finished plan keeps
   * its `shown` and `handoff`), fresh synthesised poses otherwise — and then the next throw is
   * asked for again, because one simulated from the old rest can no longer be played. The camera
   * goes straight to the read framing: a snap is never animated.
   */
  const snapTo = (dice: Dice): void => {
    playback?.finish('snap')
    const { shown: before, handoff: blended } = store.getState()
    let shown: ThrowShown = before ?? 'rest'
    let handoff = blended
    if (!showsDice(rest, dice)) {
      rest = restShowing(dice)
      shown = 'rest'
      handoff = 0
    }
    hidden = false
    version++
    store.setState({
      state: 'settled',
      faces: facesOf(rest),
      d1Body: d1BodyOf(rest, dice),
      shown,
      handoff,
    })
    refetch()
    renderer?.invalidate()
  }

  const runPlayback = (
    plan: PlaybackPlan,
    shown: Exclude<ThrowShown, 'rest'>,
    handoff: number,
    speed: PlaybackSpeed,
    signal: AbortSignal,
  ): Promise<void> =>
    new Promise((resolve) => {
      const rate = SPEED[speed]
      const wall = playbackMs(plan) / rate
      const onAbort = (): void => current.finish('skip')
      const onVisibility = (): void => {
        if (documentLike?.visibilityState === 'hidden') current.finish('hidden')
      }
      const watchdog = setTimeout(
        () => current.finish('watchdog'),
        wall * WATCHDOG_FACTOR + WATCHDOG_SLACK_MS,
      )
      const current: Playback = {
        plan,
        shown,
        handoff,
        clock: createClock(rate),
        fromHidden: hidden,
        from: null,
        finish: (reason) => {
          void reason
          if (playback !== current) return
          playback = null
          clearTimeout(watchdog)
          signal.removeEventListener('abort', onAbort)
          documentLike?.removeEventListener('visibilitychange', onVisibility)
          rest = plan.rest
          hidden = false
          version++
          store.setState({
            state: 'settled',
            faces: facesOf(rest),
            d1Body: plan.swapped ? 1 : 0,
            shown,
            handoff,
          })
          updateReady()
          renderer?.invalidate()
          resolve()
        },
      }
      playback = current
      version++
      monitor.reset()
      signal.addEventListener('abort', onAbort)
      documentLike?.addEventListener('visibilitychange', onVisibility)
      store.setState({ state: 'playing', shown, handoff })
      renderer?.invalidate()
    })

  const play3d = async (
    request: DicePlayRequest,
    signal: AbortSignal,
    speed: PlaybackSpeed,
  ): Promise<void> => {
    if (signal.aborted) {
      snapTo(request.dice)
      return
    }
    const reply = await client.take(request.physicsSeed, rest, takeTimeoutMs)
    if (signal.aborted) {
      snapTo(request.dice)
      return
    }
    if (renderer === null) throw new Error('the 3D renderer is not attached')
    const planned = planThrow(reply, request.dice, rest, request.physicsSeed)
    await runPlayback(planned.plan, planned.shown, planned.handoff, speed, signal)
  }

  const controller: DiceDomeController = {
    store,
    quality,
    fallback,
    client,
    get rest() {
      return rest
    },
    get version() {
      return version
    },
    view: (speed = 'normal') => ({
      get mode() {
        return renderer === null ? ('2d' as const) : ('3d' as const)
      },
      play: (request, signal) =>
        renderer === null
          ? fallback.view('2d', speed === 'fast' ? TUMBLE_FAST : TUMBLE).play(request, signal)
          : play3d(request, signal, speed),
      showRest: (dice) => {
        fallback.view('2d').showRest(dice)
        snapTo(dice)
      },
    }),
    sample: (nowMs, size = NOMINAL_CANVAS) => {
      const current = playback
      if (current !== null) {
        // The monitor sees only frames drawn while a throw plays, and only when it is on.
        if (monitored && monitor.frame(nowMs)) quality.getState().drop()
        const time = current.clock.advance(nowMs)
        const sample = sampleAt(current.plan, time)
        if (!sample.done) {
          current.from ??= restingCamera(size)
          return {
            version,
            poses: sample.poses,
            visible: !(current.fromHidden && time < LEAD_IN_MS),
            camera: cameraAt(current.plan, time, current.from, readPose(current.plan.rest, size)),
            playing: true,
          }
        }
        current.finish('done')
      }
      return {
        version,
        poses: restPoses(rest),
        visible: !hidden,
        camera: restingCamera(size),
        playing: false,
      }
    },
    reset: () => {
      playback?.finish('reset')
      hidden = true
      version++
      store.setState({ state: 'idle', faces: null, d1Body: 0, shown: null, handoff: 0 })
      renderer?.invalidate()
    },
    attach: (next) => {
      renderer = next
      store.setState({ live: true })
      next.invalidate()
      return () => {
        if (renderer !== next) return
        renderer = null
        store.setState({ live: false })
        playback?.finish('detached')
      }
    },
    inspect: () => renderer?.inspect?.() ?? null,
    reportFaces: (faces) => {
      const { state, faces: known } = store.getState()
      if (state !== 'settled') return
      if (known !== null && known[0] === faces[0] && known[1] === faces[1]) return
      store.setState({ faces: [faces[0], faces[1]] })
    },
    prefetch: (seed) => {
      nextSeed = seed
      if (seed === null || probed === 'unavailable' || client.broken) {
        updateReady()
        return
      }
      client.prefetch(seed, rest)
      updateReady()
    },
    probe: () => {
      if (probed === null) {
        const ok = (options.probe ?? (() => probeWebGL(webglOptions())))()
        probed = ok ? 'ok' : 'unavailable'
        store.setState({ webgl: probed })
      }
      return probed
    },
    markUnavailable: () => {
      probed = 'unavailable'
      store.setState({ webgl: 'unavailable', live: false })
      renderer = null
      playback?.finish('unavailable')
    },
    contextLost: () => {
      if (store.getState().webgl !== 'ok') return
      renderer = null
      store.setState({ webgl: 'lost', live: false })
      // A throw in flight ends at its rest, so `play` resolves and the roll flow reveals in 2D.
      playback?.finish('lost')
    },
    retry: () => {
      if (store.getState().webgl !== 'lost') return
      probed = null
      store.setState({ webgl: 'unknown' })
      controller.probe()
    },
    dispose: () => {
      unsubscribeClient()
      playback?.finish('disposed')
      client.dispose()
    },
  }
  return controller
}
