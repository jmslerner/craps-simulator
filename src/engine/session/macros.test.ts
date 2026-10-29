import { describe, expect, it } from 'vitest'
import { compileConfig } from '../config/compile.ts'
import { PRESETS } from '../config/presets/index.ts'
import type { PointNumber } from '../config/rulesets.ts'
import type { DieFace } from '../core/dice.ts'
import { cents } from '../core/money.ts'
import { legalBets } from '../bets/legal.ts'
import { betId } from '../bets/types.ts'
import type { Action } from '../table/actions.ts'
import type { GameEvent } from '../table/events.ts'
import { validateAction } from '../table/reducer.ts'
import { doubleBets, maxOutOdds, pressBet, repeatBets, takeDownAll, winsOf } from './macros.ts'
import { dispatchBetting, newSession, rollWindow, type WindowedSession } from './window.ts'

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
const setAmount = (bet: number, amount: number): Action => ({
  type: 'setAmount',
  betId: betId(bet),
  amount: cents(amount),
})
const batch = (...actions: Action[]): Action[] => [{ type: 'batch', actions }]

/** A crapless session played through the window: bets, then rolls of scripted dice. */
class Table {
  session: WindowedSession = newSession(crapless, 'macros')
  lastRoll: readonly GameEvent[] = []

  bet(...actions: Action[]): this {
    for (const action of actions) {
      const result = dispatchBetting(this.session, action, crapless)
      if (!result.ok) throw new Error(`refused ${JSON.stringify(result.rejection)}`)
      this.session = result.session
    }
    return this
  }

  roll(d1: DieFace, d2: DieFace): this {
    const result = rollWindow(this.session, crapless, { d1, d2 })
    if (!result.ok) throw new Error(`roll refused ${JSON.stringify(result.rejection)}`)
    this.session = result.session
    this.lastRoll = result.events
    return this
  }

  get state() {
    return this.session.state
  }

  /** Dispatches a macro's output, which must be one batch the table accepts. */
  run(actions: readonly Action[]): this {
    expect(actions).toHaveLength(1)
    for (const action of actions) {
      expect(validateAction(this.state, action, crapless)).toBeNull()
      this.bet(action)
    }
    return this
  }

  amounts(): Record<string, number> {
    return Object.fromEntries(
      this.state.bets.map((b) => [`${b.typeId}@${b.number ?? '-'}`, b.amount]),
    )
  }
}

describe('repeatBets (Repeat Last Bet)', () => {
  it('places the last window’s bets again after a seven-out, as one batch', () => {
    const table = new Table()
      .bet(place('pass', 1_000), placeOn('place', 6, 600))
      .roll(2, 2)
      .roll(3, 4)
    expect(table.state.bets).toEqual([])
    const repeat = repeatBets(table.state, table.session.lastWindow, crapless)
    expect(repeat).toStrictEqual(batch(place('pass', 1_000), placeOn('place', 6, 600)))
    table.run(repeat)
    expect(table.amounts()).toEqual({ 'pass@-': 1_000, 'place@6': 600 })
  })

  it('is unavailable when the table would refuse any of it, or there is nothing to repeat', () => {
    const table = new Table().bet(place('pass', 1_000)).roll(5, 5)
    // A pass bet cannot be made with the point on (no put bets on Interblock).
    expect(table.session.lastWindow).toStrictEqual([place('pass', 1_000)])
    expect(repeatBets(table.state, table.session.lastWindow, crapless)).toEqual([])
    expect(repeatBets(table.state, [], crapless)).toEqual([])
    // A press of a bet that has since come down names a bet that is not there.
    expect(repeatBets(table.state, [setAmount(9, 2_000)], crapless)).toEqual([])
  })
})

