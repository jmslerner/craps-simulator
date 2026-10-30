import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cents } from '../engine/index.ts'
import { App } from './App.tsx'
import { COMPILED_PRESETS } from './state/machineStore.ts'
import { dice } from './test/game.ts'
import { renderApp, testStores } from './test/renderApp.tsx'

describe('the shell', () => {
  it('renders the title, the meters and the dome slot', () => {
    renderApp()
    expect(screen.getByRole('heading', { name: 'Bubble Craps Trainer' })).toBeInTheDocument()
    expect(screen.getByTestId('meter-credit')).toHaveTextContent('$500.00')
    expect(screen.getByTestId('meter-bet')).toHaveTextContent('$0.00')
    expect(screen.getByTestId('meter-win')).toHaveTextContent('$0.00')
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-state', 'idle')
  })

  it('boots a fresh crapless session when nothing is stored', async () => {
    const stores = testStores()
    render(<App stores={stores} />)
    await waitFor(() => {
      expect(stores.game.getState().session).not.toBeNull()
    })
    expect(stores.game.getState().cfg?.id).toBe('craplessBubble')
    expect(screen.getByTestId('meter-credit')).toHaveTextContent('$500.00')
  })

  it('keeps the meters on the engine: credit, bet on table, win on the last roll', () => {
    const { run, roll } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    expect(screen.getByTestId('meter-credit')).toHaveTextContent('$489.00')
    expect(screen.getByTestId('meter-bet')).toHaveTextContent('$11.00')
    roll(dice(3, 3)) // point 6 set; place 6 wins $7.00 at 7:6
    expect(screen.getByTestId('meter-win')).toHaveTextContent('$7.00')
    expect(screen.getByTestId('meter-credit')).toHaveTextContent('$496.00')
  })

  it('shows the session strip against deposits, so a top-up is never a win', () => {
    const { run } = renderApp()
    run((state) => {
      state.deposit(cents(10_000))
    })
    const strip = screen.getByTestId('session-strip')
    expect(strip).toHaveTextContent('In $600.00')
    expect(strip).toHaveTextContent('Result $0.00')
  })

  it('shows the approximation note once on a machine with values the engine plays otherwise', () => {
    renderApp({ cfg: COMPILED_PRESETS.traditionalBubble })
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('/offBets/consumeCredit')
    fireEvent.click(within(note).getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('has no approximation note on the default crapless machine', () => {
    renderApp()
    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('the announcer', () => {
  it('announces the roll total, the round event and the player’s net in words', () => {
    const { run, roll } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    roll(dice(3, 4))
    expect(screen.getByTestId('announcer')).toHaveTextContent(
      'Rolled 7: 3 and 4, 7 wins the come-out, you won $5.00.',
    )
  })
})

describe('the roll history (plan §0 #20)', () => {
  it('lists the newest roll with its payout arithmetic from the trace', () => {
    const { run, roll } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    roll(dice(3, 3))
    const history = screen.getByTestId('roll-history')
    expect(history).toHaveTextContent('Place 6 won $7.00')
    expect(history).toHaveTextContent('the point is 6')
    const math = screen.getByTestId('roll-math')
    expect(math).toHaveTextContent('$6.00 × 7:6 = $7.00')
    expect(history).toHaveTextContent('Pass Line moved to 6')
  })

  it('groups by hand with totals and a seven-out marker', () => {
    const { run, roll } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    roll(dice(1, 1)) // point 2
    roll(dice(3, 4)) // seven-out ends hand 1
    const history = screen.getByTestId('roll-history')
    expect(within(history).getByText('seven-out', { selector: '.hand-marker' })).toBeInTheDocument()
    expect(within(history).getByText('Hand 1')).toBeInTheDocument()
    expect(history).toHaveTextContent('Pass Line 2 lost $5.00') // the travelled bet, on its point
    // The newest hand sits first; its net is the pass line's loss.
    expect(within(history).getAllByText('-$5.00').length).toBeGreaterThan(0)
  })

  it('shows only the newest roll’s arithmetic', () => {
    const { run, roll } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    roll(dice(3, 3)) // place 6 wins
    roll(dice(2, 3)) // 5: nothing resolves for place 6
    const maths = screen.queryAllByTestId('roll-math')
    // The 3-3 roll's math is no longer shown; the newest roll resolved nothing.
    expect(maths).toHaveLength(0)
  })
})

describe('Set bets On (plan §0 #21, M5/M6 → M8 hand-off)', () => {
  it('shows Set bets On while the machine holds a new place bet OFF, and clears the hold', () => {
    const { game, run, roll } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    roll(dice(1, 1)) // point 2
    roll(dice(3, 4)) // seven-out
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    // Interblock holds the new place bet OFF after the seven-out; the zone says so.
    expect(
      screen.getByRole('button', { name: /^Place 6, \$6\.00, .*off for this roll$/ }),
    ).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Set bets On' })
    fireEvent.click(toggle) // setGlobalWorking(null) [A]: back to the machine defaults
    const bets = game.getState().view?.shown.bets ?? []
    const placeSix = bets.find((bet) => bet.typeId === 'place')
    expect(placeSix).toBeDefined()
    expect(game.getState().view?.shown.heldOff ?? []).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Set bets Off' })).toBeInTheDocument()
  })
})

describe('keyboard play (plan §6)', () => {
  it('selects chips with 1–6, toggles remove with X and undoes with U', () => {
    const { game, settings } = renderApp()
    fireEvent.keyDown(document.body, { key: '2' })
    expect(settings.getState().selectedChip).toBe(500)
    fireEvent.click(screen.getByRole('button', { name: /^Pass Line/ }))
    expect(game.getState().view?.shown.bets[0]?.amount).toBe(500)
    fireEvent.keyDown(document.body, { key: 'u' })
    expect(game.getState().view?.shown.bets).toHaveLength(0)
    fireEvent.keyDown(document.body, { key: 'x' })
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(document.body, { key: 'x' })
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('ignores the keys while a dialog is open', () => {
    const { game } = renderApp()
    fireEvent.click(screen.getByRole('button', { name: '+ Add credit' }))
    fireEvent.keyDown(document.body, { key: 'r' })
    expect(game.getState().view?.phase).toBe('betting') // no roll started
    expect(game.getState().rejection).toBeNull()
  })
})

describe('the ROLL → SKIP path', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rolls from the button, skips the animation cleanly and reveals the engine’s dice', async () => {
    const { game, run } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.enqueueDice([dice(3, 3)])
    })
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }))
    expect(game.getState().view?.phase).toBe('rolling')
    const skip = screen.getByRole('button', { name: 'SKIP' })
    fireEvent.click(skip) // aborts the tumble; the reveal follows at once
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700) // the reveal hold
    })
    expect(game.getState().view?.phase).toBe('betting')
    const view = screen.getByTestId('dice-view')
    expect(view).toHaveAttribute('data-state', 'settled')
    expect(view).toHaveAttribute('data-dice', '3-3')
    expect(screen.getByTestId('round-chip')).toHaveTextContent('Point is 6')
  })

  it('reduced motion reveals without an animation', async () => {
    const { game, settings, run } = renderApp()
    act(() => {
      settings.getState().update({ reducedMotion: true })
    })
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.enqueueDice([dice(1, 1)])
    })
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(game.getState().view?.phase).toBe('betting')
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-dice', '1-1')
  })
})
