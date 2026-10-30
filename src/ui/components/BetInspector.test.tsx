import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { cents } from '../../engine/index.ts'
import { dice } from '../test/game.ts'
import { renderApp } from '../test/renderApp.tsx'

/** Opens the inspector on a zone through INFO mode (the tap paths have their own tests). */
function openOn(zoneName: RegExp): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Info' }))
  fireEvent.click(screen.getByRole('button', { name: zoneName }))
  fireEvent.click(screen.getByRole('button', { name: 'Info' })) // back to bet mode
  return screen.getByRole('dialog')
}

describe('the bet inspector', () => {
  it('steps the amount by the spot’s own increment, from legalBets', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const dialog = openOn(/^Place 6/)
    expect(within(dialog).getByText('On the table: $6.00')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add \$1\.00 to Place 6/ }))
    expect(app.game.getState().view?.shown.bets[0]?.amount).toBe(700)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reduce Place 6' }))
    expect(app.game.getState().view?.shown.bets[0]?.amount).toBe(600)
  })

  it('Press adds the last win, in whole units, through the macro', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    app.roll(dice(3, 3)) // place 6 wins $7.00 (7:6) on the come-out point roll
    const dialog = openOn(/^Place 6/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Press' }))
    expect(app.game.getState().view?.shown.bets[0]?.amount).toBe(1_300) // $6 + $7 pressed
  })

  it('Take down returns the stake; a contract bet is refused with its lock message inline', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    app.roll(dice(1, 1)) // point 2: the pass line is now a contract
    const dialog = openOn(/^Pass Line/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take down' }))
    expect(app.game.getState().view?.shown.bets).toHaveLength(1) // refused, still up
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Pass Line is a contract bet: it stays up until it wins or loses.',
    )
  })

  it('the odds stepper and Max come from legalBets and the maxOutOdds macro', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    app.roll(dice(1, 1)) // point 2; crapless odds pay 6:1, capped at 2x the flat
    const dialog = openOn(/^Pass Line/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add odds behind Pass Line' }))
    const oddsBet = () =>
      app.game.getState().view?.shown.bets.find((bet) => bet.typeId === 'passOdds')
    expect(oddsBet()?.amount).toBe(100) // the smallest odds addition
    fireEvent.click(within(dialog).getByRole('button', { name: 'Max' }))
    expect(oddsBet()?.amount).toBe(1_000) // 2x the $5 flat
  })

  it('keeps the working toggle visible but disabled where the machine has no per-bet switch', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const dialog = openOn(/^Place 6/)
    const toggle = within(dialog).getByRole('button', { name: 'Set OFF' })
    expect(toggle).toBeDisabled() // crapless Interblock: global button only
    expect(toggle).toHaveAttribute('title', expect.stringContaining('Set bets On/Off'))
  })

  it('offers to place the smallest bet on an empty spot', () => {
    const app = renderApp()
    const dialog = openOn(/^Field/)
    expect(within(dialog).getByText('No bet here yet.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add \$1\.00 to Field/ }))
    const bet = app.game.getState().view?.shown.bets[0]
    expect(bet?.typeId).toBe('field')
    expect(bet?.amount).toBe(100)
  })

  it('closes on Escape and returns focus to the opener', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const zone = screen.getByRole('button', { name: /^Place 6/ })
    zone.focus()
    fireEvent.contextMenu(zone)
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(zone)
  })
})
