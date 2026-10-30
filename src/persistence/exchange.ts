import { z } from 'zod'
import {
  ENGINE_VERSION,
  SESSION_LOG_FORMAT,
  compileConfig,
  parseSessionLog,
  serializeSession,
  sessionFromLog,
  validateConfig,
} from '../engine/index.ts'
import type {
  MachineConfig,
  MachineConfigInput,
  ReplayFailure,
  SessionLog,
  WindowedSession,
} from '../engine/index.ts'
import type { ConfigIssue } from '../engine/config/issues.ts'
import { toPointer } from '../engine/config/provenance.ts'
import { MAX_BATCH_DEPTH, batchDepthOf } from '../engine/session/window.ts'
import {
  MACHINE_CONFIG_HISTORY,
  MACHINE_FILE_HISTORY,
  MACHINE_FILE_VERSION,
  SESSION_LOG_HISTORY,
  SETTINGS_FILE_HISTORY,
  SETTINGS_FILE_VERSION,
  describeMigrationError,
  migrate,
  type MigrationError,
} from './migrations.ts'
import { isJsonObject, parseJsonSafely, type JsonGuardError } from './safeJson.ts'
import type { SessionNotice } from './sessionRepo.ts'
import { parseSettings, type Settings } from './settings.ts'

/**
 * Export and import (plan §8, M12): the player's game, machines and settings as files they can
 * download and load again in any browser. Three formats, each versioned (`migrations.ts`):
 *
 * - **A game** is the session log itself (`serializeSession`, format `bubble-craps-session`): the
 *   header with the machine's config and seed, every committed window and the open one, and the
 *   final table's hash. Importing it replays every window and checks every hash, so a loaded game
 *   is exactly the game exported — export, clear, import gives the same `sessionHash`.
 * - **Machines** (`bubble-craps-machine`): one or more machine configs, each validated in full.
 * - **Settings** (`bubble-craps-settings`): the player's settings, the 3D quality pin included,
 *   read field by field as a load reads them.
 *
 * Reading never throws and never trusts the file: the text passes the JSON guards (size, nesting,
 * prototype keys; `safeJson.ts`), its format and version are checked and migrated, every batch is
 * held to `MAX_BATCH_DEPTH`, a config must compile, and a game must replay to its own hashes. Any
 * failure comes back as an `ImportError`, which `describeImportError` puts in words.
 */

export const MACHINE_FILE_FORMAT = 'bubble-craps-machine'
export const SETTINGS_FILE_FORMAT = 'bubble-craps-settings'

export interface MachineFile {
  readonly format: typeof MACHINE_FILE_FORMAT
  readonly version: typeof MACHINE_FILE_VERSION
  readonly machines: readonly MachineConfigInput[]
}

export interface SettingsFile {
  readonly format: typeof SETTINGS_FILE_FORMAT
  readonly version: typeof SETTINGS_FILE_VERSION
  readonly settings: Settings
}

export type ImportedFile =
  | {
      readonly kind: 'session'
      readonly session: WindowedSession
      readonly cfg: MachineConfig
      /** Set when the game was recorded on another engine version and replayed the same here. */
      readonly notice: SessionNotice | null
      readonly rolls: number
    }
  | { readonly kind: 'machines'; readonly machines: readonly MachineConfigInput[] }
  | { readonly kind: 'settings'; readonly settings: Settings }

export type ImportError =
  | JsonGuardError
  | { readonly kind: 'notObject' }
  | { readonly kind: 'unknownFormat'; readonly format: string | null }
  | { readonly kind: 'migration'; readonly error: MigrationError }
  | { readonly kind: 'shape'; readonly what: string; readonly issues: readonly string[] }
  | { readonly kind: 'batchDepth'; readonly where: string; readonly max: number }
  | {
      readonly kind: 'config'
      readonly machine: number | null
      readonly issues: readonly ConfigIssue[]
    }
  | { readonly kind: 'replay'; readonly failure: ReplayFailure }
  | { readonly kind: 'unexpected'; readonly message: string }

export type ImportResult =
  | { readonly ok: true; readonly file: ImportedFile }
  | { readonly ok: false; readonly error: ImportError }

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/** The game as a session-log file: what `importFileText` reads back to the same session. */
export function sessionFileText(session: WindowedSession): string {
  return `${serializeSession(session, 2)}\n`
}

