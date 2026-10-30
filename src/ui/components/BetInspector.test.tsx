import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cents } from '../../engine/index.ts'
import { handleAnalysisRequest } from '../../workers/analysisHandler.ts'
import { setAnalysisTransportForTests } from '../services/analysisClient.ts'
import { dice } from '../test/game.ts'
import { coachMemoryStore } from '../state/nextStep.ts'
import { COMPILED_PRESETS } from '../state/machineStore.ts'
import { renderApp } from '../test/renderApp.tsx'

/** Opens the inspector on a zone through INFO mode (the tap paths have their own tests). */
function openOn(zoneName: RegExp): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Info' }))
  fireEvent.click(screen.getByRole('button', { name: zoneName }))
  fireEvent.click(screen.getByRole('button', { name: 'Info' })) // back to bet mode
  return screen.getByRole('dialog')
}

describe('the bet inspector', () => {
  it('steps the amount by the spot’s own increment, from legalBets', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const dialog = openOn(/^Place 6/)
    expect(within(dialog).getByText('On the table: $6.00')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add \$1\.00 to Place 6/ }))
    expect(app.game.getState().view?.shown.bets[0]?.amount).toBe(700)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reduce Place 6' }))
    expect(app.game.getState().view?.shown.bets[0]?.amount).toBe(600)
  })

  it('Press adds the last win, in whole units, through the macro', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    app.roll(dice(3, 3)) // place 6 wins $7.00 (7:6) on the come-out point roll
    const dialog = openOn(/^Place 6/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Press' }))
    expect(app.game.getState().view?.shown.bets[0]?.amount).toBe(1_300) // $6 + $7 pressed
  })

  it('Take down returns the stake; a contract bet is refused with its lock message inline', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    app.roll(dice(1, 1)) // point 2: the pass line is now a contract
    const dialog = openOn(/^Pass Line/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take down' }))
    expect(app.game.getState().view?.shown.bets).toHaveLength(1) // refused, still up
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Pass Line is a contract bet: it stays up until it wins or loses.',
    )
  })

  it('the odds stepper and Max come from legalBets and the maxOutOdds macro', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    app.roll(dice(1, 1)) // point 2; crapless odds pay 6:1, capped at 2x the flat
    const dialog = openOn(/^Pass Line/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add odds behind Pass Line' }))
    const oddsBet = () =>
      app.game.getState().view?.shown.bets.find((bet) => bet.typeId === 'passOdds')
    expect(oddsBet()?.amount).toBe(100) // the smallest odds addition
    fireEvent.click(within(dialog).getByRole('button', { name: 'Max' }))
    expect(oddsBet()?.amount).toBe(1_000) // 2x the $5 flat
  })

  it('keeps the working toggle visible but disabled where the machine has no per-bet switch', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const dialog = openOn(/^Place 6/)
    const toggle = within(dialog).getByRole('button', { name: 'Set OFF' })
    expect(toggle).toBeDisabled() // crapless Interblock: global button only
    expect(toggle).toHaveAttribute('title', expect.stringContaining('Set bets On/Off'))
  })

  it('offers to place the smallest bet on an empty spot', () => {
    const app = renderApp()
    const dialog = openOn(/^Field/)
    expect(within(dialog).getByText('No bet here yet.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add \$1\.00 to Field/ }))
    const bet = app.game.getState().view?.shown.bets[0]
    expect(bet?.typeId).toBe('field')
    expect(bet?.amount).toBe(100)
  })

  it('closes on Escape and returns focus to the opener', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const zone = screen.getByRole('button', { name: /^Place 6/ })
    zone.focus()
    fireEvent.contextMenu(zone)
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(zone)
  })
})

describe('InspectorExtras (plan §10 M9a: the coach analysis in the inspector)', () => {
  beforeEach(() => {
    setAnalysisTransportForTests((request) => handleAnalysisRequest(request))
  })

  afterEach(() => {
    setAnalysisTransportForTests(null)
  })

  it('the Place 6 $5 inspector shows "$5.83" and "1.55%" (the §10 M9a acceptance)', async () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(500) })
    })
    const dialog = openOn(/^Place 6/)
    expect(await within(dialog).findByText('$5.00 × 7:6 = $5.83')).toBeInTheDocument()
    expect(within(dialog).getByText('House edge 1.55%')).toBeInTheDocument()
    expect(within(dialog).getByText('Wins 45.5% of decisions')).toBeInTheDocument()
  })

  it('Show math lists the derivation steps from the worker', async () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(500) })
    })
    const dialog = openOn(/^Place 6/)
    await within(dialog).findByText('Show math')
    expect(
      within(dialog).getByText('Of 36 rolls: 5 win, 6 lose, 25 change nothing.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('$5.00 × 7:6 = $5.833… → pays $5.83.')).toBeInTheDocument()
  })

  it('shows equity for a bet on the table, and no take-down line for a contract bet', async () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(1_000) })
    })
    app.roll(dice(1, 1)) // the point is 2: the crapless pass equity drops to 2000/7 cents
    const dialog = openOn(/^Pass Line/)
    expect(await within(dialog).findByText('Worth from now: ≈ $2.86')).toBeInTheDocument()
    expect(within(dialog).getByText('Expected loss from here: ≈ $7.14')).toBeInTheDocument()
    expect(within(dialog).queryByText(/Taking it down returns/)).toBeNull()
  })

  it('offers the take-down value for a bet the machine lets down', async () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const dialog = openOn(/^Place 6/)
    expect(await within(dialog).findByText('Taking it down returns $6.00')).toBeInTheDocument()
  })

  it('renders nothing coach-y while the analysis has not arrived', () => {
    setAnalysisTransportForTests(() => new Promise(() => undefined))
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const dialog = openOn(/^Place 6/)
    expect(within(dialog).queryByText(/House edge/)).toBeNull()
  })
})

