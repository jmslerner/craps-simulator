/**
 * Whether a recording can be shown (§7 Valid): every value finite, both dice inside the dome
 * throughout, never sunk into anything deeper than a solver contact does, at any physics step,
 * settled in time, and each die lying flat on the floor so its top face is unambiguous. Depths are
 * exact (gap.ts).
 */
import { contactAt, diceGap, domeGap, floorGap, insideDome } from './gap.ts'
import { DEFAULT_PARAMS, type PhysicsParams } from './params.ts'
import { normalize } from './quat.ts'
import { framePose, type Recording } from './recording.ts'
import { posesOf, tiltDeg, type DicePoses, type Pose, type RestState } from './restPose.ts'

export type InvalidReason =
  /** A NaN or infinity anywhere in the frames. */
  | 'nonfinite'
  /** A die centre left the dome or went below the floor at some frame. */
  | 'escaped'
  /** A die sank more than `maxOverlap` into the floor, the dome or the other die at some step. */
  | 'overlap'
  /** The dice did not come to rest by `maxSettleTime`. */
  | 'unsettled'
  /** A die rests leaning (cocked) more than `maxTiltDeg`. */
  | 'tilted'
  /** A die rests off the floor, e.g. on top of the other die. */
  | 'height'
  /** A die rests pressed into or through the dome wall. */
  | 'outside'

export interface Validity {
  readonly valid: boolean
  readonly reasons: readonly InvalidReason[]
}

/** How deep a die pressed into one kind of surface, u; negative when it never touched it. */
export interface Depths {
  /** At any physics step, impacts included: how deep it really went (`Recording.stepDepths`). */
  readonly step: number
  /** At any 60 Hz frame, impacts included: the deepest a frame shows. */
  readonly frame: number
  /**
   * At 60 Hz frames where the die had already been touching that surface for the two frames
   * before: resting, sliding or rolling contact rather than the first 33 ms of an impact.
   */
  readonly sustained: number
  /** At the 60 Hz frames from `settleFrame` on (NaN if it never settled). */
  readonly atRest: number
}

/** The deepest either die pressed into the floor, the dome and the other die. */
export interface DepthProfile {
  readonly floor: Depths
  readonly dome: Depths
  readonly dice: Depths
}

const SURFACES = ['floor', 'dome', 'dice'] as const

export function checkRecording(
  rec: Recording,
  params: PhysicsParams = DEFAULT_PARAMS,
  depths: DepthProfile = depthProfile(rec, params),
): Validity {
  const reasons = new Set<InvalidReason>()
  if (!rec.frames.every(Number.isFinite)) reasons.add('nonfinite')
  for (let frame = 0; frame < rec.frameCount; frame++) {
    for (const die of [0, 1] as const) {
      if (!insideDome(framePose(rec, frame, die).p, params)) reasons.add('escaped')
    }
  }
  // The steps include the frames; a frame is checked too, for a recording edited after the fact.
  const deepest = Math.max(
    ...SURFACES.flatMap((surface) => [depths[surface].step, depths[surface].frame]),
  )
  if (!(deepest <= params.validity.maxOverlap)) reasons.add('overlap')
  const settleTime = rec.settleFrame / rec.frameRate
  if (rec.settleFrame < 0 || settleTime > params.validity.maxSettleTime) reasons.add('unsettled')

  const { validity } = params
  for (const pose of rec.finalPoses) {
    if (!(tiltDeg(pose.q) <= validity.maxTiltDeg)) reasons.add('tilted')
    if (!(Math.abs(pose.p[1] - validity.restHeight) <= validity.heightTolerance)) {
      reasons.add('height')
    }
    if (!(domeGap(pose, params, 0) >= -validity.wallTolerance)) reasons.add('outside')
  }
  return { valid: reasons.size === 0, reasons: [...reasons] }
}

/**
 * Whether a throw can start from `rest`: what checkRecording finds at the first frame and step of
 * any recording thrown from there. Every value is finite and each quaternion has a length
 * (`nonfinite`), both centres are inside the dome (`escaped`), and neither die is deeper than
 * `maxOverlap` into the floor, the dome or the other die (`overlap`), both as the poses are given,
 * with unit quaternions, and as a Float32 frame stores them. Lying flat is not asked: a throw may
 * start from a die cocked against the wall or resting on the other. From a start this accepts, the
 * analytic hop is valid by construction; from any other, no recording is.
 */
