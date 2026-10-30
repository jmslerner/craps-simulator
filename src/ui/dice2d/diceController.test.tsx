import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRoll } from '../../engine/index.ts'
import type { DicePlayRequest } from '../services/rollFlow.ts'
import { DiceView2D } from './DiceView2D.tsx'
import { TUMBLE, createDice2D } from './diceController.ts'

const REQUEST: DicePlayRequest = { dice: makeRoll(3, 4), rollIndex: 0, physicsSeed: 123456789 }

describe('the 2D dice controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tumbles, then rests on the engine’s faces', async () => {
    const controller = createDice2D()
    const view = controller.view('2d')
    const played = view.play(REQUEST, new AbortController().signal)
    expect(controller.store.getState().state).toBe('playing')
    await vi.advanceTimersByTimeAsync(TUMBLE.durationMs)
    await played
    const { state, faces } = controller.store.getState()
    expect(state).toBe('settled')
    expect(faces).toStrictEqual({ d1: 3, d2: 4 })
  })

  it('changes the tumbling faces deterministically from the physics seed', async () => {
    const seen: string[] = []
    const record = (controller: ReturnType<typeof createDice2D>) =>
      controller.store.subscribe((snapshot) => {
        if (snapshot.state === 'playing' && snapshot.faces !== null) {
          seen.push(`${snapshot.faces.d1}-${snapshot.faces.d2}`)
        }
      })
    const first = createDice2D()
    record(first)
    const one = first.view('2d').play(REQUEST, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(TUMBLE.durationMs)
    await one
    const firstRun = [...seen]
    seen.length = 0
    const second = createDice2D()
    record(second)
    const two = second.view('2d').play(REQUEST, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(TUMBLE.durationMs)
    await two
    expect(seen).toStrictEqual(firstRun)
    expect(firstRun.length).toBeGreaterThan(2)
  })

  it('aborts cleanly: SKIP settles at once on the engine’s faces', async () => {
    const controller = createDice2D()
    const abort = new AbortController()
    const played = controller.view('2d').play(REQUEST, abort.signal)
    await vi.advanceTimersByTimeAsync(TUMBLE.frameMs)
    abort.abort()
    await played // resolves without advancing to the full duration
    expect(controller.store.getState()).toStrictEqual({
      state: 'settled',
      faces: { d1: 3, d2: 4 },
    })
    // No timer is left running after the abort.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles immediately on an already-aborted signal', async () => {
    const controller = createDice2D()
    const abort = new AbortController()
    abort.abort()
    await controller.view('2d').play(REQUEST, abort.signal)
    expect(controller.store.getState().state).toBe('settled')
    expect(controller.store.getState().faces).toStrictEqual({ d1: 3, d2: 4 })
  })

  it('showRest snaps to dice at rest for restores and instant mode', () => {
    const controller = createDice2D()
    controller.view('instant').showRest(makeRoll(5, 2))
    expect(controller.store.getState()).toStrictEqual({
      state: 'settled',
      faces: { d1: 5, d2: 2 },
    })
  })
})

describe('DiceView2D', () => {
  it('exposes the plan §7 DOM contract: mode, state and the rested dice', () => {
    const controller = createDice2D()
    controller.view('instant').showRest(makeRoll(1, 1))
    render(<DiceView2D controller={controller} mode="instant" />)
    const view = screen.getByTestId('dice-view')
    expect(view).toHaveAttribute('data-mode', 'instant')
    expect(view).toHaveAttribute('data-state', 'settled')
    expect(view).toHaveAttribute('data-dice', '1-1')
  })

  it('shows an idle prompt before the first roll', () => {
    const controller = createDice2D()
    render(<DiceView2D controller={controller} mode="2d" />)
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-state', 'idle')
    expect(screen.getByText('Press ROLL to throw')).toBeInTheDocument()
  })
})