describe('doubleBets (Double Bet)', () => {
  it('doubles every bet that may grow, and leaves the contract pass line alone', () => {
    const table = new Table()
      .bet(place('pass', 1_000))
      .roll(3, 3)
      .bet(odds('passOdds', 1, 1_000), placeOn('place', 8, 600), place('field', 500))
    const double = doubleBets(table.state, crapless)
    expect(double).toStrictEqual(
      batch(setAmount(2, 2_000), setAmount(3, 1_200), setAmount(4, 1_000)),
    )
    table.run(double)
    expect(table.amounts()).toEqual({
      'pass@6': 1_000,
      'passOdds@6': 2_000,
      'place@8': 1_200,
      'field@-': 1_000,
    })
  })

  it('doubles the pass line before its first roll', () => {
    const table = new Table().bet(place('pass', 500), placeOn('hard', 6, 100))
    expect(doubleBets(table.state, crapless)).toStrictEqual(
      batch(setAmount(1, 1_000), setAmount(2, 200)),
    )
  })

  it('leaves a bet whose double is over its cap, and doubles the rest', () => {
    const table = new Table()
      .bet(place('pass', 1_000))
      .roll(3, 3)
      .bet(odds('passOdds', 1, 1_500), placeOn('place', 8, 600))
    // $15 of odds would double to $30, over the 2x cap of $20.
    expect(doubleBets(table.state, crapless)).toStrictEqual(batch(setAmount(3, 1_200)))
  })

  it('does nothing when credit cannot cover every double together', () => {
    const table = new Table()
      .bet(place('pass', 1_000))
      .roll(3, 3)
      .bet(placeOn('place', 5, 39_000), placeOn('place', 6, 3_000), placeOn('place', 8, 3_000))
    expect(table.state.ledger.bankroll).toBe(4_000)
    // Each $30 double fits the $40 of credit alone, but not both; place 5 cannot double at all.
    expect(validateAction(table.state, setAmount(3, 6_000), crapless)).toBeNull()
    expect(doubleBets(table.state, crapless)).toEqual([])
  })
})

describe('pressBet and winsOf (Press)', () => {
  it('presses a winning place bet by its win, which stays up', () => {
    const table = new Table()
      .bet(place('pass', 1_000))
      .roll(4, 4)
      .bet(placeOn('place', 6, 600))
      .roll(2, 4)
    const won = winsOf(table.lastRoll)
    expect([...won]).toEqual([[betId(2), 700]])
    table.run(pressBet(table.state, betId(2), cents(700), crapless))
    expect(table.amounts()['place@6']).toBe(1_300)
  })

  it('presses in whole units of the bet’s increment, and as far as credit allows', () => {
    const table = new Table()
      .bet(place('pass', 1_000))
      .roll(4, 4)
      .bet(placeOn('place', 6, 600))
    expect(pressBet(table.state, betId(2), cents(750), crapless)).toStrictEqual(
      batch(setAmount(2, 1_300)),
    )
    expect(pressBet(table.state, betId(2), cents(99), crapless)).toEqual([])
    expect(pressBet(table.state, betId(2), cents(0), crapless)).toEqual([])
    const credit = table.state.ledger.bankroll
    expect(pressBet(table.state, betId(2), cents(credit + 10_000), crapless)).toStrictEqual(
      batch(setAmount(2, 600 + credit)),
    )
  })

  it('does nothing for a bet that cannot grow, or is not there', () => {
    const table = new Table().bet(place('pass', 1_000)).roll(4, 4)
    expect(pressBet(table.state, betId(1), cents(1_000), crapless)).toEqual([])
    expect(pressBet(table.state, betId(7), cents(1_000), crapless)).toEqual([])
  })

  it('counts a win net of commission, and not a returned stake', () => {
    const table = new Table()
      .bet(place('pass', 1_000))
      .roll(3, 3)
      .bet(placeOn('buy', 4, 2_500), place('come', 500))
      .roll(1, 3)
    // Buy 4 $25 wins $50 and stays up, its $1.25 commission re-collected from the win (upfront,
    // recollectFromWin); the come bet travels to 4.
    expect([...winsOf(table.lastRoll)]).toEqual([[betId(2), 4_875]])
    const comeWin = table.bet(odds('comeOdds', 3, 1_000)).roll(2, 2)
    // The come bet on 4 wins even money and comes back with its stake (afterWin: return), and its
    // odds pay 2:1; the buy pays $50 again, less $1.25.
    expect(Object.fromEntries(winsOf(comeWin.lastRoll))).toEqual({
      [betId(2)]: 4_875,
      [betId(3)]: 500,
      [betId(4)]: 2_000,
    })
  })
})

