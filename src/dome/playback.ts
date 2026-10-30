import { rotationAt } from '../physics/core/cube.ts'
import { drawnRotation, SOFT_CUT_FRAMES } from '../physics/core/handoff.ts'
import type { PlaybackPlan } from '../physics/core/plan.ts'
import { multiply, normalize, slerp, type Quat, type Vec3 } from '../physics/core/quat.ts'
import { framePose, type DieIndex, type Recording } from '../physics/core/recording.ts'
import type { RestState } from '../physics/core/restPose.ts'

/**
 * Playback math (plan §7 Playback): where each die is drawn at a moment of a throw. Positions are
 * lerped and body rotations slerped between the recording's 60 Hz frames, then the plan's drawn
 * cube rotation is applied — q_vis = q_body · R — so the dice land showing the engine's dice. A
 * 120 ms lead-in shows the start pose, the throw plays until the recording settles, and a 250 ms
 * read pause follows before the reveal. Pure functions of time: the renderer calls `sampleAt`
 * each frame, and the controller tests drive it with numbers.
 *
 * The drawn cube rotation at a frame is `drawnRotation` (physics/core/handoff.ts): the handoff
 * blend over the track's window (M10b), the single-frame step of a hidden snap, or the soft cut
 * around a snap that cannot hide (M10a's cover for P1b's ~0.3%). Nothing can change a face at
 * rest: past the blend the end offset is drawn.
 */

export const LEAD_IN_MS = 120
export const READ_PAUSE_MS = 250
/** The most a rendered frame may advance the clock, so a hitch never skips the throw (plan §7). */
export const MAX_STEP_MS = 50
export { drawnRotation, SOFT_CUT_FRAMES }

export type PlaybackSpeed = 'normal' | 'fast'
export const SPEED: Readonly<Record<PlaybackSpeed, number>> = { normal: 1, fast: 1.75 }

export interface VisualPose {
  readonly p: Vec3
  /** The orientation to draw: body rotation times the drawn cube rotation. */
  readonly q: Quat
}

export interface PlaybackSample {
  readonly poses: readonly [VisualPose, VisualPose]
  /** The recorded frame being shown, fractional between two frames. */
  readonly frame: number
  /** True once the throw has settled and the read pause has elapsed. */
  readonly done: boolean
}

/** The last frame worth showing: the settle frame, or the end of an unsettled recording. */
export function lastFrameOf(rec: Recording): number {
  return rec.settleFrame > 0 ? rec.settleFrame : rec.frameCount - 1
}

/** The throw's wall time at normal speed: lead-in, the throw, the read pause. */
export function playbackMs(plan: PlaybackPlan): number {
  const rec = plan.recording
  return LEAD_IN_MS + (lastFrameOf(rec) / rec.frameRate) * 1000 + READ_PAUSE_MS
}

/** Both dice as drawn at `timeMs` into the playback, at normal speed. */
export function sampleAt(plan: PlaybackPlan, timeMs: number): PlaybackSample {
  const rec = plan.recording
  const last = lastFrameOf(rec)
  const thrown = Math.max(0, timeMs - LEAD_IN_MS)
  const frame = Math.min(last, (thrown / 1000) * rec.frameRate)
  const done = thrown >= (last / rec.frameRate) * 1000 + READ_PAUSE_MS
  return { poses: [poseAt(plan, 0, frame), poseAt(plan, 1, frame)], frame, done }
}

function poseAt(plan: PlaybackPlan, die: DieIndex, frame: number): VisualPose {
  const rec = plan.recording
  const lower = Math.floor(frame)
  const upper = Math.min(lower + 1, lastFrameOf(rec))
  const t = frame - lower
  const a = framePose(rec, lower, die)
  const b = framePose(rec, upper, die)
  const p: Vec3 = [
    a.p[0] + (b.p[0] - a.p[0]) * t,
    a.p[1] + (b.p[1] - a.p[1]) * t,
    a.p[2] + (b.p[2] - a.p[2]) * t,
  ]
  const body = t <= 0 ? normalize(a.q) : slerp(normalize(a.q), normalize(b.q), t)
  return { p, q: multiply(body, drawnRotation(plan.tracks[die], frame)) }
}

/** The dice as drawn at rest: each body's pose with its rest offset. */
export function restPoses(rest: RestState): readonly [VisualPose, VisualPose] {
  const pose = ({ pose, offset }: RestState[number]): VisualPose => ({
    p: pose.p,
    q: multiply(normalize(pose.q), rotationAt(offset).quat),
  })
  return [pose(rest[0]), pose(rest[1])]
}

export interface PlaybackClock {
  /** Advances by the wall time since the last call, capped per call, scaled by the speed. */
  advance(nowMs: number): number
  /** Playback time so far, ms. */
  readonly time: number
}

/** The playback clock: `min(dt, MAX_STEP_MS) × speed` per rendered frame (plan §7). */
export function createClock(speed: number): PlaybackClock {
  let time = 0
  let last: number | null = null
  return {
    advance(nowMs) {
      if (last !== null) time += Math.min(Math.max(0, nowMs - last), MAX_STEP_MS) * speed
      last = nowMs
      return time
    },
    get time() {
      return time
    },
  }
}
