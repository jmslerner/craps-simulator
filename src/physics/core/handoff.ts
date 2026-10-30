/**
 * The handoff (§7 Face remap, M10b): instead of switching the drawn cube rotation in one frame,
 * slerp R[o_start] → R[o_end] over a 100–250 ms window of the throw in which the die
 *
 * - touches nothing at any physics step (the recording's contact bytes),
 * - keeps its bounding ball clear of the floor, the dome and the other die by `handoff.margin`
 *   (`ballClearance`), so whatever the blend draws on the body, the drawn die meets nothing, and
 * - turns at least `handoff.minTurnRate` from each frame to the next, so the extra rotation the
 *   blend adds is lost in the tumble.
 *
 * `handoffWindow` finds such a window or says there is none, in which case the plan falls back to
 * the snap (plan.ts). `drawnRotation` is the cube rotation to draw on a track at a fractional
 * frame: the blend over its window, the single-frame step of a hidden snap, or the short soft cut
 * that covers the few snaps that cannot hide (M10a's cover for P1b's ~0.3%). Pure functions over
 * recordings and tracks: no Rapier, so the dome runs them on the main thread.
 */
import { domeFaces } from './dome.ts'
import { circumradius } from './gap.ts'
import { DEFAULT_PARAMS, type PhysicsParams } from './params.ts'
import type { DieTrack } from './plan.ts'
import { rotationAt } from './cube.ts'
import { angleBetween, slerp, type Quat } from './quat.ts'
import { framePose, touchesDuring, type DieIndex, type Recording } from './recording.ts'

/** The frames the blend runs over: R[start] at `from`, R[end] from `to` on. */
export interface HandoffWindow {
  readonly from: number
  readonly to: number
}

/** Half the blend width, in recorded frames, around a snap that cannot hide. */
export const SOFT_CUT_FRAMES = 3

/**
 * How much room die `die`'s bounding ball has at `frame`, u: the least of its centre's height
 * over the floor, its depth inside the dome's inscribed sphere and its distance from the other
 * die's ball, each less the circumradius (twice, for the other die). A lower bound on the exact
 * gap (gap.ts) at every orientation of the die, so while it is positive any cube rotation drawn
 * on the body meets nothing.
 */
export function ballClearance(
  rec: Recording,
  frame: number,
  die: DieIndex,
  params: PhysicsParams = DEFAULT_PARAMS,
): number {
  const reach = circumradius(params.die)
  const { inradius } = domeFaces(params.dome)
  const [px, py, pz] = framePose(rec, frame, die).p
  const [ox, oy, oz] = framePose(rec, frame, die === 0 ? 1 : 0).p
  const centre = Math.sqrt(px * px + py * py + pz * pz)
  const apart = Math.sqrt((px - ox) ** 2 + (py - oy) ** 2 + (pz - oz) ** 2)
  return Math.min(py - reach, inradius - centre - reach, apart - 2 * reach)
}

/** The frames a window may span, from the durations in `params.handoff`: [min, max]. */
export function windowFrames(
  rec: Recording,
  params: PhysicsParams = DEFAULT_PARAMS,
): [number, number] {
  const { minDuration, maxDuration } = params.handoff
  // A whisker of slack, so 0.1 s at 60 Hz is 6 frames and not 7 from a rounding error.
  const min = Math.max(1, Math.ceil(minDuration * rec.frameRate - 1e-9))
  const max = Math.max(min, Math.floor(maxDuration * rec.frameRate + 1e-9))
  return [min, max]
}

/**
 * The window to blend die `die`'s drawn rotation over, or null when the throw has none: the
 * longest run of frames (clipped to `maxDuration`) at which the die has moved freely since the
 * previous frame, with its bounding ball clear by `margin` at both ends of each step and turning
 * at least `minTurnRate` across it — and, of the runs at least `minDuration` long, the stretch
 * that turns most in total. Ties go to the earliest. Only frames up to the settle frame count.
 */