/** One or more machines as a machine file. */
export function machineFileText(machines: readonly MachineConfigInput[]): string {
  const file: MachineFile = {
    format: MACHINE_FILE_FORMAT,
    version: MACHINE_FILE_VERSION,
    machines,
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** The settings as a settings file; the 3D quality pin (`domeQuality`) travels with them. */
export function settingsFileText(settings: Settings): string {
  const file: SettingsFile = {
    format: SETTINGS_FILE_FORMAT,
    version: SETTINGS_FILE_VERSION,
    settings,
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** A file name for a download: the kind of file and a short tag, safe on every system. */
export function exportFileName(kind: 'session' | 'machine' | 'settings', tag = ''): string {
  const safe = tag.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const stem = safe === '' ? `bubble-craps-${kind}` : `bubble-craps-${kind}-${safe}`
  return `${stem.slice(0, 80)}.json`
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/** Reads any of the three formats (see the module comment). Never throws. */
export function importFileText(text: string): ImportResult {
  try {
    const parsed = parseJsonSafely(text)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const data = parsed.value
    if (!isJsonObject(data)) return { ok: false, error: { kind: 'notObject' } }
    const format = typeof data['format'] === 'string' ? data['format'] : null
    if (format === SESSION_LOG_FORMAT) return importSession(data)
    if (format === MACHINE_FILE_FORMAT) return importMachines(data)
    if (format === SETTINGS_FILE_FORMAT) return importSettings(data)
    return { ok: false, error: { kind: 'unknownFormat', format } }
  } catch (error) {
    // Nothing above should throw; this is the promise to the caller that nothing escapes.
    return {
      ok: false,
      error: {
        kind: 'unexpected',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function importSession(data: Record<string, unknown>): ImportResult {
  const migrated = migrate(data, SESSION_LOG_HISTORY)
  if (!migrated.ok) return { ok: false, error: { kind: 'migration', error: migrated.error } }
  // The log's own schema (engine/session/serialize.ts) reads text; the migrated data is JSON.
  const log = parseSessionLog(JSON.stringify(migrated.data))
  if (!log.ok) {
    const { error } = log
    if (error.kind === 'format') {
      return { ok: false, error: { kind: 'shape', what: 'game', issues: error.issues } }
    }
    return { ok: false, error: { kind: 'unexpected', message: JSON.stringify(error) } }
  }
  const deep = deepBatch(log.log)
  if (deep !== null) {
    return { ok: false, error: { kind: 'batchDepth', where: deep, max: MAX_BATCH_DEPTH } }
  }
  // A game recorded on another engine version is replayed to check it plays the same here (plan
  // §8); one that does carries on as this version's game, like a stored session after an update.
  const logged = log.log.header.engineVersion
  const loaded = sessionFromLog(log.log, { anyEngineVersion: logged !== ENGINE_VERSION })
  if (!loaded.ok) {
    const { error } = loaded
    if (error.kind === 'replay') {
      return { ok: false, error: { kind: 'replay', failure: error.failure } }
    }
    return { ok: false, error: { kind: 'unexpected', message: JSON.stringify(error) } }
  }
  const { session } = loaded
  return {
    ok: true,
    file: {
      kind: 'session',
      session,
      cfg: compileConfig(session.header.config),
      notice:
        logged === ENGINE_VERSION
          ? null
          : { kind: 'engineVersion', from: logged, to: ENGINE_VERSION },
      rolls: session.committed.length,
    },
  }
}

/** The first action nested past `MAX_BATCH_DEPTH`, named by its place in the log; null if none. */
function deepBatch(log: SessionLog): string | null {
  for (const [index, window] of log.windows.entries()) {
    for (const [step, action] of window.actions.entries()) {
      if (batchDepthOf(action) > MAX_BATCH_DEPTH) return `windows[${index}].actions[${step}]`
    }
  }
  for (const [step, action] of log.pending.entries()) {
    if (batchDepthOf(action) > MAX_BATCH_DEPTH) return `pending[${step}]`
  }
  return null
}

const MachineFileSchema = z.object({
  format: z.literal(MACHINE_FILE_FORMAT),
  version: z.literal(MACHINE_FILE_VERSION),
  machines: z.array(z.unknown()).min(1, 'the file holds no machine'),
})

function importMachines(data: Record<string, unknown>): ImportResult {
  const migrated = migrate(data, MACHINE_FILE_HISTORY)
  if (!migrated.ok) return { ok: false, error: { kind: 'migration', error: migrated.error } }
  const file = MachineFileSchema.safeParse(migrated.data)
  if (!file.success) {
    const issues = file.error.issues.map((issue) => `${pathText(issue.path)}: ${issue.message}`)
    return { ok: false, error: { kind: 'shape', what: 'machine file', issues } }
  }
  const machines: MachineConfigInput[] = []
  for (const [index, raw] of file.data.machines.entries()) {
    const config = migrate(raw, MACHINE_CONFIG_HISTORY)
    if (!config.ok) return { ok: false, error: { kind: 'migration', error: config.error } }
    const issues = validateConfig(config.data)
    if (issues.length > 0) {
      return { ok: false, error: { kind: 'config', machine: index, issues } }
    }
    machines.push(config.data as unknown as MachineConfigInput)
  }
  return { ok: true, file: { kind: 'machines', machines } }
}

const SettingsFileSchema = z.object({
  format: z.literal(SETTINGS_FILE_FORMAT),
  version: z.literal(SETTINGS_FILE_VERSION),
  settings: z.record(z.string(), z.unknown()),
})

function importSettings(data: Record<string, unknown>): ImportResult {
  const migrated = migrate(data, SETTINGS_FILE_HISTORY)
  if (!migrated.ok) return { ok: false, error: { kind: 'migration', error: migrated.error } }
  const file = SettingsFileSchema.safeParse(migrated.data)
  if (!file.success) {
    const issues = file.error.issues.map((issue) => `${pathText(issue.path)}: ${issue.message}`)
    return { ok: false, error: { kind: 'shape', what: 'settings file', issues } }
  }
  return { ok: true, file: { kind: 'settings', settings: parseSettings(file.data.settings) } }
}

function pathText(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '/' : toPointer(path.map((key) => String(key)))
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

/** An import error in words for the player: what was wrong, never a stack. */
export function describeImportError(error: ImportError): string {
  switch (error.kind) {
    case 'empty':
      return 'The file is empty.'
    case 'size':
      return 'The file is too large to be a trainer file.'
    case 'depth':
      return `The file nests deeper than ${error.max} levels, which no trainer file does.`
    case 'json':
      return 'The file is not valid JSON.'
    case 'key':
      return `The file uses the key "${error.key}", which no trainer file contains.`
    case 'notObject':
      return 'The file is not a trainer file.'
    case 'unknownFormat':
      return error.format === null
        ? 'The file does not say what it holds: it is not a trainer game, machine or settings file.'
        : `The file holds "${error.format}", which the trainer does not read.`
    case 'migration':
      return describeMigrationError(error.error)
    case 'shape':
      return `The ${error.what} is damaged: ${error.issues.slice(0, 3).join('; ')}.`
    case 'batchDepth':
      return `The game nests its actions deeper than ${error.max} levels at ${error.where}, which the trainer never writes.`
    case 'config': {
      const which = error.machine === null ? 'The machine' : `Machine ${error.machine + 1}`
      const first = error.issues
        .slice(0, 3)
        .map((issue) => `${toPointer(issue.path) || '/'}: ${issue.message}`)
      return `${which} is not a valid machine: ${first.join('; ')}.`
    }
    case 'replay':
      return replayWords(error.failure)
    case 'unexpected':
      return `The file could not be read: ${error.message}`
  }
}

function replayWords(failure: ReplayFailure): string {
  switch (failure.kind) {
    case 'engineVersion':
      return `The game was recorded on engine version ${failure.logged}; this trainer runs version ${failure.current}.`
    case 'config':
      return `The game's machine is not valid: ${failure.issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join('; ')}.`
    case 'configHash':
      return "The game's machine does not match the machine it was recorded on."
    case 'malformed':
      return `The game is damaged at ${failure.where}: ${failure.reason}.`
    case 'refused':
      return `The game does not replay: the table refuses ${failure.step === 'roll' ? 'the roll' : `action ${failure.step + 1}`} of window ${failure.window + 1} (${failure.rejection.code}).`
    case 'hash':
      return `The game does not replay to the table it recorded (window ${failure.window + 1}): the file was changed, or it was recorded by a different engine.`
  }
}
