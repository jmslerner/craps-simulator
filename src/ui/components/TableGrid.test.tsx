import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cents } from '../../engine/index.ts'
import { dice } from '../test/game.ts'
import { renderApp } from '../test/renderApp.tsx'
import { LONG_PRESS_MS } from './useLongPress.ts'

/** The pass line zone button, by its accessible name. */
function passZone(): HTMLElement {
  return screen.getByRole('button', { name: /^Pass Line/ })
}

describe('tapping the layout (plan §10 M8)', () => {
  it('a tap places the selected chip', () => {
    const { game } = renderApp()
    fireEvent.click(passZone())
    const bets = game.getState().view?.shown.bets ?? []
    expect(bets).toHaveLength(1)
    expect(bets[0]?.typeId).toBe('pass')
    expect(bets[0]?.amount).toBe(100) // the $1 chip is in hand by default
    expect(screen.getByRole('button', { name: /^Pass Line, \$1\.00/ })).toBeInTheDocument()
  })

  it('places the chip in hand after picking another chip', () => {
    const { game } = renderApp()
    fireEvent.click(screen.getByRole('button', { name: '$5.00 chip (2)' }))
    fireEvent.click(passZone())
    expect(game.getState().view?.shown.bets[0]?.amount).toBe(500)
  })

  it('reads a bet zone to screen readers with amount and the machine pays', () => {
    const { run } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(1_200) })
    })
    expect(screen.getByRole('button', { name: 'Place 6, $12.00, pays 7 to 6' })).toBeInTheDocument()
  })

  it('a disabled zone still answers: the odds bar without a line bet shows the rejection', () => {
    renderApp()
    const odds = screen.getByRole('button', { name: /^Pass Odds/ })
    expect(odds).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(odds)
    expect(screen.getByTestId('reason-strip')).toHaveTextContent(
      'Odds need a Pass Line bet to back.',
    )
  })

  it('REMOVE mode takes a bet down', () => {
    const { game, run } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: /^Place 6, \$6\.00/ }))
    expect(game.getState().view?.shown.bets).toHaveLength(0)
  })

  it('a contract bet shows the lock message when taken down', () => {
    const { run, roll } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    roll(dice(1, 1)) // crapless: 2 becomes the point; the pass line is now a contract
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(passZone())
    expect(screen.getByTestId('reason-strip')).toHaveTextContent(
      'Pass Line is a contract bet: it stays up until it wins or loses.',
    )
  })

  it('the reason strip shows BELOW_MIN_TOTAL’s short amount when the roll is refused', () => {
    const { game, run } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(100) })
    })
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }))
    expect(game.getState().rejection?.code).toBe('BELOW_MIN_TOTAL')
    const strip = screen.getByTestId('reason-strip')
    expect(strip).toHaveTextContent('BETS ARE NOT VALID YET!')
    expect(strip).toHaveTextContent('$4.00') // details.short, formatted
    expect(strip).toHaveTextContent('(4 credits)')
  })

  it('shows the point puck on the number and marks an OFF bet', () => {
    const { run, roll } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    roll(dice(3, 3)) // point 6
    expect(screen.getByTestId('round-chip')).toHaveTextContent('Point is 6')
    const column = document.querySelector('[data-number="6"]')
    expect(column?.querySelector('.puck-on')).not.toBeNull()
  })
})

describe('the inspector openings', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a long-press opens the inspector', () => {
    const { run } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const zone = screen.getByRole('button', { name: /^Place 6/ })
    fireEvent.pointerDown(zone, { clientX: 10, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS)
    })
    fireEvent.pointerUp(zone)
    const dialog = screen.getByRole('dialog', { name: 'Place 6' })
    expect(dialog).toBeInTheDocument()
    // The long press did not also place a chip.
  })

  it('a press that moves 10 px is a scroll, not a bet and not an inspection', () => {
    const { game } = renderApp()
    const zone = passZone()
    fireEvent.pointerDown(zone, { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(zone, { clientX: 10, clientY: 40 })
    vi.advanceTimersByTime(LONG_PRESS_MS)
    fireEvent.pointerUp(zone)
    expect(game.getState().view?.shown.bets).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a short press is the tap', () => {
    const { game } = renderApp()
    const zone = passZone()
    fireEvent.pointerDown(zone, { clientX: 10, clientY: 10 })
    vi.advanceTimersByTime(100)
    fireEvent.pointerUp(zone)
    expect(game.getState().view?.shown.bets).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('right-click inspects instead of betting', () => {
    const { game } = renderApp()
    fireEvent.contextMenu(passZone())
    expect(screen.getByRole('dialog', { name: 'Pass Line' })).toBeInTheDocument()
    expect(game.getState().view?.shown.bets).toHaveLength(0)
  })

  it('INFO mode turns a tap into an inspection', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Info' }))
    fireEvent.click(passZone())
    expect(screen.getByRole('dialog', { name: 'Pass Line' })).toBeInTheDocument()
  })
})

describe('the come strip and the phone sheet', () => {
  it('shows the travelled come bet on its number and a tap adds its odds', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    app.roll(dice(1, 1)) // point 2
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'come', amount: cents(500) })
    })
    app.roll(dice(2, 3)) // the come bet travels to 5
    const spot = screen.getByRole('button', { name: /^Come on 5, \$5\.00/ })
    fireEvent.click(spot)
    const bets = app.game.getState().view?.shown.bets ?? []
    const come = bets.find((bet) => bet.typeId === 'come')
    const odds = bets.find((bet) => bet.typeId === 'comeOdds')
    expect(odds?.parentId).toBe(come?.id)
    expect(odds?.amount).toBe(100) // the $1 chip in hand
  })

  it('names hardways without doubling the number', () => {
    renderApp()
    expect(
      screen.getAllByRole('button', { name: /^Hard 8, no bet, pays 9 to 1$/ }),
    ).not.toHaveLength(0)
  })

  it('the tabs open a bottom sheet with the chosen panel', () => {
    renderApp()
    fireEvent.click(screen.getByRole('tab', { name: 'Hardways' }))
    const sheet = document.querySelector('.bottom-sheet')
    expect(sheet).not.toBeNull()
    expect(
      within(sheet as HTMLElement).getByRole('button', { name: /^Hard 8/ }),
    ).toBeInTheDocument()
    fireEvent.click(within(sheet as HTMLElement).getByRole('button', { name: 'Close' }))
    expect(document.querySelector('.bottom-sheet')).toBeNull()
  })
})
