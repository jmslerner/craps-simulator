import { SESSION_LOG_VERSION } from '../engine/index.ts'
import { isJsonObject } from './safeJson.ts'

/**
 * Stored-shape migrations (plan §8, M12). Every shape the trainer stores or writes to a file
 * carries its version: the session log its `version` (`SESSION_LOG_VERSION`), each stored table
 * its `v` (`TableState.v`), a machine config its `schemaVersion`, and the machine and settings
 * files their own `version`. When a shape changes, its version goes up by one and a step that
 * turns the old shape into the new one joins its history here; anything read — a stored head, an
 * imported file — is migrated before it is checked (zod) and replayed (hashes), so an old save
 * still loads on the new build.
 *
 * **No stored shape has changed since version 1**, so every history below has no steps yet and
 * migration is a no-op that only checks the version: a current shape passes through untouched, a
 * newer one (from a later build) is refused rather than misread, and one without a version is
 * refused as not ours. The mechanism itself — steps run in order, each from its version to the
 * next, never touching the caller's data — is proven on a synthetic history in the tests, and the
 * pinned crapless-200 fixture (format 1, engine 4, tables v1) is the migration fixture: it must
 * import to its recorded hash (tests/replay/migration.test.ts).
 *
 * The engine's own version (`ENGINE_VERSION`) is not a shape version: a log from another engine
 * is replayed to check it plays the same (plan §8), which no migration can change. Likewise a
 * config inside a session log is never migrated, since the log's `configHash` pins it.
 */

/** One step of a shape's history: turns data at version `from` into data at `from + 1`. */
export interface MigrationStep {
  readonly from: number
  /** What changed, for the result's record. */
  readonly change: string
  migrate(data: Readonly<Record<string, unknown>>): Record<string, unknown>
}

/** A stored shape's history: where its version lives, the current version and the steps to it. */
export interface ShapeHistory {
  /** How the shape is named in messages: "session log", "stored table". */
  readonly shape: string
  readonly current: number
  /** The key that holds the version. */
  readonly versionKey: string
  readonly steps: readonly MigrationStep[]
}

export type MigrationError =
  | { readonly kind: 'notObject'; readonly shape: string }
  | { readonly kind: 'noVersion'; readonly shape: string }
  | {
      readonly kind: 'newer'
      readonly shape: string
      readonly version: number
      readonly current: number
    }
  | { readonly kind: 'gap'; readonly shape: string; readonly version: number }
  | {
      readonly kind: 'failed'
      readonly shape: string
      readonly version: number
      readonly message: string
    }

export type MigrationResult =
  | {
      readonly ok: true
      readonly data: Record<string, unknown>
      readonly from: number
      readonly to: number
      /** The steps applied, oldest first; empty for a shape already current. */
      readonly applied: readonly string[]
    }
  | { readonly ok: false; readonly error: MigrationError }

/** `TableState.v`: the stored table's shape (src/engine/table/state.ts). */
export const TABLE_STATE_VERSION = 1
/** A machine config's `schemaVersion` (src/engine/config/schema.ts). */
export const MACHINE_SCHEMA_VERSION = 1
/** The machine file's `version` (`exchange.ts`). */
export const MACHINE_FILE_VERSION = 1
/** The settings file's `version` (`exchange.ts`). */
export const SETTINGS_FILE_VERSION = 1

/** The session log (`serializeSession`): an exported game, and the replay fixture. */
export const SESSION_LOG_HISTORY: ShapeHistory = Object.freeze({
  shape: 'session log',
  current: SESSION_LOG_VERSION,
  versionKey: 'version',
  steps: [],
})

/** A table as the session store keeps it (`windowStart` and `state` in a stored head). */
export const TABLE_STATE_HISTORY: ShapeHistory = Object.freeze({
  shape: 'stored table',
  current: TABLE_STATE_VERSION,
  versionKey: 'v',
  steps: [],
})

/** A machine config in a machine file or the saved-machines store (not inside a session log). */
export const MACHINE_CONFIG_HISTORY: ShapeHistory = Object.freeze({
  shape: 'machine config',
  current: MACHINE_SCHEMA_VERSION,
  versionKey: 'schemaVersion',
  steps: [],
})

export const MACHINE_FILE_HISTORY: ShapeHistory = Object.freeze({
  shape: 'machine file',
  current: MACHINE_FILE_VERSION,
  versionKey: 'version',
  steps: [],
})

export const SETTINGS_FILE_HISTORY: ShapeHistory = Object.freeze({
  shape: 'settings file',
  current: SETTINGS_FILE_VERSION,
  versionKey: 'version',
  steps: [],
})

/**
 * `data` brought to `history.current`: unchanged when it is current, else a copy with each step
 * applied in turn. Never throws and never changes `data`.
 */
export function migrate(data: unknown, history: ShapeHistory): MigrationResult {
  const { shape, current, versionKey } = history
  if (!isJsonObject(data)) return { ok: false, error: { kind: 'notObject', shape } }
  const version = data[versionKey]
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return { ok: false, error: { kind: 'noVersion', shape } }
  }
  if (version > current) return { ok: false, error: { kind: 'newer', shape, version, current } }
  if (version === current) return { ok: true, data, from: version, to: current, applied: [] }
  let migrated: Record<string, unknown> = structuredClone(data)
  const applied: string[] = []
  for (let at = version; at < current; at++) {
    const step = history.steps.find((candidate) => candidate.from === at)
    if (step === undefined) return { ok: false, error: { kind: 'gap', shape, version: at } }
    try {
      migrated = { ...step.migrate(migrated), [versionKey]: at + 1 }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: { kind: 'failed', shape, version: at, message } }
    }
    applied.push(step.change)
  }
  return { ok: true, data: migrated, from: version, to: current, applied }
}

export type HeadMigration =
  | { readonly ok: true; readonly head: unknown; readonly applied: readonly string[] }
  | { readonly ok: false; readonly error: MigrationError }

/**
 * A stored session head (`sessionRepo`) with both of its tables migrated: what the repo reads
 * before its schema and hash checks. A head that is not an object, or a table that is missing, is
 * passed on as it is, for the head's schema to refuse with its own message.
 */
export function migrateHead(
  head: unknown,
  history: ShapeHistory = TABLE_STATE_HISTORY,
): HeadMigration {
  if (!isJsonObject(head)) return { ok: true, head, applied: [] }
  let result: Record<string, unknown> = head
  const applied: string[] = []
  for (const key of ['windowStart', 'state'] as const) {
    const table = head[key]
    if (!isJsonObject(table)) continue
    const migrated = migrate(table, history)
    if (!migrated.ok) return migrated
    if (migrated.applied.length > 0) {
      result = { ...result, [key]: migrated.data }
      applied.push(...migrated.applied.map((change) => `${key}: ${change}`))
    }
  }
  return { ok: true, head: result, applied }
}

/** A migration error in words for the player. */
export function describeMigrationError(error: MigrationError): string {
  switch (error.kind) {
    case 'notObject':
      return `This ${error.shape} is not a JSON object.`
    case 'noVersion':
      return `This ${error.shape} has no version, so it was not written by this trainer.`
    case 'newer':
      return `This ${error.shape} is version ${error.version}, made by a newer trainer (this one reads up to version ${error.current}).`
    case 'gap':
      return `No migration reads a ${error.shape} at version ${error.version}.`
    case 'failed':
      return `Updating this ${error.shape} from version ${error.version} failed: ${error.message}`
  }
}