describe('InspectorExtras advice (plan §10 M9c: alternatives with one-tap switch, memory, modes)', () => {
  beforeEach(() => {
    setAnalysisTransportForTests((request) => handleAnalysisRequest(request))
    coachMemoryStore.getState().reset()
  })

  afterEach(() => {
    setAnalysisTransportForTests(null)
    coachMemoryStore.getState().reset()
  })

  it('Place 4 on an on-win machine offers "Switch to Buy 4"; the tap converts the bet', async () => {
    const app = renderApp({ cfg: COMPILED_PRESETS.traditionalBubble })
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 4, amount: cents(1_500) })
    })
    const dialog = openOn(/^Place 4/)
    const fix = await within(dialog).findByTestId('advice-fix-same-event')
    expect(fix).toHaveTextContent('Switch to Buy 4')
    fireEvent.click(fix)
    const bets = app.game.getState().view?.shown.bets ?? []
    expect(
      bets.some((bet) => bet.typeId === 'buy' && bet.number === 4 && bet.amount === 1_500),
    ).toBe(true)
    expect(bets.some((bet) => bet.typeId === 'place')).toBe(false)
  })

  it("one Don't show retires an advice row for the run; It's for fun silences the whole type", async () => {
    const app = renderApp({ cfg: COMPILED_PRESETS.traditionalBubble })
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 4, amount: cents(1_500) })
    })
    const dialog = openOn(/^Place 4/)
    await within(dialog).findByTestId('advice-fix-same-event')
    const row = () => within(dialog).queryByTestId('advice-fix-same-event')
    const dontShow = within(dialog)
      .getAllByRole('button', { name: /Don't show this same-event/ })
      .at(0)
    // The button says "again", so the first tap is the last time the row shows (M9 audit MINOR-5).
    fireEvent.click(dontShow as HTMLElement)
    expect(row()).toBeNull()
    expect(screen.getByTestId('announcer')).toHaveTextContent(
      'That advice will not be shown again.',
    )
    // Retired means badge-only for the gate too: reopening the inspector keeps it gone.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    const again = openOn(/^Place 4/)
    await within(again).findByText(/House edge/)
    expect(within(again).queryByTestId('advice-fix-same-event')).toBeNull()

    // "It's for fun" silences every advice about that bet type (table-level rows may stay).
    act(() => {
      coachMemoryStore.getState().markForFun('place')
    })
    expect(again.querySelector('[data-advice="edge-warning"]')).toBeNull()
    expect(again.querySelector('[data-advice="same-event"]')).toBeNull()
  })

  it('coach off hides the whole coach section: no lines, no Show math, no advice (plan §5.6)', async () => {
    const app = renderApp()
    act(() => {
      app.settings.getState().update({ coachMode: 'off' })
    })
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(500) })
    })
    const dialog = openOn(/^Place 6/)
    // The machine's own facts stay; the coach's go.
    expect(within(dialog).getByText(/On the table: \$5\.00/)).toBeInTheDocument()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(within(dialog).queryByRole('region', { name: 'Coach analysis' })).toBeNull()
    expect(within(dialog).queryByText(/House edge/)).toBeNull()
    expect(within(dialog).queryByText('Show math')).toBeNull()
    expect(within(dialog).queryByRole('list', { name: 'Coach advice' })).toBeNull()
    // Switching the coach back on brings the analysis in.
    act(() => {
      app.settings.getState().update({ coachMode: 'full' })
    })
    expect(await within(dialog).findByText('House edge 1.55%')).toBeInTheDocument()
  })

  it('coach quiet keeps the priced lines and Show math, and lists only gate-routed advice', async () => {
    const app = renderApp({ cfg: COMPILED_PRESETS.traditionalBubble })
    act(() => {
      app.settings.getState().update({ coachMode: 'hints' })
    })
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 4, amount: cents(1_500) })
    })
    const dialog = openOn(/^Place 4/)
    // The same-event switch saves 2/105 ≥ a quarter of the place 4's 1/15: quiet still toasts it.
    expect(await within(dialog).findByTestId('advice-fix-same-event')).toHaveTextContent(
      'Switch to Buy 4',
    )
    expect(within(dialog).getByText(/House edge/)).toBeInTheDocument()
    expect(within(dialog).getByText('Show math')).toBeInTheDocument()
    // The edge warning (6.67%, under quiet's 9% bar) and the context rows are not listed.
    const rules = [...dialog.querySelectorAll('[data-advice]')].map((el) =>
      el.getAttribute('data-advice'),
    )
    expect(rules).toEqual(['same-event'])
  })

  it('a working-held advice carries the Set bets On fix and the assumed chip', async () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    app.roll(dice(1, 1)) // point 2
    app.roll(dice(3, 4)) // seven-out
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const dialog = openOn(/^Place 6/)
    const fix = await within(dialog).findByTestId('advice-fix-working-held')
    expect(fix).toHaveTextContent('Set bets On')
    const row = fix.closest('li')
    expect(row?.querySelector('.coach-assumed')?.getAttribute('title')).toContain('§9 #28')
    fireEvent.click(fix)
    expect(app.game.getState().view?.shown.globalOff).toBeNull()
  })
})
