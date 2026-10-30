import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cents } from '../engine/index.ts'
import type { DiceDomeController } from '../dome/domeController.ts'
import { CRAPLESS, dice, placePass, roll, testSession } from './test/game.ts'
import { App } from './App.tsx'
import { renderApp, testStores } from './test/renderApp.tsx'

/**
 * The App's dice wiring (M10 audit CRITICAL-1): the dome holds the last roll whichever mode rolled
 * it, because every reveal — 2D and instant ones too — goes through the dome's `showRest`, and
 * whenever no roll is in flight both views are put on the shown table's last roll (a resume, a
 * switch to 3D) or cleared (a new game). jsdom has no WebGL, so the slot itself shows the 2D
 * fallback; the dome the App built is captured here to read what it holds. The chromium-3d e2e
 * checks the same switches against the drawn dice.
 */

const created: DiceDomeController[] = []

vi.mock('../dome/domeController.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../dome/domeController.ts')>()
  return {
    ...real,
    createDiceDome: (...args: Parameters<typeof real.createDiceDome>) => {
      const dome = real.createDiceDome(...args)
      created.push(dome)
      return dome
    },
  }
})

/** The dome the App rendered, and what it holds in the engine's order ("d1-d2"), or null. */
function domeHolds(): string | null {
  const dome = created.at(-1)
  if (dome === undefined) throw new Error('the App built no dome')
  const { state, faces, d1Body } = dome.store.getState()
  if (state !== 'settled' || faces === null) return null
  return d1Body === 0 ? `${faces[0]}-${faces[1]}` : `${faces[1]}-${faces[0]}`
}

describe('the App’s dice views', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    created.length = 0
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  for (const mode of ['2d', 'instant'] as const) {
    it(`reveals a ${mode} roll through the dome too, so 3D shows it after the switch`, async () => {
      const { game, settings, run } = renderApp()
      act(() => settings.getState().update({ diceMode: mode }))
      expect(domeHolds()).toBeNull()
      run((state) => {
        state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
        state.enqueueDice([dice(5, 3)])
      })
      fireEvent.click(screen.getByRole('button', { name: 'ROLL' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(game.getState().view?.phase).toBe('betting')
      expect(screen.getByTestId('dice-view')).toHaveAttribute('data-dice', '5-3')
      expect(domeHolds()).toBe('5-3')
      // Switching to 3D finds the dome on that roll (and puts it there again).
      act(() => settings.getState().update({ diceMode: '3d' }))
      expect(domeHolds()).toBe('5-3')
      expect(screen.getByTestId('dice-view')).toHaveAttribute('data-dice', '5-3')
    })
  }

  it('3D → 2D → 3D: the 2D roll is the one the dome holds when 3D comes back', async () => {
    const { settings, run } = renderApp()
    act(() => settings.getState().update({ diceMode: '3d' }))
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.enqueueDice([dice(6, 2), dice(6, 5)])
    })
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(domeHolds()).toBe('6-2')
    act(() => settings.getState().update({ diceMode: '2d' }))
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(domeHolds()).toBe('6-5')
    act(() => settings.getState().update({ diceMode: '3d' }))
    expect(domeHolds()).toBe('6-5')
  })

  it('a switch to 3D mid-tumble keeps the shown roll until the reveal, then shows the new one', async () => {
    const { game, settings, run } = renderApp()
    act(() => settings.getState().update({ diceMode: '2d' }))
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.enqueueDice([dice(2, 2), dice(6, 1)])
    })
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(domeHolds()).toBe('2-2')
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }))
    expect(game.getState().view?.phase).toBe('rolling')
    // Mid-tumble the engine already holds 6-1, but the table still shows the 2-2 roll: so does
    // the dome, and nothing reveals the new dice early.
    act(() => settings.getState().update({ diceMode: '3d' }))
    expect(domeHolds()).toBe('2-2')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(game.getState().view?.phase).toBe('betting')
    expect(domeHolds()).toBe('6-1')
  })

  it('mounts the 3D dome only once the boot has settled the dice mode', async () => {
    vi.useRealTimers()
    const stores = testStores()
    expect(stores.settings.getState().diceMode).toBe('3d')
    render(<App stores={stores} />)
    // Before the boot is done the slot shows the 2D dice, and WebGL is not even asked about.
    const dome = created.at(-1)
    expect(dome?.store.getState().webgl).toBe('unknown')
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-mode', '2d')
    await waitFor(() => expect(stores.game.getState().session).not.toBeNull())
    // Then the dome mounts and probes (jsdom has no WebGL, so it stays on its 2D fallback).
    await waitFor(() => expect(dome?.store.getState().webgl).toBe('unavailable'))
  })

  it('a new game clears both views, and a resumed session shows its last roll', () => {
    const { game, run, roll: rollStore } = renderApp()
    run((state) => state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) }))
    rollStore(dice(4, 1))
    expect(domeHolds()).toBe('4-1')
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-dice', '4-1')
    act(() => game.getState().startGame(CRAPLESS, 'a-new-game'))
    expect(domeHolds()).toBeNull()
    expect(created.at(-1)?.store.getState().state).toBe('idle')
    const view = screen.getByTestId('dice-view')
    expect(view).toHaveAttribute('data-state', 'idle')
    expect(view).toHaveAttribute('data-dice', '')
    expect(screen.getByText('Press ROLL to throw')).toBeInTheDocument()
    // A stored session with a roll behind it comes back showing that roll.
    const stored = roll(placePass(testSession('resumed')), [6, 3]).session
    act(() => game.getState().restoreGame({ cfg: CRAPLESS, session: stored, meta: null }))
    expect(domeHolds()).toBe('6-3')
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-dice', '6-3')
  })
})
