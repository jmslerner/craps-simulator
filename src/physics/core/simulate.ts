/**
 * Headless throws (§7). A throw is simulated without knowing the outcome: the engine has already
 * chosen the dice, and plan.ts remaps the faces afterwards. Steps at 480 Hz, records poses at
 * 60 Hz, and contact flags and the deepest overlaps at every step.
 */
import type { RigidBody } from '@dimforge/rapier3d-deterministic-compat'
import { contactAt } from './gap.ts'
import { analyticHop } from './hop.ts'
import { DEFAULT_PARAMS, paramsFingerprint, type PhysicsParams } from './params.ts'
import { synthesizeRest } from './plan.ts'
import { burstSteps, drawKicks, type Kick } from './popper.ts'
import { createPrng, deriveSeed } from './prng.ts'
import {
  deeper,
  FLOATS_PER_DIE,
  FLOATS_PER_FRAME,
  NO_DEPTH,
  type Recording,
  type ThrowSource,
} from './recording.ts'
import {
  hashRest,
  posesOf,
  upAxis,
  visualTopFace,
  type DicePoses,
  type Pose,
  type RestState,
} from './restPose.ts'
import { createSettleTracker, isStill } from './settle.ts'
import {
  apexHeights,
  checkRecording,
  checkStart,
  depthProfile,
  type DepthProfile,
  type Validity,
} from './validity.ts'
import { createScene, type Scene } from './world.ts'

/** A physics attempt: the popper, or the gentler fallback drop. */
export type PhysicsSource = Exclude<ThrowSource, 'hop'>

/**
 * One physics attempt from the dice at rest in `rest`, recorded until both dice settle or time
 * runs out. Needs `await initPhysics()` first. Neither the start nor the result is checked; see
 * `simulateThrow`.
 */
export function simulateAttempt(
  seed: number,
  rest: RestState,
  source: PhysicsSource,
  params: PhysicsParams = DEFAULT_PARAMS,
): Recording {
  const start = posesOf(rest)
  const scene = createScene(start, params)
  try {
    return { ...record(scene, seed, start, source, params), restHash: hashRest(rest) }
  } finally {
    scene.world.free()
  }
}

function record(
  { world, dice }: Scene,
  seed: number,
  start: DicePoses,
  source: PhysicsSource,
  params: PhysicsParams,
): Omit<Recording, 'restHash'> {
  const { stepsPerFrame, timestep, settle, validity } = params
  const kick = source === 'pop' ? params.pop : params.drop
  const kicks = drawKicks(createPrng(seed), start, kick, params.dome.radius)
  const burst = burstSteps(kick, timestep)
  const frameRate = 1 / (timestep * stepsPerFrame)
  // Long enough to confirm a rest that starts exactly at the deadline.
  const maxFrames = Math.ceil((validity.maxSettleTime + settle.hold) * frameRate) + 1
  const frames = new Float32Array(maxFrames * FLOATS_PER_FRAME)
  const contacts = new Uint8Array((maxFrames - 1) * stepsPerFrame + 1)
  let poses = bodyPoses(dice)
  writeFrame(frames, 0, poses)
  // Each step's contact flags and depths, read from the same gaps.
  let stepDepths = NO_DEPTH
  const observe = (step: number) => {
    const { byte, depths } = contactAt(poses, params)
    contacts[step] = byte
    stepDepths = deeper(stepDepths, depths)
  }
  observe(0)
  let frameCount = 1
  const tracker = createSettleTracker(settle, timestep)
  // While a die is being pushed, gravity is cancelled so it leaves at the drawn launch speed.
  const lift = -params.gravity * timestep
  let settled = false
  for (let step = 1; frameCount < maxFrames; step++) {
    if (step <= burst) {
      dice.forEach((body, die) => {
        const kick = kicks[die]
        if (kick) push(body, kick, burst, lift)
      })
    }
    world.step()
    poses = bodyPoses(dice)
    observe(step)
    const still = dice.every((body) => isStill(body.linvel(), body.angvel(), settle))
    const asleep = dice.every((body) => body.isSleeping())
    settled = tracker.observe(step, still, asleep)
    if (step % stepsPerFrame === 0) {
      writeFrame(frames, frameCount, poses)
      frameCount++
      if (settled) break
    }
  }

  const restStep = tracker.restStep()
  const finalPoses = poses
  return {
    frames: frames.slice(0, frameCount * FLOATS_PER_FRAME),
    frameCount,
    frameRate,
    stepsPerFrame,
    contacts: contacts.slice(0, (frameCount - 1) * stepsPerFrame + 1),
    stepDepths,
    settleFrame: settled ? Math.ceil(restStep / stepsPerFrame) : -1,
    finalPoses,
    finalUpAxis: [upAxis(finalPoses[0].q), upAxis(finalPoses[1].q)],
    source,
    seed,
    paramsFingerprint: paramsFingerprint(params),
  }
}

/** One step's share of a kick, applied as a velocity change so it is independent of mass. */
function push(body: RigidBody, kick: Kick, burst: number, lift: number): void {
  const v = body.linvel()
  const w = body.angvel()
  const [lx, ly, lz] = kick.linear
  const [ax, ay, az] = kick.angular
  body.setLinvel({ x: v.x + lx / burst, y: v.y + ly / burst + lift, z: v.z + lz / burst }, true)
  body.setAngvel({ x: w.x + ax / burst, y: w.y + ay / burst, z: w.z + az / burst }, true)
}