describe('maxOutOdds (maximum odds)', () => {
  it('takes the most odds every bet on a number can hold, or one bet’s', () => {
    const table = new Table()
      .bet(place('pass', 1_000))
      .roll(3, 3)
      .bet(place('come', 500))
      .roll(4, 4)
    expect(maxOutOdds(table.state, betId(2), crapless)).toStrictEqual(
      batch(odds('comeOdds', 2, 1_000)),
    )
    const all = maxOutOdds(table.state, null, crapless)
    expect(all).toStrictEqual(batch(odds('passOdds', 1, 2_000), odds('comeOdds', 2, 1_000)))
    table.run(all)
    expect(maxOutOdds(table.state, null, crapless)).toEqual([])
    // Partial odds are topped up to the cap.
    table.bet(setAmount(3, 1_000))
    expect(maxOutOdds(table.state, null, crapless)).toStrictEqual(batch(setAmount(3, 2_000)))
  })

  it('fills spots in layout order with the credit there is', () => {
    const table = new Table()
      .bet(place('pass', 10_000))
      .roll(3, 3)
      .bet(place('come', 10_000))
      .roll(4, 4)
      .bet(placeOn('place', 5, 26_000))
    expect(table.state.ledger.bankroll).toBe(4_000)
    table.run(maxOutOdds(table.state, null, crapless))
    expect(table.amounts()).toMatchObject({ 'passOdds@6': 4_000 })
    expect(table.amounts()).not.toHaveProperty('comeOdds@8')
    for (const spot of legalBets(table.state, crapless).filter((s) => s.parentId !== null)) {
      expect(spot.canAdd).not.toBeNull()
    }
  })

  it('does nothing with no bet on a number', () => {
    const table = new Table().bet(place('pass', 1_000))
    expect(maxOutOdds(table.state, null, crapless)).toEqual([])
    expect(maxOutOdds(table.state, betId(1), crapless)).toEqual([])
  })
})

describe('takeDownAll', () => {
  it('takes down every bet that can come down, odds with their parent, and keeps contracts', () => {
    const table = new Table()
      .bet(place('pass', 1_000))
      .roll(3, 3)
      .bet(odds('passOdds', 1, 2_000), place('come', 500))
      .roll(4, 4)
      .bet(odds('comeOdds', 3, 1_000), placeOn('place', 5, 500), place('field', 200))
      .bet(placeOn('hard', 10, 100), place('come', 500))
    const down = takeDownAll(table.state, crapless)
    expect(down).toStrictEqual(
      batch(
        setAmount(2, 0),
        setAmount(4, 0),
        setAmount(5, 0),
        setAmount(6, 0),
        setAmount(7, 0),
        setAmount(8, 0),
      ),
    )
    table.run(down)
    // The pass line and the come bet on 8 are contracts.
    expect(table.amounts()).toEqual({ 'pass@6': 1_000, 'come@8': 500 })
    expect(takeDownAll(table.state, crapless)).toEqual([])
  })

  it('takes a line bet down before its first roll, when it is no contract yet', () => {
    const table = new Table().bet(place('pass', 1_000), placeOn('place', 6, 600))
    expect(takeDownAll(table.state, crapless)).toStrictEqual(
      batch(setAmount(1, 0), setAmount(2, 0)),
    )
  })
})
