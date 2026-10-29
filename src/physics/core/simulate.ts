/**
 * Headless throws (§7). A throw is simulated without knowing the outcome: the engine has already
 * chosen the dice, and plan.ts remaps the faces afterwards. Steps at 480 Hz, records poses at
 * 60 Hz and contact flags at every step.
 */
import type { RigidBody } from '@dimforge/rapier3d-deterministic-compat'
import { touching } from './gap.ts'
import { analyticHop } from './hop.ts'
import { DEFAULT_PARAMS, paramsFingerprint, type PhysicsParams } from './params.ts'
import { burstSteps, drawKicks, type Kick } from './popper.ts'
import { createPrng, deriveSeed } from './prng.ts'
import { FLOATS_PER_DIE, FLOATS_PER_FRAME, type Recording, type ThrowSource } from './recording.ts'
import { upAxis, type DicePoses, type Pose } from './restPose.ts'
import { createSettleTracker, isStill } from './settle.ts'
import {
  apexHeights,
  checkRecording,
  depthProfile,
  type DepthProfile,
  type Validity,
} from './validity.ts'
import { createScene, type Scene } from './world.ts'

/** A physics attempt: the popper, or the gentler fallback drop. */
export type PhysicsSource = Exclude<ThrowSource, 'hop'>

/**
 * One physics attempt from `start`, recorded until both dice settle or time runs out. Needs
 * `await initPhysics()` first. The result is not checked; see `simulateThrow` for that.
 */
export function simulateAttempt(
  seed: number,
  start: DicePoses,
  source: PhysicsSource,
  params: PhysicsParams = DEFAULT_PARAMS,
): Recording {
  const scene = createScene(start, params)
  try {
    return record(scene, seed, start, source, params)
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
): Recording {
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
  contacts[0] = touching(poses, params)
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
    contacts[step] = touching(poses, params)
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
  /** Exact depths into the floor, the dome and the other die; see depthProfile. */
  readonly depths: DepthProfile
  /** How high each die's centre rose, u. */
  readonly apex: readonly [number, number]
}

export interface ThrowResult {
  /** The first valid recording; the analytic hop guarantees there is one. */
  readonly recording: Recording
  /** Every attempt in order. The last one produced `recording`. */
  readonly attempts: readonly AttemptLog[]
}

/**
 * Simulates one throw from `start` (the previous rest poses) and falls back until it is valid
 * (§7 Fallback chain): the pop, up to `popRetries` re-pops with derived seeds, up to `dropTries`
 * low-energy drops, then the analytic hop, which is valid by construction.
 */
export function simulateThrow(
  seed: number,
  start: DicePoses,
  params: PhysicsParams = DEFAULT_PARAMS,
): ThrowResult {
  // A NaN pose would only come from a corrupt rest state; fail loudly rather than record NaNs.
  if (!start.every(({ p, q }) => [...p, ...q].every(Number.isFinite))) {
    throw new RangeError('simulateThrow: start poses must be finite')
  }
  const { popRetries, dropTries } = params.fallback
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
    const recording = simulateAttempt(attempt.seed, start, attempt.source, params)
    if (log(recording).valid) return { recording, attempts }
  }
  const recording = analyticHop(deriveSeed(seed, popRetries + dropTries + 1), start, params)
  log(recording)
  return { recording, attempts }
}
