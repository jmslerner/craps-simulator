import { describe, expect, it } from 'vitest'
import { AXIS_FACE, rotationAt, type DieFace } from '../physics/core/cube.ts'
import { analyticHop } from '../physics/core/hop.ts'
import { buildPlaybackPlan, synthesizeRest, type DieTrack } from '../physics/core/plan.ts'
import { angleBetween, type Quat } from '../physics/core/quat.ts'
import { upAxis } from '../physics/core/restPose.ts'
import {
  createClock,
  drawnRotation,
  LEAD_IN_MS,
  lastFrameOf,
  MAX_STEP_MS,
  playbackMs,
  READ_PAUSE_MS,
  restPoses,
  sampleAt,
  SOFT_CUT_FRAMES,
} from './playback.ts'

/**
 * The playback math over a scripted hop (pure, no Rapier): the lead-in holds the start pose, the
 * end shows the plan's rest, the drawn faces at the end are the engine's dice, and the soft cut
 * blends only where a snap could not hide.
 */

const REST = synthesizeRest(0x77, [2, 5])
const DICE = { d1: 6 as DieFace, d2: 1 as DieFace }
const PLAN = buildPlaybackPlan(analyticHop(0x99, REST), DICE, REST, 'snap')

/** The face a drawn (visual) quaternion puts on top. */
function topFace(q: Quat): DieFace {
  return AXIS_FACE[upAxis(q)] ?? 1
}

const close = (a: readonly number[], b: readonly number[], eps = 1e-6) =>
  a.length === b.length && a.every((value, k) => Math.abs(value - (b[k] ?? Number.NaN)) <= eps)

describe('sampleAt', () => {
  it('holds the start pose through the lead-in', () => {
    const start = restPoses(REST)
    for (const t of [0, LEAD_IN_MS / 2, LEAD_IN_MS]) {
      const { poses, frame, done } = sampleAt(PLAN, t)
      expect(frame).toBe(0)
      expect(done).toBe(false)
      expect(close(poses[0].p, start[0].p)).toBe(true)
      expect(angleBetween(poses[0].q, start[0].q)).toBeLessThan(1e-6)
      expect(angleBetween(poses[1].q, start[1].q)).toBeLessThan(1e-6)
    }
  })

  it('ends on the plan’s rest, showing the engine’s dice, and is done after the read pause', () => {
    const rec = PLAN.recording
    const endMs = LEAD_IN_MS + (lastFrameOf(rec) / rec.frameRate) * 1000
    const before = sampleAt(PLAN, endMs + READ_PAUSE_MS - 1)
    expect(before.done).toBe(false)
    const after = sampleAt(PLAN, endMs + READ_PAUSE_MS)
    expect(after.done).toBe(true)
    expect(after.frame).toBe(lastFrameOf(rec))
    const resting = restPoses(PLAN.rest)
    for (const die of [0, 1] as const) {
      expect(close(after.poses[die].p, resting[die].p)).toBe(true)
      expect(angleBetween(after.poses[die].q, resting[die].q)).toBeLessThan(1e-6)
    }
    const shown = [topFace(after.poses[0].q), topFace(after.poses[1].q)].sort()
    expect(shown).toStrictEqual([1, 6])
    expect(playbackMs(PLAN)).toBeCloseTo(endMs + READ_PAUSE_MS, 9)
  })

  it('interpolates between frames: a half frame lies between its neighbours', () => {
    const rec = PLAN.recording
    const frameMs = 1000 / rec.frameRate
    const mid = Math.floor(lastFrameOf(rec) / 2)
    const a = sampleAt(PLAN, LEAD_IN_MS + mid * frameMs).poses[0].p
    const b = sampleAt(PLAN, LEAD_IN_MS + (mid + 1) * frameMs).poses[0].p
    const half = sampleAt(PLAN, LEAD_IN_MS + (mid + 0.5) * frameMs).poses[0].p
    for (const k of [0, 1, 2] as const) {
      expect(half[k]).toBeCloseTo((a[k] + b[k]) / 2, 6)
    }
  })

  it('draws every frame at a unit quaternion', () => {
    const rec = PLAN.recording
    for (let t = 0; t <= playbackMs(PLAN); t += 7) {
      for (const pose of sampleAt(PLAN, t).poses) {
        const n = Math.hypot(...pose.q)
        expect(n).toBeCloseTo(1, 6)
      }
    }
    expect(rec.frameCount).toBeGreaterThan(2)
  })
})

describe('drawnRotation', () => {
  const track = (hidden: boolean): DieTrack => ({
    face: 1,
    startOffset: 0,
    endOffset: 5,
    switchFrame: 10,
    hidden,
    handoff: null,
  })

  it('steps at the switch frame when the snap is hidden', () => {
    const t = track(true)
    expect(drawnRotation(t, 9.99)).toStrictEqual(rotationAt(0).quat)
    expect(drawnRotation(t, 10)).toStrictEqual(rotationAt(5).quat)
    expect(drawnRotation(t, 30)).toStrictEqual(rotationAt(5).quat)
  })

  it('blends across the soft-cut window when the snap cannot hide', () => {
    const t = track(false)
    const start = rotationAt(0).quat
    const end = rotationAt(5).quat
    expect(drawnRotation(t, 10 - SOFT_CUT_FRAMES)).toStrictEqual(start)
    expect(drawnRotation(t, 10 + SOFT_CUT_FRAMES)).toStrictEqual(end)
    const mid = drawnRotation(t, 10)
    expect(Math.hypot(...mid)).toBeCloseTo(1, 9)
    const total = angleBetween(start, end)
    expect(angleBetween(start, mid)).toBeGreaterThan(0.2 * total)
    expect(angleBetween(mid, end)).toBeGreaterThan(0.2 * total)
    // Monotonic: later in the window, further from the start.
    let previous = 0
    for (let f = 10 - SOFT_CUT_FRAMES; f <= 10 + SOFT_CUT_FRAMES; f += 0.5) {
      const turned = angleBetween(start, drawnRotation(t, f))
      expect(turned).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = turned
    }
  })

  it('never changes a face that needs no change', () => {
    const same: DieTrack = { ...track(false), endOffset: 0 }
    for (const f of [0, 9, 10, 11, 40]) {
      expect(drawnRotation(same, f)).toStrictEqual(rotationAt(0).quat)
    }
  })
})

describe('createClock', () => {
  it('advances by the wall time, capped per frame and scaled by the speed', () => {
    const clock = createClock(1)
    expect(clock.advance(1000)).toBe(0)
    expect(clock.advance(1016)).toBe(16)
    // A 300 ms hitch counts as one capped step.
    expect(clock.advance(1316)).toBe(16 + MAX_STEP_MS)
    // Time never runs backwards.
    expect(clock.advance(1300)).toBe(16 + MAX_STEP_MS)
    const fast = createClock(1.75)
    fast.advance(0)
    expect(fast.advance(20)).toBeCloseTo(35, 9)
    expect(fast.time).toBeCloseTo(35, 9)
  })
})
