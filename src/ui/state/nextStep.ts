import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  EMPTY_COACH_MEMORY,
  dismissAdvice,
  markForFun,
  noteToast,
  retireAdvice,
  type CoachMemory,
} from '../../coach/policy.ts'

/**
 * The next-step provider swap (plan §10 M9c, §13 M8 → M9 hand-off): the guide itself now lives in
 * `src/coach/nextStep.ts` — same `NextStep` contract, wording as `CoachNumber`s, the 7-preview on
 * roll steps — and this module re-exports it so `gameStore.selectNextStep`,
 * `components/nextStepCache.ts` and the bar keep their import. What stays UI-side is the **coach
 * memory**: which ideas the player dismissed (per-idea, plan §0 #18), which advice was toasted or
 * dismissed and which bet types are "for fun" (`coach/policy.ts` gate memory). Memory is advice
 * routing, not game state: it lives for the app run, is never logged, and losing it only means the
 * coach may repeat itself once.
 */

export { GUIDE_CYCLE, SEVEN_DICE, nextStep, sevenPreview } from '../../coach/nextStep.ts'
export type {
  CycleStepId,
  GuideStep,
  NextStep,
  NextStepSettings,
  SevenBetEffect,
  SevenPreview,
} from '../../coach/nextStep.ts'

export interface CoachMemoryState {
  /** The gate's memory (plan §5.6): toasts shown, advice dismissed, bet types silenced. */
  readonly memory: CoachMemory
  /** Guide idea ids the player said no to (plan §0 #18); those ideas never come back. */
  readonly dismissedIdeas: readonly string[]
  dismissIdea(ideaId: string): void
  /** A soft dismissal (a toast's close): `DISMISSALS_TO_BADGE` of them retire the advice. */
  dismissAdvice(adviceId: string): void
  /** "Don't show this advice again": retires it to badge-only at once (plan §5.6; M9 audit). */
  retireAdvice(adviceId: string): void
  markForFun(typeId: string): void
  noteToast(adviceId: string, rollIndex: number): void
  reset(): void
}

export function createCoachMemoryStore(): StoreApi<CoachMemoryState> {
  return createStore<CoachMemoryState>()((set) => ({
    memory: EMPTY_COACH_MEMORY,
    dismissedIdeas: [],
    dismissIdea: (ideaId) =>
      set((state) =>
        state.dismissedIdeas.includes(ideaId)
          ? state
          : { dismissedIdeas: [...state.dismissedIdeas, ideaId] },
      ),
    dismissAdvice: (adviceId) =>
      set((state) => ({ memory: dismissAdvice(state.memory, adviceId) })),
    retireAdvice: (adviceId) => set((state) => ({ memory: retireAdvice(state.memory, adviceId) })),
    markForFun: (typeId) => set((state) => ({ memory: markForFun(state.memory, typeId) })),
    noteToast: (adviceId, rollIndex) =>
      set((state) => ({ memory: noteToast(state.memory, adviceId, rollIndex) })),
    reset: () => set({ memory: EMPTY_COACH_MEMORY, dismissedIdeas: [] }),
  }))
}

/** The app's coach memory, per run; tests build their own store or call `reset`. */
export const coachMemoryStore: StoreApi<CoachMemoryState> = createCoachMemoryStore()

export function useCoachMemory<T>(selector: (state: CoachMemoryState) => T): T {
  return useStore(coachMemoryStore, selector)
}
