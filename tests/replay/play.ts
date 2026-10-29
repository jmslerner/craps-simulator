import fc from 'fast-check'
import { expect } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../src/engine/config/presets/index.ts'
import type { Dice, DieFace } from '../../src/engine/core/dice.ts'
import { canonicalJson, hashJson } from '../../src/engine/core/hash.ts'
import { cents } from '../../src/engine/core/money.ts'
import { legalBets } from '../../src/engine/bets/legal.ts'
import { smallestBet, typeLimits } from '../../src/engine/bets/limits.ts'
import type { BetId, Rejection } from '../../src/engine/bets/types.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import type { GameEvent } from '../../src/engine/table/events.ts'
import { applyAction, validateAction } from '../../src/engine/table/reducer.ts'
import type { TableState } from '../../src/engine/table/state.ts'
import {
  doubleBets,
  maxOutOdds,
  pressBet,
  repeatBets,
  takeDownAll,
  winsOf,
} from '../../src/engine/session/macros.ts'
import { replay, replayHistory, resumeSession } from '../../src/engine/session/replay.ts'
import { deserializeSession, serializeSession } from '../../src/engine/session/serialize.ts'
import {
  clearWindow,
  dispatchBetting,
  newSession,
  rollWindow,
  undo,
  type WindowedSession,
} from '../../src/engine/session/window.ts'
import { addTo, lineFor, topUp } from './bets.ts'

/**
 * Random sessions played through the betting window (M5, plan §4.9 and §9 item 6), for the
 * session properties in tests/properties/session*.prop.test.ts. fast-check draws moves; each is
 * made concrete against the table as it stands (a bet on a spot `legalBets` offers, a cut or a
 * take-down of a bet that is up, a macro, undo, clear, a deposit, a roll), and the window functions
 * are checked after every one:
 *
 * - a betting action the table refuses, or accepts without changing anything, is not logged, and
 *   the session is left as it was; an accepted one joins `pending` as a JSON copy, and the table is
 *   what `applyAction` alone makes of it;
 * - undo gives back exactly the table before the window's last action (deep equality), clear gives
 *   back the window's start, and neither reaches past a roll: right after every roll, undo refuses;
 * - an accepted roll commits the window's actions and the roll as one record whose hash is the
 *   table's; a refused roll changes nothing, and the window stays open;
 * - every macro emits nothing or one batch that `validateAction` accepts and that changes the table
 *   (when `macroEvery` is set, every macro is also run on that share of tables, with checks of what
 *   it does).
 *
 * The final checks, `expectReplayMatches` and `expectSerializes`, compare the log with live play.
 */

export type MacroKind = 'repeat' | 'double' | 'press' | 'maxOdds' | 'maxOddsOne' | 'takeDownAll'

const MACROS: readonly MacroKind[] = [
  'repeat',
  'double',
  'press',
  'maxOdds',
  'maxOddsOne',
  'takeDownAll',
]

type Size = 'min' | 'units' | 'max'

/** What fast-check draws: choices that `playMove` makes concrete against the table. */
export type Move =
  | { readonly kind: 'bet'; readonly pick: number; readonly size: Size; readonly units: number }
  | { readonly kind: 'line'; readonly units: number }
  | { readonly kind: 'cut'; readonly pick: number; readonly units: number }
  | { readonly kind: 'takeDown'; readonly pick: number }
  | { readonly kind: 'working'; readonly pick: number; readonly value: boolean | null }
  | { readonly kind: 'global'; readonly value: boolean | null }
  | { readonly kind: 'deposit'; readonly dollars: number }
  | { readonly kind: 'refused'; readonly pick: number }
  | { readonly kind: 'macro'; readonly macro: MacroKind; readonly pick: number }
  | { readonly kind: 'undo' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'roll'; readonly d1: DieFace; readonly d2: DieFace; readonly drawn: boolean }

const face = fc.constantFrom<DieFace>(1, 2, 3, 4, 5, 6)
const setting = fc.constantFrom(true, false, null)
const size = fc.constantFrom<Size>('min', 'units', 'units', 'units', 'max')

