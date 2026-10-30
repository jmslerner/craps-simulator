import type { StoreApi } from 'zustand/vanilla'
import { deriveSeed32 } from '../../engine/index.ts'
import type { Dice } from '../../engine/index.ts'
import type { SessionRepo } from '../../persistence/sessionRepo.ts'
import type { GameState, RollStart } from '../state/gameStore.ts'

/**
 * The roll flow (plan §6): the six steps from the ROLL press to the next betting window.
 *
 *  1. `store.beginRoll` runs `rollWindow`: the engine state becomes the truth.
 *  2. `repo.commitRoll` stores it with `pendingReveal: true`, BEFORE any animation, so a reload
 *     mid-animation reveals the stored outcome and never re-rolls.
 *  3. The view is already `rolling`, showing the pre-roll table.
 *  4. The dice view plays the throw. SKIP aborts it through the signal and jumps to the reveal;
 *     reduced motion (or an instant dice view) plays nothing. The animation is cosmetic: whatever
 *     it does — finish, abort, fail — the outcome is the engine's.
 *  5. Reveal: the table the roll left is shown, and the stored `pendingReveal` is cleared.
 *  6. After the reveal hold, back to `betting`.
 *
 * The physics seed is derived from the session seed and the roll index (plan §7) and never touches
 * the dice stream.
 */

/** What a dice view is asked to play; the dice are already decided. */
export interface DicePlayRequest {
  readonly dice: Dice
  readonly rollIndex: number
  /** `deriveSeed32(sessionSeed, 'physics', rollIndex, 0)`: animation only, never outcomes. */
  readonly physicsSeed: number
}

/**
 * The dice surface (plan §6): instant, 2D or 3D. `play` animates one throw and resolves when the
 * dice are at rest; it must settle (resolve or reject) when the signal aborts, an already-aborted
 * signal included. `showRest` snaps the view to dice at rest, for skips, restores and instant
 * mode.
 */
export interface DiceView {
  readonly mode: 'instant' | '2d' | '3d'
  play(request: DicePlayRequest, signal: AbortSignal): Promise<void>
  showRest(dice: Dice): void
}

export interface RollFlowDeps {
  readonly store: StoreApi<GameState>
  readonly repo: Pick<SessionRepo, 'commitRoll' | 'clearPendingReveal'>
  readonly diceView: DiceView
  /** Reduced motion means instant: the throw is not animated at all. */
  readonly reducedMotion?: boolean
  /** The reveal hold before betting reopens (plan §6 step 6); default 600 ms. */
  readonly revealHoldMs?: number
  /** Injectable for tests; the default is a real timer. */
  readonly delay?: (ms: number) => Promise<void>
}

export interface RollRun {
  /** Step 1's result, synchronous: the engine's truth, or the refusal (window left open). */
  readonly outcome: RollStart
  /** Resolves when the view is back to `betting` (immediately for a refused roll). */
  readonly settled: Promise<void>
  /** SKIP: aborts the animation; the reveal follows at once. */
  skip(): void
}

export const REVEAL_HOLD_MS = 600

/**
 * The physics seed of roll `rollIndex` (the pre-roll `round.rollIndex`, which `diceRolled`
 * carries): animation only, never outcomes (plan §7). The dome prefetches the next roll's throw
 * with the same function, so the prefetched seed and the played seed always agree.
 */
export function physicsSeedFor(sessionSeed: string, rollIndex: number): number {
  return deriveSeed32(sessionSeed, 'physics', rollIndex, 0)
}

/** The next roll's physics seed while betting is open (for the dome's prefetch), else null. */
export function selectNextPhysicsSeed(state: GameState): number | null {
  const { session, view } = state
  if (session === null || view === null || view.phase !== 'betting') return null
  return physicsSeedFor(session.header.seed, session.state.round.rollIndex)
}

const realDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs one roll. `dice` is for scripted rolls (e2e builds); otherwise the store draws from its
 * queue or the engine's dice stream. Never throws: a refused roll comes back in `outcome`, and
 * storage or animation failures never block the reveal.
 */
export function runRoll(deps: RollFlowDeps, dice?: Dice): RollRun {
  const { store, repo, diceView } = deps
  const delay = deps.delay ?? realDelay
  const holdMs = deps.revealHoldMs ?? REVEAL_HOLD_MS
  const outcome = store.getState().beginRoll(dice)
  if (!outcome.ok) {
    return { outcome, settled: Promise.resolve(), skip: () => undefined }
  }

  const controller = new AbortController()
  const settled = (async () => {
    // Step 2: persist before any animation. The repo never throws; a failed write is the repo's
    // problem to report, not a reason to hide a roll the engine already made.
    const meta = store.getState().meta
    if (meta !== null) await repo.commitRoll(meta, outcome.session, outcome.record)

    // Step 4: the animation, unless motion is reduced, the view is instant, or SKIP already won.
    const animated =
      deps.reducedMotion !== true && diceView.mode !== 'instant' && !controller.signal.aborted
    if (animated) {
      const physicsSeed = physicsSeedFor(outcome.session.header.seed, outcome.rollIndex)
      try {
        await diceView.play(
          { dice: outcome.dice, rollIndex: outcome.rollIndex, physicsSeed },
          controller.signal,
        )
      } catch {
        // Skipped or failed: the reveal follows at once.
      }
    }
    diceView.showRest(outcome.dice)

    // Step 5: reveal, and clear the stored pendingReveal.
    store.getState().reveal()
    if (meta !== null)
      await repo.clearPendingReveal(meta, store.getState().session ?? outcome.session)

    // Step 6: hold, then back to betting.
    await delay(holdMs)
    store.getState().finishReveal()
  })()

  return { outcome, settled, skip: () => controller.abort() }
}
