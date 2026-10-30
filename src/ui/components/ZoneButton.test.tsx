import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyzeZone } from '../services/testHooks.ts'
import { setAnalysisTransportForTests } from '../services/analysisClient.ts'
import { handleAnalysisRequest } from '../../workers/analysisHandler.ts'
import { CRAPLESS } from '../test/game.ts'
import { renderApp } from '../test/renderApp.tsx'

/**
 * The coach badge on a zone (plan §10 M9a): the analysis worker's edge, rendered as a second,
 * coach-owned slot beside the machine's own badge. The transport here is the real worker handler,
 * so the badge the DOM shows is the same wire data production receives; the expected text comes
 * from `analyzeZone`, the hook the e2e equality check uses.
 */

beforeEach(() => {
  setAnalysisTransportForTests((request) => handleAnalysisRequest(request))
})

afterEach(() => {
  setAnalysisTransportForTests(null)
})

describe('the zone coach badge', () => {
  it('shows the Place 6 edge from the worker, equal to the analyze hook, graded', async () => {
    renderApp()
    const expected = analyzeZone(CRAPLESS, 'place', 6)
    expect(expected).not.toBeNull()
    const zone = screen.getByRole('button', { name: /^Place 6/ })
    const badge = await within(zone).findByText(expected?.badge ?? '--')
    expect(badge).toHaveAttribute('data-coach-badge', 'place|6')
    expect(badge.className).toContain(`grade-${expected?.grade ?? ''}`)
  })

  it('badges every modelled zone kind that has a catalog row: line, field, hardway', async () => {
    renderApp()
    for (const [name, typeId, number] of [
      [/^Pass Line/, 'pass', null],
      [/^Field/, 'field', null],
      [/^Hard 8/, 'hard', 8],
    ] as const) {
      const expected = analyzeZone(CRAPLESS, typeId, number)
      expect(expected, typeId).not.toBeNull()
      const zone = screen.getByRole('button', { name })
      const badge = await within(zone).findByText(expected?.badge ?? '--')
      expect(badge).toBeInTheDocument()
    }
  })

  it('shows no coach badge while the analysis has not arrived', () => {
    setAnalysisTransportForTests(() => new Promise(() => undefined)) // never answers
    const { container } = renderApp()
    expect(container.querySelector('[data-coach-badge]')).toBeNull()
  })
})
