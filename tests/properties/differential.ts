import fc from 'fast-check'
import { expect } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { canonicalJson } from '../../src/engine/core/hash.ts'
import { effectiveWorking } from '../../src/engine/bets/working.ts'
import type { GameEvent } from '../../src/engine/table/events.ts'
import { applyAction, type ActionResult } from '../../src/engine/table/reducer.ts'
import { newTable, type TableState } from '../../src/engine/table/state.ts'
import { factsFrom, type MachineFacts } from '../oracle/machineFacts.ts'
import {
  refApply,
  refNewTable,
  refSnapshot,
  type RefAction,
  type RefOutcome,
  type RefSnapshot,
  type RefTable,
} from '../oracle/referenceTable.ts'
import {
  engineAction,
  intent,
  keyOf,
  newCoverage,
  offeredTypes,
  recordResult,
  resolveIntent,
  type BetKey,
  type Coverage,
  type Step,
} from './actions.ts'

/**
 * The reference differential (plan §9 item 2, §0 #17): seeded random action sequences go through
 * the engine (`applyAction`) and the independent reference table (`tests/oracle/referenceTable.ts`,
 * written from the rules spec alone), and after every action the two must agree:
 *
 * - on whether the action is accepted (the oracle models validation for every action it takes);
 * - when it is, on the bankroll, the house net, the deposits, the commission paid, the phase and
 *   the point, and the bets on the table, normalized: type, number, the parent's spot, amount,
 *   commission held, and whether the bet works on the next roll (`effectiveWorking` against the
 *   oracle's `refWorking`).
 *
 * A mismatch is minimized (steps are dropped while it persists) and returned with both sides'
 * view, for adjudication against the rules spec.
 */

/** One disagreement, minimized: the steps from a fresh table up to the one that disagrees. */
export interface Mismatch {
  /** The machine's id. */
  readonly preset: string
  /** The sequence it came from, and its index there before minimizing. */
  readonly run: number
  readonly at: number
  readonly steps: readonly Step[]
  readonly what: 'accept' | 'snapshot'
  readonly engine: unknown
  readonly oracle: unknown
  /** The engine's events and the oracle's settlements on the last step, to adjudicate it. */
  readonly engineEvents: readonly GameEvent[]
  readonly oracleSettled: unknown
}

export interface DiffReport {
  readonly preset: string
  readonly runs: number
  /** Actions compared in all. */
  readonly actions: number
  /** Actions both sides accepted, and both refused; of those, how many with the same code. */
  readonly accepted: number
  readonly refused: number
  readonly sameCode: number
  /** Refusals with different codes, as `engine/oracle`, by count (the check order differs). */
  readonly codePairs: Map<string, number>
  readonly coverage: Coverage
  readonly mismatches: Mismatch[]
}

/**
 * Plays `numRuns` sequences of `length` intents on a preset (or any config), with the dice and
 * choices drawn by fast-check from `seed`. Every sequence plays to its end unless it disagrees.
 */
export function runDifferential(
  machine: PresetId | MachineConfigInput,
  numRuns: number,
  length: number,
  seed = 20261028,
): DiffReport {
  const input = typeof machine === 'string' ? PRESETS[machine] : machine
  const id = input.id
  const cfg = compileConfig(input)
  const facts = factsFrom(input)
  const sequences = fc.sample(fc.array(intent, { minLength: length, maxLength: length }), {
    seed,
    numRuns,
  })
  const report = {
    preset: id,
    runs: sequences.length,
    actions: 0,
    accepted: 0,
    refused: 0,
    sameCode: 0,
    codePairs: new Map<string, number>(),
    coverage: newCoverage(),
    mismatches: [] as Mismatch[],
  }
  sequences.forEach((intents, run) => {
    const game = new Game(cfg, facts, `diff-${id}`)
    const steps: Step[] = []
    for (const next of intents) {
      const step = resolveIntent(next, game.engine, cfg)
      steps.push(step)
      const before = game.engine
      const turn = game.play(step)
      report.actions++
      recordResult(report.coverage, before, turn.result)
      if (turn.mismatch === null) {
        if (turn.result.ok) report.accepted++
        else {
          report.refused++
          const oracle = turn.refResult.ok ? '' : turn.refResult.reason
          if (turn.result.rejection.code === oracle) report.sameCode++
          else {
            const pair = `${turn.result.rejection.code}/${oracle}`
            report.codePairs.set(pair, (report.codePairs.get(pair) ?? 0) + 1)
          }
        }
        continue
      }
      report.mismatches.push(minimized(cfg, facts, id, run, steps))
      return
    }
  })
  return report
}