/** One move. About a third are rolls, half of those drawn from the table's dice stream. */
export const move: fc.Arbitrary<Move> = fc.oneof(
  {
    weight: 30,
    arbitrary: fc.record({
      kind: fc.constant('bet' as const),
      pick: fc.nat(),
      size,
      units: fc.integer({ min: 0, max: 20 }),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant('line' as const),
      units: fc.integer({ min: 1, max: 4 }),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('cut' as const),
      pick: fc.nat(),
      units: fc.integer({ min: 1, max: 10 }),
    }),
  },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('takeDown' as const), pick: fc.nat() }) },
  {
    weight: 3,
    arbitrary: fc.record({ kind: fc.constant('working' as const), pick: fc.nat(), value: setting }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('global' as const), value: setting }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('deposit' as const),
      dollars: fc.integer({ min: 1, max: 500 }),
    }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('refused' as const), pick: fc.nat() }) },
  {
    weight: 10,
    arbitrary: fc.record({
      kind: fc.constant('macro' as const),
      macro: fc.constantFrom(...MACROS),
      pick: fc.nat(),
    }),
  },
  { weight: 6, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'clear' as const }) },
  {
    weight: 30,
    arbitrary: fc.record({
      kind: fc.constant('roll' as const),
      d1: face,
      d2: face,
      drawn: fc.boolean(),
    }),
  },
)

/** Counts of what the runs did, so a test can insist they exercised what they check. */
export interface PlayReport {
  readonly preset: PresetId
  moves: number
  /** Betting actions that joined the window. */
  logged: number
  /** Betting actions the table refused; never logged. */
  refused: number
  /** Accepted betting actions that changed nothing; never logged. */
  unchanged: number
  undone: number
  cleared: number
  /** Undo refused right after a roll: the roll boundary held. */
  rollBoundaries: number
  rolls: number
  refusedRolls: number
  /** Undo that restored the window after a refused roll. */
  undoneAfterRefusedRoll: number
  deposits: number
  /** Macros dispatched, by kind. */
  readonly macros: Map<MacroKind, number>
  /** Macro runs checked on random tables (`macroEvery`), and how many emitted a batch, by kind. */
  macroChecks: number
  readonly macroEmitted: Map<MacroKind, number>
}

export interface PlayOptions {
  /** Run every macro on every `macroEvery`th table a session passes through (0: never). */
  readonly macroEvery?: number
  readonly seed?: number
}

/** A window as live play saw it, for comparison with its replay. */
export interface LiveWindow {
  readonly actionEvents: readonly (readonly GameEvent[])[]
  readonly atRoll: TableState
  readonly rollEvents: readonly GameEvent[]
  readonly after: TableState
}

/** One session played: the session at the end and every committed window as live play saw it. */
export interface Played {
  readonly cfg: MachineConfig
  readonly session: WindowedSession
  readonly windows: readonly LiveWindow[]
}

export function newReport(preset: PresetId): PlayReport {
  return {
    preset,
    moves: 0,
    logged: 0,
    refused: 0,
    unchanged: 0,
    undone: 0,
    cleared: 0,
    rollBoundaries: 0,
    rolls: 0,
    refusedRolls: 0,
    undoneAfterRefusedRoll: 0,
    deposits: 0,
    macros: new Map(),
    macroChecks: 0,
    macroEmitted: new Map(),
  }
}

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function pick<T>(list: readonly T[], n: number): T | undefined {
  return list.length === 0 ? undefined : list[n % list.length]
}

/**
 * Runs `numRuns` sessions of up to `maxMoves` moves on preset `id`, checking the window after every
 * move and handing each finished session to `finish` for the final checks.
 */
export function checkSessionRuns(
  id: PresetId,
  numRuns: number,
  maxMoves: number,
  finish: (played: Played) => void,
  options: PlayOptions = {},
): PlayReport {
  const cfg = compileConfig(PRESETS[id])
  const report = newReport(id)
  fc.assert(
    fc.property(
      fc.string({ maxLength: 8 }),
      fc.array(move, { minLength: 1, maxLength: maxMoves, size: 'max' }),
      (seed, moves) => finish(playSession(cfg, `window-${seed}`, moves, report, options)),
    ),
    { seed: options.seed ?? 20261028, numRuns },
  )
  return report
}