export function handoffWindow(
  rec: Recording,
  die: DieIndex,
  params: PhysicsParams = DEFAULT_PARAMS,
): HandoffWindow | null {
  const last = rec.settleFrame > 0 ? rec.settleFrame : rec.frameCount - 1
  const { margin, minTurnRate } = params.handoff
  const [minFrames, maxFrames] = windowFrames(rec, params)
  // Per frame f ≥ 1: whether the step (f − 1, f] can carry the blend, and how fast it turns.
  const usable: boolean[] = [false]
  const rate: number[] = [0]
  let clearBefore = ballClearance(rec, 0, die, params) >= margin
  for (let frame = 1; frame <= last; frame++) {
    const clearNow = ballClearance(rec, frame, die, params) >= margin
    const turn =
      angleBetween(framePose(rec, frame - 1, die).q, framePose(rec, frame, die).q) * rec.frameRate
    rate.push(turn)
    usable.push(
      clearBefore && clearNow && turn >= minTurnRate && touchesDuring(rec, frame, die) === 0,
    )
    clearBefore = clearNow
  }
  let best: HandoffWindow | null = null
  let bestTurn = -Infinity
  let runStart = -1
  for (let frame = 1; frame <= last + 1; frame++) {
    if (frame <= last && usable[frame]) {
      if (runStart < 0) runStart = frame
      continue
    }
    if (runStart >= 0) {
      // Steps runStart..frame − 1 are usable: the window [runStart − 1, frame − 1].
      const length = frame - runStart
      if (length >= minFrames) {
        const span = Math.min(length, maxFrames)
        for (let first = runStart; first + span - 1 <= frame - 1; first++) {
          let turned = 0
          for (let step = first; step < first + span; step++) turned += rate[step] ?? 0
          // Equal to rounding counts as a tie, so the earliest of equal windows is kept.
          if (turned > bestTurn + 1e-9) {
            bestTurn = turned
            best = { from: first - 1, to: first + span - 1 }
          }
        }
      }
      runStart = -1
    }
  }
  return best
}

/** The slowest turn, rad/s over a frame, at any step of the window `span`. */
export function slowestTurn(rec: Recording, die: DieIndex, span: HandoffWindow): number {
  let slowest = Infinity
  for (let frame = span.from + 1; frame <= span.to; frame++) {
    const turn = angleBetween(framePose(rec, frame - 1, die).q, framePose(rec, frame, die).q)
    slowest = Math.min(slowest, turn * rec.frameRate)
  }
  return slowest
}

/** Hermite ease: still at both ends of the blend. */
function ease(k: number): number {
  if (k <= 0) return 0
  if (k >= 1) return 1
  return k * k * (3 - 2 * k)
}

/**
 * The cube rotation drawn on a track at fractional `frame`: the start offset, the end offset, or
 * the blend between them — over the handoff window when the track has one, over the soft cut
 * around the switch frame when its snap could not hide, and a step at the switch frame otherwise.
 * Nothing here can change a face at rest: past the blend the end offset is drawn.
 */
export function drawnRotation(track: DieTrack, frame: number): Quat {
  const start = rotationAt(track.startOffset).quat
  const end = rotationAt(track.endOffset).quat
  if (track.startOffset === track.endOffset) return end
  if (track.handoff !== null) {
    const { from, to } = track.handoff
    const k = to > from ? (frame - from) / (to - from) : frame >= to ? 1 : 0
    if (k <= 0) return start
    if (k >= 1) return end
    return slerp(start, end, ease(k))
  }
  if (track.hidden) return frame >= track.switchFrame ? end : start
  const k = (frame - (track.switchFrame - SOFT_CUT_FRAMES)) / (2 * SOFT_CUT_FRAMES)
  if (k <= 0) return start
  if (k >= 1) return end
  return slerp(start, end, ease(k))
}
