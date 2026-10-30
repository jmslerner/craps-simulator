import { beforeAll, describe, expect, it } from 'vitest'
import { DIE_FACES, FACE_NORMALS, rotationAt, type DieFace } from './cube.ts'
import { domeFaces } from './dome.ts'
import { circumradius, contactAt } from './gap.ts'
import {
  ballClearance,
  drawnRotation,
  handoffWindow,
  slowestTurn,
  SOFT_CUT_FRAMES,
  windowFrames,
} from './handoff.ts'
import { analyticHop } from './hop.ts'
import { DEFAULT_PARAMS } from './params.ts'
import {
  buildPlaybackPlan,
  faceShown,
  snapFrame,
  synthesizeRest,
  visualRotation,
  type DicePair,
  type DieTrack,
  type PlaybackPlan,
} from './plan.ts'
import { createPrng, deriveSeed, type Prng } from './prng.ts'
import {
  angleBetween,
  fromAxisAngle,
  IDENTITY,
  multiply,
  normalize,
  rotate,
  type Quat,
} from './quat.ts'
import {
  deeper,
  FLOATS_PER_DIE,
  FLOATS_PER_FRAME,
  framePose,
  NO_DEPTH,
  readPoses,
  touchesAt,
  type Recording,
} from './recording.ts'
import { posesOf, restOf, type DicePoses, type RestState } from './restPose.ts'
import { simulateThrow } from './simulate.ts'
import { initPhysics } from './world.ts'

/**
 * The §10 M10b handoff: over seeded chained throws planned in handoff mode, every window is
 * 100–250 ms long, lies before the settle frame, has no contact at any physics step inside it,
 * keeps the die's bounding ball clear by the margin at every frame and turns at least 12 rad/s at
 * every step; frame 0 draws the previous rest within 1e-6; the dice land on the engine's faces;
 * and a die without a window falls back to the snap, soft cut included. Hand-built recordings pin
 * the window rules one at a time.
 */

/** Pinned so that any failure reproduces. */
const META_SEED = 0xd1ce
const PLANS = 400
const SESSION = 25
const COS_4_DEG = Math.cos((4 * Math.PI) / 180)
const params = DEFAULT_PARAMS
const { margin, minTurnRate } = params.handoff

interface Sample {
  readonly plan: PlaybackPlan
  readonly prevRest: RestState
  readonly dice: DicePair
}

const face = (prng: Prng): DieFace => DIE_FACES[Math.floor(prng.next() * 6)] ?? 1
const dice = [0, 1] as const

const samples: Sample[] = []

beforeAll(async () => {
  await initPhysics()
  const prng = createPrng(META_SEED)
  let rest = synthesizeRest(META_SEED, [face(prng), face(prng)])
  for (let index = 0; index < PLANS; index++) {
    if (index % SESSION === 0) {
      rest = synthesizeRest(deriveSeed(META_SEED, index), [face(prng), face(prng)])
    }
    const seed = prng.nextUint32()
    const roll = { d1: face(prng), d2: face(prng) }
    const { recording } = simulateThrow(seed, rest)
    const plan = buildPlaybackPlan(recording, roll, rest, 'handoff')
    samples.push({ plan, prevRest: rest, dice: roll })
    rest = plan.rest
  }
}, 60_000)

/** A recording of the dice at the given poses, one pair per frame, held through each frame's steps. */
function recordingOf(frames: readonly DicePoses[], settleFrame = frames.length - 1): Recording {
  const { stepsPerFrame } = params
  const frameCount = frames.length
  const data = new Float32Array(frameCount * FLOATS_PER_FRAME)
  const contacts = new Uint8Array((frameCount - 1) * stepsPerFrame + 1)
  let stepDepths = NO_DEPTH
  frames.forEach((poses, frame) => {
    poses.forEach(({ p, q }, die) => {
      data.set([...p, ...q], frame * FLOATS_PER_FRAME + die * FLOATS_PER_DIE)
    })
    const { byte, depths } = contactAt(readPoses(data, frame), params)
    contacts.fill(byte, Math.max(0, (frame - 1) * stepsPerFrame + 1), frame * stepsPerFrame + 1)
    stepDepths = deeper(stepDepths, depths)
  })
  const rec = analyticHop(1, restOf(frames[0] ?? posesOf(synthesizeRest(1, [1, 1]))))
  return {
    ...rec,
    frames: data,
    frameCount,
    contacts,
    stepDepths,
    settleFrame,
    finalPoses: readPoses(data, frameCount - 1),
  }
}

