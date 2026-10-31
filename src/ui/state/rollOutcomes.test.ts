import { describe, expect, it } from 'vitest'
import { cents } from '../../engine/index.ts'
import type { BetId, SettlementTrace, TableState } from '../../engine/index.ts'
import type { WindowedSession } from '../../engine/index.ts'
import { outcomeText } from '../components/ZoneButton.tsx'
import { layoutSpec } from '../layout/layoutSpec.ts'
import { CRAPLESS, bet, placePass, placeSix, roll, testSession } from '../test/game.ts'
import { rollEntryOf, type RollEntry } from './rollHistory.ts'
import { zoneOutcomes } from './rollOutcomes.ts'

const spec = layoutSpec(CRAPLESS)

/** The layout key of the zone for a bet type on a number (null: the type's bar or box). */
function keyOf(typeId: string, number: number | null = null): string {
  const zones = [
    ...spec.numbers.flatMap((column) => column.cells),
    ...spec.lines,
    ...spec.center,
    ...spec.hardways,
    ...spec.props,
    ...spec.sideBets,
  ]
  const zone = zones.find((candidate) => candidate.typeId === typeId && candidate.number === number)
  if (zone === undefined) throw new Error(`no zone for ${typeId} ${String(number)}`)
  return zone.key
}

/** Rolls scripted dice and returns the session after it and the roll's history entry. */
function rolled(
  session: WindowedSession,
  dice: readonly [number, number],
): { session: WindowedSession; entry: RollEntry } {
  const result = roll(session, dice)
  return {
    session: result.session,
    entry: rollEntryOf(session.state, result.events, result.session.state, CRAPLESS),
  }
}

function betOf(state: TableState, typeId: string): BetId {
  const found = state.bets.find((candidate) => candidate.typeId === typeId)
  if (found === undefined) throw new Error(`no ${typeId} bet on the table`)
  return found.id
}

function traceOf(entry: RollEntry, typeId: string): SettlementTrace {
  for (const item of entry.items) {
    if (item.type === 'betResolved' && item.trace.typeId === typeId) return item.trace
  }
  throw new Error(`no ${typeId} settlement on roll ${entry.rollIndex}`)
}

describe('zoneOutcomes: the engine’s settlements on the felt', () => {
  it('marks a come-out 7: the pass line wins its stake, the field loses its own', () => {
    let session = placePass(testSession())
    session = bet(session, { type: 'place', typeId: 'field', amount: cents(500) })
    const { entry } = rolled(session, [4, 3])
    const marks = zoneOutcomes(entry, spec)
    expect(marks.get(keyOf('pass'))).toEqual({
      rollIndex: entry.rollIndex,
      kind: 'win',
      net: 500,
      stake: 500,
    })
    expect(marks.get(keyOf('field'))).toEqual({
      rollIndex: entry.rollIndex,
      kind: 'lose',
      net: -500,
      stake: 500,
    })
    expect(marks.size).toBe(2)
  })

  it('marks a line bet decided on its point on the line bar, and its odds on the odds bar', () => {
    let session = placePass(testSession())
    session = rolled(session, [3, 3]).session // the point is 6
    session = bet(session, {
      type: 'place',
      typeId: 'passOdds',
      parentId: betOf(session.state, 'pass'),
      amount: cents(1_000),
    })
    session = bet(session, { type: 'place', typeId: 'place', number: 8, amount: cents(600) })
    const { entry } = rolled(session, [4, 2]) // 6: the point is made
    const marks = zoneOutcomes(entry, spec)
    expect(marks.get(keyOf('pass'))).toMatchObject({ kind: 'win', net: 500 })
    // $10 odds on the 6 pay 6 to 5: $12.00, the engine's own figure.
    expect(marks.get(keyOf('passOdds'))).toMatchObject({ kind: 'win', net: 1_200, stake: 1_000 })
    expect(marks.has(keyOf('place', 8))).toBe(false) // no action on the 6
  })

  it('adds a come bet and its odds together on the come spot that holds them', () => {
    let session = placePass(testSession())
    session = rolled(session, [4, 4]).session // the point is 8
    session = bet(session, { type: 'place', typeId: 'come', amount: cents(500) })
    session = rolled(session, [3, 3]).session // the come bet travels to the 6
    session = bet(session, {
      type: 'place',
      typeId: 'comeOdds',
      parentId: betOf(session.state, 'come'),
      amount: cents(1_000),
    })
    const { entry } = rolled(session, [5, 1])
    const marks = zoneOutcomes(entry, spec)
    expect(marks.get(keyOf('come', 6))).toEqual({
      rollIndex: entry.rollIndex,
      kind: 'win',
      net: 500 + 1_200,
      stake: 1_500,
    })
    expect(marks.has(keyOf('pass'))).toBe(false)
  })

  it('marks every bet a seven-out takes', () => {
    let session = placePass(testSession())
    session = rolled(session, [4, 4]).session
    session = placeSix(session)
    const { entry } = rolled(session, [3, 4])
    const marks = zoneOutcomes(entry, spec)
    expect(marks.get(keyOf('pass'))).toMatchObject({ kind: 'lose', net: -500 })
    expect(marks.get(keyOf('place', 6))).toMatchObject({ kind: 'lose', net: -600 })
  })

  it('marks nothing on a roll that decides nothing', () => {
    let session = placePass(testSession())
    session = rolled(session, [4, 4]).session // point 8
    const { entry } = rolled(session, [5, 6]) // 11: no action for the pass line
    expect(zoneOutcomes(entry, spec).size).toBe(0)
  })

  it('shows a win after the commission the machine takes from it', () => {
    let session = placePass(testSession())
    session = rolled(session, [4, 4]).session
    session = bet(session, { type: 'place', typeId: 'buy', number: 4, amount: cents(2_500) })
    const { entry } = rolled(session, [2, 2])
    const trace = traceOf(entry, 'buy')
    const mark = zoneOutcomes(entry, spec).get(keyOf('buy', 4))
    // The buy stays up, so everything credited is the gain: the engine's `credited`, to the cent.
    expect(trace.stakeDisposition).not.toBe('returned')
    expect(mark).toMatchObject({ kind: 'win', net: trace.credited })
    expect(mark?.net).toBe(trace.winPaid - trace.vigOnWin - trace.vigRearm)
  })
})

describe('outcomeText', () => {
  it('writes a win with a plus, a loss with a minus sign, and a push as a word', () => {
    const base = { rollIndex: 3, stake: cents(500) }
    expect(outcomeText({ ...base, kind: 'win', net: cents(700) })).toBe('+$7.00')
    expect(outcomeText({ ...base, kind: 'lose', net: cents(-500) })).toBe('−$5.00')
    expect(outcomeText({ ...base, kind: 'push', net: cents(0) })).toBe('Push')
  })
})
