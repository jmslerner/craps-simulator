import type { Recording, ThrowSource } from '../physics/core/recording.ts'
import type { RestState } from '../physics/core/restPose.ts'

/**
 * The physics worker's protocol (plan §7 Prefetch; §13 M9 → M10 hand-off). The worker knows
 * nothing about outcomes: a request names the seed (`deriveSeed32(sessionSeed, 'physics',
 * rollIndex, 0)`, derived in the UI) and the `RestState` the throw starts from — the rest the
 * previous throw's plan left — and the response carries the outcome-agnostic `Recording` plus the
 * rest the throw actually started from (`ThrowResult.rest`: the one asked for, or fresh poses when
 * that rest could not start a throw). The dome builds the `PlaybackPlan` on the main thread from
 * exactly that rest once the engine's dice are known; `buildPlaybackPlan` refuses any other.
 *
 * Everything crosses the boundary as structured-clone data: plain objects, numbers and the two
 * typed arrays of the recording, whose buffers travel in the transfer list (zero-copy). Every
 * request gets exactly one response, matched by `id`; a failure is an `ok: false` response, never
 * a worker crash.
 */

export interface ThrowRequest {
  readonly id: number
  readonly kind: 'throw'
  readonly seed: number
  /** Where the dice rest now; the throw starts from these poses. */
  readonly rest: RestState
}

/** Warms the worker up (Rapier's WebAssembly) and reports its params fingerprint. */
export interface PingRequest {
  readonly id: number
  readonly kind: 'ping'
}

export type PhysicsRequest = ThrowRequest | PingRequest

export interface ThrowResponse {
  readonly id: number
  readonly ok: true
  readonly kind: 'throw'
  readonly seed: number
  readonly recording: Recording
  /** The rest the throw started from: build the plan from this one. */
  readonly rest: RestState
  /** False when the requested rest could not start a throw, so `rest` is fresh poses. */
  readonly startedFromRequest: boolean
  /** How many attempts the fallback chain used; 1 means the first pop was valid. */
  readonly attempts: number
  readonly source: ThrowSource
}

export interface ReadyResponse {
  readonly id: number
  readonly ok: true
  readonly kind: 'ready'
  /** `paramsFingerprint(DEFAULT_PARAMS)` on the worker's side; the client checks it matches. */
  readonly paramsFingerprint: string
}

export interface PhysicsFailure {
  readonly id: number
  readonly ok: false
  readonly error: string
}

export type PhysicsResponse = ThrowResponse | ReadyResponse | PhysicsFailure

/** A response with the buffers to hand `postMessage` as transferables. */
export interface Outgoing {
  readonly response: PhysicsResponse
  readonly transfer: readonly ArrayBuffer[]
}
