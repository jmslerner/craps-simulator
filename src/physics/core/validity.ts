/**
 * Whether a recording can be shown (§7 Valid): every value finite, both dice inside the dome
 * throughout, never sunk into anything deeper than a solver contact does, settled in time, and
 * each die lying flat on the floor so its top face is unambiguous. Depths are exact (gap.ts).
 */
import { diceGap, domeGap, floorGap, insideDome } from './gap.ts'
import { DEFAULT_PARAMS, type PhysicsParams } from './params.ts'
import { framePose, type Recording } from './recording.ts'
import { tiltDeg } from './restPose.ts'

export type InvalidReason =
  /** A NaN or infinity anywhere in the frames. */
  | 'nonfinite'
  /** A die centre left the dome or went below the floor at some frame. */
  | 'escaped'
  /** A die sank more than `maxOverlap` into the floor, the dome or the other die at some frame. */
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
  /** At any frame, impacts included. */
  readonly deepest: number
  /**
   * At frames where the die had already been touching that surface for the two frames before:
   * resting, sliding or rolling contact rather than the first 33 ms of an impact.
   */
  readonly sustained: number
  /** At the frames from `settleFrame` on (NaN if it never settled). */
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
  const deepest = Math.max(...SURFACES.map((surface) => depths[surface].deepest))
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
 * Exact per-frame depths into the floor, the dome's trimesh and the other die, as the deepest
 * over the recording (see Depths). These are the true depths, not the centre-based lower bound.
 */
export function depthProfile(rec: Recording, params: PhysicsParams = DEFAULT_PARAMS): DepthProfile {
  const { touchGap } = params.contact
  // Exact wherever a die is within this of a surface; elsewhere a lower bound is enough.
  const cutoff = 2 * touchGap
  const deepest = { floor: -Infinity, dome: -Infinity, dice: -Infinity }
  const sustained = { floor: -Infinity, dome: -Infinity, dice: -Infinity }
  const atRest = { floor: -Infinity, dome: -Infinity, dice: -Infinity }
  // Per die, its gaps one frame back and two frames back.
  type Gaps = Record<(typeof SURFACES)[number], number>
  const history: [Gaps[], Gaps[]] = [[], []]
  for (let frame = 0; frame < rec.frameCount; frame++) {
    const poses = [framePose(rec, frame, 0), framePose(rec, frame, 1)] as const
    const dice = diceGap(poses[0], poses[1], params.die, cutoff)
    for (const die of [0, 1] as const) {
      const self = poses[die]
      const now = { floor: floorGap(self, params.die), dome: domeGap(self, params, cutoff), dice }
      const [previous, before] = history[die]
      for (const surface of SURFACES) {
        const depth = -now[surface]
        deepest[surface] = Math.max(deepest[surface], depth)
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
    deepest: deepest[surface],
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
