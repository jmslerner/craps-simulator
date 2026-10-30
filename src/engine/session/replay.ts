import { ConfigError, compileConfig, type MachineConfig } from '../config/compile.ts'
import { issue, type ConfigIssue } from '../config/issues.ts'
import { hashJson } from '../core/hash.ts'
import type { Rejection } from '../bets/types.ts'
import type { Action } from '../table/actions.ts'
import type { GameEvent } from '../table/events.ts'
import { applyAction, type ApplyOptions } from '../table/reducer.ts'
import { newTable, type TableState } from '../table/state.ts'
import { ENGINE_VERSION } from '../version.ts'
import {
  MAX_BATCH_DEPTH,
  batchDepthOf,
  lastWindowOf,
  type SessionHeader,
  type WindowRecord,
  type WindowedSession,
} from './window.ts'

/**
 * Replay (plan §4.9): a session log played again through `applyAction`, from a new table on the
 * header's machine and seed, window by window: each window's betting actions, then its roll, then
 * the table's hash against the one the window recorded. The engine is pure and its dice come only
 * from the seed, so a log replays to the very table it was recorded on. Anything else is a
 * `ReplayError` naming what differed and where, never a silent divergence:
 *
 * - the log was recorded on another `ENGINE_VERSION` (it replays only on its own; see
 *   `ReplayOptions.anyEngineVersion` for checking one against this engine);
 * - the header's config does not compile, or compiles to another hash;
 * - the log is malformed (a roll among a window's betting actions, a record without a roll, or a
 *   batch nested past `MAX_BATCH_DEPTH`, which `dispatchBetting` would never have logged and
 *   `serializeSession` could not write back);
 * - the table refuses an action the log says it accepted;
 * - the table after a window hashes differently from the recorded `hashAfter`.
 *
 * Replay also rebuilds the roll history (plan §0 #20): `replayHistory` gives each window's events,
 * the `diceRolled` and every `betResolved` with its `SettlementTrace` included, and the tables
 * around its roll.
 */

/** What made a replay fail. Window indices count from 0; the open window is `committed.length`. */
export type ReplayFailure =
  | { readonly kind: 'engineVersion'; readonly logged: number; readonly current: number }
  | { readonly kind: 'config'; readonly issues: readonly ConfigIssue[] }
  | { readonly kind: 'configHash'; readonly logged: string; readonly compiled: string }
  | { readonly kind: 'malformed'; readonly where: string; readonly reason: string }
  | {
      readonly kind: 'refused'
      readonly window: number
      /** The action's index in the window, or `roll`. */
      readonly step: number | 'roll'
      readonly rejection: Rejection
    }
  | {
      readonly kind: 'hash'
      readonly window: number
      readonly logged: string
      readonly replayed: string
    }

/** Thrown when a log does not replay as recorded; `failure` says how. */
export class ReplayError extends Error {
  readonly failure: ReplayFailure

  constructor(failure: ReplayFailure) {
    super(`Session log does not replay: ${describeFailure(failure)}`)
    this.name = 'ReplayError'
    this.failure = failure
  }
}

export interface ReplayOptions {
  /**
   * Replay a log recorded on another engine version, to learn whether this engine still plays it
   * the same (plan §8: a stored session is checked after an update). Every hash is still checked.
   * Off by default: a log replays only on the version that recorded it.
   */
  readonly anyEngineVersion?: boolean
  /** Check the table invariants after every action (default true). */
  readonly checkInvariants?: boolean
}

/** One window of a log, replayed. */
export interface ReplayedWindow {
  readonly index: number
  /** The table when the window began. */
  readonly start: TableState
  /** Each betting action's events, in the window's order. */
  readonly actionEvents: readonly (readonly GameEvent[])[]
  /** The table the roll was made on: the start with the window's actions applied. */
  readonly atRoll: TableState
  /**
   * The roll's events: `diceRolled`, the round's own event, each bet the roll decided
   * (`betResolved` with its trace, `betTraveled`), commission, `newShooter` and the machine's
   * switches.
   */
  readonly rollEvents: readonly GameEvent[]
  /** The table after the roll; it hashes to the window's `hashAfter`. */
  readonly after: TableState
}

