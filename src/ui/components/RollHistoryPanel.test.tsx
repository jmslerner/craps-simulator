import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cents } from '../../engine/index.ts'
import { handleAnalysisRequest } from '../../workers/analysisHandler.ts'
import { setAnalysisTransportForTests } from '../services/analysisClient.ts'
import { COMPILED_PRESETS } from '../state/machineStore.ts'
import { dice } from '../test/game.ts'
import { renderApp, type TestApp } from '../test/renderApp.tsx'

/**
 * The post-roll recap in the history panel (plan §5.5 surface 5, §10 M9b): the newest roll's
 * settlement arithmetic from its `SettlementTrace`, the no-action lines for untouched bets, and
 * the teachable moments (plan §5.4) with the one worker-computed number, a stuck bet's equity.
 * The analysis requests run through the real worker handler as the transport, as in the
 * inspector's tests.
 */

describe('the post-roll recap (plan §10 M9b)', () => {
  beforeEach(() => {
    setAnalysisTransportForTests((request) => handleAnalysisRequest(request))
  })

  afterEach(() => {
    setAnalysisTransportForTests(null)
  })

  it('shows "$5 × 7/6 = $5.833… → paid $5.83" for the $5 place 6 win (the §10 M9b acceptance)', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(500) })
    })
    app.roll(dice(3, 3)) // the point lands on 6 and place 6 wins 7:6
    const math = screen.getByTestId('roll-math')
    expect(math).toHaveTextContent('$5 × 7/6 = $5.833… → paid $5.83')
    expect(math).toHaveTextContent('machine kept $0.003…')
    expect(math).toHaveTextContent('+$5.83 to credit, stake stays up')
  })

  it('a pay the machine rounds UP reads "paid extra" and teaches no rounding loss (M9 audit MAJOR-1)', () => {
    // traditionalBubble's place 6/8 round up to the cent: the $1 place 8 wins 116.67¢, paid $1.17.
    const app = renderApp({ cfg: COMPILED_PRESETS.traditionalBubble })
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    app.roll(dice(2, 3)) // the point is 5
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 8, amount: cents(100) })
    })
    app.roll(dice(4, 4))
    const math = screen.getByTestId('roll-math')
    expect(math).toHaveTextContent(
      '($1 × 7/6 = $1.166… → paid $1.17, rounded up — machine paid $0.003… extra, +$1.17 to credit, stake stays up)',
    )
    expect(math.textContent).not.toContain('kept')
    const moments = screen
      .queryAllByTestId('coach-moment')
      .map((m) => m.getAttribute('data-moment'))
    expect(moments).not.toContain('rounding-loss')
  })

  it('setting the point on 2 with a $10 pass teaches the equity drop: ≈ $2.86 (the acceptance)', async () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(1000) })
    })
    app.roll(dice(1, 1)) // the point lands on 2
    const moment = screen.getByTestId('coach-moment')
    expect(moment).toHaveAttribute('data-moment', 'point-outside')
    expect(moment).toHaveTextContent('Lesson: the point is 2')
    // The worth sentence arrives from the analysis worker (fn analyzeExisting): 2000/7 cents.
    await waitFor(() =>
      expect(screen.getByTestId('coach-moment')).toHaveTextContent(
        'Your $10 on the line is worth ≈ $2.86 right now.',
      ),
    )
  })

  it('an off place 6 gets its no-action line when the come-out 7 misses it, plus the lesson', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
      state.dispatch({ type: 'setGlobalWorking', off: true })
    })
    app.roll(dice(3, 4)) // come-out 7: pass wins, the off place 6 is untouched
    expect(screen.getByTestId('roll-no-action')).toHaveTextContent(
      'Place 6 $6.00 was off — the 7 didn’t take it',
    )
    const moments = screen.getAllByTestId('coach-moment')
    expect(moments.some((m) => m.getAttribute('data-moment') === 'place-off-comeout-7')).toBe(true)
  })

  it('a working bet the roll misses reads as no action, and the math shows only on the newest roll', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    app.roll(dice(3, 3)) // place 6 wins: arithmetic shows
    expect(screen.getByTestId('roll-math')).toBeInTheDocument()
    app.roll(dice(2, 3)) // 5: nothing resolves; the win's math is no longer the newest roll's
    expect(screen.queryAllByTestId('roll-math')).toHaveLength(0)
    const noAction = screen.getAllByTestId('roll-no-action').map((el) => el.textContent)
    expect(noAction).toContain('Place 6 $6.00 — no action on the 5')
    expect(noAction).toContain('Pass Line 6 $5.00 — no action on the 5')
  })

  it('each teachable moment appears only for its first 3 occurrences (the §10 M9b acceptance)', () => {
    const app = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(1000) })
    })
    const establishPointTwo = (expected: boolean) => {
      app.roll(dice(1, 1)) // the point lands on 2 (the pass line stays up after each win)
      const moment = screen
        .queryAllByTestId('coach-moment')
        .find((el) => el.getAttribute('data-moment') === 'point-outside')
      expect(moment !== undefined).toBe(expected)
      app.roll(dice(1, 1)) // the point is made at once; back to the come-out
    }
    establishPointTwo(true) // 1st
    establishPointTwo(true) // 2nd
    establishPointTwo(true) // 3rd
    establishPointTwo(false) // 4th: retired
  })

  it('quiet and off keep one line per decided bet and drop the math, no-action lines and lessons (plan §5.6)', () => {
    for (const mode of ['hints', 'off'] as const) {
      const app = renderApp()
      act(() => {
        app.settings.getState().update({ coachMode: mode })
      })
      app.run((state) => {
        state.dispatch({ type: 'place', typeId: 'pass', amount: cents(1000) })
        state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(500) })
        state.dispatch({ type: 'setGlobalWorking', off: true })
      })
      app.roll(dice(1, 1)) // the point lands on 2: a lesson in coach mode; the off place 6 is untouched
      const history = screen.getByTestId('roll-history')
      expect(history).toHaveAttribute('data-coach-mode', mode === 'off' ? 'off' : 'quiet')
      // The player's record (plan §0 #20) stays: the roll, its event, its net and credit.
      expect(history).toHaveTextContent('the point is 2')
      expect(history).toHaveTextContent('credit $485.00')
      expect(screen.queryAllByTestId('coach-moment')).toHaveLength(0)
      expect(screen.queryAllByTestId('roll-no-action')).toHaveLength(0)
      app.run((state) => {
        state.dispatch({ type: 'setGlobalWorking', off: null })
      })
      app.roll(dice(3, 3)) // place 6 wins: one line for the bet, no arithmetic on it
      expect(screen.getByTestId('roll-history')).toHaveTextContent('Place 6 won $5.83')
      expect(screen.queryAllByTestId('roll-math')).toHaveLength(0)
      expect(screen.queryAllByTestId('roll-note')).toHaveLength(0)
      // Back to coach: the newest roll's arithmetic appears without a new roll.
      act(() => {
        app.settings.getState().update({ coachMode: 'full' })
      })
      expect(screen.getByTestId('roll-math')).toHaveTextContent('$5 × 7/6 = $5.833… → paid $5.83')
      app.unmount()
    }
  })

  it('a restored history without recap extras still renders (no moments, no no-action lines)', () => {
    const app: TestApp = renderApp()
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    app.roll(dice(2, 3)) // point 5: an ordinary entry the panel renders in full
    expect(screen.getByTestId('roll-history')).toHaveTextContent('the point is 5')
  })
})
