import { describe, expect, it } from 'vitest'
import { compileConfig } from '../config/compile.ts'
import { PRESETS } from '../config/presets/index.ts'
import type { PointNumber } from '../config/rulesets.ts'
import type { DieFace } from '../core/dice.ts'
import { hashJson } from '../core/hash.ts'
import { cents } from '../core/money.ts'
import { betId } from '../bets/types.ts'
import type { Action } from '../table/actions.ts'
import { applyAction, validateAction } from '../table/reducer.ts'
import { newTable, type TableState } from '../table/state.ts'
import { ENGINE_VERSION } from '../version.ts'
import { replay } from './replay.ts'
import {
  clearWindow,
  dispatchBetting,
  lastWindowOf,
  newSession,
  rollWindow,
  undo,
  type BettingResult,
  type RollResult,
  type WindowedSession,
} from './window.ts'

const crapless = compileConfig(PRESETS.craplessBubble)

const place = (typeId: string, amount: number): Action => ({
  type: 'place',
  typeId,
  amount: cents(amount),
})
const placeOn = (typeId: string, number: PointNumber, amount: number): Action => ({
  type: 'place',
  typeId,
  number,
  amount: cents(amount),
})
const odds = (typeId: string, parent: number, amount: number): Action => ({
  type: 'place',
  typeId,
  parentId: betId(parent),
  amount: cents(amount),
})
const dice = (d1: DieFace, d2: DieFace) => ({ d1, d2 })

