import { describe, expect, it } from 'vitest'
import { cents } from '../../engine/index.ts'
import { CRAPLESS, bet, placePass, roll, testSession } from '../test/game.ts'
import { createGameStore } from './gameStore.ts'
import { selectSideBetSpots, sideBetSpotsOf } from './sideBetSpots.ts'

/**
 * The side-bet spots (plan §10 M11): `legalBets` with `{ sideBets: true }`, filtered to the side
 * bets, memoized per table; every answer is the engine's own (`canAdd`, `canRemove`, the limits).
 */

describe('sideBetSpotsOf', () => {
  it('lists the machine’s side bets in config order with the engine’s limits', () => {
    const session = placePass(testSession('side-spots'))
    const spots = sideBetSpotsOf(session.state, CRAPLESS)
    expect(spots.map((spot) => spot.typeId)).toStrictEqual([
      'luckyRollerLow',
      'luckyRollerHigh',
      'luckyRollerAll',
    ])
    for (const spot of spots) {
      expect(spot.number).toBeNull()
      expect(spot.betId).toBeNull()
      expect(spot.canAdd).toBeNull()
      expect(spot.minAdd).toBe(100) // the crapless $1 minimum
      expect(spot.maxAdd).toBe(49_500) // the lesser of the $500 maximum and the credit left
      expect(spot.canRemove?.code).toBe('BET_NOT_FOUND')
    }
  })

  it('lists no main-game spot, and memoizes per table', () => {
    const session = testSession('side-spots-memo')
    const spots = sideBetSpotsOf(session.state, CRAPLESS)
    expect(spots.some((spot) => CRAPLESS.catalog.has(spot.typeId))).toBe(false)
    expect(sideBetSpotsOf(session.state, CRAPLESS)).toBe(spots)
  })

  it('carries the engine’s refusals once the dice have rolled', () => {
    let session = placePass(testSession('side-spots-locked'))
    session = bet(session, { type: 'place', typeId: 'luckyRollerLow', amount: cents(100) })
    const open = sideBetSpotsOf(session.state, CRAPLESS)
    expect(open[0]?.betId).toBe('b2')
    expect(open[0]?.canRemove).toBeNull() // free until the first roll
    session = roll(session, [1, 1]).session
    const locked = sideBetSpotsOf(session.state, CRAPLESS)
    expect(locked[0]?.canAdd?.code).toBe('CONTRACT_BET')
    expect(locked[0]?.canRemove?.code).toBe('CONTRACT_BET')
    expect(locked[1]?.canAdd?.code).toBe('WINDOW_CLOSED')
    expect(locked[1]?.canAdd?.details).toStrictEqual({
      typeId: 'luckyRollerHigh',
      reason: 'afterSevenOrStart',
      until: 'nextSeven',
    })
  })
})

describe('selectSideBetSpots', () => {
  it('is null before a game starts and the shown table’s spots after', () => {
    const store = createGameStore()
    expect(selectSideBetSpots(store.getState())).toBeNull()
    store.getState().startGame(CRAPLESS, 'side-spots-store')
    const spots = selectSideBetSpots(store.getState())
    expect(spots?.map((spot) => spot.typeId)).toStrictEqual([
      'luckyRollerLow',
      'luckyRollerHigh',
      'luckyRollerAll',
    ])
    expect(selectSideBetSpots(store.getState())).toBe(spots)
  })
})