/**
 * The machine a header names, compiled: its engine version, its config and its hash checked. The
 * shell uses it to get the config of a stored session.
 */
export function headerConfig(header: SessionHeader, options: ReplayOptions = {}): MachineConfig {
  if (typeof header !== 'object' || header === null) fail(malformed('header', 'not an object'))
  const { engineVersion, configHash, seed } = header
  if (typeof engineVersion !== 'number') fail(malformed('header.engineVersion', 'not a number'))
  if (typeof configHash !== 'string') fail(malformed('header.configHash', 'not a string'))
  if (typeof seed !== 'string') fail(malformed('header.seed', 'not a string'))
  if (engineVersion !== ENGINE_VERSION && options.anyEngineVersion !== true) {
    fail({ kind: 'engineVersion', logged: engineVersion, current: ENGINE_VERSION })
  }
  let cfg: MachineConfig
  try {
    cfg = compileConfig(header.config)
  } catch (error) {
    if (error instanceof ConfigError) fail({ kind: 'config', issues: error.issues })
    // A malformed config can throw while its issues are still being gathered (e.g. a composite
    // part's pay ratio). That is still a config failure, never a crash out of loading (M5/M6
    // audit), so junk a session log carries cannot take the shell down.
    fail({
      kind: 'config',
      issues: [issue([], error instanceof Error ? error.message : String(error))],
    })
  }
  if (cfg.configHash !== configHash) {
    fail({ kind: 'configHash', logged: configHash, compiled: cfg.configHash })
  }
  return cfg
}

/** The table a log ends on, every window hash-checked; throws `ReplayError` on any difference. */
export function replay(
  header: SessionHeader,
  committed: readonly WindowRecord[],
  options: ReplayOptions = {},
): TableState {
  return play(header, committed, options).state
}

/** Every window of a log, replayed and hash-checked, for the roll history (plan §0 #20). */
export function replayHistory(
  header: SessionHeader,
  committed: readonly WindowRecord[],
  options: ReplayOptions = {},
): ReplayedWindow[] {
  const windows: ReplayedWindow[] = []
  play(header, committed, options, (replayed) => windows.push(replayed))
  return windows
}

export interface ResumeOptions extends ReplayOptions {
  /** `hashJson` of the table after `pending`, when the log recorded one: checked too. */
  readonly expectHash?: string
}

/**
 * A stored session back in play: the log replayed and hash-checked, then the open window's
 * `pending` actions applied. It equals the session that was stored. A log replayed under
 * `anyEngineVersion` plays the same on this engine, so it carries on as this version's log.
 */
export function resumeSession(
  header: SessionHeader,
  committed: readonly WindowRecord[],
  pending: readonly Action[],
  options: ResumeOptions = {},
): WindowedSession {
  const { cfg, state: windowStart } = play(header, committed, options)
  const open = committed.length
  if (!Array.isArray(pending)) fail(malformed('pending', 'not an array'))
  let state = windowStart
  pending.forEach((action, step) => {
    state = applyStep(state, action, cfg, options, open, step).state
  })
  if (options.expectHash !== undefined) checkHash(state, options.expectHash, open)
  return {
    header:
      header.engineVersion === ENGINE_VERSION
        ? header
        : { ...header, engineVersion: ENGINE_VERSION },
    committed: [...committed],
    windowStart,
    pending: [...pending],
    state,
    lastWindow: lastWindowOf(committed),
  }
}

