import { useEffect, useRef } from 'react'
import { GUIDE_CYCLE, useCoachMemory } from '../state/nextStep.ts'
import type { GuideStep } from '../state/nextStep.ts'
import { cachedNextStep } from './nextStepCache.ts'
import { useGameState, useSettingsState, useStores, useUi } from './context.tsx'

/**
 * The next-step guide bar (plan §0 #18, M8 scope): the four-step round as a stepper, the one
 * action to take now with a single Go button, at most one Alt, and a Hide control. The Go and Alt
 * buttons never move — they stay mounted in the same spots whatever the step, so keyboard focus
 * survives a re-render — and a Go is ignored within ~350 ms of a step change or another Go, so a
 * double tap cannot fire the next step's action. Every Go is announced in the app's live region
 * together with the step that follows. The content itself comes from `nextStep` (M9 rewrites the
 * wording); the target highlight is drawn by the zones through `ui.highlight`.
 */

export const GO_GUARD_MS = 350

export function NextStepBar() {
  const { game, settings } = useStores()
  const ui = useUi()
  const guideEnabled = useSettingsState((state) => state.guideEnabled)
  const selectedChip = useSettingsState((state) => state.selectedChip)
  const chips = useSettingsState((state) => state.chips)
  const dismissedIdeas = useCoachMemory((state) => state.dismissedIdeas)
  const dismissIdea = useCoachMemory((state) => state.dismissIdea)
  const step = useGameState((state) =>
    cachedNextStep(state, { selectedChip, chips, dismissedIdeas }),
  )

  // A Go within the guard of a step change (or of the previous Go) is ignored: the step under the
  // player's finger may have just changed (plan §0 #18 lessons).
  const stepChangedAt = useRef(0)
  const lastGoAt = useRef(0)
  const lastStepId = useRef<string | null>(null)
  useEffect(() => {
    const id = step?.stepId ?? null
    if (id !== lastStepId.current) {
      lastStepId.current = id
      stepChangedAt.current = Date.now()
    }
  }, [step?.stepId])

  if (!guideEnabled) return null

  const run = (guide: GuideStep | undefined): void => {
    if (guide?.action === undefined) return
    const at = Date.now()
    if (at - stepChangedAt.current < GO_GUARD_MS || at - lastGoAt.current < GO_GUARD_MS) return
    lastGoAt.current = at
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

  // Per-idea dismissal (plan §0 #18): "No thanks" remembers the idea's id, so that idea never
  // comes back; the button stays mounted so Go/Alt/Hide keep their places and focus survives.
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
          className="guide-go"
          data-testid="guide-go"
          disabled={step?.action === undefined}
          onClick={() => run(step ?? undefined)}
        >
          Go
        </button>
        <button
          type="button"
          className="guide-alt"
          data-testid="guide-alt"
          disabled={step?.alt?.action === undefined}
          onClick={() => run(step?.alt)}
        >
          {step?.alt?.title ?? 'More'}
        </button>
        <button type="button" className="guide-hide" onClick={hide}>
          Hide
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
      </div>
    </section>
  )
}