/**
 * Die 0 at `height`, turning about a tilted axis by `turn(frame)` radians per frame for 30
 * frames, then landed flat; die 1 at rest far away unless `other` says where it is.
 */
function spinning(
  turn: (frame: number) => number,
  height = 3,
  other: (frame: number) => DicePoses[number] = () => ({ p: [3, 0.5, 3], q: IDENTITY }),
): Recording {
  let q: Quat = IDENTITY
  const axis = normalize([1, 2, 0.5, 0]).slice(0, 3) as unknown as [number, number, number]
  const frames: DicePoses[] = []
  for (let frame = 0; frame < 40; frame++) {
    if (frame < 30) q = normalize(multiply(fromAxisAngle(axis, turn(frame)), q))
    const y = frame < 30 ? height : 0.5
    frames.push([{ p: [0, y, 0], q }, other(frame)])
  }
  return recordingOf(frames, 32)
}

const [MIN_FRAMES, MAX_FRAMES] = windowFrames(analyticHop(1, synthesizeRest(1, [1, 1])))

describe(`${PLANS} seeded throws planned in handoff mode`, () => {
  it('give most dice that change face a window; the rest snap (hidden or soft cut)', () => {
    let changes = 0
    let blended = 0
    let snapped = 0
    let covered = 0
    for (const { plan } of samples) {
      for (const die of dice) {
        const track = plan.tracks[die]
        if (track.startOffset === track.endOffset) {
          expect(track.hidden).toBe(true)
          continue
        }
        changes++
        if (track.handoff !== null) {
          blended++
          expect(track.hidden).toBe(true)
          expect(track.switchFrame).toBe(track.handoff.to)
          continue
        }
        snapped++
        if (!track.hidden) covered++
        const snap = snapFrame(plan.recording, die, params)
        expect([snap.frame, snap.hidden]).toEqual([track.switchFrame, track.hidden])
      }
    }
    expect(changes).toBeGreaterThan(500)
    // Measured on these seeds: 60.7% of changing dice blend. The rest have no 100 ms stretch
    // that is clear, contact-free and fast at once (the popper sends dice to a mean apex of 6 u
    // under a 6.6 u clearance ceiling, so the fall is short); they snap, 99.7% hidden.
    expect(blended / changes).toBeGreaterThanOrEqual(0.5)
    expect(blended + snapped).toBe(changes)
    // The soft cut is only ever needed for a snap that could not hide.
    expect(covered).toBeLessThanOrEqual(snapped)
  })

  it('windows are 100–250 ms long and end before the dice settle', () => {
    for (const { plan } of samples) {
      const rec = plan.recording
      for (const track of plan.tracks) {
        if (track.handoff === null) continue
        const { from, to } = track.handoff
        expect(Number.isInteger(from) && Number.isInteger(to)).toBe(true)
        expect(from).toBeGreaterThanOrEqual(0)
        expect(to - from).toBeGreaterThanOrEqual(MIN_FRAMES)
        expect(to - from).toBeLessThanOrEqual(MAX_FRAMES)
        expect((to - from) / rec.frameRate).toBeGreaterThanOrEqual(
          params.handoff.minDuration - 1e-9,
        )
        expect((to - from) / rec.frameRate).toBeLessThanOrEqual(params.handoff.maxDuration + 1e-9)
        expect(to).toBeLessThan(rec.settleFrame)
      }
    }
  })

  it('no contact at any physics step inside a window', () => {
    for (const { plan } of samples) {
      const rec = plan.recording
      for (const die of dice) {
        const span = plan.tracks[die].handoff
        if (span === null) continue
        for (
          let step = span.from * rec.stepsPerFrame;
          step <= span.to * rec.stepsPerFrame;
          step++
        ) {
          expect(touchesAt(rec, step, die)).toBe(0)
        }
      }
    }
  })

  it('the clearance rules hold at every frame of a window', () => {
    const reach = circumradius(params.die)
    const { inradius } = domeFaces(params.dome)
    for (const { plan } of samples) {
      const rec = plan.recording
      for (const die of dice) {
        const span = plan.tracks[die].handoff
        if (span === null) continue
        for (let frame = span.from; frame <= span.to; frame++) {
          expect(ballClearance(rec, frame, die, params)).toBeGreaterThanOrEqual(margin)
          // The same rules spelled out: centre over the floor, inside the dome, off the other die.
          const p = framePose(rec, frame, die).p
          const o = framePose(rec, frame, die === 0 ? 1 : 0).p
          expect(p[1]).toBeGreaterThanOrEqual(reach + margin)
          expect(Math.hypot(...p)).toBeLessThanOrEqual(inradius - reach - margin)
          expect(Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2])).toBeGreaterThanOrEqual(
            2 * reach + margin,
          )
        }
      }
    }
  })

  it('the die turns at least 12 rad/s at every step of a window', () => {
    const rates: number[] = []
    for (const { plan } of samples) {
      const rec = plan.recording
      for (const die of dice) {
        const span = plan.tracks[die].handoff
        if (span === null) continue
        const slowest = slowestTurn(rec, die, span)
        expect(slowest).toBeGreaterThanOrEqual(minTurnRate)
        for (let frame = span.from + 1; frame <= span.to; frame++) {
          const turn = angleBetween(framePose(rec, frame - 1, die).q, framePose(rec, frame, die).q)
          expect(turn * rec.frameRate).toBeGreaterThanOrEqual(minTurnRate)
        }
        rates.push(slowest)
      }
    }
    // 400 throws, 800 dice, about 71% changing face and 61% of those blending: ~350 windows.
    expect(rates.length).toBeGreaterThan(300)
  })

  it('frame 0 draws the previous rest within 1e-6, so nothing jumps as the throw begins', () => {
    for (const { plan, prevRest } of samples) {
      for (const die of dice) {
        const before = multiply(
          normalize(prevRest[die].pose.q),
          rotationAt(prevRest[die].offset).quat,
        )
        expect(angleBetween(visualRotation(plan, die, 0), before)).toBeLessThan(1e-6)
        // And the blend has not begun: the start offset is drawn whole.
        expect(drawnRotation(plan.tracks[die], 0)).toStrictEqual(
          rotationAt(plan.tracks[die].startOffset).quat,
        )
      }
    }
  })

  it('land showing the engine’s dice, from the moment they come to rest', () => {
    for (const { plan, dice: roll } of samples) {
      const rec = plan.recording
      const wanted = plan.swapped ? [roll.d2, roll.d1] : [roll.d1, roll.d2]
      for (const die of dice) {
        for (let frame = rec.settleFrame; frame < rec.frameCount; frame++) {
          expect(faceShown(plan, die, frame)).toBe(wanted[die])
        }
        const up = rotate(
          visualRotation(plan, die, rec.frameCount - 1),
          FACE_NORMALS[wanted[die] ?? 1],
        )
        expect(up[1]).toBeGreaterThan(COS_4_DEG)
        expect(plan.rest[die]).toEqual({
          pose: rec.finalPoses[die],
          offset: plan.tracks[die].endOffset,
        })
      }
    }
  })

  it('draws a unit rotation at every frame, blending monotonically across the window', () => {
    for (const { plan } of samples) {
      for (const track of plan.tracks) {
        if (track.handoff === null) continue
        const start = rotationAt(track.startOffset).quat
        const end = rotationAt(track.endOffset).quat
        let previous = 0
        for (let frame = track.handoff.from; frame <= track.handoff.to; frame += 0.25) {
          const drawn = drawnRotation(track, frame)
          expect(Math.hypot(...drawn)).toBeCloseTo(1, 9)
          const turned = angleBetween(start, drawn)
          expect(turned).toBeGreaterThanOrEqual(previous - 1e-9)
          previous = turned
        }
        expect(drawnRotation(track, track.handoff.to)).toStrictEqual(end)
        expect(drawnRotation(track, track.handoff.from)).toStrictEqual(start)
      }
    }
  })

  it('plans the same recording identically in snap mode but for the remap timing', () => {
    for (const { plan, prevRest, dice: roll } of samples.slice(0, 50)) {
      const snap = buildPlaybackPlan(plan.recording, roll, prevRest, 'snap')
      expect(snap.swapped).toBe(plan.swapped)
      expect(snap.rest).toEqual(plan.rest)
      for (const die of dice) {
        expect(snap.tracks[die].handoff).toBeNull()
        expect([snap.tracks[die].startOffset, snap.tracks[die].endOffset]).toEqual([
          plan.tracks[die].startOffset,
          plan.tracks[die].endOffset,
        ])
      }
    }
  })
})

