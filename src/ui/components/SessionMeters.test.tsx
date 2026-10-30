import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { betId, cents, makeRoll } from '../../engine/index.ts'
import { renderApp } from '../test/renderApp.tsx'
import { METER_DEFINITIONS } from './SessionMeters.tsx'

/**
 * The session meters on screen (rules spec §4.6): the compact row under the top bar and the
 * detailed list in the session section, both reading the store's figures, each definition in one
 * plain line, the figures trailing the dice during a roll, and "not available" for a session whose
 * log no longer replays.
 */

describe('the session meters on screen', () => {
  it('shows credit added, total wagered and the result, always', () => {
    const app = renderApp()
    const meters = screen.getByRole('region', { name: 'Session totals' })
    expect(within(meters).getByTestId('meters-credit-added')).toHaveTextContent('$500.00')
    expect(within(meters).getByTestId('meters-wagered')).toHaveTextContent('$0.00')
    expect(within(meters).getByTestId('meters-result')).toHaveTextContent('$0.00')

    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(1000) })
      state.dispatch({ type: 'place', typeId: 'buy', number: 4, amount: cents(2000) })
      state.deposit(cents(10_000))
    })
    app.roll(makeRoll(2, 2)) // point 4, and the buy 4 wins $40 with $1 re-collected
    expect(screen.getByTestId('meters-credit-added')).toHaveTextContent('$600.00')
    expect(screen.getByTestId('meters-wagered')).toHaveTextContent('$20.00')

    const list = screen.getByTestId('money-list')
    expect(within(list).getByTestId('money-deposit-count')).toHaveTextContent('2 deposits')
    expect(within(list).getByTestId('money-deposit-list')).toHaveTextContent(
      'Buy-in $500.00$100.00 before roll 1',
    )
    expect(within(list).getByTestId('money-decisions')).toHaveTextContent('1 decision')
    expect(within(list).getByTestId('money-commission')).toHaveTextContent('$2.00')
    expect(within(list).getByTestId('money-commission-parts')).toHaveTextContent(
      'up front $1.00 · re-collected $1.00',
    )
    for (const line of Object.values(METER_DEFINITIONS)) {
      expect(within(list).getByText(line)).toBeInTheDocument()
    }
  })

  it('reads as before the roll until the dice show it', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(1000) })
      state.beginRoll(makeRoll(3, 4)) // the pass wins: $10 decided
    })
    expect(screen.getByTestId('meters-wagered')).toHaveTextContent('$0.00')
    expect(screen.getByTestId('meters-result')).toHaveTextContent('$0.00')
    app.run((state) => {
      state.reveal()
    })
    expect(screen.getByTestId('meters-wagered')).toHaveTextContent('$10.00')
    expect(screen.getByTestId('meters-result')).toHaveTextContent('+$10.00')
  })

  it('says the total wagered is not available when the log no longer replays', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(1000) })
    })
    app.roll(makeRoll(2, 2))
    app.run((state) => {
      const { cfg, session } = state
      if (cfg === null || session === null) throw new Error('no session')
      const [first] = session.committed
      if (first === undefined) throw new Error('no roll')
      const committed = [{ ...first, hashAfter: '0000000000000000' }]
      state.restoreGame({ cfg, session: { ...session, committed }, meta: null })
    })
    expect(screen.getByTestId('meters-wagered')).toHaveTextContent('—')
    expect(screen.getByTestId('meters-credit-added')).toHaveTextContent('$500.00')
    expect(screen.getByTestId('money-decisions')).toHaveTextContent('Not available')
    // The engine's own commission total stays: the stored ledger holds it.
    expect(screen.getByTestId('money-commission')).toHaveTextContent('$0.00')
  })

  it('lists a take-down as no decision', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(1000) })
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    app.roll(makeRoll(2, 2))
    app.run((state) => {
      state.dispatch({ type: 'setAmount', betId: betId(2), amount: cents(0) })
    })
    app.roll(makeRoll(3, 3)) // a 6 with Place 6 down: nothing decided
    expect(screen.getByTestId('meters-wagered')).toHaveTextContent('$0.00')
    expect(screen.getByTestId('money-decisions')).toHaveTextContent('0 decisions')
  })
})