/** Both bodies' poses as Rapier holds them: Float32 values, so recording them loses nothing. */
function bodyPoses(dice: Scene['dice']): DicePoses {
  const pose = (body: RigidBody): Pose => {
    const p = body.translation()
    const q = body.rotation()
    return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] }
  }
  return [pose(dice[0]), pose(dice[1])]
}

function writeFrame(frames: Float32Array, frame: number, poses: DicePoses): void {
  poses.forEach(({ p, q }, die) => {
    frames.set([...p, ...q], frame * FLOATS_PER_FRAME + die * FLOATS_PER_DIE)
  })
}

export interface AttemptLog {
  readonly source: ThrowSource
  readonly seed: number
  readonly validity: Validity
  /** The attempt's simulated settle time in seconds, or -1 if it never settled. */
  readonly settleTime: number
  /** Exact depths into the floor, the dome and the other die, per step and per frame. */
  readonly depths: DepthProfile
  /** How high each die's centre rose, u. */
  readonly apex: readonly [number, number]
}

export interface ThrowResult {
  /** The first valid recording; the analytic hop guarantees there is one. */
  readonly recording: Recording
  /** Every attempt in order. The last one produced `recording`. */
  readonly attempts: readonly AttemptLog[]
  /**
   * The rest the throw started from, which the playback plan must be built from: the `rest` asked
   * for, or, when `start` rejected it, fresh poses showing the same faces.
   */
  readonly rest: RestState
  /** checkStart of the rest asked for: invalid when the throw started from fresh poses instead. */
  readonly start: Validity
}

/**
 * Simulates one throw from `rest`, where the previous throw's plan left the dice (its `rest`), and
 * falls back until it is valid (§7 Fallback chain): the pop, up to `popRetries` re-pops with
 * derived seeds, up to `dropTries` low-energy drops, then the analytic hop, which is valid by
 * construction from any start checkStart accepts. From any other rest no recording can be valid
 * (dice sunk into each other, the floor or the dome, or a die outside it, as a corrupt or outdated
 * saved rest may have them), so the throw starts instead from fresh poses that synthesizeRest
 * places, showing the faces `rest` shows. `ThrowResult.rest` is the rest it started from, and the
 * recording carries hashRest of that rest, so only it can plan the playback.
 *
 * Throws a RangeError for start poses that are not finite (checkStart's `nonfinite`), or a rest
 * to replace whose offsets name no cube rotation, and an Error rather than return an invalid
 * hop, as params that no flat landing meets would make it.
 */
export function simulateThrow(
  seed: number,
  rest: RestState,
  params: PhysicsParams = DEFAULT_PARAMS,
): ThrowResult {
  const start = checkStart(rest, params)
  // A NaN pose would only come from a corrupt rest state, which shows no faces to keep.
  if (start.reasons.includes('nonfinite')) {
    throw new RangeError('simulateThrow: start poses must be finite, with non-zero quaternions')
  }
  const { popRetries, dropTries } = params.fallback
  // Fresh poses, if needed, at a seed that no attempt and not the hop uses.
  const restSeed = deriveSeed(seed, popRetries + dropTries + 2)
  const from = start.valid ? rest : freshRest(restSeed, rest, params)
  const plan: { source: PhysicsSource; seed: number }[] = [{ source: 'pop', seed: seed >>> 0 }]
  for (let k = 1; k <= popRetries; k++) plan.push({ source: 'pop', seed: deriveSeed(seed, k) })
  for (let k = 1; k <= dropTries; k++) {
    plan.push({ source: 'drop', seed: deriveSeed(seed, popRetries + k) })
  }

  const attempts: AttemptLog[] = []
  const log = (recording: Recording): Validity => {
    const depths = depthProfile(recording, params)
    const validity = checkRecording(recording, params, depths)
    const { source, seed, settleFrame, frameRate } = recording
    const settleTime = settleFrame < 0 ? -1 : settleFrame / frameRate
    attempts.push({ source, seed, validity, settleTime, depths, apex: apexHeights(recording) })
    return validity
  }
  for (const attempt of plan) {
    const recording = simulateAttempt(attempt.seed, from, attempt.source, params)
    if (log(recording).valid) return { recording, attempts, rest: from, start }
  }
  const recording = analyticHop(deriveSeed(seed, popRetries + dropTries + 1), from, params)
  const { valid, reasons } = log(recording)
  if (!valid) {
    throw new Error(
      `simulateThrow: the analytic hop is invalid (${reasons.join(', ')}): ` +
        'can a flat landing at restHeight meet these validity params?',
    )
  }
  return { recording, attempts, rest: from, start }
}

/** Fresh poses for a throw that cannot start from `rest`, showing the faces `rest` shows. */
function freshRest(seed: number, rest: RestState, params: PhysicsParams): RestState {
  const faces = [
    visualTopFace(rest[0].pose.q, rest[0].offset),
    visualTopFace(rest[1].pose.q, rest[1].offset),
  ] as const
  return synthesizeRest(seed, faces, params)
}
