/**
 * The last fallback: a scripted hop with no physics, valid by construction. Each die flies from
 * its start pose to a flat landing near the floor centre, tumbling whole extra turns on the way so
 * the face snap has an airborne, fast-turning frame to hide in.
 *
 * Why no die ever moves into the floor, the dome or the other die (as gap.ts measures them):
 * - The landing spots lie along the dice's start separation, in the same order. Until the dice
 *   may tumble, the separation s = p1 − p0 only changes length, never direction, and the distance
 *   between two rigid convex bodies is a convex function of s that is 0 at s = 0, so scaling s up
 *   never brings them closer. Shrinking it only happens when both ends are at least 2 × landing
 *   apart, which is more than two circumradii.
 * - A die keeps its start orientation until every bounding ball is clear by `hop.margin`: the
 *   centres at least 2ρ apart, each centre ρ above the floor and ρ inside the dome's inradius (ρ
 *   the circumradius). While that holds no orientation can touch anything, so the dice tumble
 *   only then, and are back in their flat landing orientation before it stops holding.
 * - Rising, a die moves away from the floor; lying flat on the way down, it clears the floor as
 *   long as its centre is above restHeight, where it lands.
 */
import { CUBE_ROTATIONS } from './cube.ts'
import { domeFaces } from './dome.ts'
import { circumradius, contactAt } from './gap.ts'
import { DEFAULT_PARAMS, paramsFingerprint, type PhysicsParams } from './params.ts'
import { createPrng, onCircle, onSphere } from './prng.ts'
import { fromAxisAngle, length3, multiply, normalize, slerp, yawFromHalfAngle } from './quat.ts'
import type { Quat, Vec3 } from './quat.ts'
import {
  deeper,
  FLOATS_PER_DIE,
  FLOATS_PER_FRAME,
  NO_DEPTH,
  readPoses,
  type Recording,
} from './recording.ts'
import {
  flatOrientation,
  hashRest,
  posesOf,
  upAxis,
  type DicePoses,
  type Pose,
  type RestState,
} from './restPose.ts'

/** The hop from the dice at rest in `rest`; the recording carries hashRest(rest), as throws do. */
export function analyticHop(
  seed: number,
  rest: RestState,
  params: PhysicsParams = DEFAULT_PARAMS,
): Recording {
  const start = posesOf(rest)
  const { hop, validity, settle, timestep, stepsPerFrame } = params
  const prng = createPrng(seed)
  const frameRate = 1 / (timestep * stepsPerFrame)
  const airFrames = Math.max(1, Math.round(hop.airTime * frameRate))
  const airSteps = airFrames * stepsPerFrame
  const frameCount = airFrames + Math.ceil(settle.hold * frameRate) + 1

  const [a, b] = start
  const startSeparation: Vec3 = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]]
  const startLength = length3(startSeparation)
  const [sx, , sz] = startSeparation
  const across = Math.sqrt(sx * sx + sz * sz)
  // Stacked dice have no horizontal separation to follow, so any landing axis will do.
  const [ux, uz] = across > 1e-9 ? [sx / across, sz / across] : onCircle(prng)
  const spot = (side: number): Vec3 => [
    side * hop.landing * ux,
    validity.restHeight,
    side * hop.landing * uz,
  ]
  const ends = [spot(-1), spot(1)].map((p): Pose => {
    const index = Math.floor(prng.next() * CUBE_ROTATIONS.length)
    const [yc, ys] = onCircle(prng)
    return { p, q: flatOrientation(index, yawFromHalfAngle(yc, ys)) }
  })
  const spinAxes = [onSphere(prng), onSphere(prng)]
  const startQ = [normalize(a.q), normalize(b.q)]

  const path = createPath(start, startSeparation, startLength, [ux, 0, uz], hop.landing, params)
  const [turnFrom, turnTo] = tumbleWindow(path, airSteps, params)
  const poseAt = (step: number): DicePoses => {
    if (step >= airSteps) return [ends[0] ?? a, ends[1] ?? b]
    const t = step / airSteps
    const positions = path.at(t, turnFrom)
    const pose = (die: 0 | 1): Pose => ({ p: positions[die], q: orientation(die, t) })
    return [pose(0), pose(1)]
  }
  const orientation = (die: 0 | 1, t: number): Quat => {
    const from = startQ[die] ?? [0, 0, 0, 1]
    const to = ends[die]?.q ?? from
    if (t <= turnFrom) return from
    if (t >= turnTo) return to
    const x = (t - turnFrom) / (turnTo - turnFrom)
    const w = x * x * (3 - 2 * x)
    // Whole turns about a random axis come back to the identity, so the die lands on `to`.
    const turn = fromAxisAngle(spinAxes[die] ?? [0, 1, 0], 2 * Math.PI * hop.turns * w)
    return multiply(turn, slerp(from, to, w))
  }

  const frames = new Float32Array(frameCount * FLOATS_PER_FRAME)
  const contacts = new Uint8Array((frameCount - 1) * stepsPerFrame + 1)
  let stepDepths = NO_DEPTH
  for (let step = 0; step < contacts.length; step++) {
    const poses = poseAt(step)
    const { byte, depths } = contactAt(poses, params)
    contacts[step] = byte
    stepDepths = deeper(stepDepths, depths)
    if (step % stepsPerFrame !== 0) continue
    poses.forEach(({ p, q }, die) => {
      frames.set([...p, ...q], (step / stepsPerFrame) * FLOATS_PER_FRAME + die * FLOATS_PER_DIE)
    })
  }

  const finalPoses = readPoses(frames, frameCount - 1)
  return {
    frames,
    frameCount,
    frameRate,
    stepsPerFrame,
    contacts,
    stepDepths,
    settleFrame: airFrames,
    finalPoses,
    finalUpAxis: [upAxis(finalPoses[0].q), upAxis(finalPoses[1].q)],
    source: 'hop',
    seed,
    paramsFingerprint: paramsFingerprint(params),
    restHash: hashRest(rest),
  }
}

