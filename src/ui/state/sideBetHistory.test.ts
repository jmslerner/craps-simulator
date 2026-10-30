import { describe, expect, it } from 'vitest'
import { cents, totalBit } from '../../engine/index.ts'
import type { WindowedSession } from '../../engine/index.ts'
import { CRAPLESS, bet, placePass, roll, testSession } from '../test/game.ts'
import { rollEntryOf } from './rollHistory.ts'

/**
 * The history's side-bet fields (plan §10 M11, additive to `RollEntry`): the roll's `betProgress`
 * events and every bet's progress as it stood when the roll was made, both straight from the
 * engine, so the panel can say what a settled side bet had collected.
 */

function played(session: WindowedSession, dice: readonly [number, number]) {
  const before = session.state
  const result = roll(session, dice)
  return { entry: rollEntryOf(before, result.events, result.session.state, CRAPLESS), result }
}

describe('rollEntryOf with a side bet on the table', () => {
  it('carries the betProgress events and the progress each bet brought into the roll', () => {
    let session = placePass(testSession('history-side-bet'))
    session = bet(session, { type: 'place', typeId: 'luckyRollerLow', amount: cents(100) })

    const first = played(session, [1, 1]) // the point is 2, and 2 is a Low Rolls target
    expect(first.entry.progress).toStrictEqual([
      { type: 'betProgress', betId: 'b2', progress: totalBit(2) },
    ])
    expect(first.entry.betsAtRoll).toStrictEqual([
      { betId: 'b1', typeId: 'pass', progress: 0 },
      { betId: 'b2', typeId: 'luckyRollerLow', progress: 0 },
    ])
    expect(first.entry.items.map((item) => item.type)).toStrictEqual(['betTraveled'])

    const second = played(first.result.session, [2, 2]) // 4: progress only, nothing decided
    expect(second.entry.progress).toStrictEqual([
      { type: 'betProgress', betId: 'b2', progress: totalBit(2) | totalBit(4) },
    ])
    expect(second.entry.items).toStrictEqual([])
    expect(second.entry.betsAtRoll[1]?.progress).toBe(totalBit(2))

    const out = played(second.result.session, [3, 4]) // seven-out: pass and Low Rolls lose
    expect(out.entry.progress).toStrictEqual([])
    expect(out.entry.betsAtRoll[1]).toStrictEqual({
      betId: 'b2',
      typeId: 'luckyRollerLow',
      progress: totalBit(2) | totalBit(4),
    })
    const lost = out.entry.items.filter((item) => item.type === 'betResolved')
    expect(
      lost.map((item) => (item.type === 'betResolved' ? item.trace.typeId : '')),
    ).toStrictEqual(['pass', 'luckyRollerLow'])
    expect(out.entry.net).toBe(-600)
  })

  it('has empty side-bet fields on a roll with no bets but the line', () => {
    const { entry } = played(placePass(testSession('history-no-side')), [3, 4])
    expect(entry.progress).toStrictEqual([])
    expect(entry.betsAtRoll).toStrictEqual([{ betId: 'b1', typeId: 'pass', progress: 0 }])
  })
})
