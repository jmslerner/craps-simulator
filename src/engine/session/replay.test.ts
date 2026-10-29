import { describe, expect, it } from 'vitest'
import { compileConfig } from '../config/compile.ts'
import { PRESETS } from '../config/presets/index.ts'
import type { MachineConfigInput } from '../config/schema.ts'
import { hashJson } from '../core/hash.ts'
import { cents } from '../core/money.ts'
import { betId } from '../bets/types.ts'
import type { Action } from '../table/actions.ts'
import type { GameEvent } from '../table/events.ts'
import { ENGINE_VERSION } from '../version.ts'
import {
  ReplayError,
  headerConfig,
  replay,
  replayHistory,
  resumeSession,
  type ReplayFailure,
} from './replay.ts'
import {
  dispatchBetting,
  newSession,
  rollWindow,
  type SessionHeader,
  type WindowRecord,
  type WindowedSession,
} from './window.ts'

const crapless = compileConfig(PRESETS.craplessBubble)

/**
 * A crapless session of a few windows: line bets, odds, place bets, a deposit and a press, with
 * dice drawn from the seed except where scripted. Returns it with the events live play gave.
 */
function played(): { session: WindowedSession; rolls: GameEvent[][]; actions: GameEvent[][][] } {
  let session = newSession(crapless, 'replay')
  const rolls: GameEvent[][] = []
  const actions: GameEvent[][][] = []
  let open: GameEvent[][] = []
  const bet = (action: Action) => {
    const result = dispatchBetting(session, action, crapless)
    if (!result.ok) throw new Error(`refused ${JSON.stringify(result.rejection)}`)
    session = result.session
    open.push([...result.events])
  }
  const roll = (dice?: { d1: 1 | 2 | 3 | 4 | 5 | 6; d2: 1 | 2 | 3 | 4 | 5 | 6 }) => {
    const result = rollWindow(session, crapless, dice)
    if (!result.ok) throw new Error(`roll refused ${JSON.stringify(result.rejection)}`)
    session = result.session
    rolls.push([...result.events])
    actions.push(open)
    open = []
  }
  bet({ type: 'place', typeId: 'pass', amount: cents(1_000) })
  bet({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
  roll({ d1: 2, d2: 2 })
  bet({ type: 'place', typeId: 'passOdds', parentId: betId(1), amount: cents(2_000) })
  bet({ type: 'deposit', amount: cents(10_000) })
  roll({ d1: 1, d2: 3 })
  bet({ type: 'setAmount', betId: betId(2), amount: cents(1_200) })
  roll()
  roll()
  bet({ type: 'place', typeId: 'field', amount: cents(500) })
  return { session, rolls, actions }
}

/** The failure a call throws; fails the test if it does not throw a `ReplayError`. */
function failureOf(run: () => unknown): ReplayFailure {
  try {
    run()
  } catch (error) {
    if (error instanceof ReplayError) return error.failure
    throw error
  }
  throw new Error('expected a ReplayError')
}

/** `records` with record `index` changed by `change`. */
function editRecord(
  records: readonly WindowRecord[],
  index: number,
  change: (record: WindowRecord) => WindowRecord,
): WindowRecord[] {
  return records.map((record, i) => (i === index ? change(record) : record))
}

describe('replay', () => {
  it('replays a log to the table live play reached', () => {
    const { session } = played()
    expect(session.committed).toHaveLength(4)
    expect(replay(session.header, session.committed)).toStrictEqual(session.windowStart)
    expect(replay(session.header, [])).toStrictEqual(newSession(crapless, 'replay').state)
  })

  it('rebuilds the roll history: each window’s events, as live play gave them', () => {
    const { session, rolls, actions } = played()
    const history = replayHistory(session.header, session.committed)
    expect(history.map((w) => w.rollEvents)).toStrictEqual(rolls)
    expect(history.map((w) => w.actionEvents)).toStrictEqual(actions)
    history.forEach((replayed, index) => {
      expect(replayed.index).toBe(index)
      expect(hashJson(replayed.after)).toBe(session.committed[index]?.hashAfter)
      expect(replayed.rollEvents[0]).toMatchObject({ type: 'diceRolled', rollIndex: index })
      expect(replayed.start).toStrictEqual(
        index === 0 ? newSession(crapless, 'replay').state : history[index - 1]?.after,
      )
    })
    // The second roll makes the point: the pass line wins and its odds pay, each with its trace.
    const resolved = history[1]?.rollEvents.filter((e) => e.type === 'betResolved') ?? []
    expect(
      resolved.map((e) => e.type === 'betResolved' && [e.trace.typeId, e.trace.winPaid]),
    ).toEqual([
      ['pass', 1_000],
      ['passOdds', 4_000],
    ])
  })

  it('refuses a log from another engine version, unless asked only to check it', () => {
    const { session } = played()
    const header = { ...session.header, engineVersion: ENGINE_VERSION + 1 }
    expect(failureOf(() => replay(header, session.committed))).toEqual({
      kind: 'engineVersion',
      logged: ENGINE_VERSION + 1,
      current: ENGINE_VERSION,
    })
    expect(replay(header, session.committed, { anyEngineVersion: true })).toStrictEqual(
      session.windowStart,
    )
  })

  it('refuses a header whose config does not compile, or compiles to another hash', () => {
    const { session } = played()
    const strict = compileConfig(PRESETS.strictBubble)
    expect(
      failureOf(() =>
        replay({ ...session.header, configHash: strict.configHash }, session.committed),
      ),
    ).toEqual({
      kind: 'configHash',
      logged: strict.configHash,
      compiled: crapless.configHash,
    })
    const broken = { ...crapless.input, variant: 'noSuchVariant' } as unknown as MachineConfigInput
    const failure = failureOf(() =>
      replay({ ...session.header, config: broken }, session.committed),
    )
    expect(failure.kind).toBe('config')
    expect(failure.kind === 'config' && failure.issues.length).toBeGreaterThan(0)
    expect(
      failureOf(() => replay({ ...session.header, seed: 5 } as unknown as SessionHeader, [])),
    ).toEqual({
      kind: 'malformed',
      where: 'header.seed',
      reason: 'not a string',
    })
  })

  it('names the window whose table hashes differently from its record', () => {
    const { session } = played()
    const tampered = editRecord(session.committed, 2, (r) => ({
      ...r,
      hashAfter: '0123456789abcdef',
    }))
    expect(failureOf(() => replay(session.header, tampered))).toEqual({
      kind: 'hash',
      window: 2,
      logged: '0123456789abcdef',
      replayed: session.committed[2]?.hashAfter,
    })
  })

  it('never diverges silently: a changed action or seed is caught at its window', () => {
    const { session } = played()
    // A press to $13 instead of $12 is still a valid action, so only the hash catches it.
    const pressed = editRecord(session.committed, 2, (r) => ({
      ...r,
      actions: [{ type: 'setAmount', betId: betId(2), amount: cents(1_300) }],
    }))
    expect(failureOf(() => replay(session.header, pressed))).toMatchObject({
      kind: 'hash',
      window: 2,
    })
    // Another seed is another dice stream, part of every table: the first window catches it.
    const reseeded = { ...session.header, seed: 'another seed' }
    expect(failureOf(() => replay(reseeded, session.committed))).toMatchObject({
      kind: 'hash',
      window: 0,
    })
  })

  it('names the action the table refuses, and a malformed record', () => {
    const { session } = played()
    const tooMuch = editRecord(session.committed, 1, (r) => ({
      ...r,
      actions: [{ type: 'place', typeId: 'passOdds', parentId: betId(1), amount: cents(9_000) }],
    }))
    expect(failureOf(() => replay(session.header, tooMuch))).toEqual({
      kind: 'refused',
      window: 1,
      step: 0,
      rejection: { code: 'ODDS_LIMIT', details: expect.anything() as unknown },
    })
    const unrolled = editRecord(session.committed, 0, (r) => ({ ...r, actions: [] }))
    expect(failureOf(() => replay(session.header, unrolled))).toMatchObject({
      kind: 'refused',
      window: 0,
      step: 'roll',
      rejection: { code: 'BELOW_MIN_TOTAL' },
    })
    const rollInside = editRecord(session.committed, 1, (r) => ({
      ...r,
      actions: [...r.actions, { type: 'roll' }],
    }))
    expect(failureOf(() => replay(session.header, rollInside))).toEqual({
      kind: 'malformed',
      where: 'windows[1].actions[2]',
      reason: 'a roll among the betting actions',
    })
    const noRoll = editRecord(
      session.committed,
      3,
      (r) => ({ ...r, roll: { type: 'deposit' } }) as unknown as WindowRecord,
    )
    expect(failureOf(() => replay(session.header, noRoll))).toEqual({
      kind: 'malformed',
      where: 'windows[3]',
      reason: 'not a window record',
    })
    expect(failureOf(() => replay(session.header, 'windows' as unknown as WindowRecord[]))).toEqual(
      {
        kind: 'malformed',
        where: 'windows',
        reason: 'not an array',
      },
    )
  })

  it('throws ReplayError with a message that says what differed', () => {
    const { session } = played()
    const tampered = editRecord(session.committed, 1, (r) => ({
      ...r,
      hashAfter: '0000000000000000',
    }))
    expect(() => replay(session.header, tampered)).toThrow(
      /^Session log does not replay: window 1 ends on table [0-9a-f]{16}, not 0000000000000000$/,
    )
  })
})

describe('resumeSession', () => {
  it('rebuilds the stored session, open window included', () => {
    const { session } = played()
    expect(session.pending).toHaveLength(1)
    const resumed = resumeSession(session.header, session.committed, session.pending, {
      expectHash: hashJson(session.state),
    })
    expect(resumed).toStrictEqual(session)
  })

  it('checks the open window too, as window committed.length', () => {
    const { session } = played()
    const open = session.committed.length
    expect(
      failureOf(() =>
        resumeSession(session.header, session.committed, session.pending, {
          expectHash: '0000000000000000',
        }),
      ),
    ).toEqual({
      kind: 'hash',
      window: open,
      logged: '0000000000000000',
      replayed: hashJson(session.state),
    })
    const refused: Action = { type: 'setAmount', betId: betId(99), amount: cents(0) }
    expect(failureOf(() => resumeSession(session.header, session.committed, [refused]))).toEqual({
      kind: 'refused',
      window: open,
      step: 0,
      rejection: { code: 'BET_NOT_FOUND', details: { betId: 'b99' } },
    })
  })

  it('carries a log checked under anyEngineVersion on as this version’s log', () => {
    const { session } = played()
    const header = { ...session.header, engineVersion: ENGINE_VERSION + 1 }
    expect(failureOf(() => resumeSession(header, session.committed, session.pending)).kind).toBe(
      'engineVersion',
    )
    const resumed = resumeSession(header, session.committed, session.pending, {
      anyEngineVersion: true,
    })
    expect(resumed.header.engineVersion).toBe(ENGINE_VERSION)
    expect(resumed.state).toStrictEqual(session.state)
  })
})

describe('headerConfig', () => {
  it('compiles the machine a header names', () => {
    const { session } = played()
    expect(headerConfig(session.header).configHash).toBe(crapless.configHash)
    expect(headerConfig(session.header).input).toStrictEqual(crapless.input)
    const copy = {
      ...session.header,
      config: JSON.parse(JSON.stringify(crapless.input)) as MachineConfigInput,
    }
    expect(headerConfig(copy).configHash).toBe(crapless.configHash)
  })
})