/** A session in progress, with what the checks need beside it. */
interface Player {
  readonly cfg: MachineConfig
  readonly report: PlayReport
  session: WindowedSession
  /** The window's tables: its start, then the table after each pending action. */
  tables: TableState[]
  /** The events of each pending action. */
  events: GameEvent[][]
  readonly windows: LiveWindow[]
  /** The last accepted roll's events, for Press. */
  lastRoll: readonly GameEvent[]
}

export function playSession(
  cfg: MachineConfig,
  seed: string,
  moves: readonly Move[],
  report: PlayReport,
  options: PlayOptions = {},
): Played {
  const session = newSession(cfg, seed)
  const player: Player = {
    cfg,
    report,
    session,
    tables: [session.state],
    events: [],
    windows: [],
    lastRoll: [],
  }
  const every = options.macroEvery ?? 0
  for (const next of moves) {
    if (every > 0 && report.moves % every === 0) checkAllMacros(player)
    report.moves++
    playMove(player, next)
  }
  return { cfg, session: player.session, windows: player.windows }
}

function playMove(player: Player, next: Move): void {
  const { cfg, report } = player
  const { state } = player.session
  switch (next.kind) {
    case 'bet': {
      const action = betOn(state, cfg, next)
      if (action !== null) bet(player, action)
      return
    }
    case 'line': {
      // The phase's line bet (pass, or come with a point on), which odds can then go behind.
      const line = lineFor(state, cfg)
      if (line !== null) {
        const amount = smallestBet(typeLimits(cfg, line)) * next.units
        bet(player, { type: 'place', typeId: line, amount: cents(amount) })
      }
      return
    }
    case 'cut': {
      const target = pick(state.bets, next.pick)
      if (target === undefined) return
      const { increment } = typeLimits(cfg, target.typeId, target.number)
      const amount = cents(Math.max(0, target.amount - next.units * increment))
      bet(player, { type: 'setAmount', betId: target.id, amount })
      return
    }
    case 'takeDown': {
      const target = pick(state.bets, next.pick)
      if (target !== undefined)
        bet(player, { type: 'setAmount', betId: target.id, amount: cents(0) })
      return
    }
    case 'working': {
      const target = pick(state.bets, next.pick)
      if (target !== undefined) {
        bet(player, { type: 'setWorking', betId: target.id, working: next.value })
      }
      return
    }
    case 'global':
      bet(player, { type: 'setGlobalWorking', off: next.value })
      return
    case 'deposit':
      if (bet(player, { type: 'deposit', amount: cents(next.dollars * 100) })) report.deposits++
      return
    case 'refused': {
      const refused: readonly Action[] = [
        { type: 'setAmount', betId: 'b999999' as BetId, amount: cents(100) },
        { type: 'place', typeId: 'noSuchBet', amount: cents(500) },
        { type: 'place', typeId: 'pass', amount: cents(0) },
        { type: 'deposit', amount: cents(-500) },
      ]
      const action = pick(refused, next.pick)
      if (action !== undefined) expect(bet(player, action), 'a refused action').toBe(false)
      return
    }
    case 'macro':
      runMacro(player, next.macro, next.pick)
      return
    case 'undo':
      undoLast(player)
      return
    case 'clear':
      clear(player)
      return
    case 'roll':
      rollOrMeetMinimum(player, next.drawn ? undefined : { d1: next.d1, d2: next.d2 })
      return
  }
}

/** An addition the table offers on one of its spots: a new bet, or a press of the bet there. */
function betOn(
  state: TableState,
  cfg: MachineConfig,
  next: Extract<Move, { kind: 'bet' }>,
): Action | null {
  const spot = pick(
    legalBets(state, cfg).filter((s) => s.canAdd === null),
    next.pick,
  )
  if (spot === undefined) return null
  const { increment } = typeLimits(cfg, spot.typeId, spot.number)
  const steps = (spot.maxAdd - spot.minAdd) / increment
  const add =
    next.size === 'min'
      ? spot.minAdd
      : next.size === 'max'
        ? spot.maxAdd
        : spot.minAdd + increment * (next.units % (steps + 1))
  return addTo(spot, add, cfg)
}

/**
 * Dispatches a betting action and checks the window; returns whether the table accepted it. A
 * refused action, or an accepted one that changes nothing, leaves the session as it was.
 */