/** A turn of the differential: both results, and what disagreed, if anything. */
export interface Turn {
  readonly result: ActionResult
  readonly refResult: RefOutcome
  readonly mismatch: Pick<Mismatch, 'what' | 'engine' | 'oracle'> | null
}

/** The engine and the reference table side by side, from a fresh table of each. */
export class Game {
  engine: TableState
  ref: RefTable
  private readonly cfg: MachineConfig
  private readonly facts: MachineFacts

  constructor(cfg: MachineConfig, facts: MachineFacts, seed = 'diff') {
    this.cfg = cfg
    this.facts = facts
    this.engine = newTable(cfg, seed)
    this.ref = refNewTable(facts)
  }

  /** Plays one step on both; a refused step leaves both as they were. */
  play(step: Step): Turn {
    const result = applyAction(this.engine, engineAction(step, this.engine), this.cfg)
    const refResult = refApply(this.facts, this.ref, refAction(step))
    if (result.ok !== refResult.ok) {
      return {
        result,
        refResult,
        mismatch: {
          what: 'accept',
          engine: result.ok ? 'accepted' : result.rejection,
          oracle: refResult.ok
            ? 'accepted'
            : { reason: refResult.reason, detail: refResult.detail },
        },
      }
    }
    if (!result.ok || !refResult.ok) return { result, refResult, mismatch: null }
    this.engine = result.state
    this.ref = refResult.table
    const engine = engineSnapshot(this.engine, this.cfg)
    const oracle = refSnapshot(this.facts, this.ref)
    if (canonicalJson(engine) === canonicalJson(oracle))
      return { result, refResult, mismatch: null }
    return { result, refResult, mismatch: { what: 'snapshot', ...difference(engine, oracle) } }
  }
}

/** The engine's table in the reference table's normalized form (`refSnapshot`). */
export function engineSnapshot(state: TableState, cfg: MachineConfig): RefSnapshot {
  const { phase } = state.round
  const bets = state.bets.map((bet) => {
    const key = keyOf(bet, state)
    return {
      typeId: bet.typeId,
      number: bet.number,
      parent: key.parent,
      amount: bet.amount,
      vigHeld: bet.vigHeld,
      working: effectiveWorking(bet, state, cfg),
    }
  })
  const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  bets.sort(
    (a, b) =>
      text(a.typeId, b.typeId) ||
      (a.number ?? 0) - (b.number ?? 0) ||
      text(a.parent ?? '', b.parent ?? ''),
  )
  const { bankroll, houseNet, deposits, vigPaid, wagered } = state.ledger
  return {
    bankroll,
    houseNet,
    deposits,
    vigPaid,
    wagered,
    rebetBlocked: [...state.rebetBlocked].sort(text),
    phase: phase.kind,
    point: phase.kind === 'point' ? phase.point : null,
    bets,
  }
}

/** The step as the reference table's action. */
export function refAction(step: Step): RefAction {
  const ref = (key: BetKey) => ({ typeId: key.typeId, number: key.number, parent: key.parent })
  switch (step.kind) {
    case 'place': {
      const base = { type: 'place' as const, typeId: step.typeId, amount: step.amount }
      if (step.parent !== null) {
        const { typeId, number } = step.parent
        return { ...base, parent: number === null ? typeId : `${typeId}@${number}` }
      }
      return step.number === null ? base : { ...base, number: step.number }
    }
    case 'setAmount':
      return { type: 'setAmount', bet: ref(step.bet), amount: step.amount }
    case 'setWorking':
      return { type: 'setWorking', bet: ref(step.bet), working: step.working }
    case 'setGlobalWorking':
      return { type: 'setGlobalWorking', off: step.off }
    case 'deposit':
      return { type: 'deposit', amount: step.amount }
    case 'roll':
      return { type: 'roll', d1: step.d1, d2: step.d2 }
  }
}

/** Just the fields of two snapshots that differ, bet lists in full when they do. */
function difference(
  engine: RefSnapshot,
  oracle: RefSnapshot,
): { engine: unknown; oracle: unknown } {
  const a: Record<string, unknown> = {}
  const b: Record<string, unknown> = {}
  for (const key of Object.keys(engine) as (keyof RefSnapshot)[]) {
    if (canonicalJson(engine[key]) !== canonicalJson(oracle[key])) {
      a[key] = engine[key]
      b[key] = oracle[key]
    }
  }
  return { engine: a, oracle: b }
}

