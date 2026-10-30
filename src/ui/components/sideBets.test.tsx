import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cents } from '../../engine/index.ts'
import { formatPart } from '../../coach/format.ts'
import { inspectorMath } from '../../coach/inspector.ts'
import { handleAnalysisRequest } from '../../workers/analysisHandler.ts'
import { setAnalysisTransportForTests } from '../services/analysisClient.ts'
import { COMPILED_PRESETS } from '../state/machineStore.ts'
import { sideBetSpotsOf } from '../state/sideBetSpots.ts'
import { CRAPLESS, dice } from '../test/game.ts'
import { renderApp } from '../test/renderApp.tsx'

/**
 * The side bets on the table (plan §10 M11): their zones take real bets with the engine's limits
 * and refusals, light their progress from the bet's own `progress` after every roll, the
 * inspector shows the progress section with the machine's pay table and the engine's lock status,
 * and the history lists the progress and what a settled side bet had collected. These are machine
 * facts, so the analysis transport here never answers (no solver work on the test thread); the one
 * test about the coach's lines installs the real worker handler itself, as the inspector's tests
 * do, and checks each rendered line against the handler's own `inspectorMath`.
 */

/** The side-bet panel's zone (the bottom sheet is closed, so each zone renders once). */
function sideZone(name: RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function litPips(zone: HTMLElement): string[] {
  return [...zone.querySelectorAll('.pip-lit')].map((pip) => pip.textContent ?? '')
}

/** Opens the inspector on a zone through INFO mode and returns the dialog. */
function openOn(name: RegExp): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Info' }))
  fireEvent.click(screen.getByRole('button', { name }))
  fireEvent.click(screen.getByRole('button', { name: 'Info' }))
  return screen.getByRole('dialog')
}

beforeEach(() => {
  setAnalysisTransportForTests(() => new Promise(() => undefined))
})

afterEach(() => {
  setAnalysisTransportForTests(null)
})

describe('the Lucky Roller zones (crapless)', () => {
  it('a tap places the chip in hand, and the pips light as the targets roll', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    const low = sideZone(/^Low Rolls/)
    expect(low).not.toHaveAttribute('aria-disabled')
    expect(low.querySelectorAll('.pip')).toHaveLength(5)
    expect(litPips(low)).toStrictEqual([])

    fireEvent.click(low) // the $1 chip is in hand by default
    const bets = () => app.game.getState().view?.shown.bets ?? []
    expect(bets().find((bet) => bet.typeId === 'luckyRollerLow')?.amount).toBe(100)
    expect(
      screen.getByRole('button', {
        name: 'Low Rolls, $1.00, pays 31 for 1, none of 2, 3, 4, 5 and 6 rolled yet',
      }),
    ).toBeInTheDocument()

    app.roll(dice(1, 1)) // the point is 2, and 2 is a target
    const after = sideZone(/^Low Rolls/)
    expect(litPips(after)).toStrictEqual(['2'])
    expect(after.querySelector('.zone-track')).toHaveAttribute('data-lit', '2')
    expect(after).toHaveAttribute(
      'aria-label',
      'Low Rolls, $1.00, pays 31 for 1, 2 rolled, needs 3, 4, 5 and 6',
    )

    app.roll(dice(2, 2))
    expect(litPips(sideZone(/^Low Rolls/))).toStrictEqual(['2', '4'])
    expect(sideZone(/^Low Rolls/).querySelector('.zone-track')).toHaveAttribute('data-lit', '2 4')
    // The lit progress stays bright although the locked zone is aria-disabled.
    expect(sideZone(/^Low Rolls/)).toHaveAttribute('aria-disabled', 'true')
  })

  it('after the first roll a re-tap and a closed window show the engine’s refusals in words', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'luckyRollerLow', amount: cents(100) })
    })
    app.roll(dice(1, 1))
    const strip = screen.getByTestId('reason-strip')
    fireEvent.click(sideZone(/^Low Rolls/))
    expect(strip).toHaveTextContent(
      'Low Rolls cannot be added to now — a side bet is set before the dice roll.',
    )
    fireEvent.click(sideZone(/^High Rolls/))
    expect(strip).toHaveTextContent(
      'High Rolls can only be bet right after a 7 or before the first roll — it opens again after the next 7.',
    )
    expect(app.game.getState().view?.shown.bets).toHaveLength(2)
  })

  it('REMOVE mode takes a side bet down before the dice roll, and is refused after', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'luckyRollerLow', amount: cents(100) })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(sideZone(/^Low Rolls/))
    expect(app.game.getState().view?.shown.bets).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' })) // back to bet mode

    fireEvent.click(sideZone(/^Low Rolls/))
    app.roll(dice(1, 1))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(sideZone(/^Low Rolls/))
    expect(app.game.getState().view?.shown.bets).toHaveLength(2)
    expect(screen.getByTestId('reason-strip')).toHaveTextContent(
      'Low Rolls is locked once the dice roll — it stays up until it wins or loses.',
    )
  })

  it('the window reopens after a 7, as the engine says', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'luckyRollerLow', amount: cents(100) })
    })
    app.roll(dice(1, 1))
    app.roll(dice(3, 4)) // seven-out: the pass and the Low Rolls lose
    expect(app.game.getState().view?.shown.bets).toHaveLength(0)
    expect(sideZone(/^Low Rolls/)).not.toHaveAttribute('aria-disabled')
    fireEvent.click(sideZone(/^Low Rolls/))
    expect(app.game.getState().view?.shown.bets[0]?.typeId).toBe('luckyRollerLow')
  })
})

