import { describe, expect, it } from 'vitest'
import { cents } from '../../engine/index.ts'
import type { Dice } from '../../engine/index.ts'
import type { StoreApi } from 'zustand/vanilla'
import { CRAPLESS, dice } from '../test/game.ts'
import { createGameStore, type GameState } from '../state/gameStore.ts'
import type { SessionMeta } from '../../persistence/sessionRepo.ts'
import { runRoll, type DicePlayRequest, type DiceView } from './rollFlow.ts'

/**
 * The roll flow against fakes that record the order of everything: the engine first, the commit
 * before the animation, the reveal after it, and the hold before betting reopens (plan §6).
 */

const META: SessionMeta = { id: 'flow-test', createdAt: 1, divergent: false }

function playingStore(): StoreApi<GameState> {
  const store = createGameStore()
  store.getState().startGame(CRAPLESS, 'flow-seed', { meta: META })
  const placed = store.getState().dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
  if (!placed.ok) throw new Error('pass bet refused')
  return store
}

interface Recorded {
  readonly log: string[]
  readonly repo: {
    commitRoll: (...args: unknown[]) => Promise<{ ok: true }>
    clearPendingReveal: (...args: unknown[]) => Promise<{ ok: true }>
  }
}

function recordingRepo(): Recorded {
  const log: string[] = []
  return {
    log,
    repo: {
      commitRoll: async () => {
        log.push('commitRoll')
        return { ok: true as const }
      },
      clearPendingReveal: async () => {
        log.push('clearPendingReveal')
        return { ok: true as const }
      },
    },
  }
}

interface FakeDiceView extends DiceView {
  readonly plays: DicePlayRequest[]
  readonly rests: Dice[]
}

function fakeDiceView(
  log: string[],
  options: { mode?: DiceView['mode']; behavior?: 'resolve' | 'reject' | 'hang' } = {},
): FakeDiceView {
  const plays: DicePlayRequest[] = []
  const rests: Dice[] = []
  return {
    mode: options.mode ?? '2d',
    plays,
    rests,
    play: (request, signal) => {
      plays.push(request)
      log.push('play')
      const behavior = options.behavior ?? 'resolve'
      if (behavior === 'resolve') return Promise.resolve()
      if (behavior === 'reject') return Promise.reject(new Error('webgl lost'))
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(new Error('aborted'))
        else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    },
    showRest: (rest) => {
      rests.push(rest)
      log.push('showRest')
    },
  }
}

const instantly = (): Promise<void> => Promise.resolve()

describe('runRoll', () => {
  it('follows the six steps in order: engine, commit, animate, reveal, clear, betting', async () => {
    const store = playingStore()
    const { log, repo } = recordingRepo()
    const diceView = fakeDiceView(log)
    const phases: string[] = []
    store.subscribe((state) => {
      const phase = state.view?.phase
      if (phase !== undefined && phases[phases.length - 1] !== phase) phases.push(phase)
    })

    const run = runRoll({ store, repo, diceView, delay: instantly }, dice(3, 4))
    expect(run.outcome.ok).toBe(true)
    expect(store.getState().view?.phase).toBe('rolling') // the view locked before anything async
    await run.settled

    expect(log).toStrictEqual(['commitRoll', 'play', 'showRest', 'clearPendingReveal'])
    expect(phases).toStrictEqual(['rolling', 'revealing', 'betting'])
    expect(diceView.plays[0]?.dice).toStrictEqual({ d1: 3, d2: 4 })
    expect(diceView.plays[0]?.rollIndex).toBe(0)
    expect(typeof diceView.plays[0]?.physicsSeed).toBe('number')
    expect(diceView.rests).toStrictEqual([{ d1: 3, d2: 4 }])
    expect(store.getState().history.rolls).toHaveLength(1)
  })

  it('SKIP aborts the animation through the signal and jumps to the reveal', async () => {
    const store = playingStore()
    const { log, repo } = recordingRepo()
    const diceView = fakeDiceView(log, { behavior: 'hang' })
    const run = runRoll({ store, repo, diceView, delay: instantly }, dice(1, 1))
    expect(store.getState().view?.phase).toBe('rolling')
    run.skip()
    await run.settled
    expect(store.getState().view?.phase).toBe('betting')
    expect(store.getState().view?.shown.round.phase).toMatchObject({ kind: 'point', point: 2 })
  })

  it('reduced motion means instant: no animation is played at all', async () => {
    const store = playingStore()
    const { log, repo } = recordingRepo()
    const diceView = fakeDiceView(log)
    const run = runRoll(
      { store, repo, diceView, reducedMotion: true, delay: instantly },
      dice(3, 4),
    )
    await run.settled
    expect(diceView.plays).toHaveLength(0)
    expect(log).toStrictEqual(['commitRoll', 'showRest', 'clearPendingReveal'])
  })

  it('an instant dice view plays nothing either', async () => {
    const store = playingStore()
    const { log, repo } = recordingRepo()
    const diceView = fakeDiceView(log, { mode: 'instant' })
    const run = runRoll({ store, repo, diceView, delay: instantly }, dice(3, 4))
    await run.settled
    expect(diceView.plays).toHaveLength(0)
    expect(store.getState().view?.phase).toBe('betting')
  })

  it('a failed animation still reveals: the engine state is the truth', async () => {
    const store = playingStore()
    const { log, repo } = recordingRepo()
    const diceView = fakeDiceView(log, { behavior: 'reject' })
    const run = runRoll({ store, repo, diceView, delay: instantly }, dice(3, 4))
    await run.settled
    expect(store.getState().view?.phase).toBe('betting')
    expect(store.getState().view?.shown.ledger.bankroll).toBe(50_000) // the $5 win reached credit
  })

  it('a refused roll returns the rejection and touches neither storage nor the dice', async () => {
    const store = createGameStore()
    store.getState().startGame(CRAPLESS, 'flow-refused', { meta: META })
    // No bets: the crapless round minimum refuses the roll.
    const { log, repo } = recordingRepo()
    const diceView = fakeDiceView(log)
    const run = runRoll({ store, repo, diceView, delay: instantly })
    expect(run.outcome.ok).toBe(false)
    if (run.outcome.ok) return
    expect(run.outcome.rejection.code).toBe('BELOW_MIN_TOTAL')
    await run.settled
    expect(log).toStrictEqual([])
    expect(store.getState().view?.phase).toBe('betting')
  })

  it('holds the reveal before betting reopens', async () => {
    const store = playingStore()
    const { log, repo } = recordingRepo()
    const diceView = fakeDiceView(log)
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = runRoll({ store, repo, diceView, delay: () => held }, dice(3, 4))
    await Promise.resolve() // let the flow pass the animation
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.getState().view?.phase).toBe('revealing')
    release()
    await run.settled
    expect(store.getState().view?.phase).toBe('betting')
  })
})
