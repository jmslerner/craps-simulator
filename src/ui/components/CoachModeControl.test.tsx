import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { COACH_MODE_OPTIONS } from './CoachModeControl.tsx'
import { renderApp } from '../test/renderApp.tsx'

/**
 * The coach-mode control (plan §5.6 Off / Quiet / Coach; M9 audit MAJOR-2): a topbar group of
 * three pressed-state buttons that writes `settingsStore.coachMode`, announces each change, is
 * keyboard-reachable (plain buttons) and is remembered through the settings store.
 */

describe('the coach-mode control', () => {
  it('shows the three plan modes with the stored one pressed (Coach by default)', () => {
    renderApp()
    const group = screen.getByRole('group', { name: 'Coach mode' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Off', 'Quiet', 'On'])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
    expect(COACH_MODE_OPTIONS.map((o) => o.setting)).toEqual(['off', 'hints', 'full'])
  })

  it('writes the setting, moves the pressed state and announces what the mode shows', () => {
    const app = renderApp()
    fireEvent.click(screen.getByTestId('coach-mode-quiet'))
    expect(app.settings.getState().coachMode).toBe('hints')
    expect(screen.getByTestId('coach-mode-quiet')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('coach-mode-coach')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('announcer')).toHaveTextContent(
      'Coach quiet: only poor and awful badges, one recap line per bet, a compact cost meter and only the strongest advice.',
    )
    fireEvent.click(screen.getByTestId('coach-mode-off'))
    expect(app.settings.getState().coachMode).toBe('off')
    expect(screen.getByTestId('announcer')).toHaveTextContent('Coach off:')
    fireEvent.click(screen.getByTestId('coach-mode-coach'))
    expect(app.settings.getState().coachMode).toBe('full')
    expect(screen.getByTestId('announcer')).toHaveTextContent('Coach on:')
  })

  it('reflects a stored mode at mount and is reachable from the keyboard', () => {
    const app = renderApp()
    act(() => {
      app.settings.getState().update({ coachMode: 'off' })
    })
    expect(screen.getByTestId('coach-mode-off')).toHaveAttribute('aria-pressed', 'true')
    const quiet = screen.getByRole('button', { name: 'Coach quiet' })
    quiet.focus()
    expect(quiet).toHaveFocus()
    // A focused button activates on Enter/Space through its click, as every native button does.
    fireEvent.click(quiet)
    expect(app.settings.getState().coachMode).toBe('hints')
  })

  it('hides every coach surface when off: badges, meter, cheat sheet (the §5.6 Off column)', async () => {
    const app = renderApp()
    fireEvent.click(screen.getByTestId('coach-mode-off'))
    expect(document.querySelectorAll('[data-coach-badge]')).toHaveLength(0)
    expect(screen.queryByTestId('layout-meter')).toBeNull()
    expect(screen.queryByRole('button', { name: /Cheat sheet/ })).toBeNull()
    expect(app.settings.getState().coachMode).toBe('off')
  })
})
