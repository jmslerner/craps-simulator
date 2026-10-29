import { describe, expect, it } from 'vitest'
import {
  contactByte,
  FLOATS_PER_FRAME,
  framePose,
  hashRecording,
  readPoses,
  touchesAt,
  touchesDuring,
  TOUCH_DIE,
  TOUCH_DOME,
  TOUCH_FLOOR,
  type Recording,
} from './recording.ts'

const STEPS_PER_FRAME = 8

function recording(frameCount: number): Recording {
  const frames = new Float32Array(frameCount * FLOATS_PER_FRAME)
  frames.forEach((_, i) => (frames[i] = Math.sin(i) * 3))
  const contacts = new Uint8Array((frameCount - 1) * STEPS_PER_FRAME + 1)
  contacts.forEach((_, i) => (contacts[i] = (i * 7) % 64))
  const finalPoses = readPoses(frames, frameCount - 1)
  return {
    frames,
    frameCount,
    frameRate: 60,
    stepsPerFrame: STEPS_PER_FRAME,
    contacts,
    settleFrame: frameCount - 2,
    finalPoses,
    finalUpAxis: [2, 4],
    source: 'pop',
    seed: 1234,
    paramsFingerprint: '0123456789abcdef',
  }
}

describe('framePose', () => {
  it('reads [px, py, pz, qx, qy, qz, qw] for each die and checks the frame', () => {
    const rec = recording(3)
    const at = FLOATS_PER_FRAME + 7
    expect(framePose(rec, 1, 1)).toEqual({
      p: [rec.frames[at], rec.frames[at + 1], rec.frames[at + 2]],
      q: [rec.frames[at + 3], rec.frames[at + 4], rec.frames[at + 5], rec.frames[at + 6]],
    })
    expect(() => framePose(rec, 3, 0)).toThrow(RangeError)
    expect(() => framePose(rec, -1, 0)).toThrow(RangeError)
  })
})

describe('contact flags', () => {
  it('pack each die into three bits of one byte per step', () => {
    expect(contactByte([TOUCH_FLOOR, TOUCH_DOME | TOUCH_DIE])).toBe(0b110001)
    expect(contactByte([0, 0])).toBe(0)
    const rec = { ...recording(3), contacts: new Uint8Array(17) }
    rec.contacts[0] = contactByte([TOUCH_FLOOR, TOUCH_FLOOR])
    rec.contacts[5] = contactByte([TOUCH_DIE, TOUCH_DIE | TOUCH_DOME])
    rec.contacts[16] = contactByte([0, TOUCH_FLOOR])
    expect([touchesAt(rec, 0, 0), touchesAt(rec, 0, 1)]).toEqual([TOUCH_FLOOR, TOUCH_FLOOR])
    expect([touchesAt(rec, 5, 0), touchesAt(rec, 5, 1)]).toEqual([
      TOUCH_DIE,
      TOUCH_DIE | TOUCH_DOME,
    ])
    expect(touchesAt(rec, 6, 0)).toBe(0)
    expect(() => touchesAt(rec, 17, 0)).toThrow(RangeError)
    expect(() => touchesAt(rec, 0.5, 0)).toThrow(RangeError)
  })

  it('gather a frame from the steps since the previous frame', () => {
    const rec = { ...recording(3), contacts: new Uint8Array(17) }
    rec.contacts[0] = contactByte([TOUCH_FLOOR, 0])
    rec.contacts[5] = contactByte([TOUCH_DIE, TOUCH_DIE])
    rec.contacts[8] = contactByte([0, TOUCH_DOME])
    rec.contacts[9] = contactByte([TOUCH_FLOOR, 0])
    // Frame 0 is the start poses alone; frame 1 covers steps 1 to 8; frame 2 steps 9 to 16.
    expect([touchesDuring(rec, 0, 0), touchesDuring(rec, 0, 1)]).toEqual([TOUCH_FLOOR, 0])
    expect([touchesDuring(rec, 1, 0), touchesDuring(rec, 1, 1)]).toEqual([
      TOUCH_DIE,
      TOUCH_DIE | TOUCH_DOME,
    ])
    expect([touchesDuring(rec, 2, 0), touchesDuring(rec, 2, 1)]).toEqual([TOUCH_FLOOR, 0])
    expect(() => touchesDuring(rec, 3, 0)).toThrow(RangeError)
  })
})

describe('hashRecording', () => {
  it('is 16 hex digits and the same for equal content in any buffer', () => {
    const rec = recording(20)
    const hash = hashRecording(rec)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    const padded = new Float32Array(rec.frames.length + 6)
    padded.set(rec.frames, 6)
    const bytes = new Uint8Array(rec.contacts.length + 3)
    bytes.set(rec.contacts, 3)
    const moved = { ...rec, frames: padded.subarray(6), contacts: bytes.subarray(3) }
    expect(hashRecording(moved)).toBe(hash)
  })

  it('changes with a single bit of any frame, any contact or any field', () => {
    const rec = recording(20)
    const hash = hashRecording(rec)
    const bits = new Uint32Array(rec.frames.slice().buffer)
    bits[100] = (bits[100] ?? 0) ^ 1
    expect(hashRecording({ ...rec, frames: new Float32Array(bits.buffer) })).not.toBe(hash)
    const contacts = rec.contacts.slice()
    contacts[40] = (contacts[40] ?? 0) ^ TOUCH_DIE
    expect(hashRecording({ ...rec, contacts })).not.toBe(hash)
    expect(hashRecording({ ...rec, settleFrame: rec.settleFrame - 1 })).not.toBe(hash)
    expect(hashRecording({ ...rec, seed: 1235 })).not.toBe(hash)
    expect(hashRecording({ ...rec, source: 'drop' })).not.toBe(hash)
    expect(hashRecording({ ...rec, finalUpAxis: [2, 5] })).not.toBe(hash)
    expect(hashRecording({ ...rec, stepsPerFrame: 4 })).not.toBe(hash)
    expect(hashRecording({ ...rec, paramsFingerprint: '0123456789abcdee' })).not.toBe(hash)
  })
})
