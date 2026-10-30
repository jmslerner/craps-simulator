import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { cents, makeRoll } from '../../engine/index.ts'
import { renderApp, type TestApp } from '../test/renderApp.tsx'

/**
 * The session summary screen (plan §5.7, §10 M13): the Summary control under the session strip,
 * the summary New game shows for the session it ends, and the modal's manners. The numbers
 * themselves are the coach's (src/coach/summary); here they only have to reach the screen.
 */

/** Pass $10, then 2+2 (point 4) and 1+3 (made): the pass wins $10 and stays up. */
function playPointMade(app: TestApp): void {
  app.run((state) => {
    state.dispatch({ type: 'place', typeId: 'pass', amount: cents(1000) })
  })
  app.roll(makeRoll(2, 2))
  app.roll(makeRoll(1, 3))
}

async function openSummary(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Session summary' }))
  const dialog = screen.getByRole('dialog', { name: 'Session summary' })
  await within(dialog).findByTestId('session-summary')
  return dialog
}

describe('the session summary screen', () => {
  it('opens from the Summary control on the session so far', async () => {
    const app = renderApp()
    playPointMade(app)
    const dialog = await openSummary()
    expect(within(dialog).getByTestId('summary-facts')).toHaveTextContent(
      'Crapless bubble craps · 2 rolls · 0 seven-outs',
    )
    expect(within(dialog).getByTestId('summary-deposits')).toHaveTextContent('$500.00')
    // The session meters beside it (rules spec §4.6): the pass decided once, at $10.
    expect(within(dialog).getByTestId('summary-deposit-count')).toHaveTextContent('1 deposit')
    expect(within(dialog).getByTestId('summary-wagered')).toHaveTextContent('$10.00')
    expect(within(dialog).getByTestId('summary-decisions')).toHaveTextContent('1 decision')
    expect(within(dialog).getByTestId('summary-commission')).toHaveTextContent('$0.00')
    // Credit $500 − $10 + $20 back, the $10 pass still up: +$10.00 against $500 put in.
    expect(within(dialog).getByTestId('summary-result-cash')).toHaveTextContent('+$10.00')
    expect(within(dialog).getByTestId('summary-result-equity')).toHaveTextContent(/^≈ \+\$9\.46$/)
    expect(within(dialog).getByTestId('summary-expected')).toHaveTextContent(/^≈ -\$1\.08$/)
    expect(within(dialog).getByTestId('summary-families')).toHaveTextContent(
      'Line bets: ≈ $1.08 over 1 decision',
    )
    expect(within(dialog).getByTestId('summary-no-leaks')).toBeInTheDocument()
  })

  it('is closed to the control while the dice are rolling', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(1000) })
    })
    const control = screen.getByRole('button', { name: 'Session summary' })
    expect(control).toBeEnabled()
    app.run((state) => {
      state.beginRoll(makeRoll(3, 3))
    })
    expect(control).toBeDisabled()
    app.run((state) => {
      state.reveal()
      state.finishReveal()
    })
    expect(control).toBeEnabled()
  })

  it('shows the ended session once New game has started the next one', async () => {
    const app = renderApp()
    playPointMade(app)
    fireEvent.click(screen.getByRole('button', { name: 'New game' }))
    const newGame = screen.getByRole('dialog', { name: 'New game' })
    await act(async () => {
      fireEvent.click(within(newGame).getByRole('button', { name: 'Start' }))
    })
    const ended = await screen.findByRole('dialog', { name: 'Session ended' })
    await within(ended).findByTestId('session-summary')
    expect(within(ended).getByTestId('summary-facts')).toHaveTextContent('2 rolls')
    expect(within(ended).getByTestId('summary-result-cash')).toHaveTextContent('+$10.00')
    // The ended session's meters, not the new game's.
    expect(within(ended).getByTestId('summary-wagered')).toHaveTextContent('$10.00')
    expect(screen.getByTestId('meters-wagered')).toHaveTextContent('$0.00')
    // The table is the new game's.
    expect(app.game.getState().session?.committed).toHaveLength(0)
    fireEvent.click(within(ended).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not open by itself with the coach off', async () => {
    const app = renderApp()
    app.settings.getState().update({ coachMode: 'off' })
    playPointMade(app)
    fireEvent.click(screen.getByRole('button', { name: 'New game' }))
    const newGame = screen.getByRole('dialog', { name: 'New game' })
    await act(async () => {
      fireEvent.click(within(newGame).getByRole('button', { name: 'Start' }))
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(app.game.getState().session?.committed).toHaveLength(0)
  })

  it('says so when the session’s log no longer replays', async () => {
    const app = renderApp()
    playPointMade(app)
    // A session whose log was recorded on a table this engine no longer reaches (a divergent
    // resume keeps such a session's stored state, plan §8).
    app.run((state) => {
      const { cfg, session } = state
      if (cfg === null || session === null) throw new Error('no session')
      const [first, ...rest] = session.committed
      if (first === undefined) throw new Error('no roll')
      const committed = [{ ...first, hashAfter: '0000000000000000' }, ...rest]
      state.restoreGame({ cfg, session: { ...session, committed }, meta: null })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Session summary' }))
    const dialog = screen.getByRole('dialog', { name: 'Session summary' })
    expect(await within(dialog).findByTestId('summary-failed')).toHaveTextContent(
      'no longer replays on this version of the trainer',
    )
  })

  it('holds the keyboard map while open, and gives focus back on Escape', async () => {
    const app = renderApp()
    playPointMade(app)
    const control = screen.getByRole('button', { name: 'Session summary' })
    control.focus()
    const dialog = await openSummary()
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document, { key: 'r' })
    expect(app.game.getState().session?.committed).toHaveLength(2)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(control)
  })
})
