import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SessionNotice } from '../../persistence/sessionRepo.ts'
import { renderApp } from '../test/renderApp.tsx'

/**
 * The session-resume notice banner (plan §8): `restoreGame` with a notice renders it in an
 * assertive live region (`role="alert"`), the player dismisses it through the store, and a resume
 * without a notice renders nothing.
 */

function restoreWithNotice(notice: SessionNotice | undefined) {
  const app = renderApp()
  app.run((state) => {
    const { cfg, session } = state
    if (cfg === null || session === null) throw new Error('test session missing')
    state.restoreGame({ cfg, session, meta: null, notice })
  })
  return app
}

describe('the session notice banner (plan §8)', () => {
  it('shows a cross-version resume as checked and kept, in an aria-live alert', () => {
    restoreWithNotice({ kind: 'engineVersion', from: 1, to: 2 })
    const banner = screen.getByTestId('session-notice')
    expect(banner).toHaveTextContent('older version of the game engine')
    expect(banner).toHaveTextContent('checked')
    expect(banner).toHaveTextContent('kept exactly as it was')
    // The banner is itself the live region, so the resume announces it.
    expect(screen.getByRole('alert')).toBe(banner)
    // Honest and number-free: no version numbers leak into the wording.
    expect(banner.textContent).not.toMatch(/\d/)
  })

  it('shows a divergent resume as kept but not reproducing, with care', () => {
    restoreWithNotice({
      kind: 'divergence',
      from: 2,
      failure: { kind: 'engineVersion', logged: 1, current: 2 },
    })
    const banner = screen.getByTestId('session-notice')
    expect(banner).toHaveTextContent('no longer reproduces from its roll log')
    expect(banner).toHaveTextContent('treat its history with care')
    expect(screen.getByRole('alert')).toBe(banner)
    expect(banner.textContent).not.toMatch(/\d/)
  })

  it('dismisses through the store and stays dismissed', () => {
    const { game } = restoreWithNotice({ kind: 'engineVersion', from: 1, to: 2 })
    const banner = screen.getByTestId('session-notice')
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(game.getState().notice).toBeNull()
    expect(screen.queryByTestId('session-notice')).toBeNull()
  })

  it('renders nothing when the resume carried no notice', () => {
    restoreWithNotice(undefined)
    expect(screen.queryByTestId('session-notice')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