describe('handoffWindow on hand-built recordings', () => {
  const reach = circumradius(params.die)

  it('finds a window in a clear, fast spin and clips it to the longest allowed', () => {
    // 0.4 rad a frame is 24 rad/s: well over the floor, for 30 airborne frames.
    const rec = spinning(() => 0.4)
    const span = handoffWindow(rec, 0, params)
    expect(span).not.toBeNull()
    expect((span?.to ?? 0) - (span?.from ?? 0)).toBe(MAX_FRAMES)
    expect(span?.from).toBeGreaterThanOrEqual(0)
    expect(span?.to).toBeLessThanOrEqual(29)
    expect(handoffWindow(rec, 1, params)).toBeNull()
  })

  it('takes the stretch that turns most when the run is longer than the window', () => {
    // The steps into frames 20–29 turn twice as fast as the rest, so the window ends at 29.
    const rec = spinning((frame) => (frame >= 20 && frame < 30 ? 0.8 : 0.4))
    const span = handoffWindow(rec, 0, params)
    expect(span).toEqual({ from: 29 - MAX_FRAMES, to: 29 })
    // A spin that slows as it goes turns most at the start: the window starts at frame 0.
    expect(
      handoffWindow(
        spinning((frame) => 0.4 - 0.004 * frame),
        0,
        params,
      ),
    ).toEqual({
      from: 0,
      to: MAX_FRAMES,
    })
  })

  it('needs the full minimum: a run one step short gives no window', () => {
    // Only the steps into frames 10..10 + MIN_FRAMES − 2 turn fast enough: MIN_FRAMES − 1 steps.
    const short = spinning((frame) => (frame >= 10 && frame < 10 + MIN_FRAMES - 1 ? 0.4 : 0.05))
    expect(handoffWindow(short, 0, params)).toBeNull()
    // One more step, and the window runs from the frame before the first fast step.
    const enough = spinning((frame) => (frame >= 10 && frame < 10 + MIN_FRAMES ? 0.4 : 0.05))
    expect(handoffWindow(enough, 0, params)).toEqual({ from: 9, to: 9 + MIN_FRAMES })
  })

  it('refuses a die too low for its bounding ball to clear the floor', () => {
    expect(
      handoffWindow(
        spinning(() => 0.4, reach + margin - 1e-3),
        0,
        params,
      ),
    ).toBeNull()
    expect(
      handoffWindow(
        spinning(() => 0.4, reach + margin + 1e-3),
        0,
        params,
      ),
    ).not.toBeNull()
  })

  it('refuses a die whose ball comes within reach of the other die', () => {
    const near = spinning(
      () => 0.4,
      3,
      () => ({ p: [2 * reach + margin - 1e-3, 3, 0], q: IDENTITY }),
    )
    expect(handoffWindow(near, 0, params)).toBeNull()
    const clear = spinning(
      () => 0.4,
      3,
      () => ({ p: [2 * reach + margin + 1e-3, 3, 0], q: IDENTITY }),
    )
    expect(handoffWindow(clear, 0, params)).not.toBeNull()
  })

  it('refuses a die too close to the dome wall', () => {
    const { inradius } = domeFaces(params.dome)
    const frames = (x: number): DicePoses[] => {
      let q: Quat = IDENTITY
      const out: DicePoses[] = []
      for (let frame = 0; frame < 40; frame++) {
        if (frame < 30) q = normalize(multiply(fromAxisAngle([0, 1, 0], 0.4), q))
        out.push([
          { p: [frame < 30 ? x : 0, frame < 30 ? 3 : 0.5, 0], q },
          { p: [-3, 0.5, -3], q: IDENTITY },
        ])
      }
      return out
    }
    const edge = Math.sqrt((inradius - reach - margin) ** 2 - 9)
    expect(handoffWindow(recordingOf(frames(edge + 1e-3), 32), 0, params)).toBeNull()
    expect(handoffWindow(recordingOf(frames(edge - 1e-3), 32), 0, params)).not.toBeNull()
  })

  it('refuses a spin under 12 rad/s, however clear', () => {
    // 0.19 rad a frame is 11.4 rad/s.
    expect(
      handoffWindow(
        spinning(() => 0.19),
        0,
        params,
      ),
    ).toBeNull()
    expect(
      handoffWindow(
        spinning(() => 0.21),
        0,
        params,
      ),
    ).not.toBeNull()
  })

  it('refuses steps with a contact, even high and spinning', () => {
    const rec = spinning(() => 0.4)
    const steps = rec.stepsPerFrame
    // A contact on one step in the middle of the flight splits the run in two short halves.
    const touched = new Uint8Array(rec.contacts)
    touched[15 * steps - 3] = 1
    const split = { ...rec, contacts: touched }
    const span = handoffWindow(split, 0, params)
    // Each half is at most 15 frames, so a window may remain, but never across the contact.
    if (span !== null) {
      expect(span.to <= 14 || span.from >= 15).toBe(true)
    }
    // Contacts every step: no window at all.
    expect(
      handoffWindow({ ...rec, contacts: new Uint8Array(rec.contacts.length).fill(1) }, 0, params),
    ).toBeNull()
  })

  it('ballClearance is the least of the three rooms', () => {
    const rec = spinning(
      () => 0.4,
      3,
      () => ({ p: [2.5, 3, 0], q: IDENTITY }),
    )
    expect(ballClearance(rec, 5, 0, params)).toBeCloseTo(2.5 - 2 * reach, 6)
    const high = spinning(() => 0.4, 1.2)
    expect(ballClearance(high, 5, 0, params)).toBeCloseTo(1.2 - reach, 6)
  })

  it('the analytic hop always has a window: the fallback blends too', () => {
    const prng = createPrng(0xabc)
    for (let seed = 0; seed < 40; seed++) {
      const rest = synthesizeRest(seed, [face(prng), face(prng)])
      const hop = analyticHop(deriveSeed(0xabc, seed), rest)
      for (const die of dice) expect(handoffWindow(hop, die, params)).not.toBeNull()
      const plan = buildPlaybackPlan(hop, { d1: face(prng), d2: face(prng) }, rest, 'handoff')
      for (const track of plan.tracks) {
        if (track.startOffset !== track.endOffset) expect(track.handoff).not.toBeNull()
      }
    }
  })
})

