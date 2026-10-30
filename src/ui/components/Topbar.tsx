import { cents, formatCents } from '../../engine/index.ts'
import type { Cents } from '../../engine/index.ts'
import { selectShown } from '../state/gameStore.ts'
import type { RollEntry } from '../state/rollHistory.ts'
import { useGameState, useSettingsState, useStores, useUi } from './context.tsx'

/**
 * The machine's top bar (plan §6): CREDIT, BET and WIN meters, all through `formatCents` and all
 * from the engine — credit is the shown ledger's bankroll, BET the stakes on the table, WIN the
 * winnings the last roll paid (each resolved bet's `winPaid` net of commission, from its
 * `SettlementTrace`). Beside them: Add credit (plan §0 #19), New game, and the guide toggle the
 * Hide control focuses (plan §0 #18).
 */

export function Topbar() {
  const { settings } = useStores()
  const ui = useUi()
  const shown = useGameState(selectShown)
  const machineName = useGameState((state) => state.cfg?.name ?? null)
  const newest = useGameState((state) => state.history.rolls[0] ?? null)
  const guideEnabled = useSettingsState((state) => state.guideEnabled)

  const credit = shown?.ledger.bankroll ?? cents(0)
  const onTable = cents(shown?.bets.reduce((sum, bet) => sum + bet.amount, 0) ?? 0)
  const win = newest === null ? cents(0) : lastRollWin(newest)

  return (
    <header className="topbar">
      <div className="meters">
        <Meter name="Credit" amount={credit} />
        <Meter name="Bet" amount={onTable} />
        <Meter name="Win" amount={win} />
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className={ui.highlight === 'control:add-credit' ? 'guide-target' : undefined}
          data-target="control:add-credit"
          onClick={() => ui.openDialog('addCredit')}
        >
          + Add credit
        </button>
        <button type="button" onClick={() => ui.openDialog('newGame')}>
          New game
        </button>
        <button
          type="button"
          id="guide-toggle"
          aria-pressed={guideEnabled}
          onClick={() => settings.getState().update({ guideEnabled: !guideEnabled })}
        >
          Guide
        </button>
      </div>
      {machineName !== null && <p className="machine-name">{machineName}</p>}
    </header>
  )
}

function Meter({ name, amount }: { name: string; amount: Cents }) {
  return (
    <p className="meter">
      <span className="meter-name">{name}</span>
      <span className="meter-amount" data-testid={`meter-${name.toLowerCase()}`}>
        {formatCents(amount)}
      </span>
    </p>
  )
}

/** What the machine's WIN meter shows for a roll: the winnings paid, net of commission. */
export function lastRollWin(entry: RollEntry): Cents {
  let total = 0
  for (const item of entry.items) {
    if (item.type !== 'betResolved') continue
    const { trace } = item
    total += trace.winPaid - trace.vigOnWin - trace.vigRearm
  }
  return cents(total)
}