describe('the inspector on a side bet', () => {
  it('shows the progress section: track, words, the machine pay table and the lock status', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'luckyRollerLow', amount: cents(100) })
    })
    let dialog = openOn(/^Low Rolls/)
    expect(within(dialog).getByText('On the table: $1.00')).toBeInTheDocument()
    expect(within(dialog).getByText('· pays 31 for 1')).toBeInTheDocument()
    const section = within(dialog).getByTestId('side-bet-progress')
    expect(within(section).getByTestId('side-bet-words')).toHaveTextContent(
      'None of 2, 3, 4, 5 and 6 rolled yet',
    )
    const row = section.querySelector('[data-pay-row="set"]')
    expect(row).toHaveTextContent('all of 2, 3, 4, 5 and 6')
    expect(row).toHaveTextContent('31 for 1')
    expect(row?.className).toContain('is-next')
    expect(section).toHaveTextContent('Any 7 loses it, a come-out 7 included.')
    expect(within(section).getByTestId('side-bet-status')).toHaveTextContent(
      'Can still be changed or taken down.',
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    app.roll(dice(1, 1))
    dialog = openOn(/^Low Rolls/)
    const locked = within(dialog).getByTestId('side-bet-progress')
    expect(within(locked).getByTestId('side-bet-words')).toHaveTextContent(
      '2 rolled, needs 3, 4, 5 and 6',
    )
    expect(locked.querySelector('.zone-track')).toHaveAttribute('data-lit', '2')
    expect(within(locked).getByTestId('side-bet-status')).toHaveTextContent(
      'Low Rolls is locked once the dice roll — it stays up until it wins or loses.',
    )
    // The stepper is the engine's: nothing can be added to a locked side bet.
    expect(within(dialog).getByRole('button', { name: /^Add to Low Rolls/ })).toBeDisabled()
  })

  it('an empty side-bet spot says whether it is open, from legalBets', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    let dialog = openOn(/^High Rolls/)
    expect(within(dialog).getByText('No bet here yet.')).toBeInTheDocument()
    expect(within(dialog).getByTestId('side-bet-status')).toHaveTextContent('Open to bet now.')
    expect(within(dialog).queryByTestId('side-bet-words')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    app.roll(dice(1, 1))
    dialog = openOn(/^High Rolls/)
    expect(within(dialog).getByTestId('side-bet-status')).toHaveTextContent(
      'High Rolls can only be bet right after a 7 or before the first roll — it opens again after the next 7.',
    )
  })

  it('renders the coach’s side-bet lines verbatim from the worker: stage, next tier, chances', async () => {
    setAnalysisTransportForTests((request) => handleAnalysisRequest(request))
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'luckyRollerLow', amount: cents(100) })
    })
    app.roll(dice(1, 1)) // the 2 is in: the next tier is the whole set
    const shown = app.game.getState().view?.shown
    const bet = shown?.bets.find((b) => b.typeId === 'luckyRollerLow')
    if (shown === undefined || bet === undefined) throw new Error('no Low Rolls on the table')
    // What the analysis worker computes for this very spot, through the same function it runs.
    const math = inspectorMath(
      { typeId: 'luckyRollerLow', number: null },
      bet.amount,
      CRAPLESS,
      shown,
      bet.id,
    )
    expect(math.sideBet).not.toBeNull()
    expect(math.sideBet?.stage).toStrictEqual({
      kind: 'collectSet',
      rolled: [2],
      remaining: [3, 4, 5, 6],
    })
    const ids = math.lines.map((line) => line.id)
    for (const id of ['side-stage', 'side-now', 'side-next', 'side-chances', 'equity']) {
      expect(ids, `line ${id}`).toContain(id)
    }
    const dialog = openOn(/^Low Rolls/)
    // Every coach line on the dialog is the worker's own, character for character.
    for (const line of math.lines) {
      const rendered = line.parts.map((part) => formatPart(part)).join('')
      const element = await within(dialog).findByText(rendered)
      expect(element).toHaveAttribute('data-coach-line', line.id)
    }
    // And the machine facts sit above them, in every mode.
    expect(within(dialog).getByTestId('side-bet-words')).toHaveTextContent(
      '2 rolled, needs 3, 4, 5 and 6',
    )
  })
})

