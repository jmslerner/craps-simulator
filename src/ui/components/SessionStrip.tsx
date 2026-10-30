import {
  selectSessionResult,
  selectSessionTotals,
  selectShown,
  selectSummaryAvailable,
} from '../state/gameStore.ts'
import { useGameState } from './context.tsx'
import { SessionMoneyList } from './SessionMeters.tsx'

/**
 * The session section (plan §0 #19, rules spec §4.6): rolls this hand and seven-outs, then the
 * session's money in detail — credit added with every deposit, the total wagered with its
 * decisions, the commission paid and the result, each with its one-line definition
 * (`SessionMoneyList`). The result is credit + money on the table − every deposit, so a top-up
 * never shows as a win; every figure comes from the store (the engine's ledger and the session
 * meters) and every amount is shown through `formatCents`. Under it, the Summary control opens the
 * session summary (plan §5.7, M13) while the betting window is open — never mid-roll, so it cannot
 * show a roll before the dice do.
 */

export function SessionStrip({ onSummary }: { onSummary?: () => void } = {}) {
  const shown = useGameState(selectShown)
  const totals = useGameState(selectSessionTotals)
  const result = useGameState(selectSessionResult)
  const canSummarize = useGameState(selectSummaryAvailable)
  if (shown === null) return null
  const { round } = shown
  return (
    <>
      <p className="session-strip" data-testid="session-strip">
        <span>
          Hand roll <strong>{round.hand.rolls + 1}</strong>
        </span>
        <span>
          Seven-outs <strong>{round.hand.index}</strong>
        </span>
      </p>
      {totals !== null && <SessionMoneyList totals={totals} result={result} />}
      {onSummary !== undefined && (
        <button
          type="button"
          className="session-summary-open"
          disabled={!canSummarize}
          onClick={onSummary}
        >
          Session summary
        </button>
      )}
    </>
  )
}