describe('drawnRotation on a track', () => {
  const track = (handoff: DieTrack['handoff'], hidden = true): DieTrack => ({
    face: 1,
    startOffset: 0,
    endOffset: 5,
    switchFrame: handoff === null ? 10 : handoff.to,
    hidden,
    handoff,
  })

  it('blends over the handoff window and holds the ends outside it', () => {
    const t = track({ from: 8, to: 20 })
    const start = rotationAt(0).quat
    const end = rotationAt(5).quat
    expect(drawnRotation(t, 0)).toStrictEqual(start)
    expect(drawnRotation(t, 8)).toStrictEqual(start)
    expect(drawnRotation(t, 20)).toStrictEqual(end)
    expect(drawnRotation(t, 50)).toStrictEqual(end)
    const mid = drawnRotation(t, 14)
    const total = angleBetween(start, end)
    expect(angleBetween(start, mid)).toBeCloseTo(total / 2, 6)
    // Eased: slow at the ends, so the first quarter turns less than the second.
    const quarter = angleBetween(start, drawnRotation(t, 11))
    expect(quarter).toBeLessThan(total / 4)
    expect(quarter).toBeGreaterThan(0)
  })

  it('steps at the switch frame for a hidden snap and soft-cuts an unhidden one', () => {
    const hiddenSnap = track(null, true)
    expect(drawnRotation(hiddenSnap, 9.99)).toStrictEqual(rotationAt(0).quat)
    expect(drawnRotation(hiddenSnap, 10)).toStrictEqual(rotationAt(5).quat)
    const cut = track(null, false)
    expect(drawnRotation(cut, 10 - SOFT_CUT_FRAMES)).toStrictEqual(rotationAt(0).quat)
    expect(drawnRotation(cut, 10 + SOFT_CUT_FRAMES)).toStrictEqual(rotationAt(5).quat)
    const mid = drawnRotation(cut, 10)
    expect(angleBetween(rotationAt(0).quat, mid)).toBeGreaterThan(0)
    expect(angleBetween(mid, rotationAt(5).quat)).toBeGreaterThan(0)
  })

  it('never changes a face that needs no change', () => {
    const same: DieTrack = { ...track({ from: 8, to: 20 }), endOffset: 0 }
    for (const f of [0, 9, 14, 20, 40]) {
      expect(drawnRotation(same, f)).toStrictEqual(rotationAt(0).quat)
    }
  })
})
