import { useEffect } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import type { GameState } from '../state/gameStore.ts'
import { GUIDE_CYCLE, useCoachMemory } from '../state/nextStep.ts'
import type { GuideStep, NextStep } from '../state/nextStep.ts'
import { cachedNextStep } from './nextStepCache.ts'
import { useGameState, useSettingsState, useStores, useUi } from './context.tsx'

/**
 * The next-step guide (plan §0 #18, M8 scope; plan §0 #28 placement). It is drawn in two places:
 * the one action to take now — the step's title with its single Go button — rides in the
 * machine's status banner (`GuideLine`), where the station shows its own one-line messages, and
 * the detail — the four-step round as a stepper, the step's words, at most one Alt, "No thanks"
 * and Hide — sits in the Coach drawer (`NextStepBar`, `data-testid="next-step"`). Both read the
 * same step (`cachedNextStep`) and share one click guard: a Go or Alt is ignored within ~350 ms of
 * a step change or of another Go, so a double tap cannot fire the next step's action. The buttons
 * never move — they stay mounted in the same spots whatever the step, so keyboard focus survives a
 * re-render — and every Go is announced in the app's live region together with the step that
 * follows. The content itself comes from `nextStep` (M9); the target highlight is drawn by the
 * zones through `ui.highlight`.
 */

export const GO_GUARD_MS = 350

interface Guard {
  stepChangedAt: number
  lastGoAt: number
  lastStepId: string | null
}

/** One click guard per game store: the banner's Go and the drawer's Alt share it. */
const guards = new WeakMap<StoreApi<GameState>, Guard>()

function guardOf(store: StoreApi<GameState>): Guard {
  const known = guards.get(store)
  if (known !== undefined) return known
  const guard: Guard = { stepChangedAt: 0, lastGoAt: 0, lastStepId: null }
  guards.set(store, guard)
  return guard
}

interface Guide {
  readonly enabled: boolean
  readonly step: NextStep | null
  /** Runs a step's (or its Alt's) action through the guard; announces it with the next step. */
  run(guide: GuideStep | undefined): void
}

function useGuide(): Guide {
  const { game } = useStores()
  const ui = useUi()
  const enabled = useSettingsState((state) => state.guideEnabled)
  const selectedChip = useSettingsState((state) => state.selectedChip)
  const chips = useSettingsState((state) => state.chips)
  const dismissedIdeas = useCoachMemory((state) => state.dismissedIdeas)
  const step = useGameState((state) =>
    cachedNextStep(state, { selectedChip, chips, dismissedIdeas }),
  )

  // A Go within the guard of a step change (or of the previous Go) is ignored: the step under the
  // player's finger may have just changed (plan §0 #18 lessons).
  const id = step?.stepId ?? null
  useEffect(() => {
    const guard = guardOf(game)
    if (id !== guard.lastStepId) {
      guard.lastStepId = id
      guard.stepChangedAt = Date.now()
    }
  }, [game, id])

  const run = (guide: GuideStep | undefined): void => {
    if (guide?.action === undefined) return
    const guard = guardOf(game)
    const at = Date.now()
    if (at - guard.stepChangedAt < GO_GUARD_MS || at - guard.lastGoAt < GO_GUARD_MS) return
    guard.lastGoAt = at
    // A shortcut leaves take-down (or info) mode, back to betting (§0 #18 lessons): the guide's
    // action is a bet or a roll, never a removal, so the mode under the next tap must match.
    if (ui.mode !== 'bet') ui.setMode('bet')
    if (guide.action.type === 'roll') {
      ui.announce(`${guide.title}: rolling.`)
      ui.roll()
      return
    }
    const result = game.getState().dispatch(guide.action, guide.target)
    if (!result.ok) return // The reason strip and the zone shake answer.
    const next = cachedNextStep(game.getState(), { selectedChip, chips, dismissedIdeas })
    ui.announce(`${guide.title}: done.${next === null ? '' : ` Next: ${next.title}.`}`)
  }

  return { enabled, step, run }
}

/**
 * The guide's line in the machine's status banner: the step to take now and its Go. Nothing while
 * the guide is hidden; "Rolling…" while the dice are in the air (the Go stays, disabled).
 */
export function GuideLine() {
  const { enabled, step, run } = useGuide()
  if (!enabled) return null
  return (
    <p className="banner-guide">
      <span className="banner-tag" aria-hidden="true">
        Next step
      </span>
      <span className="banner-step">{step?.title ?? 'Rolling…'}</span>
      <button
        type="button"
        className="guide-go"
        data-testid="guide-go"
        disabled={step?.action === undefined}
        onClick={() => run(step ?? undefined)}
      >
        Go
      </button>
    </p>
  )
}

/** The guide's detail, in the Coach drawer: the stepper, the words, the Alt, No thanks and Hide. */
export function NextStepBar() {
  const { settings } = useStores()
  const ui = useUi()
  const { enabled, step, run } = useGuide()
  const dismissIdea = useCoachMemory((state) => state.dismissIdea)
  if (!enabled) return null

  // Per-idea dismissal (plan §0 #18): "No thanks" remembers the idea's id, so that idea never
  // comes back; the button stays mounted so Alt/Hide keep their places and focus survives.
  const idea = step?.alt?.ideaId
  const dismiss = (): void => {
    if (idea === undefined || step?.alt === undefined) return
    dismissIdea(idea)
    ui.announce(`Dismissed: ${step.alt.title}.`)
  }

  const hide = (): void => {
    settings.getState().update({ guideEnabled: false })
    document.getElementById('guide-toggle')?.focus()
  }

  return (
    <section className="next-step" aria-label="Next step guide" data-testid="next-step">
      <div className="ns-top">
        <span className="ns-badge" aria-hidden="true">
          Next step
        </span>
        <ol className="guide-stepper">
          {GUIDE_CYCLE.map((cycle, index) => (
            <li
              key={cycle.id}
              aria-current={step !== null && index === step.activeStep ? 'step' : undefined}
              className={step !== null && index === step.activeStep ? 'step-active' : undefined}
            >
              <span className="lbl">{cycle.title}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="guide-body">
        <h3 className="guide-title">{step?.title ?? 'Rolling…'}</h3>
        <p className="guide-text">{step?.body ?? 'The dice are in the air.'}</p>
      </div>
      <div className="guide-actions">
        <button
          type="button"
          className="guide-alt"
          data-testid="guide-alt"
          disabled={step?.alt?.action === undefined}
          onClick={() => run(step?.alt)}
        >
          {step?.alt?.title ?? 'More'}
        </button>
        <button
          type="button"
          className="guide-dismiss"
          data-testid="guide-dismiss"
          aria-label="No thanks: dismiss this idea"
          disabled={idea === undefined}
          onClick={dismiss}
        >
          No thanks
        </button>
        <button type="button" className="guide-hide" onClick={hide}>
          Hide
        </button>
      </div>
    </section>
  )
}
