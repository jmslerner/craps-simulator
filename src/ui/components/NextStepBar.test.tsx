import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cents } from '../../engine/index.ts'
import { coachMemoryStore } from '../state/nextStep.ts'
import { renderApp } from '../test/renderApp.tsx'
import { GO_GUARD_MS } from './NextStepBar.tsx'

/** Lets the click guard expire after a step change (fake timers drive Date.now too). */
function settle(): void {
  act(() => {
    vi.advanceTimersByTime(GO_GUARD_MS + 50)
  })
}

describe('the next-step bar (plan §0 #18, M8 scope)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens on step 1, pointing at the pass line with a one-tap Go', () => {
    const { game } = renderApp()
    const bar = screen.getByTestId('next-step')
    expect(bar).toHaveTextContent('Bet the Pass Line')
    const steps = screen.getAllByRole('listitem')
    expect(steps[0]).toHaveAttribute('aria-current', 'step')
    // The highlight is on the pass line zone.
    expect(screen.getByRole('button', { name: /^Pass Line/ })).toHaveClass('guide-target')
    settle()
    fireEvent.click(screen.getByTestId('guide-go'))
    expect(game.getState().view?.shown.bets[0]?.typeId).toBe('pass')
  })

  it('announces each Go together with the step that follows', () => {
    renderApp()
    settle()
    fireEvent.click(screen.getByTestId('guide-go'))
    expect(screen.getByTestId('announcer')).toHaveTextContent(/Bet the Pass Line: done\. Next:/)
  })

  it('keeps focus on the Go button across the state change it causes', () => {
    const { game } = renderApp()
    settle()
    const go = screen.getByTestId('guide-go')
    go.focus()
    fireEvent.click(go)
    expect(game.getState().view?.shown.bets).toHaveLength(1) // the step moved on
    expect(screen.getByTestId('next-step')).not.toHaveTextContent('Bet the Pass Line')
    expect(document.activeElement).toBe(go) // same element, same position
  })

  it('a Go leaves take-down mode, so the player is back to betting (§0 #18 lessons)', () => {
    const { game } = renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute('aria-pressed', 'true')
    settle()
    fireEvent.click(screen.getByTestId('guide-go'))
    expect(game.getState().view?.shown.bets[0]?.typeId).toBe('pass') // the shortcut still bets
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('ignores a second click inside the guard, so a double tap cannot fire the next step', () => {
    const { game } = renderApp()
    settle()
    const go = screen.getByTestId('guide-go')
    fireEvent.click(go)
    const after = game.getState().view?.shown.bets
    fireEvent.click(go) // within ~350 ms of both the last Go and the step change
    expect(game.getState().view?.shown.bets).toStrictEqual(after)
    settle()
    fireEvent.click(go) // after the guard it acts again
    expect(game.getState().view?.shown.bets).not.toStrictEqual(after)
  })

  it('offers the odds step with the machine cap, and an Alt to just roll', () => {
    const { run, roll } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    roll({ d1: 1, d2: 1 })
    const bar = screen.getByTestId('next-step')
    expect(bar).toHaveTextContent('Add odds behind your Pass Line')
    expect(bar).toHaveTextContent('$10.00') // 2x the $5 flat, from legalBets maxAdd
    settle()
    fireEvent.click(screen.getByTestId('guide-alt')) // "Or just roll" starts the roll
    expect(screen.getByTestId('next-step')).toHaveTextContent('Rolling…')
  })

  it('hides from its own control and hands focus to the guide toggle', () => {
    const { settings } = renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByTestId('next-step')).toBeNull()
    expect(settings.getState().guideEnabled).toBe(false)
    expect(document.activeElement).toBe(document.getElementById('guide-toggle'))
    // No zone is highlighted while the guide is hidden.
    expect(document.querySelector('.guide-target')).toBeNull()
  })
})

describe('per-idea dismissal (plan §0 #18, M9c)', () => {
  beforeEach(() => {
    coachMemoryStore.getState().reset()
  })
  afterEach(() => {
    coachMemoryStore.getState().reset()
  })

  it('"No thanks" dismisses the skip-odds idea by id; the idea never comes back', () => {
    const { run, roll } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    roll({ d1: 1, d2: 1 }) // point 2: the odds step offers "Or just roll"
    const alt = screen.getByTestId('guide-alt')
    expect(alt).toBeEnabled()
    const dismiss = screen.getByTestId('guide-dismiss')
    expect(dismiss).toBeEnabled()
    fireEvent.click(dismiss)
    expect(coachMemoryStore.getState().dismissedIdeas).toStrictEqual(['skip-odds'])
    expect(screen.getByTestId('guide-alt')).toBeDisabled() // the idea is gone, the slot stays put
    expect(screen.getByTestId('guide-dismiss')).toBeDisabled()
    // The main step is unchanged: dismissing an idea never blocks the round.
    expect(screen.getByTestId('next-step')).toHaveTextContent('Add odds behind your Pass Line')
  })

  it('the roll steps state what a 7 would do to every bet on the table (§0 #18)', () => {
    const { run } = renderApp()
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const bar = screen.getByTestId('next-step')
    expect(bar).toHaveTextContent('A seven now: wins you $5.00, takes $6.00 — net -$1.00.')
  })
})
