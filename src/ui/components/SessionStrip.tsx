import { cents, formatCents } from '../../engine/index.ts'
import { selectShown } from '../state/gameStore.ts'
import { useGameState } from './context.tsx'

/**
 * The session strip (plan §0 #19): rolls this hand, seven-outs, what was bought in and the result.
 * The result is credit + money on the table − total deposits, so a top-up never shows as a win;
 * every number comes from the engine's round and ledger, summed in cents and shown through
 * `formatCents`.
 */

export function SessionStrip() {
  const shown = useGameState(selectShown)
  if (shown === null) return null
  const { ledger, round } = shown
  const onTable = shown.bets.reduce((sum, bet) => sum + bet.amount, 0)
  const result = cents(ledger.bankroll + onTable - ledger.deposits)
  return (
    <p className="session-strip" data-testid="session-strip">
      <span>
        Hand roll <strong>{round.hand.rolls + 1}</strong>
      </span>
      <span>
        Seven-outs <strong>{round.hand.index}</strong>
      </span>
      <span>
        In <strong>{formatCents(ledger.deposits)}</strong>
      </span>
      <span>
        Result{' '}
        <strong className={result < 0 ? 'amount-down' : result > 0 ? 'amount-up' : undefined}>
          {result > 0 ? `+${formatCents(result)}` : formatCents(result)}
        </strong>
      </span>
    </p>
  )
}
