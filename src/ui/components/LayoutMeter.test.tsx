import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cents } from '../../engine/index.ts'
import { handleAnalysisRequest } from '../../workers/analysisHandler.ts'
import { setAnalysisTransportForTests } from '../services/analysisClient.ts'
import { renderApp } from '../test/renderApp.tsx'

/**
 * The layout cost meter (plan §10 M9d): Σ of the standing costs from the analysis worker, the
 * hourly line over the pace range with the machine's own pace marked, the by-bet rows, the
 * cheapest same-event relayout and the working toggle's dry-run effect. The transport is the real
 * worker handler, so every rendered figure is the same wire data production receives; the pinned
 * strings are the §13 M5/M6 → M9 numbers (place 4 at $5 loses a sixtieth of the stake a roll).
 */

beforeEach(() => {
  setAnalysisTransportForTests((request) => handleAnalysisRequest(request))
})

afterEach(() => {
  setAnalysisTransportForTests(null)
})

describe('the layout cost meter', () => {
  it('says the table is empty until a bet stands', async () => {
    renderApp()
    expect(await screen.findByTestId('meter-empty')).toHaveTextContent(
      'No bets standing. The meter prices every bet you keep working.',
    )
  })

  it('prices a place 4: the per-roll headline and the hourly line at 60, 120 and 150', async () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 4, amount: cents(500) }, 'test')
    })
    expect(await screen.findByTestId('meter-per-roll')).toHaveTextContent(
      'Keeping these bets up costs ≈ $0.08 a roll.',
    )
    const hourly = screen.getByTestId('meter-hourly')
    const items = [...hourly.querySelectorAll('li')]
    expect(items.map((item) => item.getAttribute('data-pace'))).toEqual(['60', '120', '150'])
    expect(items.map((item) => item.textContent)).toEqual([
      '60 rolls/hr: $5.00',
      '120 rolls/hr (this machine): $10.00',
      '150 rolls/hr: $12.50',
    ])
    expect(items[1]?.hasAttribute('data-machine')).toBe(true)
    expect(items[0]?.hasAttribute('data-machine')).toBe(false)
  })

  it('is hidden when the coach is off and compact in quiet: the headline alone (plan §5.6)', async () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 4, amount: cents(500) }, 'test')
    })
    await screen.findByTestId('meter-per-roll')
    act(() => {
      app.settings.getState().update({ coachMode: 'off' })
    })
    expect(screen.queryByTestId('layout-meter')).toBeNull()
    act(() => {
      app.settings.getState().update({ coachMode: 'hints' })
    })
    const meter = await screen.findByTestId('layout-meter')
    expect(meter).toHaveAttribute('data-compact', 'true')
    expect(screen.getByTestId('meter-per-roll')).toHaveTextContent(
      'Keeping these bets up costs ≈ $0.08 a roll.',
    )
    expect(screen.queryByTestId('meter-hourly')).toBeNull()
    expect(screen.queryByTestId('meter-toggle')).toBeNull()
    expect(screen.queryByTestId('meter-alt')).toBeNull()
    expect(document.querySelector('[data-meter-bet]')).toBeNull()
    act(() => {
      app.settings.getState().update({ coachMode: 'full' })
    })
    expect(await screen.findByTestId('meter-hourly')).toBeInTheDocument()
    expect(screen.getByTestId('layout-meter')).not.toHaveAttribute('data-compact')
  })

  it('lists the bet, offers the same-event swap and prices the Set bets OFF dry run', async () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 4, amount: cents(500) }, 'test')
    })
    await screen.findByTestId('meter-per-roll')
    const row = document.querySelector('[data-meter-bet]')
    expect(row?.textContent).toContain('Place 4')
    expect(row?.textContent).toContain('$5')
    expect(screen.getByTestId('meter-alt')).toHaveTextContent('Swap Place 4 into Buy 4 at $5.00.')
    expect(screen.getByTestId('meter-toggle')).toHaveTextContent(
      'Set bets OFF and this becomes $0.00 a roll.',
    )
    // The numbers rest on assumed machine values on this preset, and the meter says so.
    expect(screen.getByTestId('layout-meter').textContent).toContain('Uses assumed machine values')
  })
})
