import { selectBettingOpen, selectCanUndo, selectWorkingToggle } from '../state/gameStore.ts'
import { useGameState, useStores, useUi } from './context.tsx'

/**
 * The rest of the station's controls (plan §6, §0 #28), as machine chrome beside ROLL: the INFO and
 * REMOVE tap modes, Clear bets (this window's actions taken back, key C), the machine's Set bets
 * On/Off — Interblock's mapping, marked assumed (plan §0 #21) — and ROLL, which reads SKIP while
 * the dice are rolling. On phones the four switches share the row beside ROLL, each label on up to
 * two lines, so none hides behind it. The row itself keeps a tab stop (M14: it scrolled sideways
 * on phones before the design polish), so while every control in it is disabled the keyboard can
 * still reach it.
 */

export function ActionBar() {
  const { game } = useStores()
  const ui = useUi()
  const betting = useGameState(selectBettingOpen)
  const canUndo = useGameState(selectCanUndo)
  const workingToggle = useGameState(selectWorkingToggle)
  const hasBets = useGameState((state) => (state.view?.shown.bets.length ?? 0) > 0)

  return (
    <div className="action-bar" role="toolbar" aria-label="Table actions">
      <div className="action-macros" role="group" aria-label="Modes and switches" tabIndex={0}>
        <button
          type="button"
          className="chrome-pill chrome-small"
          aria-pressed={ui.mode === 'info'}
          onClick={() => ui.setMode(ui.mode === 'info' ? 'bet' : 'info')}
          title="Tap a zone to inspect it (I)"
        >
          Info
        </button>
        <button
          type="button"
          className="chrome-pill chrome-small"
          aria-pressed={ui.mode === 'remove'}
          onClick={() => ui.setMode(ui.mode === 'remove' ? 'bet' : 'remove')}
          title="Tap a bet to take it down (X)"
        >
          Remove
        </button>
        <button
          type="button"
          className="chrome-pill chrome-small"
          disabled={!canUndo}
          onClick={() => game.getState().clearBets()}
          title="Take back this window's actions (C)"
        >
          Clear bets
        </button>
        <button
          type="button"
          className="chrome-pill chrome-small"
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
      </div>
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
