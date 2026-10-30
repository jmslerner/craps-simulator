import { describe, expect, it } from 'vitest'
import { cents, replayHistory } from '../../engine/index.ts'
import type { WindowedSession } from '../../engine/index.ts'
import { CRAPLESS, placePass, placeSix, roll, testSession, type TestRoll } from '../test/game.ts'
import {
  HISTORY_CAP,
  emptyHistory,
  groupByHand,
  historyFromWindows,
  pushRoll,
  rollEntryOf,
  type RollHistory,
} from './rollHistory.ts'

/** Rolls and returns the entry the store would append, with the sessions around it. */
function playedEntry(session: WindowedSession, dice: readonly [number, number]) {
  const before = session.state
  const played: TestRoll = roll(session, dice)
  return { entry: rollEntryOf(before, played.events, played.session.state), played }
}

describe('rollEntryOf', () => {
  it('derives dice, round event, amounts, net and credit from the engine events', () => {
    const session = placePass(testSession('history-natural')) // $5 pass, bankroll $495.00
    const { entry } = playedEntry(session, [3, 4]) // come-out 7: a crapless natural, pass wins 1:1
    expect(entry.rollIndex).toBe(0)
    expect(entry.dice).toStrictEqual({ d1: 3, d2: 4 })
    expect(entry.total).toBe(7)
    expect(entry.scripted).toBe(true)
    expect(entry.handIndex).toBe(0)
    expect(entry.roundEvent?.type).toBe('natural')
    expect(entry.endedHand).toBe(false)
    const resolved = entry.items.filter((item) => item.type === 'betResolved')
    expect(resolved).toHaveLength(1)
    const trace = resolved[0]?.type === 'betResolved' ? resolved[0].trace : null
    expect(trace?.outcome).toBe('win')
    expect(trace?.stake).toBe(500)
    expect(trace?.winPaid).toBe(500) // $5 at 1:1, exactly
    // The pass line stays up after a win on this machine, so only the win reaches credit.
    expect(trace?.stakeDisposition).toBe('stays')
    expect(entry.net).toBe(500)
    expect(entry.creditAfter).toBe(50_000) // $495.00 + the $5.00 win, the stake still up
  })

  it('marks the seven-out and the hand it ended', () => {
    const opened = placePass(testSession('history-sevenout'))
    const pointSet = playedEntry(opened, [1, 1]) // point 2
    expect(pointSet.entry.roundEvent?.type).toBe('pointEstablished')
    const out = playedEntry(pointSet.played.session, [3, 4]) // 7 out: pass loses
    expect(out.entry.roundEvent?.type).toBe('sevenOut')
    expect(out.entry.endedHand).toBe(true)
    expect(out.entry.handIndex).toBe(0)
    expect(out.entry.net).toBe(-500)
  })

  it('refuses events that hold no roll', () => {
    expect(() => rollEntryOf(testSession('x').state, [], testSession('x').state)).toThrow(
      /events of a roll/,
    )
  })
})

describe('pushRoll', () => {
  it('keeps the newest first and trims at the cap with a marker', () => {
    const session = placePass(testSession('history-cap'))
    const first = playedEntry(session, [3, 4])
    const second = playedEntry(first.played.session, [1, 1])
    const third = playedEntry(placeSix(second.played.session), [3, 3])
    let history: RollHistory = emptyHistory()
    history = pushRoll(history, first.entry, 2)
    history = pushRoll(history, second.entry, 2)
    expect(history.trimmed).toBe(false)
    history = pushRoll(history, third.entry, 2)
    expect(history.trimmed).toBe(true)
    expect(history.rolls.map((entry) => entry.rollIndex)).toStrictEqual([2, 1])
  })
})

describe('historyFromWindows', () => {
  it('rebuilds on resume exactly what the live pushes built (plan §0 #20)', () => {
    let session = placePass(testSession('history-replay'))
    let live: RollHistory = emptyHistory()
    const script: readonly (readonly [number, number])[] = [
      [1, 1], // point 2
      [3, 3], // no decision for the pass; place six would win if present
      [1, 1], // point 2 made
      [3, 4], // come-out 7: natural
    ]
    for (const dice of script) {
      const { entry, played } = playedEntry(session, dice)
      live = pushRoll(live, entry)
      session = played.session
    }
    const replayed = historyFromWindows(replayHistory(session.header, session.committed))
    expect(replayed).toStrictEqual(live)
  })

  it('trims the oldest windows at the cap', () => {
    let session = placePass(testSession('history-replay-cap'))
    for (const dice of [
      [3, 4],
      [1, 1],
      [1, 1],
    ] as const) {
      session = roll(session, dice).session
    }
    const trimmed = historyFromWindows(replayHistory(session.header, session.committed), 2)
    expect(trimmed.trimmed).toBe(true)
    expect(trimmed.rolls.map((entry) => entry.rollIndex)).toStrictEqual([2, 1])
  })
})

