/**
 * Playback plans (§7 Face remap). The physics never knows the outcome; a plan says which cube
 * rotation to draw on each body at each frame, so the dice land showing the engine's dice. Two
 * modes: `snap` switches the drawn rotation in one airborne, fast-turning frame (M10a); `handoff`
 * blends it over a 100–250 ms window where the die is airborne, clear and spinning (handoff.ts,
 * M10b), and falls back to the snap for a die whose throw has no such window.
 */
import { IDENTITY_OFFSET, rotationAngleDeg, type DieFace } from './cube.ts'
import { diceGap, domeGap, floorGap } from './gap.ts'
import { drawnRotation, handoffWindow, slowestTurn, type HandoffWindow } from './handoff.ts'
import { DEFAULT_PARAMS, paramsFingerprint, type PhysicsParams } from './params.ts'
import { createPrng, inDisc, onCircle } from './prng.ts'
import { angleBetween, multiply, normalize, yawFromHalfAngle, type Quat } from './quat.ts'
import { framePose, touchesDuring, type DieIndex, type Recording } from './recording.ts'
import { chooseEndOffset } from './remap.ts'
import {
  flatOrientation,
  hashRest,
  rotationShowing,
  visualTopFace,
  type DieRest,
  type Pose,
  type RestState,
} from './restPose.ts'

export type PlaybackMode = 'snap' | 'handoff'

/** The engine's dice. Structural, so engine/core/dice.ts's DiceRoll fits without an import. */
export interface DicePair {
  readonly d1: DieFace
  readonly d2: DieFace
}

export interface DieTrack {
  /** The face this body shows once it lands. */
  readonly face: DieFace
  /** Drawn before `switchFrame`: the previous rest offset, so frame 0 continues the last throw. */
  readonly startOffset: number
  /** Drawn from `switchFrame` on. */
  readonly endOffset: number
  /**
   * The frame from which the end offset is drawn whole: a snap's switch frame (see snapFrame), or
   * the last frame of the handoff window.
   */
  readonly switchFrame: number
  /**
   * Whether the change of drawn face is hidden: there is none, it is blended over a handoff
   * window, or it snaps on a frame where the die is airborne and turning at least
   * `snap.minTurnRate`. When false the change may be visible, so the dome covers it with a short
   * blend around the switch frame (handoff.ts's soft cut).
   */
  readonly hidden: boolean
  /**
   * Handoff mode, when the throw gave this die a usable window: the frames the drawn rotation
   * blends over (handoff.ts). Null in snap mode, or when no window was found and the snap stands
   * in. Between `from` and `to` the drawn face is neither offset's; `offsetAt` reports the start
   * offset there.
   */
  readonly handoff: HandoffWindow | null
}

export interface PlaybackPlan {
  readonly mode: PlaybackMode
  readonly recording: Recording
  /** True when body 0 shows d2 and body 1 shows d1, because that needed less rotation. */
  readonly swapped: boolean
  /** Per body. */
  readonly tracks: readonly [DieTrack, DieTrack]
  /** Where the dice rest afterwards: the next throw's start poses and its prevRest. */
  readonly rest: RestState
}

/**
 * Plans the playback of `rec` so the dice land showing `dice`. `prevRest` is the rest state the
 * recording was thrown from, poses and offsets; its offsets are where each body's drawn faces
 * start. Throws a RangeError if the recording was made with other params, if frame 0 is not at
 * prevRest's poses, or if prevRest is not the rest the throw was asked for (`rec.restHash`), as
 * when its offsets are stale: any of these would make the dice jump on the first frame or show
 * the wrong faces.
 */