function bet(player: Player, action: Action): boolean {
  const { cfg, report } = player
  const before = player.session
  const table = canonicalJson(before.state)
  const pending = before.pending.length
  const result = dispatchBetting(before, action, cfg)
  expect(canonicalJson(before.state), 'dispatchBetting changed the session it was given').toBe(
    table,
  )
  expect(before.pending).toHaveLength(pending)
  const direct = applyAction(before.state, action, cfg)
  if (!result.ok) {
    report.refused++
    expect(direct.ok ? null : direct.rejection, 'the refusal is the table’s').toEqual(
      result.rejection,
    )
    return false
  }
  if (!direct.ok)
    throw new Error(`the window accepted what the table refuses: ${direct.rejection.code}`)
  if (result.session === before) {
    report.unchanged++
    expect(canonicalJson(direct.state), 'an unlogged action changed the table').toBe(table)
    return true
  }
  report.logged++
  const next = result.session
  expect(next.pending).toStrictEqual([...before.pending, JSON.parse(JSON.stringify(action))])
  expect(next.state).toStrictEqual(direct.state)
  expect(result.events).toStrictEqual(direct.events)
  expect(next.windowStart).toBe(before.windowStart)
  expect(next.committed).toBe(before.committed)
  player.session = next
  player.tables.push(next.state)
  player.events.push([...result.events])
  return true
}

/** Undo: the table before the window's last action, exactly; nothing at the window's start. */
function undoLast(player: Player): void {
  const { cfg, report } = player
  const before = player.session
  const next = undo(before, cfg)
  if (before.pending.length === 0) {
    expect(next, 'undo with nothing pending').toBeNull()
    return
  }
  if (next === null) throw new Error('undo refused with actions pending')
  player.tables.pop()
  player.events.pop()
  expect(next.state, 'undo restores the exact prior table').toStrictEqual(player.tables.at(-1))
  expect(next.pending).toStrictEqual(before.pending.slice(0, -1))
  expect(next.windowStart).toBe(before.windowStart)
  expect(next.committed).toBe(before.committed)
  player.session = next
  report.undone++
}

/** Clear: the window's start. */
function clear(player: Player): void {
  const next = clearWindow(player.session, player.cfg)
  expect(next.state, 'clear restores the window’s start').toStrictEqual(player.tables[0])
  expect(next.pending).toEqual([])
  expect(next.committed).toBe(player.session.committed)
  if (player.session.pending.length > 0) player.report.cleared++
  else expect(next).toBe(player.session)
  player.session = next
  player.tables = [next.state]
  player.events = []
}

/**
 * Rolls; on a refusal for the round's minimum, tops the table up (a line bet for the phase, or the
 * short bet pressed under a per-bet minimum), adding credit if need be, and rolls again.
 */
function rollOrMeetMinimum(player: Player, dice: Dice | undefined): void {
  const refusal = roll(player, dice)
  if (refusal === null || refusal.code !== 'BELOW_MIN_TOTAL') return
  // The window stays open after a refused roll: undo still takes back its last action.
  if (player.session.pending.length > 0) {
    const kept = player.session
    undoLast(player)
    player.report.undoneAfterRefusedRoll++
    const redo = kept.pending.at(-1)
    if (redo !== undefined) expect(bet(player, redo), 'the undone action applies again').toBe(true)
  }
  const top = topUp(player.session.state, player.cfg, refusal)
  if (top === null) return
  if (!bet(player, top)) {
    bet(player, { type: 'deposit', amount: cents(50_000) })
    if (!bet(player, top)) return
  }
  roll(player, dice)
}

