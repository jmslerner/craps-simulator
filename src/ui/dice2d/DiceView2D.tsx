import { useStore } from 'zustand'
import { Die } from './Die.tsx'
import type { Dice2DController } from './diceController.ts'

/**
 * The dome slot until M10 (plan §6): two 2D dice driven by the controller's store. The DOM
 * attributes are the plan §7 contract the e2e tests read — `data-mode`, `data-state` and
 * `data-dice` showing the rested faces as "d1-d2". The tumble is CSS (`.dice-rolling`), which
 * `prefers-reduced-motion` turns off; under reduced motion the roll flow never plays it anyway.
 */

export function DiceView2D({
  controller,
  mode,
}: {
  controller: Dice2DController
  mode: 'instant' | '2d'
}) {
  const snapshot = useStore(controller.store)
  const { state, faces } = snapshot
  return (
    <div
      className="dice-view"
      data-testid="dice-view"
      data-mode={mode}
      data-state={state}
      data-dice={state === 'settled' && faces !== null ? `${faces.d1}-${faces.d2}` : ''}
    >
      <div className={state === 'playing' ? 'dice dice-rolling' : 'dice'}>
        {faces === null ? (
          <p className="dice-idle">Press ROLL to throw</p>
        ) : (
          <>
            <Die face={faces.d1} />
            <Die face={faces.d2} />
          </>
        )}
      </div>
    </div>
  )
}
