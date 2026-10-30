import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { byEdge, catalogTable } from '../../exact/index.ts'
import { badgeKey } from '../../coach/types.ts'
import { handleAnalysisRequest } from '../../workers/analysisHandler.ts'
import { setAnalysisTransportForTests } from '../services/analysisClient.ts'
import { COMPILED_PRESETS } from '../state/machineStore.ts'
import { CRAPLESS } from '../test/game.ts'
import { renderApp } from '../test/renderApp.tsx'

/**
 * The cheat sheet (plan §10 M9d): every bet the machine offers, `byEdge(catalogTable(cfg))`,
 * rendered from the worker's raw rows — order, count and headline figures pinned against the
 * exact catalog computed directly.
 */

beforeEach(() => {
  setAnalysisTransportForTests((request) => handleAnalysisRequest(request))
})

afterEach(() => {
  setAnalysisTransportForTests(null)
})

describe('the cheat sheet', () => {
  it('opens on its button and lists every catalog row, sorted by edge', async () => {
    renderApp()
    const toggle = screen.getByRole('button', { name: /Cheat sheet/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const rows = await screen.findByTestId('sheet-rows')
    const expected = byEdge(catalogTable(CRAPLESS))
    const items = [...rows.querySelectorAll('[data-sheet-row]')]
    expect(items).toHaveLength(expected.length)
    expect(items.map((item) => item.getAttribute('data-sheet-row'))).toEqual(
      expected.map((row) => badgeKey(row.spec.typeId, row.spec.number)),
    )
  })

  it('shows place 6 priced at its exact unit, with the warning for the worse minimum', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /Cheat sheet/ }))
    await screen.findByTestId('sheet-rows')
    const row = document.querySelector('[data-sheet-row="place|6"]')
    expect(row).not.toBeNull()
    expect(row?.textContent).toContain('Place 6')
    expect(row?.textContent).toContain('1.52%')
    expect(row?.textContent).toContain('pays 7:6 · at $3.00')
    expect(row?.textContent).toContain('At the minimum $1.00 this worsens to 1.82%.')
    expect(row?.querySelector('.sheet-edge')?.className).toContain('grade-good')
    expect(row?.querySelector('.sheet-assumed')).not.toBeNull()
  })

  it('shows a side bet’s note on how it settles, and none on the main game’s rows (M11)', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /Cheat sheet/ }))
    await screen.findByTestId('sheet-rows')
    const low = document.querySelector('[data-sheet-row="luckyRollerLow|"]')
    expect(low?.querySelector('[data-coach-line="side-note"]')?.textContent).toMatch(
      /^Side bet: every target total must roll before any seven/,
    )
    const place = document.querySelector('[data-sheet-row="place|6"]')
    expect(place?.querySelector('.sheet-note')).toBeNull()
  })

  it('says which options the machine sets that the trainer approximates', async () => {
    renderApp({ cfg: COMPILED_PRESETS.traditionalBubble })
    fireEvent.click(screen.getByRole('button', { name: /Cheat sheet/ }))
    expect(await screen.findByTestId('sheet-not-modelled')).toHaveTextContent(
      '/offBets/consumeCredit',
    )
  })

  it('is hidden when the coach is off, and stays on demand in quiet (plan §5.6)', async () => {
    const app = renderApp()
    act(() => {
      app.settings.getState().update({ coachMode: 'off' })
    })
    expect(screen.queryByRole('button', { name: /Cheat sheet/ })).toBeNull()
    act(() => {
      app.settings.getState().update({ coachMode: 'hints' })
    })
    fireEvent.click(screen.getByRole('button', { name: /Cheat sheet/ }))
    expect(await screen.findByTestId('sheet-rows')).toBeInTheDocument()
  })

  it('renders no rows before the worker answers', () => {
    setAnalysisTransportForTests(() => new Promise(() => undefined)) // never answers
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /Cheat sheet/ }))
    expect(screen.queryByTestId('sheet-rows')).toBeNull()
    expect(screen.getByText('Computing the table…')).toBeInTheDocument()
  })
})
