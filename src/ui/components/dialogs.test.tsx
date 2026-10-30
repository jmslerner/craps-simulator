import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp.tsx'

describe('the Add credit dialog (plan §0 #19)', () => {
  it('deposits a preset amount through the store, logged as a deposit', () => {
    const { game } = renderApp()
    fireEvent.click(screen.getByRole('button', { name: '+ Add credit' }))
    const dialog = screen.getByRole('dialog', { name: 'Add credit' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '$50' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add credit' }))
    const ledger = game.getState().view?.shown.ledger
    expect(ledger?.bankroll).toBe(55_000)
    expect(ledger?.deposits).toBe(55_000) // a top-up, never a win
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('validates the custom amount inline with aria-invalid', () => {
    const { game } = renderApp()
    fireEvent.click(screen.getByRole('button', { name: '+ Add credit' }))
    const dialog = screen.getByRole('dialog', { name: 'Add credit' })
    const custom = within(dialog).getByLabelText('Whole dollars')
    fireEvent.change(custom, { target: { value: '12.50' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add credit' }))
    expect(custom).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter whole dollars, like 100.')
    expect(game.getState().view?.shown.ledger.bankroll).toBe(50_000)
    fireEvent.change(custom, { target: { value: '75' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add credit' }))
    expect(game.getState().view?.shown.ledger.bankroll).toBe(57_500)
  })

  it('refuses a deposit the machine cannot hold, inline', () => {
    const { game } = renderApp()
    fireEvent.click(screen.getByRole('button', { name: '+ Add credit' }))
    const dialog = screen.getByRole('dialog', { name: 'Add credit' })
    const custom = within(dialog).getByLabelText('Whole dollars')
    fireEvent.change(custom, { target: { value: '99999999999999' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add credit' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'The machine cannot take that deposit.',
    )
    expect(game.getState().view?.shown.ledger.bankroll).toBe(50_000)
  })

  it('traps focus and closes on Escape', () => {
    renderApp()
    const opener = screen.getByRole('button', { name: '+ Add credit' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Add credit' })
    expect(dialog.contains(document.activeElement)).toBe(true) // focus moved in
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener) // and restored
  })
})

describe('the New game dialog (plan §0 #19)', () => {
  it('starts a new session on the chosen bankroll and remembers it', async () => {
    const { game, settings } = renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'New game' }))
    const dialog = screen.getByRole('dialog', { name: 'New game' })
    // The machine's own default is offered and checked first; focus landed on it.
    const checked = within(dialog).getByRole('radio', { name: '$500' })
    expect((checked as HTMLInputElement).checked).toBe(true)
    expect(document.activeElement).toBe(checked)
    fireEvent.click(within(dialog).getByRole('radio', { name: '$200' }))
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(game.getState().view?.shown.ledger.bankroll).toBe(20_000)
    expect(game.getState().view?.shown.bets).toHaveLength(0)
    expect(settings.getState().startingBankroll).toBe(20_000)
  })

  it('validates the custom whole-dollar buy-in', async () => {
    const { game } = renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'New game' }))
    const dialog = screen.getByRole('dialog', { name: 'New game' })
    const custom = within(dialog).getByLabelText('Whole dollars')
    fireEvent.change(custom, { target: { value: 'three hundred' } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter whole dollars, like 300.')
    expect(custom).toHaveAttribute('aria-invalid', 'true')
    expect(game.getState().view?.shown.ledger.bankroll).toBe(50_000) // unchanged
    fireEvent.change(custom, { target: { value: '300' } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(game.getState().view?.shown.ledger.bankroll).toBe(30_000)
  })

  it('the guide checkbox decides whether the next-step bar opens (plan §0 #18)', async () => {
    const { settings } = renderApp()
    expect(screen.getByTestId('next-step')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New game' }))
    const dialog = screen.getByRole('dialog', { name: 'New game' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Show the guide' }))
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    })
    await waitFor(() => {
      expect(settings.getState().guideEnabled).toBe(false)
    })
    expect(screen.queryByTestId('next-step')).toBeNull()
  })

  it('remembers the last choice: a custom amount comes back prefilled', async () => {
    const app = renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'New game' }))
    let dialog = screen.getByRole('dialog', { name: 'New game' })
    const custom = within(dialog).getByLabelText('Whole dollars')
    fireEvent.change(custom, { target: { value: '321' } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(app.game.getState().view?.shown.ledger.bankroll).toBe(32_100)
    fireEvent.click(screen.getByRole('button', { name: 'New game' }))
    dialog = screen.getByRole('dialog', { name: 'New game' })
    expect(
      (within(dialog).getByRole('radio', { name: 'Custom' }) as HTMLInputElement).checked,
    ).toBe(true)
    expect(within(dialog).getByLabelText('Whole dollars')).toHaveValue('321')
  })
})
