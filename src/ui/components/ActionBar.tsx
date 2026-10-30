import {
  selectBettingOpen,
  selectCanUndo,
  selectMacros,
  selectWorkingToggle,
} from '../state/gameStore.ts'
import { useGameState, useStores, useUi } from './context.tsx'
import { rejectionText } from './rejectionText.ts'

/**
 * The action bar (plan §6): UNDO, CLEAR, REPEAT, DOUBLE, the machine's Set bets On/Off and ROLL,
 * which reads SKIP while the dice are rolling. Macro buttons are enabled exactly when the engine's
 * macro returns a batch (M5/M6 → M8 hand-off), a blocked REPEAT carries the engine's reason in its
 * tooltip, and the Set bets On/Off mapping is Interblock's, marked assumed (plan §0 #21).
 */

export function ActionBar() {
  const { game } = useStores()
  const ui = useUi()
  const cfg = useGameState((state) => state.cfg)
  const betting = useGameState(selectBettingOpen)
  const canUndo = useGameState(selectCanUndo)
  const macros = useGameState(selectMacros)
  const workingToggle = useGameState(selectWorkingToggle)
  const hasBets = useGameState((state) => (state.view?.shown.bets.length ?? 0) > 0)

  const repeat = macros.repeat[0]
  const double = macros.double[0]
  const blockedWhy =
    macros.repeatBlocked !== null && cfg !== null
      ? rejectionText(macros.repeatBlocked, cfg)
      : undefined

  return (
    <div className="action-bar" role="toolbar" aria-label="Table actions">
      <button
        type="button"
        disabled={!canUndo}
        onClick={() => game.getState().undoLast()}
        title="Take back the last action (U)"
      >
        Undo
      </button>
      <button
        type="button"
        disabled={!canUndo}
        onClick={() => game.getState().clearBets()}
        title="Take back this window's actions (C)"
      >
        Clear
      </button>
      <button
        type="button"
        disabled={repeat === undefined || !betting}
        title={blockedWhy ?? 'Repeat the last window’s bets (Shift+R)'}
        onClick={() =>
          repeat === undefined ? undefined : game.getState().dispatch(repeat, 'control:repeat')
        }
      >
        Repeat
      </button>
      <button
        type="button"
        disabled={double === undefined || !betting}
        title="Double every bet that can double"
        onClick={() =>
          double === undefined ? undefined : game.getState().dispatch(double, 'control:double')
        }
      >
        Double
      </button>
      <button
        type="button"
        disabled={workingToggle === null || !betting || !hasBets}
        title="Interblock mapping, assumed: On returns bets to the machine defaults (O)"
        onClick={() => {
          if (workingToggle === null) return
          const result = game.getState().dispatch(workingToggle.action, 'control:working')
          if (result.ok) {
            ui.announce(workingToggle.showSetOn ? 'Bets set on.' : 'Bets set off.')
          }
        }}
      >
        {workingToggle?.showSetOn === true ? 'Set bets On' : 'Set bets Off'}
      </button>
      <button
        type="button"
        className={`roll-button${ui.highlight === 'control:roll' ? ' guide-target' : ''}`}
        data-target="control:roll"
        onClick={() => ui.roll()}
        title={betting ? 'Roll the dice (Space or R)' : 'Skip the animation'}
      >
        {betting ? 'ROLL' : 'SKIP'}
      </button>
    </div>
  )
}