/** Rolls and checks the commit; returns the refusal, or null when the dice rolled. */
function roll(player: Player, dice: Dice | undefined): Rejection | null {
  const { cfg, report } = player
  const before = player.session
  const result = rollWindow(before, cfg, dice)
  const action: Action = dice === undefined ? { type: 'roll' } : { type: 'roll', dice }
  const direct = applyAction(before.state, action, cfg)
  if (!result.ok) {
    report.refusedRolls++
    expect(direct.ok ? null : direct.rejection, 'the refusal is the table’s').toEqual(
      result.rejection,
    )
    return result.rejection
  }
  if (!direct.ok)
    throw new Error(`the window rolled what the table refuses: ${direct.rejection.code}`)
  report.rolls++
  const next = result.session
  expect(next.state).toStrictEqual(direct.state)
  expect(result.events).toStrictEqual(direct.events)
  expect(result.record).toStrictEqual({
    actions: before.pending,
    roll:
      dice === undefined ? { type: 'roll' } : { type: 'roll', dice: { d1: dice.d1, d2: dice.d2 } },
    hashAfter: hashJson(next.state),
  })
  expect(next.committed).toStrictEqual([...before.committed, result.record])
  expect(next.windowStart).toBe(next.state)
  expect(next.pending).toEqual([])
  expect(next.header).toBe(before.header)
  // No undo across a roll: the window it closed is committed, bets and all.
  expect(undo(next, cfg), 'undo after a roll').toBeNull()
  expect(clearWindow(next, cfg)).toBe(next)
  report.rollBoundaries++
  player.windows.push({
    actionEvents: player.events,
    atRoll: before.state,
    rollEvents: result.events,
    after: next.state,
  })
  player.session = next
  player.tables = [next.state]
  player.events = []
  player.lastRoll = result.events
  return null
}

/** Runs one macro and dispatches what it emits, which must be one batch the table takes. */
function runMacro(player: Player, kind: MacroKind, n: number): void {
  const { cfg, report } = player
  const { state, lastWindow } = player.session
  let actions: readonly Action[]
  switch (kind) {
    case 'repeat':
      actions = repeatBets(state, lastWindow, cfg)
      break
    case 'double':
      actions = doubleBets(state, cfg)
      break
    case 'press': {
      const target = pressTargets(state, player.lastRoll, n)[0]
      if (target === undefined) return
      actions = pressBet(state, target.betId, cents(target.won), cfg)
      break
    }
    case 'maxOdds':
      actions = maxOutOdds(state, null, cfg)
      break
    case 'maxOddsOne': {
      const parent = pick(parentsOf(state, cfg), n)
      if (parent === undefined) return
      actions = maxOutOdds(state, parent, cfg)
      break
    }
    case 'takeDownAll':
      actions = takeDownAll(state, cfg)
      break
  }
  expectEmitted(state, cfg, actions)
  for (const action of actions) {
    expect(bet(player, action), `${kind} dispatched`).toBe(true)
    bump(report.macros, kind)
  }
}

/** The bets odds can go behind: those of a type that has odds. */
function parentsOf(state: TableState, cfg: MachineConfig): BetId[] {
  return state.bets.filter((b) => cfg.oddsFor.has(b.typeId)).map((b) => b.id)
}

/**
 * Bets to press: the last roll's winners still up, by what they won, or else any bet with a made-up
 * win, so Press also meets bets that cannot grow.
 */
function pressTargets(
  state: TableState,
  lastRoll: readonly GameEvent[],
  n: number,
): { readonly betId: BetId; readonly won: number }[] {
  const up = new Set(state.bets.map((b) => b.id))
  const winner = pick(
    [...winsOf(lastRoll)].filter(([id]) => up.has(id)),
    n,
  )
  if (winner !== undefined) return [{ betId: winner[0], won: winner[1] }]
  const other = pick(state.bets, n)
  return other === undefined ? [] : [{ betId: other.id, won: ((n % 40) + 1) * 50 }]
}

/**
 * The macro property (plan §9 item 6): nothing, or exactly one batch that `validateAction` accepts
 * on the table the macro was given and that changes it.
 */
export function expectEmitted(
  state: TableState,
  cfg: MachineConfig,
  actions: readonly Action[],
): TableState {
  expect(actions.length).toBeLessThanOrEqual(1)
  const batch = actions[0]
  if (batch === undefined) return state
  expect(batch.type).toBe('batch')
  expect(validateAction(state, batch, cfg), 'the table accepts the macro').toBeNull()
  const result = applyAction(state, batch, cfg)
  if (!result.ok) throw new Error('validateAction and applyAction disagree')
  expect(canonicalJson(result.state), 'the macro changes the table').not.toBe(canonicalJson(state))
  return result.state
}

/**
 * Every macro on this table, each checked against the property and against what it is meant to do,
 * without dispatching any of them.
 */
