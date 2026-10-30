import type { DieFace } from '../physics/core/cube.ts'
import { analyticHop } from '../physics/core/hop.ts'
import { buildPlaybackPlan, synthesizeRest, type DicePair } from '../physics/core/plan.ts'
import type { PlaybackMode, PlaybackPlan } from '../physics/core/plan.ts'
import { deriveSeed } from '../physics/core/prng.ts'
import type { Recording, ThrowSource } from '../physics/core/recording.ts'
import { visualTopFace, type RestState } from '../physics/core/restPose.ts'
import { checkStart } from '../physics/core/validity.ts'

/**
 * Turning a worker's recording — or, without one, a scripted hop — into the plan the dome plays
 * (plan §7 Face remap, Fallback chain). The engine has already decided the dice; nothing here can
 * change them. `planThrow` prefers the pre-simulated recording, falls back to `analyticHop` (pure
 * TypeScript, valid by construction, two whole turns to hide the face change) when the worker was
 * late or its recording cannot be planned, and the dome goes to an instant rest only when it has
 * no renderer at all. Plans are built in handoff mode (M10b): a die's face change blends over a
 * clear, fast-spinning window of the throw, and snaps where the throw has none. Rests chain: each
 * plan's `rest` is the next throw's start.
 */

/** The remap mode the dome plays in. */
export const DOME_PLAYBACK_MODE: PlaybackMode = 'handoff'

/** A worker's answer, as the dome keeps it: the recording and the rest it was thrown from. */
export interface ThrowReply {
  readonly seed: number
  readonly recording: Recording
  readonly rest: RestState
  readonly startedFromRequest: boolean
  readonly attempts: number
  readonly source: ThrowSource
}

/** How the dome arrived at what it shows: a worker plan, the hop fallback, or a snapped rest. */
export type ThrowShown = 'plan' | 'hop' | 'rest'

/** Seed salts for the main-thread fallbacks, away from simulateThrow's 1..popRetries+dropTries+2. */
const HOP_SALT = 0x40
const FRESH_REST_SALT = 0x41
/** A fixed salt so a rest synthesised for given faces always looks the same. */
const REST_SEED = 0x3d1ce

/** The faces each body shows at rest, in body order. */
export function facesOf(rest: RestState): readonly [DieFace, DieFace] {
  return [
    visualTopFace(rest[0].pose.q, rest[0].offset),
    visualTopFace(rest[1].pose.q, rest[1].offset),
  ]
}

/** Whether `rest` shows the pair `dice`, either body showing either die. */
export function showsDice(rest: RestState, dice: DicePair): boolean {
  const [a, b] = facesOf(rest)
  return (a === dice.d1 && b === dice.d2) || (a === dice.d2 && b === dice.d1)
}

/** Fresh poses showing `dice` (body 0 shows d1), the same for the same dice: restores, snaps. */
export function restShowing(dice: DicePair): RestState {
  return synthesizeRest(deriveSeed(REST_SEED, dice.d1 * 6 + dice.d2), [dice.d1, dice.d2])
}

export interface PlannedThrow {
  readonly plan: PlaybackPlan
  readonly shown: Exclude<ThrowShown, 'rest'>
  /** How many dice (0–2) blend their face change over a handoff window. */
  readonly handoff: number
}

/** The dice in `plan` whose face change blends over a handoff window. */
export function handoffCount(plan: PlaybackPlan): number {
  return plan.tracks.filter((track) => track.handoff !== null).length
}

/**
 * The plan for one throw landing on `dice`, from the dice at `rest`. With a reply, the plan is
 * built from the rest the worker reports (the recording carries its hash); if that fails — other
 * params, a stale rest — or without a reply, the analytic hop from `rest` stands in, started from
 * fresh poses when `rest` itself could not start a throw.
 */
export function planThrow(
  reply: ThrowReply | null,
  dice: DicePair,
  rest: RestState,
  physicsSeed: number,
  mode: PlaybackMode = DOME_PLAYBACK_MODE,
): PlannedThrow {
  if (reply !== null) {
    try {
      const plan = buildPlaybackPlan(reply.recording, dice, reply.rest, mode)
      return { plan, shown: 'plan', handoff: handoffCount(plan) }
    } catch {
      // Fall through to the hop: the recording cannot be planned from this rest.
    }
  }
  const from = checkStart(rest).valid
    ? rest
    : synthesizeRest(deriveSeed(physicsSeed, FRESH_REST_SALT), facesOf(rest))
  const hop = analyticHop(deriveSeed(physicsSeed, HOP_SALT), from)
  const plan = buildPlaybackPlan(hop, dice, from, mode)
  return { plan, shown: 'hop', handoff: handoffCount(plan) }
}
