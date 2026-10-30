import { createStore, type StoreApi } from 'zustand/vanilla'
import { makeRoll } from '../../engine/index.ts'
import type { Dice } from '../../engine/index.ts'
import type { DicePlayRequest, DiceView } from '../services/rollFlow.ts'

/**
 * The 2D dice view's state and `DiceView` adapter (plan §6; the 3D dome is M10). The engine has
 * already decided the dice before `play` is called: the tumble is cosmetic, its faces drawn from a
 * tiny PRNG seeded by the roll's physics seed — never `Math.random`, so the same roll always
 * tumbles the same way — and the dice always come to rest on the engine's faces. `play` settles
 * (resolves) whatever happens: completion, SKIP (the abort signal) or an already-aborted signal,
 * and the rest pose is set before it resolves, so the reveal never waits on a dangling animation.
 */

export interface Dice2DSnapshot {
  readonly state: 'idle' | 'playing' | 'settled'
  /** What the dice show now: tumbling frames while playing, the rest faces after. */
  readonly faces: Dice | null
}

export interface Dice2DTimings {
  /** How long the tumble runs; SKIP cuts it short. */
  readonly durationMs: number
  /** How often the tumbling faces change. */
  readonly frameMs: number
}

export const TUMBLE: Dice2DTimings = { durationMs: 700, frameMs: 90 }
export const TUMBLE_FAST: Dice2DTimings = { durationMs: 380, frameMs: 70 }

export interface Dice2DController {
  readonly store: StoreApi<Dice2DSnapshot>
  /** The `DiceView` the roll flow drives; `mode` decides whether `play` animates at all. */
  view(mode: 'instant' | '2d', timings?: Dice2DTimings): DiceView
}

export function createDice2D(): Dice2DController {
  const store = createStore<Dice2DSnapshot>()(() => ({
    state: 'idle',
    faces: null,
  }))

  const rest = (dice: Dice): void => {
    store.setState({ state: 'settled', faces: dice })
  }

  const play = (
    request: DicePlayRequest,
    signal: AbortSignal,
    timings: Dice2DTimings,
  ): Promise<void> => {
    if (signal.aborted) {
      rest(request.dice)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const frames = tumbleFrames(request.physicsSeed)
      store.setState({ state: 'playing', faces: frames() })
      const interval = setInterval(() => {
        store.setState({ state: 'playing', faces: frames() })
      }, timings.frameMs)
      let timeout: ReturnType<typeof setTimeout> | null = null
      const settle = (): void => {
        clearInterval(interval)
        if (timeout !== null) clearTimeout(timeout)
        signal.removeEventListener('abort', settle)
        rest(request.dice)
        resolve()
      }
      timeout = setTimeout(settle, timings.durationMs)
      signal.addEventListener('abort', settle)
    })
  }

  return {
    store,
    view: (mode, timings = TUMBLE) => ({
      mode,
      play: (request, signal) => play(request, signal, timings),
      showRest: rest,
    }),
  }
}

/**
 * Deterministic tumble faces from the physics seed: a 32-bit LCG (Numerical Recipes constants),
 * folded to faces 1–6. Animation only — the engine's dice are already decided.
 */
function tumbleFrames(seed: number): () => Dice {
  let state = seed >>> 0
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return ((state >>> 8) % 6) + 1
  }
  return () => makeRoll(next(), next())
}