function checkAllMacros(player: Player): void {
  const { cfg, report } = player
  const { state, lastWindow } = player.session
  const emitted = (kind: MacroKind, actions: readonly Action[]): TableState => {
    report.macroChecks++
    if (actions.length > 0) bump(report.macroEmitted, kind)
    return expectEmitted(state, cfg, actions)
  }
  const inner = (actions: readonly Action[]): readonly Action[] => {
    const batch = actions[0]
    return batch?.type === 'batch' ? batch.actions : []
  }

  // Repeat is exactly the last window's betting actions.
  const repeat = repeatBets(state, lastWindow, cfg)
  emitted('repeat', repeat)
  if (repeat.length > 0) expect(inner(repeat)).toStrictEqual(lastWindow)

  // Double sets bets to twice what they hold, each at most once.
  const double = doubleBets(state, cfg)
  emitted('double', double)
  const doubled = new Set<BetId>()
  for (const action of inner(double)) {
    if (action.type !== 'setAmount') throw new Error(`double emitted ${action.type}`)
    const target = state.bets.find((b) => b.id === action.betId)
    if (target === undefined) throw new Error('doubled a bet that is not up')
    expect(action.amount).toBe(target.amount * 2)
    expect(doubled.has(action.betId)).toBe(false)
    doubled.add(action.betId)
  }

  // Press adds no more than the win, in whole units of the bet's increment.
  for (const { betId, won } of pressTargets(state, player.lastRoll, report.moves)) {
    const press = pressBet(state, betId, cents(won), cfg)
    emitted('press', press)
    const [action] = inner(press)
    if (action === undefined) continue
    if (action.type !== 'setAmount') throw new Error(`press emitted ${action.type}`)
    const target = state.bets.find((b) => b.id === betId)
    if (target === undefined) throw new Error('pressed a bet that is not up')
    const added = action.amount - target.amount
    expect(added).toBeGreaterThan(0)
    expect(added).toBeLessThanOrEqual(won)
    expect(added % typeLimits(cfg, target.typeId, target.number).increment).toBe(0)
  }

  // Maximum odds leaves no odds spot it covers that could take more.
  for (const parent of [null, ...parentsOf(state, cfg)]) {
    const after = emitted(
      parent === null ? 'maxOdds' : 'maxOddsOne',
      maxOutOdds(state, parent, cfg),
    )
    for (const spot of legalBets(after, cfg)) {
      if (spot.parentId === null || (parent !== null && spot.parentId !== parent)) continue
      expect(spot.canAdd, `${spot.typeId} behind ${spot.parentId} after max odds`).not.toBeNull()
    }
  }

  // Take down all leaves nothing that could come down.
  const after = emitted('takeDownAll', takeDownAll(state, cfg))
  for (const spot of legalBets(after, cfg)) {
    expect(spot.canRemove, `${spot.typeId} left up by take down all`).not.toBeNull()
  }
}

/**
 * Replay equals live play: the log replays to the table live play reached, every window's hash
 * matches its record and its live table, the roll history rebuilt from the log (plan §0 #20) has
 * the very events live play gave, and the stored session resumes to an equal session.
 */
export function expectReplayMatches({ session, windows }: Played): void {
  const { header, committed, pending } = session
  expect(replay(header, committed)).toStrictEqual(session.windowStart)
  const history = replayHistory(header, committed)
  expect(history).toHaveLength(windows.length)
  history.forEach((replayed, index) => {
    const live = windows[index]
    const record = committed[index]
    if (live === undefined || record === undefined) throw new Error(`window ${index} missing`)
    expect(hashJson(replayed.after), `window ${index} hash`).toBe(record.hashAfter)
    expect(replayed.after).toStrictEqual(live.after)
    expect(replayed.atRoll).toStrictEqual(live.atRoll)
    expect(replayed.actionEvents).toStrictEqual(live.actionEvents)
    expect(replayed.rollEvents).toStrictEqual(live.rollEvents)
  })
  const resumed = resumeSession(header, committed, pending, { expectHash: hashJson(session.state) })
  expect(resumed).toStrictEqual(session)
}

/** The session log round-trips: JSON to an equal session, and that session to the same JSON. */
export function expectSerializes({ session }: Played): void {
  const text = serializeSession(session)
  const back = deserializeSession(text)
  if (!back.ok) throw new Error(`the log does not load: ${JSON.stringify(back.error)}`)
  expect(back.session).toStrictEqual(session)
  expect(serializeSession(back.session)).toBe(text)
}
