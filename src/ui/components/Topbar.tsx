import { cents, formatCents } from '../../engine/index.ts'
import type { Cents } from '../../engine/index.ts'
import { selectShown } from '../state/gameStore.ts'
import type { RollEntry } from '../state/rollHistory.ts'
import { CoachToggle } from './CoachPanel.tsx'
import { useGameState, useUi } from './context.tsx'
import { SessionMeters } from './SessionMeters.tsx'

/**
 * The machine's top bar (plan §6, §0 #28): the cabinet's dark bezel over the felt. The brand
 * lockup with the machine's name; the station's CREDIT, BET and WIN meters, all through
 * `formatCents` and all from the engine — credit is the shown ledger's bankroll, BET the stakes on
 * the table, WIN the winnings the last roll paid (each resolved bet's `winPaid` net of commission,
 * from its `SettlementTrace`); the session meters beside them (CREDIT ADDED, TOTAL WAGERED,
 * RESULT: rules spec §4.6, always on screen while playing); and the bank pills — Add credit (plan
 * §0 #19), New game — with the Coach drawer's toggle at the right end.
 */

export function Topbar() {
  const ui = useUi()
  const shown = useGameState(selectShown)
  const machineName = useGameState((state) => state.cfg?.name ?? null)
  const newest = useGameState((state) => state.history.rolls[0] ?? null)

  const credit = shown?.ledger.bankroll ?? cents(0)
  const onTable = cents(shown?.bets.reduce((sum, bet) => sum + bet.amount, 0) ?? 0)
  const win = newest === null ? cents(0) : lastRollWin(newest)

  return (
    <header className="topbar">
      <div className="brand">
        <h1 className="brand-name">
          Bubble Craps <span className="brand-tag">Trainer</span>
        </h1>
        {machineName !== null && <p className="brand-tag machine-name">{machineName}</p>}
      </div>
      <div className="meters">
        <Meter name="Credit" amount={credit} />
        <Meter name="Bet" amount={onTable} />
        <Meter name="Win" amount={win} up={win > 0} />
      </div>
      <SessionMeters />
      <div className="bank">
        <button
          type="button"
          className={`add-credit${ui.highlight === 'control:add-credit' ? ' guide-target' : ''}`}
          data-target="control:add-credit"
          onClick={() => ui.openDialog('addCredit')}
        >
          + Add credit
        </button>
        <button type="button" className="new-game" onClick={() => ui.openDialog('newGame')}>
          New game
        </button>
        <CoachToggle />
      </div>
    </header>
  )
}

function Meter({ name, amount, up = false }: { name: string; amount: Cents; up?: boolean }) {
  return (
    <p className="meter">
      <span className="meter-name">{name}</span>
      <span
        className={up ? 'meter-amount amount-up' : 'meter-amount'}
        data-testid={`meter-${name.toLowerCase()}`}
      >
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