export function checkStart(rest: RestState, params: PhysicsParams = DEFAULT_PARAMS): Validity {
  const [a, b] = posesOf(rest)
  if (!usable(a) || !usable(b)) return { valid: false, reasons: ['nonfinite'] }
  const unit: DicePoses = [
    { p: a.p, q: normalize(a.q) },
    { p: b.p, q: normalize(b.q) },
  ]
  const reasons = new Set<InvalidReason>()
  for (const poses of [unit, [float32(unit[0]), float32(unit[1])] as const]) {
    if (!poses.every((pose) => insideDome(pose.p, params))) reasons.add('escaped')
    const { floor, dome, dice } = contactAt(poses, params).depths
    if (!(Math.max(floor, dome, dice) <= params.validity.maxOverlap)) reasons.add('overlap')
  }
  return { valid: reasons.size === 0, reasons: [...reasons] }
}

/** Finite values, and a quaternion with a length to divide by: neither zero nor overflowing. */
function usable({ p, q }: Pose): boolean {
  const squared = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]
  return [...p, ...q].every(Number.isFinite) && squared > 0 && Number.isFinite(squared)
}

/** A pose as a Float32 frame stores it. */
function float32({ p, q }: Pose): Pose {
  const f = Math.fround
  return { p: [f(p[0]), f(p[1]), f(p[2])], q: [f(q[0]), f(q[1]), f(q[2]), f(q[3])] }
}

/**
 * Exact depths into the floor, the dome's trimesh and the other die, as the deepest over the
 * recording: at any physics step, as the recording kept them, and at its 60 Hz frames (see
 * Depths). These are the true depths, not the centre-based lower bound.
 */
export function depthProfile(rec: Recording, params: PhysicsParams = DEFAULT_PARAMS): DepthProfile {
  const { touchGap } = params.contact
  // Exact wherever a die is within this of a surface; elsewhere a lower bound is enough.
  const cutoff = 2 * touchGap
  const anyFrame = { floor: -Infinity, dome: -Infinity, dice: -Infinity }
  const sustained = { floor: -Infinity, dome: -Infinity, dice: -Infinity }
  const atRest = { floor: -Infinity, dome: -Infinity, dice: -Infinity }
  // Per die, its gaps one frame back and two frames back.
  type Gaps = Record<(typeof SURFACES)[number], number>
  const history: [Gaps[], Gaps[]] = [[], []]
  for (let frame = 0; frame < rec.frameCount; frame++) {
    const poses = [framePose(rec, frame, 0), framePose(rec, frame, 1)] as const
    const dice = diceGap(poses[0], poses[1], params.die, cutoff)
    for (const die of [0, 1] as const) {
      const pose = poses[die]
      const now = { floor: floorGap(pose, params.die), dome: domeGap(pose, params, cutoff), dice }
      const [previous, before] = history[die]
      for (const surface of SURFACES) {
        const depth = -now[surface]
        anyFrame[surface] = Math.max(anyFrame[surface], depth)
        if (previous && before && previous[surface] <= touchGap && before[surface] <= touchGap) {
          sustained[surface] = Math.max(sustained[surface], depth)
        }
        if (rec.settleFrame >= 0 && frame >= rec.settleFrame) {
          atRest[surface] = Math.max(atRest[surface], depth)
        }
      }
      history[die] = [now, ...history[die].slice(0, 1)]
    }
  }
  const pick = (surface: (typeof SURFACES)[number]): Depths => ({
    step: rec.stepDepths[surface],
    frame: anyFrame[surface],
    sustained: sustained[surface],
    atRest: rec.settleFrame >= 0 ? atRest[surface] : Number.NaN,
  })
  return { floor: pick('floor'), dome: pick('dome'), dice: pick('dice') }
}

/** The highest each die's centre rose during the recording, u: a throw, not a shuffle. */
export function apexHeights(rec: Recording): [number, number] {
  const apex: [number, number] = [-Infinity, -Infinity]
  for (let frame = 0; frame < rec.frameCount; frame++) {
    for (const die of [0, 1] as const) {
      apex[die] = Math.max(apex[die], framePose(rec, frame, die).p[1])
    }
  }
  return apex
}