/** Replays the log, calling `visit` with each window; returns the config and the final table. */
function play(
  header: SessionHeader,
  committed: readonly WindowRecord[],
  options: ReplayOptions,
  visit?: (replayed: ReplayedWindow) => void,
): { readonly cfg: MachineConfig; readonly state: TableState } {
  const cfg = headerConfig(header, options)
  if (!Array.isArray(committed)) fail(malformed('windows', 'not an array'))
  let state = newTable(cfg, header.seed)
  committed.forEach((record: unknown, index) => {
    const where = `windows[${index}]`
    if (!isRecord(record)) fail(malformed(where, 'not a window record'))
    const start = state
    const actionEvents = record.actions.map((action, step) => {
      const result = applyStep(state, action, cfg, options, index, step)
      state = result.state
      return result.events
    })
    const atRoll = state
    const rolled = applyAction(atRoll, record.roll, cfg, applyOptions(options))
    if (!rolled.ok) {
      fail({ kind: 'refused', window: index, step: 'roll', rejection: rolled.rejection })
    }
    state = rolled.state
    checkHash(state, record.hashAfter, index)
    visit?.({ index, start, actionEvents, atRoll, rollEvents: rolled.events, after: state })
  })
  return { cfg, state }
}

/**
 * Betting action `step` of window `at`: never a roll, never a batch nested past what live play
 * could have logged and a save could write again (`MAX_BATCH_DEPTH`), and one the table accepts.
 */
function applyStep(
  state: TableState,
  action: Action,
  cfg: MachineConfig,
  options: ReplayOptions,
  at: number,
  step: number,
): { readonly state: TableState; readonly events: readonly GameEvent[] } {
  if (typeof action === 'object' && action !== null && action.type === 'roll') {
    fail(malformed(`windows[${at}].actions[${step}]`, 'a roll among the betting actions'))
  }
  if (batchDepthOf(action) > MAX_BATCH_DEPTH) {
    const reason = `a batch nested deeper than ${MAX_BATCH_DEPTH}, which no log can hold`
    fail(malformed(`windows[${at}].actions[${step}]`, reason))
  }
  const result = applyAction(state, action, cfg, applyOptions(options))
  if (!result.ok) fail({ kind: 'refused', window: at, step, rejection: result.rejection })
  return result
}

function applyOptions(options: ReplayOptions): ApplyOptions {
  return { checkInvariants: options.checkInvariants ?? true }
}

/** The table hashes to what window `at` logged. */
function checkHash(state: TableState, logged: string, at: number): void {
  const replayed = hashJson(state)
  if (replayed !== logged) fail({ kind: 'hash', window: at, logged, replayed })
}

/** A window record's shape: an array of actions, a roll and a hash. */
function isRecord(value: unknown): value is WindowRecord {
  if (typeof value !== 'object' || value === null) return false
  const { actions, roll, hashAfter } = value as Partial<Record<keyof WindowRecord, unknown>>
  return (
    Array.isArray(actions) &&
    typeof roll === 'object' &&
    roll !== null &&
    (roll as { readonly type?: unknown }).type === 'roll' &&
    typeof hashAfter === 'string'
  )
}

function malformed(where: string, reason: string): ReplayFailure {
  return { kind: 'malformed', where, reason }
}

function fail(failure: ReplayFailure): never {
  throw new ReplayError(failure)
}

function describeFailure(failure: ReplayFailure): string {
  switch (failure.kind) {
    case 'engineVersion':
      return `recorded on engine version ${failure.logged}, this is version ${failure.current}`
    case 'config':
      return `its machine config is invalid (${failure.issues.map((i) => i.message).join('; ')})`
    case 'configHash':
      return `its machine config compiles to ${failure.compiled}, not ${failure.logged}`
    case 'malformed':
      return `${failure.where}: ${failure.reason}`
    case 'refused': {
      const step = failure.step === 'roll' ? 'roll' : `action ${failure.step}`
      return `window ${failure.window} ${step} was refused (${failure.rejection.code})`
    }
    case 'hash':
      return `window ${failure.window} ends on table ${failure.replayed}, not ${failure.logged}`
  }
}
