/**
 * A recorded throw: body poses at 60 Hz, contact flags at every physics step, and what playback
 * and the remap need. Frames and contacts are typed arrays, so the worker can hand a recording
 * back with `[rec.frames.buffer, rec.contacts.buffer]` as transferables.
 */
import type { AxisIndex } from './cube.ts'
import { createHasher } from './hash.ts'
import type { Quat } from './quat.ts'
import type { DicePoses, Pose } from './restPose.ts'

/** [px, py, pz, qx, qy, qz, qw] per die per frame. */
export const FLOATS_PER_DIE = 7
export const FLOATS_PER_FRAME = 2 * FLOATS_PER_DIE

/** What produced a recording: the popper, a fallback drop, or the scripted analytic hop. */
export type ThrowSource = 'pop' | 'drop' | 'hop'

const THROW_SOURCES: readonly ThrowSource[] = ['pop', 'drop', 'hop']

/**
 * Contact flags, one byte per physics step: die 0 in bits 0–2, die 1 in bits 3–5. A die touches
 * something while its exact gap to it is at most `contact.touchGap` (see gap.ts).
 */
export const TOUCH_FLOOR = 1
export const TOUCH_DOME = 2
/** Set for both dice at once: they touch each other. */
export const TOUCH_DIE = 4
export const TOUCH_ANY = TOUCH_FLOOR | TOUCH_DOME | TOUCH_DIE
const BITS_PER_DIE = 3

export interface Recording {
  /**
   * frameCount × 2 dice × [px, py, pz, qx, qy, qz, qw]: body poses, not the drawn faces. Over a
   * plain ArrayBuffer, so `frames.buffer` can go in a postMessage transfer list.
   */
  readonly frames: Float32Array<ArrayBuffer>
  readonly frameCount: number
  readonly frameRate: number
  /** Physics steps per frame: frame f is the state after step f × stepsPerFrame. */
  readonly stepsPerFrame: number
  /**
   * One byte of TOUCH_* flags per step, for steps 0 (the start poses) to the last frame's step:
   * (frameCount − 1) × stepsPerFrame + 1 bytes. Read it with touchesAt and touchesDuring.
   */
  readonly contacts: Uint8Array<ArrayBuffer>
  /**
   * The first frame at which both dice are at rest, or -1 if they never settled. The frames after
   * it confirm the rest; the last frame equals `finalPoses`.
   */
  readonly settleFrame: number
  readonly finalPoses: DicePoses
  /** Per die, the body-local axis pointing up at the end: a_up for the remap. */
  readonly finalUpAxis: readonly [AxisIndex, AxisIndex]
  readonly source: ThrowSource
  /** The seed this attempt drew its impulses from. */
  readonly seed: number
  /** paramsFingerprint of the params it was made with; buildPlaybackPlan checks it. */
  readonly paramsFingerprint: string
}

export type DieIndex = 0 | 1

/** The body pose of die `die` at `frame`. */
export function framePose(rec: Recording, frame: number, die: DieIndex): Pose {
  if (!Number.isInteger(frame) || frame < 0 || frame >= rec.frameCount) {
    throw new RangeError(`frame ${frame} is outside 0..${rec.frameCount - 1}`)
  }
  return readPose(rec.frames, frame, die)
}

/** Both poses at `frame` of a raw frame buffer, as the Float32 values stored there. */
export function readPoses(frames: Float32Array, frame: number): DicePoses {
  return [readPose(frames, frame, 0), readPose(frames, frame, 1)]
}

function readPose(frames: Float32Array, frame: number, die: DieIndex): Pose {
  const at = frame * FLOATS_PER_FRAME + die * FLOATS_PER_DIE
  const f = (k: number) => frames[at + k] ?? Number.NaN
  const q: Quat = [f(3), f(4), f(5), f(6)]
  return { p: [f(0), f(1), f(2)], q }
}

/** The contact byte for one step: `touches` (a mask of TOUCH_* flags) for each die. */
export function contactByte(touches: readonly [number, number]): number {
  return (touches[0] & TOUCH_ANY) | ((touches[1] & TOUCH_ANY) << BITS_PER_DIE)
}

/** What die `die` touched after physics step `step`: a mask of TOUCH_* flags. */
export function touchesAt(rec: Recording, step: number, die: DieIndex): number {
  if (!Number.isInteger(step) || step < 0 || step >= rec.contacts.length) {
    throw new RangeError(`step ${step} is outside 0..${rec.contacts.length - 1}`)
  }
  return ((rec.contacts[step] ?? 0) >> (die * BITS_PER_DIE)) & TOUCH_ANY
}

/**
 * What die `die` touched at any step since the previous frame, up to and including `frame`
 * (frame 0: the start poses alone). Zero means it moved freely all the way into this frame.
 */
export function touchesDuring(rec: Recording, frame: number, die: DieIndex): number {
  framePose(rec, frame, die) // checks the frame
  const last = frame * rec.stepsPerFrame
  let touches = 0
  for (let step = Math.max(0, last - rec.stepsPerFrame + 1); step <= last; step++) {
    touches |= touchesAt(rec, step, die)
  }
  return touches
}

/**
 * A deterministic 64-bit hash (16 hex digits) of everything in a recording. It reads the frames'
 * IEEE bit patterns, so it pins the simulation bit for bit; golden values are checked in Node.
 */
export function hashRecording(rec: Recording): string {
  const hasher = createHasher()
  for (const word of new Uint32Array(rec.frames.buffer, rec.frames.byteOffset, rec.frames.length)) {
    hasher.mix(word)
  }
  for (const value of [rec.frameCount, rec.frameRate, rec.settleFrame, rec.seed]) {
    hasher.mix(value >>> 0)
  }
  for (const axis of rec.finalUpAxis) hasher.mix(axis)
  hasher.mix(THROW_SOURCES.indexOf(rec.source))
  hasher.mix(rec.stepsPerFrame)
  hasher.mix(rec.contacts.length)
  for (const byte of rec.contacts) hasher.mix(byte)
  for (let i = 0; i < rec.paramsFingerprint.length; i++) {
    hasher.mix(rec.paramsFingerprint.charCodeAt(i))
  }
  return hasher.digest()
}