export function buildPlaybackPlan(
  rec: Recording,
  dice: DicePair,
  prevRest: RestState,
  mode: PlaybackMode,
  params: PhysicsParams = DEFAULT_PARAMS,
): PlaybackPlan {
  const made = rec.paramsFingerprint
  const expected = paramsFingerprint(params)
  if (made !== expected) {
    throw new RangeError(`buildPlaybackPlan: recorded with params ${made}, not ${expected}`)
  }
  for (const die of [0, 1] as const) {
    if (!startsAt(framePose(rec, 0, die), prevRest[die].pose)) {
      throw new RangeError(`buildPlaybackPlan: die ${die} does not start at its prevRest pose`)
    }
  }
  if (hashRest(prevRest) !== rec.restHash) {
    throw new RangeError(
      'buildPlaybackPlan: prevRest is not the rest this recording was thrown from: stale offsets?',
    )
  }
  const starts = [prevRest[0].offset, prevRest[1].offset] as const
  const assign = (faces: readonly [DieFace, DieFace]) => {
    const ends = [
      chooseEndOffset(rec.finalUpAxis[0], faces[0], starts[0]),
      chooseEndOffset(rec.finalUpAxis[1], faces[1], starts[1]),
    ] as const
    const cost = rotationAngleDeg(starts[0], ends[0]) + rotationAngleDeg(starts[1], ends[1])
    return { faces, ends, cost }
  }
  const straight = assign([dice.d1, dice.d2])
  const crossed = assign([dice.d2, dice.d1])
  // Either body may show either die; take the assignment that turns the drawn faces least.
  const swapped = crossed.cost < straight.cost
  const { faces, ends } = swapped ? crossed : straight

  const track = (die: DieIndex): DieTrack => {
    const unchanged = starts[die] === ends[die]
    const choice = remapChoice(rec, die, mode, params)
    return {
      face: faces[die],
      startOffset: starts[die],
      endOffset: ends[die],
      switchFrame: choice.frame,
      hidden: choice.hidden || unchanged,
      // A die that keeps its drawn face has nothing to blend, whatever window the throw offers.
      handoff: unchanged ? null : choice.handoff,
    }
  }
  return {
    mode,
    recording: rec,
    swapped,
    tracks: [track(0), track(1)],
    rest: [
      { pose: rec.finalPoses[0], offset: ends[0] },
      { pose: rec.finalPoses[1], offset: ends[1] },
    ],
  }
}

/** The cube rotation drawn on a body at `frame`. */
export function offsetAt(track: DieTrack, frame: number): number {
  return frame < track.switchFrame ? track.startOffset : track.endOffset
}

/**
 * The rotation to draw for body `die` at `frame`: q_vis = q_body · R, where R is the cube rotation
 * drawn there (an offset's, or the blend between the two across a handoff or soft cut).
 */
export function visualRotation(plan: PlaybackPlan, die: DieIndex, frame: number): Quat {
  const q = normalize(framePose(plan.recording, frame, die).q)
  return multiply(q, drawnRotation(plan.tracks[die], frame))
}

/** The face drawn on top of body `die` at `frame`. */
export function faceShown(plan: PlaybackPlan, die: DieIndex, frame: number): DieFace {
  const q = framePose(plan.recording, frame, die).q
  return visualTopFace(q, offsetAt(plan.tracks[die], frame))
}

/** One ulp of a Float32 near 1: the most storing a value as Float32 moves it, relatively. */
const F32_EPSILON = 2 ** -23

/**
 * Whether a recorded pose is `pose` stored as Float32, with its quaternion normalised. A
 * quaternion and its negation are the same rotation (|q·q′| = 1), so either sign matches.
 */
function startsAt(recorded: Pose, pose: Pose): boolean {
  const stored = (value: number, wanted: number) =>
    Math.abs(value - wanted) <= F32_EPSILON * Math.max(1, Math.abs(wanted))
  const q = normalize(pose.q)
  const turned = (sign: number) =>
    recorded.q.every((value, k) => stored(value, sign * (q[k] ?? Number.NaN)))
  return (
    recorded.p.every((value, k) => stored(value, pose.p[k] ?? Number.NaN)) &&
    (turned(1) || turned(-1))
  )
}

interface RemapChoice extends SnapChoice {
  readonly handoff: HandoffWindow | null
}

/**
 * How die `die`'s drawn rotation changes: in handoff mode the blend over its window, when the
 * throw has one, else — and always in snap mode — the snap frame.
 */
function remapChoice(
  rec: Recording,
  die: DieIndex,
  mode: PlaybackMode,
  params: PhysicsParams,
): RemapChoice {
  if (mode === 'handoff') {
    const span = handoffWindow(rec, die, params)
    if (span !== null) {
      return { frame: span.to, turnRate: slowestTurn(rec, die, span), hidden: true, handoff: span }
    }
  }
  return { ...snapFrame(rec, die, params), handoff: null }
}