describe('the coach recap data on entries (plan §10 M9b)', () => {
  /** Rolls with the cfg, so the entry carries the recap extras the live store now builds. */
  function coachEntry(session: WindowedSession, dice: readonly [number, number]) {
    const before = session.state
    const played: TestRoll = roll(session, dice)
    return { entry: rollEntryOf(before, played.events, played.session.state, CRAPLESS), played }
  }

  it('an entry built with a cfg carries comeOut, stakes, untouched bets and moments', () => {
    const session = placeSix(placePass(testSession('history-coach'), 1000))
    const { entry } = coachEntry(session, [1, 1]) // point 2: pass travels, place 6 untouched
    expect(entry.comeOut).toBe(true)
    expect(entry.stakes).toBe(1600)
    expect(entry.noAction.map((b) => [b.typeId, b.number, b.working])).toEqual([['place', 6, true]])
    expect(entry.moments.map((m) => [m.id, m.number, m.amount, m.ordinal])).toEqual([
      ['point-outside', 2, 1000, 0], // the ordinal arrives in pushRoll
    ])
  })

  it('an entry built without a cfg stays bare, the M8 bootstrap path', () => {
    const session = placePass(testSession('history-bare'), 1000)
    const before = session.state
    const played = roll(session, [1, 1])
    const entry = rollEntryOf(before, played.events, played.session.state)
    expect(entry.comeOut).toBe(true)
    expect(entry.stakes).toBe(1000)
    expect(entry.noAction).toEqual([])
    expect(entry.moments).toEqual([])
  })

  it('pushRoll assigns session ordinals and keeps the seen counts past the cap', () => {
    // The pass line stays up after a win on this machine, so point 2 can be set repeatedly.
    let session = placePass(testSession('history-ordinals'), 1000)
    let history = emptyHistory()
    for (let cycle = 0; cycle < 4; cycle++) {
      const established = coachEntry(session, [1, 1]) // the point lands on 2
      history = pushRoll(history, established.entry, 2)
      const made = coachEntry(established.played.session, [1, 1]) // and is made at once
      history = pushRoll(history, made.entry, 2)
      session = made.played.session
    }
    expect(history.seen['point-outside']).toBe(4)
    expect(history.trimmed).toBe(true)
    expect(history.rolls).toHaveLength(2)
    // The newest establishment is the 4th occurrence: past MOMENT_SHOWN_COUNT, so the panel hides it.
    const newestEstablished = history.rolls.find((entry) => entry.moments.length > 0)
    expect(newestEstablished?.moments[0]?.ordinal).toBe(4)
  })

  it('pushRoll detects chasing losses: three straight losing rolls, then a raise', () => {
    const session = placePass(testSession('history-chasing'), 500)
    const base = coachEntry(session, [2, 3]).entry // point 5; a quiet template entry
    const losing = { ...base, net: cents(-500), stakes: cents(500), moments: [] }
    let history = emptyHistory()
    history = pushRoll(history, losing)
    history = pushRoll(history, losing)
    history = pushRoll(history, losing)
    const raised = pushRoll(history, { ...base, net: cents(0), stakes: cents(900), moments: [] })
    expect(raised.rolls[0]?.moments.map((m) => [m.id, m.ordinal])).toEqual([['chasing-losses', 1]])
    const flat = pushRoll(history, { ...base, net: cents(0), stakes: cents(500), moments: [] })
    expect(flat.rolls[0]?.moments).toEqual([]) // same money on the table: no moment
  })

  it('historyFromWindows with a cfg rebuilds the live history, ordinals and seen included', () => {
    let session = placePass(testSession('history-coach-replay'), 1000)
    let live = emptyHistory()
    const script: readonly (readonly [number, number])[] = [
      [1, 1], // point 2: the equity moment
      [3, 3], // no decision
      [1, 1], // point 2 made
      [1, 1], // point 2 again: the moment's second occurrence
    ]
    for (const dice of script) {
      const { entry, played } = coachEntry(session, dice)
      live = pushRoll(live, entry)
      session = played.session
    }
    const replayed = historyFromWindows(
      replayHistory(session.header, session.committed),
      HISTORY_CAP,
      CRAPLESS,
    )
    expect(replayed).toStrictEqual(live)
    expect(replayed.seen['point-outside']).toBe(2)
  })
})

describe('groupByHand', () => {
  it('groups newest-first by hand with per-hand totals', () => {
    let session = placePass(testSession('history-hands'))
    let history: RollHistory = emptyHistory()
    const nets: number[] = []
    for (const dice of [
      [1, 1], // hand 0: point 2
      [3, 4], // hand 0: seven-out, pass loses
    ] as const) {
      const { entry, played } = playedEntry(session, dice)
      history = pushRoll(history, entry)
      nets.push(entry.net)
      session = played.session
    }
    session = placePass(session) // the next hand's pass
    const third = playedEntry(session, [1, 2]) // hand 1: point 3
    history = pushRoll(history, third.entry)

    const hands = groupByHand(history)
    expect(hands.map((hand) => hand.handIndex)).toStrictEqual([1, 0])
    expect(hands[0]?.rollCount).toBe(1)
    expect(hands[1]?.rollCount).toBe(2)
    expect(hands[1]?.net).toBe(nets.reduce((sum, net) => sum + net, 0))
    // Newest roll first inside the hand too.
    expect(hands[1]?.rolls.map((entry) => entry.rollIndex)).toStrictEqual([1, 0])
  })
})