function ok<T extends BettingResult | RollResult>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.rejection)}`)
  return result as Extract<T, { ok: true }>
}

/** The session after each action in turn, all accepted. */
function bets(session: WindowedSession, actions: readonly Action[]): WindowedSession {
  return actions.reduce((s, action) => ok(dispatchBetting(s, action, crapless)).session, session)
}

describe('newSession', () => {
  it('records the engine version, the machine and the seed, and starts on the new table', () => {
    const session = newSession(crapless, 'window')
    expect(session.header).toEqual({
      engineVersion: ENGINE_VERSION,
      configHash: crapless.configHash,
      seed: 'window',
      config: crapless.input,
    })
    expect(session.state).toStrictEqual(newTable(crapless, 'window'))
    expect(session.windowStart).toBe(session.state)
    expect(session.committed).toEqual([])
    expect(session.pending).toEqual([])
    expect(session.lastWindow).toEqual([])
    // Plain JSON, so the shell can store it as it is.
    expect(JSON.parse(JSON.stringify(session))).toStrictEqual(session)
  })
})

describe('dispatchBetting', () => {
  it('adds an accepted action to the window, applied as the table applies it', () => {
    const start = newSession(crapless, 'window')
    const action = place('pass', 1_000)
    const result = ok(dispatchBetting(start, action, crapless))
    const direct = applyAction(start.state, action, crapless)
    expect(direct.ok && direct.state).toStrictEqual(result.session.state)
    expect(direct.ok && direct.events).toStrictEqual(result.events)
    expect(result.session.pending).toStrictEqual([action])
    expect(result.session.windowStart).toBe(start.windowStart)
    // The session it was given is unchanged.
    expect(start.pending).toEqual([])
    expect(start.state.bets).toEqual([])
  })

  it('logs a plain JSON copy, which later changes to the caller’s action cannot reach', () => {
    const action = {
      type: 'place' as const,
      typeId: 'place',
      number: 6 as const,
      parentId: undefined,
      amount: cents(600),
    }
    const session = ok(dispatchBetting(newSession(crapless, 'w'), action, crapless)).session
    action.amount = cents(60_000)
    expect(session.pending).toStrictEqual([
      { type: 'place', typeId: 'place', number: 6, amount: 600 },
    ])
    expect(session.state.bets[0]?.amount).toBe(600)
  })

  it('logs nothing for a refused action, and refuses as the table does', () => {
    const start = bets(newSession(crapless, 'w'), [place('pass', 500)])
    for (const action of [
      place('pass', 150),
      place('noSuchBet', 500),
      { type: 'setAmount', betId: betId(9), amount: cents(0) },
      { type: 'deposit', amount: cents(0) },
      placeOn('place', 7 as PointNumber, 600),
    ] as const satisfies readonly Action[]) {
      const result = dispatchBetting(start, action, crapless)
      expect(result.ok, JSON.stringify(action)).toBe(false)
      expect(result.ok ? null : result.rejection).toEqual(
        validateAction(start.state, action, crapless),
      )
    }
    expect(start.pending).toHaveLength(1)
  })

  it('logs nothing for an accepted action that leaves the table as it was', () => {
    const start = bets(newSession(crapless, 'w'), [placeOn('place', 6, 600)])
    for (const action of [
      { type: 'setAmount', betId: betId(1), amount: cents(600) },
      { type: 'setGlobalWorking', off: null },
    ] as const satisfies readonly Action[]) {
      const result = ok(dispatchBetting(start, action, crapless))
      expect(result.session).toBe(start)
    }
  })

  it('leaves rolls to rollWindow, alone or inside a batch', () => {
    const start = bets(newSession(crapless, 'w'), [place('pass', 500)])
    expect(dispatchBetting(start, { type: 'roll' }, crapless)).toEqual({
      ok: false,
      rejection: { code: 'BAD_PARAMS', details: { field: 'type', reason: 'roll' } },
    })
    const hidden: Action = { type: 'batch', actions: [place('field', 100), { type: 'roll' }] }
    const result = dispatchBetting(start, hidden, crapless)
    expect(result.ok ? null : result.rejection.code).toBe('BAD_PARAMS')
    expect(start.state.round.rollIndex).toBe(0)
  })

  it('throws for another machine’s config: a session never has two', () => {
    const strict = compileConfig(PRESETS.strictBubble)
    const session = newSession(crapless, 'w')
    expect(() => dispatchBetting(session, place('pass', 500), strict)).toThrow(RangeError)
    expect(() => undo(session, strict)).toThrow(RangeError)
    expect(() => clearWindow(session, strict)).toThrow(RangeError)
    expect(() => rollWindow(session, strict)).toThrow(RangeError)
  })
})

describe('undo', () => {
  it('takes back the window’s actions one at a time, each to the exact table before it', () => {
    let session = newSession(crapless, 'undo')
    const tables: TableState[] = [session.state]
    for (const action of [
      place('pass', 1_000),
      { type: 'deposit', amount: cents(20_000) },
      place('field', 300),
      {
        type: 'batch',
        actions: [placeOn('place', 6, 600), placeOn('place', 8, 600)],
      },
      { type: 'setAmount', betId: betId(1), amount: cents(2_500) },
      { type: 'setGlobalWorking', off: true },
    ] as const satisfies readonly Action[]) {
      session = ok(dispatchBetting(session, action, crapless)).session
      tables.push(session.state)
    }
    expect(session.pending).toHaveLength(6)
    for (let left = 5; left >= 0; left--) {
      const back = undo(session, crapless)
      if (back === null) throw new Error('nothing to undo')
      expect(back.state).toStrictEqual(tables[left])
      expect(back.pending).toStrictEqual(session.pending.slice(0, left))
      session = back
    }
    expect(session.state).toStrictEqual(newTable(crapless, 'undo'))
    expect(undo(session, crapless)).toBeNull()
  })

  it('never crosses a roll: what was bet before the dice rolled stays bet', () => {
    const before = bets(newSession(crapless, 'undo'), [place('pass', 1_000), place('field', 200)])
    const rolled = ok(rollWindow(before, crapless, dice(3, 3))).session
    expect(rolled.pending).toEqual([])
    expect(undo(rolled, crapless)).toBeNull()
    expect(clearWindow(rolled, crapless)).toBe(rolled)
    expect(rolled.state.bets).toMatchObject([{ typeId: 'pass', number: 6, amount: 1_000 }])
    // A new window's own actions undo as far as the roll, and no further.
    const withOdds = bets(rolled, [odds('passOdds', 1, 2_000)])
    const back = undo(withOdds, crapless)
    expect(back?.state).toStrictEqual(rolled.state)
    expect(back && undo(back, crapless)).toBeNull()
  })

  it('still works after a refused roll, which leaves the window open', () => {
    const start = newSession(crapless, 'undo')
    // An empty table cannot roll on a machine with a round minimum.
    const empty = rollWindow(start, crapless)
    expect(empty.ok ? null : empty.rejection).toEqual({
      code: 'BELOW_MIN_TOTAL',
      details: { scope: 'totalRound', min: 500, total: 0, short: 500 },
    })
    const field = bets(start, [place('field', 100)])
    const short = rollWindow(field, crapless)
    expect(short.ok ? null : short.rejection.details.short).toBe(400)
    expect(undo(field, crapless)?.state).toStrictEqual(start.state)
    const line = bets(field, [place('pass', 500)])
    const rolled = ok(rollWindow(line, crapless))
    expect(rolled.record.actions).toStrictEqual([place('field', 100), place('pass', 500)])
  })
})

describe('clearWindow', () => {
  it('takes back every action of the window at once', () => {
    const rolled = ok(
      rollWindow(bets(newSession(crapless, 'clear'), [place('pass', 500)]), crapless, dice(2, 2)),
    ).session
    const busy = bets(rolled, [
      placeOn('place', 6, 600),
      { type: 'deposit', amount: cents(10_000) },
      placeOn('hard', 8, 100),
    ])
    const cleared = clearWindow(busy, crapless)
    expect(cleared.state).toBe(rolled.state)
    expect(cleared.pending).toEqual([])
    expect(cleared.committed).toBe(busy.committed)
    expect(clearWindow(cleared, crapless)).toBe(cleared)
  })
})

describe('rollWindow', () => {
  it('commits the window’s actions and its roll as one record, with the hash of the table', () => {
    const before = bets(newSession(crapless, 'roll'), [place('pass', 1_000), place('field', 100)])
    const result = ok(rollWindow(before, crapless))
    const direct = applyAction(before.state, { type: 'roll' }, crapless)
    if (!direct.ok) throw new Error('the table refused the roll')
    expect(result.session.state).toStrictEqual(direct.state)
    expect(result.events).toStrictEqual(direct.events)
    expect(result.record).toStrictEqual({
      actions: before.pending,
      roll: { type: 'roll' },
      hashAfter: hashJson(direct.state),
    })
    expect(result.session.committed).toStrictEqual([result.record])
    expect(result.session.windowStart).toBe(result.session.state)
    expect(result.session.pending).toEqual([])
    expect(result.session.header).toBe(before.header)
    // Drawn dice advance the dice stream.
    expect(result.session.state.rng).not.toEqual(before.state.rng)
  })

  it('logs scripted dice with the roll, as a copy, and leaves the dice stream alone', () => {
    const before = bets(newSession(crapless, 'roll'), [place('pass', 1_000)])
    const scripted = dice(5, 6)
    const result = ok(rollWindow(before, crapless, scripted))
    expect(result.record.roll).toStrictEqual({ type: 'roll', dice: { d1: 5, d2: 6 } })
    expect(result.record.roll.dice).not.toBe(scripted)
    expect(result.session.state.rng).toEqual(before.state.rng)
    expect(result.session.state.lastRoll).toEqual({ dice: { d1: 5, d2: 6 }, scripted: true })
  })

  it('changes nothing when the table refuses the roll', () => {
    const before = bets(newSession(crapless, 'roll'), [place('field', 200)])
    const result = rollWindow(before, crapless)
    expect(result).toEqual({
      ok: false,
      rejection: validateAction(before.state, { type: 'roll' }, crapless),
    })
    const bad = rollWindow(before, crapless, { d1: 7, d2: 1 } as never)
    expect(bad.ok ? null : bad.rejection).toEqual({
      code: 'BAD_PARAMS',
      details: { field: 'dice' },
    })
    expect(before.committed).toEqual([])
    expect(before.pending).toHaveLength(1)
  })

  it('logs deposits with their window, and replays them', () => {
    const before = bets(newSession(crapless, 'deposit'), [
      { type: 'deposit', amount: cents(25_000) },
      place('pass', 1_000),
    ])
    const after = ok(rollWindow(before, crapless)).session
    expect(after.committed[0]?.actions[0]).toStrictEqual({ type: 'deposit', amount: 25_000 })
    expect(after.state.ledger.deposits).toBe(75_000)
    expect(replay(after.header, after.committed)).toStrictEqual(after.state)
  })
})

describe('lastWindow', () => {
  it('is the latest window’s bets: no deposits or switches, batches flattened', () => {
    const window1 = bets(newSession(crapless, 'last'), [
      place('pass', 500),
      { type: 'deposit', amount: cents(5_000) },
      { type: 'batch', actions: [place('field', 100), { type: 'deposit', amount: cents(100) }] },
      placeOn('place', 6, 600),
      { type: 'setGlobalWorking', off: true },
      { type: 'setAmount', betId: betId(3), amount: cents(1_200) },
    ])
    const rolled = ok(rollWindow(window1, crapless, dice(4, 4))).session
    expect(rolled.lastWindow).toStrictEqual([
      place('pass', 500),
      place('field', 100),
      placeOn('place', 6, 600),
      { type: 'setAmount', betId: betId(3), amount: 1_200 },
    ])
    // A window with no bets keeps the one before: none, only deposits, or only switches.
    const quiet = ok(rollWindow(rolled, crapless, dice(1, 2))).session
    expect(quiet.lastWindow).toBe(rolled.lastWindow)
    const topUp = bets(quiet, [
      { type: 'deposit', amount: cents(1_000) },
      { type: 'setGlobalWorking', off: null },
    ])
    const deposited = ok(rollWindow(topUp, crapless, dice(2, 3))).session
    expect(deposited.lastWindow).toBe(rolled.lastWindow)
    expect(lastWindowOf(deposited.committed)).toStrictEqual(deposited.lastWindow)
    // A new window's bets become the last window once it rolls.
    const withOdds = bets(deposited, [odds('passOdds', 1, 1_000)])
    const next = ok(rollWindow(withOdds, crapless, dice(6, 6))).session
    expect(next.lastWindow).toStrictEqual([odds('passOdds', 1, 1_000)])
    expect(lastWindowOf(next.committed)).toStrictEqual(next.lastWindow)
    expect(lastWindowOf([])).toEqual([])
  })
})