describe('the history with a side bet', () => {
  it('lists the progress each roll makes and what the bet had when it lost', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'luckyRollerLow', amount: cents(100) })
    })
    app.roll(dice(1, 1))
    expect(screen.getByTestId('roll-progress')).toHaveTextContent(
      'Low Rolls: 2 rolled, needs 3, 4, 5 and 6',
    )
    app.roll(dice(2, 2))
    const progress = screen.getAllByTestId('roll-progress')
    expect(progress[0]).toHaveTextContent('Low Rolls: 2 and 4 rolled, needs 3, 5 and 6')
    expect(progress).toHaveLength(2)

    app.roll(dice(3, 4)) // seven-out
    const newest = document.querySelector('.history-newest')
    expect(newest).toHaveTextContent('Low Rolls lost $1.00 — had 2 and 4, needed 3, 5 and 6')
    expect(newest).toHaveTextContent('Pass Line 2 lost $5.00')
  })
})

describe('the other side-bet families', () => {
  it('the Hot Shooter needs its qualifying bet, then counts rolls on the zone', () => {
    const app = renderApp({ cfg: COMPILED_PRESETS.traditionalBubble })
    const strip = screen.getByTestId('reason-strip')
    fireEvent.click(sideZone(/^Hot Shooter Jackpot/))
    expect(strip).toHaveTextContent(
      'Hot Shooter Jackpot needs $3.00 on the main game first — the table is $3.00 short.',
    )
    expect(
      screen.getByRole('button', { name: /^Hot Shooter Jackpot, no bet, needs \$3 in play$/ }),
    ).toBeInTheDocument()

    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    fireEvent.click(sideZone(/^Hot Shooter Jackpot/))
    expect(
      app.game.getState().view?.shown.bets.find((bet) => bet.typeId === 'hotShooter')?.amount,
    ).toBe(100)
    app.roll(dice(2, 2)) // the point is 4: one roll counted
    expect(sideZone(/^Hot Shooter Jackpot/).querySelector('.zone-count')).toHaveTextContent(
      '1 roll',
    )
    app.roll(dice(3, 3))
    expect(sideZone(/^Hot Shooter Jackpot/).querySelector('.zone-count')).toHaveTextContent(
      '2 rolls',
    )
    expect(sideZone(/^Hot Shooter Jackpot/)).toHaveAttribute(
      'aria-label',
      'Hot Shooter Jackpot, $1.00, needs $3 in play, 2 rolls counted',
    )
  })

  it('the Lucky Shooter marks its point and lights its hits', () => {
    const cfg = COMPILED_PRESETS.strictBubble
    const app = renderApp({ cfg })
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      const shown = state.view?.shown
      if (shown === undefined) throw new Error('no table')
      const spot = sideBetSpotsOf(shown, cfg).find((s) => s.typeId === 'luckyShooter')
      if (spot === undefined || spot.canAdd !== null) throw new Error('Lucky Shooter closed')
      state.dispatch({ type: 'place', typeId: 'luckyShooter', amount: spot.minAdd })
    })
    app.roll(dice(3, 3)) // the point is 6
    const onSix = sideZone(/^Lucky Shooter/)
    expect(onSix.querySelector('.pip-point')).toHaveTextContent('6')
    expect(litPips(onSix)).toStrictEqual([])
    expect(onSix.getAttribute('aria-label')).toContain('point 6, 0 hits')
    app.roll(dice(2, 2)) // 4 is a hit
    const oneHit = sideZone(/^Lucky Shooter/)
    expect(litPips(oneHit)).toStrictEqual(['4'])
    expect(oneHit.getAttribute('aria-label')).toContain('point 6, 1 hit (4)')
    const newest = document.querySelector('.history-newest')
    expect(newest).toHaveTextContent('Lucky Shooter: point 6, 1 hit (4)')
  })
})
