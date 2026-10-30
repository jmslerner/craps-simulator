import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cents } from '../../engine/index.ts'
import { dice } from '../test/game.ts'
import { renderApp } from '../test/renderApp.tsx'
import { DOCKED_DRAWER_QUERY } from './useMediaQuery.ts'

/**
 * The machine design's own pieces (plan §0 #28): the station's history strip, the status banner
 * that carries the trainer's one-liners, the Coach drawer that holds everything else, and the
 * station's chip rail. Each test drives the real stores; nothing here computes a number itself.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A viewport `wide` or not for the drawer's 1400 px query (jsdom has no media queries). */
function viewport(wide: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === DOCKED_DRAWER_QUERY ? wide : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

describe('the history strip', () => {
  it('lists rolls newest first, blue where the pass line won and red at the seven-out', () => {
    const { run, roll } = renderApp()
    const strip = screen.getByRole('region', { name: 'Recent rolls' })
    expect(strip).toHaveTextContent('No rolls yet')
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    roll(dice(3, 4)) // a come-out 7: the pass line wins (crapless)
    roll(dice(2, 4)) // the point is 6
    roll(dice(1, 2)) // a 3 decides nothing
    roll(dice(5, 2)) // seven-out
    const items = within(strip).getAllByRole('listitem')
    expect(items.map((item) => [item.dataset['total'], item.dataset['result']])).toStrictEqual([
      ['7', 'lost'],
      ['3', 'plain'],
      ['6', 'plain'],
      ['7', 'won'],
    ])
    // Two white die faces over the total, said in words for screen readers.
    expect(items[0]?.querySelectorAll('.die-white')).toHaveLength(2)
    expect(items[0]?.querySelector('.strip-total')).toHaveTextContent('7')
    expect(items[0]).toHaveTextContent('Roll 4: 7 (5 and 2), seven-out.')
    expect(items[3]).toHaveTextContent('Roll 1: 7 (3 and 4), 7 wins the come-out.')
  })
})

describe('the status banner', () => {
  it('carries the guide’s step with its Go, the round, and the machine’s refusals in red', () => {
    const { run } = renderApp()
    const banner = screen.getByRole('region', { name: 'Machine messages' })
    expect(banner).toHaveTextContent('Bet the Pass Line')
    expect(within(banner).getByTestId('guide-go')).toBeInTheDocument()
    expect(within(banner).getByTestId('round-chip')).toHaveTextContent('Come-out roll')
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(100) })
    })
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }))
    expect(within(banner).getByTestId('reason-strip')).toHaveTextContent('BETS ARE NOT VALID YET!')
  })

  it('keeps the round when the guide is hidden', () => {
    const { settings } = renderApp()
    act(() => settings.getState().update({ guideEnabled: false }))
    const banner = screen.getByRole('region', { name: 'Machine messages' })
    expect(within(banner).queryByTestId('guide-go')).toBeNull()
    expect(within(banner).getByTestId('round-chip')).toHaveTextContent('Come-out roll')
  })
})

describe('the Coach drawer', () => {
  it('docks open on a wide viewport and holds the trainer’s panels', () => {
    viewport(true)
    renderApp()
    const toggle = screen.getByRole('button', { name: 'Coach' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const drawer = screen.getByRole('complementary', { name: 'Coach' })
    expect(toggle).toHaveAttribute('aria-controls', drawer.id)
    for (const name of ['Next step guide', 'Roll history']) {
      expect(within(drawer).getByRole('region', { name })).toBeInTheDocument()
    }
    expect(within(drawer).getByRole('button', { name: 'Guide' })).toBeInTheDocument()
    expect(within(drawer).getByTestId('coach-mode')).toBeInTheDocument()
  })

  it('stays collapsed below 1400 px until opened, and remembers the player’s choice', () => {
    viewport(false)
    const { settings } = renderApp()
    const toggle = screen.getByRole('button', { name: 'Coach' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('complementary', { name: 'Coach' })).toBeNull() // hidden
    expect(screen.getByTestId('next-step')).not.toBeVisible()
    fireEvent.click(toggle)
    expect(settings.getState().coachDrawer).toBe('open')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('complementary', { name: 'Coach' })).toBeVisible()
    // The drawer's own close button collapses it and hands focus back to the toggle.
    fireEvent.click(screen.getByRole('button', { name: 'Close the coach' }))
    expect(settings.getState().coachDrawer).toBe('closed')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(toggle)
  })

  it('keeps a closed drawer closed on a wide viewport too', () => {
    viewport(true)
    const { settings } = renderApp()
    act(() => settings.getState().update({ coachDrawer: 'closed' }))
    expect(screen.getByRole('button', { name: 'Coach' })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('the station’s chip rail', () => {
  it('offers the station’s eight chips with keys 1 to 8, and its chrome buttons', () => {
    const { settings, run } = renderApp()
    const rail = screen.getByRole('toolbar', { name: 'Chips and bet buttons' })
    expect(
      within(rail)
        .getAllByRole('button', { name: /chip/ })
        .map((chip) => chip.textContent),
    ).toStrictEqual(['$1', '$2', '$3', '$5', '$10', '$25', '$50', '$100'])
    fireEvent.keyDown(document, { key: '8' })
    expect(settings.getState().selectedChip).toBe(10_000)
    fireEvent.keyDown(document, { key: '3' })
    expect(settings.getState().selectedChip).toBe(300)
    // CLEAR LAST BET is Undo; DOUBLE BET and REPEAT LAST BET the macros.
    const clear = within(rail).getByRole('button', { name: 'Clear last bet' })
    expect(clear).toBeDisabled()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(300) })
    })
    expect(clear).toBeEnabled()
    fireEvent.click(clear)
    expect(screen.getByTestId('meter-bet')).toHaveTextContent('$0.00')
    expect(within(rail).getByRole('button', { name: 'Double bet' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Repeat last bet' })).toBeInTheDocument()
  })
})
