import { z } from 'zod'
import type { MachineConfigInput } from '../config/schema.ts'
import { hashJson } from '../core/hash.ts'
import type { Action } from '../table/actions.ts'
import { ReplayError, resumeSession, type ReplayFailure, type ReplayOptions } from './replay.ts'
import type { SessionHeader, WindowRecord, WindowedSession } from './window.ts'

/**
 * The session log as versioned JSON (plan §8's export format, plus the open window): the header,
 * the committed windows, the open window's pending actions and the hash of the table they end on.
 * A session written by `serializeSession` reads back with `deserializeSession` to an equal session,
 * replayed and hash-checked on the way, and writes again to the same text.
 *
 * `version` is this format's version. The engine's is in the header (`engineVersion`): a log
 * replays only on the engine version that recorded it (`replay.ts`).
 */

export const SESSION_LOG_FORMAT = 'bubble-craps-session'
export const SESSION_LOG_VERSION = 1

export interface SessionLog {
  readonly format: typeof SESSION_LOG_FORMAT
  readonly version: typeof SESSION_LOG_VERSION
  readonly header: SessionHeader
  readonly windows: readonly WindowRecord[]
  readonly pending: readonly Action[]
  /** `hashJson` of the session's table: after the windows and then the pending actions. */
  readonly finalStateHash: string
}

/** Why a text is not a session this engine can load. */
export type SessionLogError =
  | { readonly kind: 'json'; readonly message: string }
  | { readonly kind: 'format'; readonly issues: readonly string[] }
  | { readonly kind: 'replay'; readonly failure: ReplayFailure }

export type ParseResult =
  | { readonly ok: true; readonly log: SessionLog }
  | { readonly ok: false; readonly error: SessionLogError }

export type LoadResult =
  | { readonly ok: true; readonly session: WindowedSession }
  | { readonly ok: false; readonly error: SessionLogError }

const HashSchema = z.string().regex(/^[0-9a-f]{16}$/, 'must be 16 lowercase hex digits')
const FaceSchema = z.literal([1, 2, 3, 4, 5, 6])

/**
 * The log's shape. Actions and the machine config are checked when the log replays: the reducer
 * refuses a malformed action and `compileConfig` a malformed config, each with its own reason. They
 * pass through here untouched, so a log writes back to the same text. Keys are in the order
 * `toSessionLog` writes them, which is the order zod builds them in.
 */
const SessionLogSchema = z.strictObject({
  format: z.literal(SESSION_LOG_FORMAT),
  version: z.literal(SESSION_LOG_VERSION),
  header: z.strictObject({
    engineVersion: z.int().min(1),
    configHash: HashSchema,
    seed: z.string(),
    config: z.custom<MachineConfigInput>(isObject, 'must be a machine config object'),
  }),
  windows: z.array(
    z.strictObject({
      actions: z.array(z.custom<Action>(isObject, 'must be an action object')),
      roll: z.strictObject({
        type: z.literal('roll'),
        dice: z.strictObject({ d1: FaceSchema, d2: FaceSchema }).optional(),
      }),
      hashAfter: HashSchema,
    }),
  ),
  pending: z.array(z.custom<Action>(isObject, 'must be an action object')),
  finalStateHash: HashSchema,
})

/** The session's log, ready for JSON. */
export function toSessionLog(session: WindowedSession): SessionLog {
  return {
    format: SESSION_LOG_FORMAT,
    version: SESSION_LOG_VERSION,
    header: session.header,
    windows: session.committed,
    pending: session.pending,
    finalStateHash: hashJson(session.state),
  }
}

/** The session as session-log JSON; `space` indents it as `JSON.stringify` does. */
export function serializeSession(session: WindowedSession, space?: number): string {
  return JSON.stringify(toSessionLog(session), null, space)
}

/** Reads a session log's JSON without replaying it: its shape only. */
export function parseSessionLog(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: { kind: 'json', message: messageOf(error) } }
  }
  const parsed = SessionLogSchema.safeParse(data)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${pathOf(issue.path)}: ${issue.message}`)
    return { ok: false, error: { kind: 'format', issues } }
  }
  return { ok: true, log: parsed.data }
}

/**
 * A log back in play: replayed window by window, the pending actions applied and the final hash
 * checked (`resumeSession`), or why not. A log this engine cannot play comes back as an error,
 * never a throw; only a fault in the engine itself (an `InvariantError`) is thrown.
 */
export function sessionFromLog(log: SessionLog, options: ReplayOptions = {}): LoadResult {
  try {
    const session = resumeSession(log.header, log.windows, log.pending, {
      ...options,
      expectHash: log.finalStateHash,
    })
    return { ok: true, session }
  } catch (error) {
    if (!(error instanceof ReplayError)) throw error
    return { ok: false, error: { kind: 'replay', failure: error.failure } }
  }
}

/** `parseSessionLog`, then `sessionFromLog`. */
export function deserializeSession(text: string, options: ReplayOptions = {}): LoadResult {
  const parsed = parseSessionLog(text)
  return parsed.ok ? sessionFromLog(parsed.log, options) : parsed
}

function isObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pathOf(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '/' : path.map((key) => String(key)).join('.')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
