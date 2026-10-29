/**
 * A recorded throw: body poses at 60 Hz plus what playback and the remap need. The frames are one
 * Float32Array, so the worker can hand a recording back as a transferable buffer.
 */
import type { AxisIndex } from './cube.ts'
import type { Quat } from './quat.ts'
import type { DicePoses, Pose } from './restPose.ts'

/** [px, py, pz, qx, qy, qz, qw] per die per frame. */
export const FLOATS_PER_DIE = 7
export const FLOATS_PER_FRAME = 2 * FLOATS_PER_DIE

/** What produced a recording: the popper, a fallback drop, or the scripted analytic hop. */
export type ThrowSource = 'pop' | 'drop' | 'hop'

export const THROW_SOURCES: readonly ThrowSource[] = ['pop', 'drop', 'hop']

export interface Recording {
  /** frameCount × 2 dice × [px, py, pz, qx, qy, qz, qw]: body poses, not the drawn faces. */
  readonly frames: Float32Array
  readonly frameCount: number
  readonly frameRate: number
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
}

export type DieIndex = 0 | 1

/** The body pose of die `die` at `frame`. */
export function framePose(rec: Recording, frame: number, die: DieIndex): Pose {
  if (!Number.isInteger(frame) || frame < 0 || frame >= rec.frameCount) {
    throw new RangeError(`frame ${frame} is outside 0..${rec.frameCount - 1}`)
  }
  const at = frame * FLOATS_PER_FRAME + die * FLOATS_PER_DIE
  const f = (k: number) => rec.frames[at + k] ?? Number.NaN
  return { p: [f(0), f(1), f(2)], q: [f(3), f(4), f(5), f(6)] }
}

/** The body orientation of die `die` at `frame`, read without building a whole pose. */
export function frameRotation(rec: Recording, frame: number, die: DieIndex): Quat {
  return framePose(rec, frame, die).q
}

/**
 * A deterministic 64-bit hash (16 hex digits) of everything in a recording. It reads the frames'
 * IEEE bit patterns, so it pins the simulation bit for bit; golden values are checked in Node.
 */
export function hashRecording(rec: Recording): string {
  const words = new Uint32Array(rec.frames.buffer, rec.frames.byteOffset, rec.frames.length)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  const mix = (word: number) => {
    h1 = Math.imul(h1 ^ word, 2654435761)
    h2 = Math.imul(h2 ^ word, 1597334677)
  }
  for (const word of words) mix(word)
  for (const value of [rec.frameCount, rec.frameRate, rec.settleFrame, rec.seed]) mix(value >>> 0)
  for (const axis of rec.finalUpAxis) mix(axis)
  mix(THROW_SOURCES.indexOf(rec.source))
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return hex(h2) + hex(h1)
}

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}