export interface SnapChoice {
  readonly frame: number
  /** How fast the body turns from the frame before into `frame`, rad/s. */
  readonly turnRate: number
  /** Whether `frame` and the frame before are airborne and the turn rate is at least the floor. */
  readonly hidden: boolean
}

/**
 * The frame to switch offsets on, so the change of drawn face is lost in the tumble: of the
 * frames that are airborne, along with the frame before, and turn at least `snap.minTurnRate`,
 * the fastest-turning. If there is none, the switch cannot be hidden, and the fastest-turning
 * frame of the throw is the least visible place for it.
 */
export function snapFrame(rec: Recording, die: DieIndex, params: PhysicsParams): SnapChoice {
  const last = rec.settleFrame > 0 ? rec.settleFrame : rec.frameCount - 1
  const { minTurnRate } = params.snap
  let best = { frame: -1, turnRate: -1 }
  let fastest = { frame: Math.min(1, last), turnRate: -1 }
  let wasAirborne = airborne(rec, 0, die, params)
  for (let frame = 1; frame <= last; frame++) {
    const turn = angleBetween(framePose(rec, frame - 1, die).q, framePose(rec, frame, die).q)
    const turnRate = turn * rec.frameRate
    const isAirborne = airborne(rec, frame, die, params)
    if (wasAirborne && isAirborne && turnRate >= minTurnRate && turnRate > best.turnRate) {
      best = { frame, turnRate }
    }
    if (turnRate > fastest.turnRate) fastest = { frame, turnRate }
    wasAirborne = isAirborne
  }
  return best.frame >= 0 ? { ...best, hidden: true } : { ...fastest, hidden: false }
}

/**
 * Whether die `die` is airborne at `frame`: clear of everything by `snap.airborneClearance`
 * there, and touching nothing at any physics step since the previous frame.
 */
export function airborne(
  rec: Recording,
  frame: number,
  die: DieIndex,
  params: PhysicsParams,
): boolean {
  const margin = params.snap.airborneClearance
  // A cutoff above the margin is all this test needs to be exact.
  const free = clearance(rec, frame, die, params, 2 * margin) >= margin
  return free && touchesDuring(rec, frame, die) === 0
}

/**
 * The gap between die `die` and the nearest of the floor, the dome's trimesh and the other die at
 * `frame`, u, from gap.ts: exact below `cutoff`, and above it a lower bound at least `cutoff`.
 */
export function clearance(
  rec: Recording,
  frame: number,
  die: DieIndex,
  params: PhysicsParams,
  cutoff = 1,
): number {
  const pose = framePose(rec, frame, die)
  const other = framePose(rec, frame, die === 0 ? 1 : 0)
  return Math.min(
    floorGap(pose, params.die),
    domeGap(pose, params, cutoff),
    diceGap(pose, other, params.die, cutoff),
  )
}

/**
 * Fresh rest poses showing `faces`, for first load, restore and fallback: both dice flat near the
 * floor centre, apart, at seeded spots and yaws, with each body's own top face drawn as is.
 */
export function synthesizeRest(
  seed: number,
  faces: readonly [DieFace, DieFace],
  params: PhysicsParams = DEFAULT_PARAMS,
): RestState {
  const prng = createPrng(seed)
  const { spread, minSeparation } = params.rest
  const apart = ([ax, az]: [number, number], [bx, bz]: [number, number]) =>
    ((ax - bx) * (ax - bx) + (az - bz) * (az - bz)) * spread * spread
  let a: [number, number]
  let b: [number, number]
  do {
    a = inDisc(prng)
    b = inDisc(prng)
  } while (apart(a, b) < minSeparation * minSeparation)
  const place = ([x, z]: [number, number], face: DieFace): DieRest => {
    const [c, s] = onCircle(prng)
    const q = flatOrientation(rotationShowing(face), yawFromHalfAngle(c, s))
    return {
      pose: { p: [x * spread, params.validity.restHeight, z * spread], q },
      offset: IDENTITY_OFFSET,
    }
  }
  return [place(a, faces[0]), place(b, faces[1])]
}