/** Replays `steps` from a fresh table; the index of the first disagreement, or null. */
function firstMismatch(cfg: MachineConfig, facts: MachineFacts, steps: readonly Step[]) {
  const game = new Game(cfg, facts, 'replay')
  for (const [index, step] of steps.entries()) {
    const turn = game.play(step)
    if (turn.mismatch !== null) return { index, turn, game }
  }
  return null
}

/** Drops steps (halving chunks, then one by one) while the disagreement persists. */
function minimized(
  cfg: MachineConfig,
  facts: MachineFacts,
  preset: string,
  run: number,
  steps: readonly Step[],
): Mismatch {
  let current = [...steps]
  for (let chunk = Math.ceil(current.length / 2); chunk >= 1;) {
    let removed = false
    for (let i = 0; i < current.length;) {
      const candidate = [...current.slice(0, i), ...current.slice(i + chunk)]
      const found = firstMismatch(cfg, facts, candidate)
      if (found === null) i += chunk
      else {
        current = candidate.slice(0, found.index + 1)
        removed = true
      }
    }
    if (!removed) chunk = Math.floor(chunk / 2)
  }
  const found = firstMismatch(cfg, facts, current)
  if (found === null) throw new Error('a mismatch went away when replayed')
  const { turn } = found
  return {
    preset,
    run,
    at: steps.length - 1,
    steps: current,
    what: turn.mismatch?.what ?? 'snapshot',
    engine: turn.mismatch?.engine,
    oracle: turn.mismatch?.oracle,
    engineEvents: turn.result.ok ? turn.result.events : [],
    oracleSettled: turn.refResult.ok ? turn.refResult.settled : [],
  }
}

/** A mismatch as readable text for a test failure or a report. */
export function describeMismatch(mismatch: Mismatch): string {
  // The oracle's settlements hold `Fraction`s, whose parts are bigints.
  const text = (value: unknown) =>
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    )
  const lines = mismatch.steps.map((step, index) => `  ${index}: ${text(step)}`)
  return [
    `${mismatch.preset} run ${mismatch.run} (step ${mismatch.at}): ${mismatch.what} differs`,
    ...lines,
    `  engine: ${text(mismatch.engine)}`,
    `  oracle: ${text(mismatch.oracle)}`,
    `  engine events: ${text(mismatch.engineEvents)}`,
    `  oracle settled: ${text(mismatch.oracleSettled)}`,
  ].join('\n')
}

/** What a set of runs must have exercised on `cfg` for the comparison to mean anything. */
export function expectExercised(report: DiffReport, cfg: MachineConfig): void {
  const { coverage } = report
  const count = (map: Map<string, number>, key: string) => map.get(key) ?? 0
  const missing = (map: Map<string, number>) =>
    offeredTypes(cfg).filter((typeId) => count(map, typeId) === 0)
  expect(missing(coverage.placed), 'types never placed').toEqual([])
  expect(missing(coverage.settled), 'types never settled').toEqual([])
  const kinds = ['win:stay', 'win:return', 'lose', 'travel', 'push:offReturned']
  if (cfg.ruleset.dontBar !== null) kinds.push('push:bar')
  if ([...cfg.composites.values()].some((type) => type.pushes.size > 0)) kinds.push('push:zeroNet')
  for (const kind of kinds) expect(count(coverage.decisions, kind), kind).toBeGreaterThan(0)
  expect(count(coverage.accepted, 'roll:comeOut'), 'come-out rolls').toBeGreaterThan(0)
  expect(count(coverage.accepted, 'roll:point'), 'point rolls').toBeGreaterThan(0)
  for (const change of ['press', 'cut', 'takenDown', 'deposit']) {
    expect(count(coverage.accepted, change), change).toBeGreaterThan(0)
  }
  const toggles = (prefix: string) => ['true', 'false', 'null'].map((v) => `${prefix}:${v}`)
  if (cfg.working.toggle.global) {
    for (const key of toggles('global'))
      expect(count(coverage.accepted, key), key).toBeGreaterThan(0)
  }
  if (cfg.working.toggle.perBet) {
    for (const key of toggles('working')) {
      expect(count(coverage.accepted, key), key).toBeGreaterThan(0)
    }
  }
  // Both sides refused a share of the actions, so validation was compared too.
  expect(report.refused).toBeGreaterThan(report.actions / 10)
}
