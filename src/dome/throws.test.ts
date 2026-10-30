import { describe, expect, it } from 'vitest'
import { analyticHop } from '../physics/core/hop.ts'
import { faceShown, synthesizeRest } from '../physics/core/plan.ts'
import { framePose } from '../physics/core/recording.ts'
import { hashRest, type RestState } from '../physics/core/restPose.ts'
import {
  DOME_PLAYBACK_MODE,
  facesOf,
  handoffCount,
  planThrow,
  restShowing,
  showsDice,
  type ThrowReply,
} from './throws.ts'
import { lastFrameOf } from './playback.ts'

/**
 * Planning a throw onto the engine's dice: from a worker recording when it fits the rest, from the
 * analytic hop otherwise, and from fresh poses when the rest itself cannot start a throw. Nothing
 * here can change the dice: every plan ends showing exactly what it was asked for.
 */

const REST = synthesizeRest(0x5, [1, 1])
const DICE = { d1: 4 as const, d2: 2 as const }

function reply(seed: number, rest: RestState): ThrowReply {
  return {
    seed,
    recording: analyticHop(seed, rest),
    rest,
    startedFromRequest: true,
    attempts: 1,
    source: 'hop',
  }
}

function landedFaces(plan: ReturnType<typeof planThrow>['plan']): number[] {
  const last = lastFrameOf(plan.recording)
  return [faceShown(plan, 0, last), faceShown(plan, 1, last)].sort()
}

describe('restShowing', () => {
  it('shows the dice asked for, body 0 first, the same way every time', () => {
    const a = restShowing({ d1: 6, d2: 3 })
    expect(facesOf(a)).toStrictEqual([6, 3])
    expect(hashRest(restShowing({ d1: 6, d2: 3 }))).toBe(hashRest(a))
    expect(hashRest(restShowing({ d1: 3, d2: 6 }))).not.toBe(hashRest(a))
  })

  it('showsDice accepts either body showing either die', () => {
    const rest = restShowing({ d1: 6, d2: 3 })
    expect(showsDice(rest, { d1: 6, d2: 3 })).toBe(true)
    expect(showsDice(rest, { d1: 3, d2: 6 })).toBe(true)
    expect(showsDice(rest, { d1: 6, d2: 6 })).toBe(false)
    expect(showsDice(rest, { d1: 3, d2: 3 })).toBe(false)
  })
})

describe('planThrow', () => {
  it('plans the worker’s recording when it was thrown from the rest it reports', () => {
    const { plan, shown, handoff } = planThrow(reply(11, REST), DICE, REST, 1234)
    expect(shown).toBe('plan')
    expect(landedFaces(plan)).toStrictEqual([2, 4])
    // The rest it leaves shows the same dice, for the next throw to start from.
    expect(showsDice(plan.rest, DICE)).toBe(true)
    // The dome plays in handoff mode: every die that changes face here blends (a hop always
    // has a window), and the count says how many.
    expect(plan.mode).toBe(DOME_PLAYBACK_MODE)
    expect(plan.mode).toBe('handoff')
    expect(handoff).toBe(handoffCount(plan))
    expect(handoff).toBe(plan.tracks.filter((t) => t.startOffset !== t.endOffset).length)
    expect(handoff).toBeGreaterThanOrEqual(1)
  })

  it('plans in snap mode when asked, with nothing to blend', () => {
    const { plan, handoff } = planThrow(reply(11, REST), DICE, REST, 1234, 'snap')
    expect(plan.mode).toBe('snap')
    expect(handoff).toBe(0)
    expect(plan.tracks.every((track) => track.handoff === null)).toBe(true)
    expect(landedFaces(plan)).toStrictEqual([2, 4])
  })

  it('falls back to the hop when the recording cannot be planned from its rest', () => {
    const other = synthesizeRest(0x6, [1, 1])
    const stale: ThrowReply = { ...reply(11, other), rest: REST } // restHash mismatch
    const { plan, shown, handoff } = planThrow(stale, DICE, REST, 1234)
    expect(shown).toBe('hop')
    expect(plan.mode).toBe('handoff')
    expect(handoff).toBe(handoffCount(plan))
    expect(landedFaces(plan)).toStrictEqual([2, 4])
    // The hop starts where the dice are.
    expect(framePose(plan.recording, 0, 0).p).toStrictEqual(
      REST[0].pose.p.map((v) => Math.fround(v)),
    )
  })

  it('hops from the current rest when there is no recording, deterministically', () => {
    const a = planThrow(null, DICE, REST, 777)
    const b = planThrow(null, DICE, REST, 777)
    expect(a.shown).toBe('hop')
    expect(landedFaces(a.plan)).toStrictEqual([2, 4])
    expect(Array.from(b.plan.recording.frames)).toStrictEqual(Array.from(a.plan.recording.frames))
    const c = planThrow(null, DICE, REST, 778)
    expect(Array.from(c.plan.recording.frames)).not.toStrictEqual(
      Array.from(a.plan.recording.frames),
    )
  })

  it('starts from fresh poses showing the same faces when the rest cannot start a throw', () => {
    const sunk: RestState = [REST[0], { ...REST[1], pose: REST[0].pose }]
    const { plan, shown } = planThrow(null, DICE, sunk, 5)
    expect(shown).toBe('hop')
    expect(landedFaces(plan)).toStrictEqual([2, 4])
    const start = [framePose(plan.recording, 0, 0).p, framePose(plan.recording, 0, 1).p]
    expect(start[0]).not.toStrictEqual(start[1])
  })
})