interface Path {
  /** Both centres at flight fraction t, when the separation starts turning at `turnFrom`. */
  at(t: number, turnFrom: number): [Vec3, Vec3]
  /** The centres' distance at t, which does not depend on turnFrom. */
  separation(t: number): number
}

/**
 * The centres' flight: their midpoint rises in a parabola of height `apex` from where it was to
 * the floor centre, and their separation eases from where it was to 2 × landing along the landing
 * axis. Each centre is computed as its start plus a displacement, so frame 0 is exactly the start.
 */
function createPath(
  start: DicePoses,
  startSeparation: Vec3,
  startLength: number,
  axis: Vec3,
  landing: number,
  params: PhysicsParams,
): Path {
  const { apex } = params.hop
  const middle = (k: number) => ((start[0].p[k] ?? 0) + (start[1].p[k] ?? 0)) / 2
  const centreShift: Vec3 = [-middle(0), params.validity.restHeight - middle(1), -middle(2)]
  const startDirection: Vec3 =
    startLength > 1e-9
      ? [
          startSeparation[0] / startLength,
          startSeparation[1] / startLength,
          startSeparation[2] / startLength,
        ]
      : axis
  const endLength = 2 * landing
  // Eases out, so touching dice part quickly and may start to tumble sooner.
  const separation = (t: number) =>
    startLength + (endLength - startLength) * (1 - (1 - t) * (1 - t) * (1 - t))
  return {
    separation,
    at(t, turnFrom) {
      const rise = 4 * apex * t * (1 - t)
      const shift: Vec3 = [centreShift[0] * t, centreShift[1] * t + rise, centreShift[2] * t]
      const length = separation(t)
      let change: Vec3
      if (t <= turnFrom) {
        // Only the length changes: the bodies keep their relative bearing exactly.
        const grow = length - startLength
        change = [startDirection[0] * grow, startDirection[1] * grow, startDirection[2] * grow]
      } else {
        // Then the separation turns onto the landing axis, along the arc between the two.
        const w = (t - turnFrom) / (1 - turnFrom)
        const blend: Vec3 = [
          startDirection[0] + (axis[0] - startDirection[0]) * w,
          startDirection[1] + (axis[1] - startDirection[1]) * w,
          startDirection[2] + (axis[2] - startDirection[2]) * w,
        ]
        const scale = length / length3(blend)
        change = [
          blend[0] * scale - startSeparation[0],
          blend[1] * scale - startSeparation[1],
          blend[2] * scale - startSeparation[2],
        ]
      }
      const centre = (die: 0 | 1, side: number): Vec3 => {
        const p = start[die].p
        return [
          p[0] + shift[0] + (side * change[0]) / 2,
          p[1] + shift[1] + (side * change[1]) / 2,
          p[2] + shift[2] + (side * change[2]) / 2,
        ]
      }
      return [centre(0, -1), centre(1, 1)]
    },
  }
}

/**
 * The flight fractions between which the dice may tumble: from the first step at which every
 * bounding ball is clear by `hop.margin`, to the last step before one of them stops being clear.
 */
function tumbleWindow(path: Path, airSteps: number, params: PhysicsParams): [number, number] {
  const reach = circumradius(params.die) + params.hop.margin
  const roof = domeFaces(params.dome).inradius - reach
  const clear = (t: number, turnFrom: number) => {
    if (path.separation(t) < 2 * reach) return false
    return path.at(t, turnFrom).every((p) => p[1] >= reach && length3(p) <= roof)
  }
  let from = -1
  for (let step = 1; step < airSteps && from < 0; step++) {
    if (clear(step / airSteps, 1)) from = step
  }
  // Never clear: no params in use get here, but a flight that never clears still has to turn.
  if (from < 0) return [0.25, 0.75]
  const turnFrom = from / airSteps
  let to = from
  while (to + 1 < airSteps && clear((to + 1) / airSteps, turnFrom)) to++
  return [turnFrom, to / airSteps]
}
