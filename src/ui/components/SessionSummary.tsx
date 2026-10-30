import { useEffect, useState } from 'react'
import { formatCoachNumber, formatPart } from '../../coach/format.ts'
import { formatSignedMoney, trendOf } from '../../coach/summary/format.ts'
import type { SessionSummary } from '../../coach/summary/index.ts'
import type { SessionTotals } from '../../coach/summary/meters.ts'
import type { CoachLine, CoachNumber } from '../../coach/types.ts'
import type { SummaryLog } from '../state/gameStore.ts'
import { Dialog } from './Dialog.tsx'
import { SessionMoneyList } from './SessionMeters.tsx'
import { computeSummary } from './SessionSummaryLoader.ts'
import './SessionSummary.css'

/**
 * The session summary screen (plan §5.7, §10 M13): opened from the Summary control under the
 * session strip, and shown once more when New game ends a session. It renders what
 * `coach/summary` computed — the result on the cash and equity bases against everything put in,
 * expected and luck (which add up to that result exactly), the expected loss by bet family, the
 * leaks from same-event choices, and the next session's focus — every number a `CoachNumber`
 * formatted through `coach/format.ts`; this component computes nothing. The summary module loads
 * lazily (it carries the solver) and a long log is accounted in slices, with a progress bar.
 *
 * Above the result, "Credit and wagers" shows the session meters of the same log (rules spec
 * §4.6, from the store with the log): credit added — the summary's own deposits figure, with
 * every deposit listed — the total wagered and the commission paid, each with its definition.
 */

export interface SessionSummaryProps {
  readonly log: SummaryLog
  /** True when New game has just ended this session. */
  readonly ended: boolean
  readonly onClose: () => void
}

type Status =
  | { readonly kind: 'loading'; readonly done: number; readonly total: number }
  | { readonly kind: 'ready'; readonly summary: SessionSummary }
  /** `replay`: the log no longer replays on this engine (`ReplayError`); else anything else. */
  | { readonly kind: 'failed'; readonly replay: boolean }

export function SessionSummaryDialog({ log, ended, onClose }: SessionSummaryProps) {
  const [status, setStatus] = useState<Status>({
    kind: 'loading',
    done: 0,
    total: log.committed.length,
  })

  // One computation per log; the App mounts a new dialog for each summary it opens.
  useEffect(() => {
    const controller = new AbortController()
    computeSummary(log, {
      signal: controller.signal,
      onProgress: (done, total) => {
        if (!controller.signal.aborted) setStatus({ kind: 'loading', done, total })
      },
    }).then(
      (summary) => {
        if (!controller.signal.aborted) setStatus({ kind: 'ready', summary })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const replay = error instanceof Error && error.name === 'ReplayError'
        setStatus({ kind: 'failed', replay })
      },
    )
    return () => controller.abort()
  }, [log])

  return (
    <Dialog titleId="session-summary-title" onClose={onClose} className="summary-dialog">
      <h2 id="session-summary-title" className="dialog-title">
        {ended ? 'Session ended' : 'Session summary'}
      </h2>
      {status.kind === 'loading' && (
        <div className="summary-loading" role="status" data-testid="summary-loading">
          <span>Working out the summary…</span>
          <progress
            max={Math.max(status.total, 1)}
            value={status.done}
            aria-label="Summary progress"
          />
        </div>
      )}
      {status.kind === 'failed' && (
        <p className="dialog-error" role="alert" data-testid="summary-failed">
          {status.replay
            ? 'This session’s log no longer replays on this version of the trainer, so it cannot be summarised.'
            : 'The summary could not be worked out. Close this and try again.'}
        </p>
      )}
      {status.kind === 'ready' && <SummaryBody summary={status.summary} money={log.money} />}
      <div className="dialog-buttons">
        <button type="button" className="btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}

function SummaryBody({ summary, money }: { summary: SessionSummary; money: SessionTotals | null }) {
  return (
    <div className="summary-body" data-testid="session-summary">
      <p className="summary-facts" data-testid="summary-facts">
        {text(summary.facts)}
      </p>

      <section className="summary-section" aria-labelledby="summary-money-title">
        <h3 id="summary-money-title" className="summary-heading">
          Credit and wagers
        </h3>
        {money !== null ? (
          <SessionMoneyList
            totals={money}
            testIdPrefix="summary"
            creditAdded={formatCoachNumber(summary.deposits)}
            creditTestId="summary-deposits"
          />
        ) : (
          <dl className="summary-ledger">
            <Row
              label="Credit added"
              value={formatCoachNumber(summary.deposits)}
              note={summary.depositsNote}
              testId="summary-deposits"
            />
          </dl>
        )}
      </section>

      <section className="summary-section" aria-labelledby="summary-result-title">
        <h3 id="summary-result-title" className="summary-heading">
          Result
        </h3>
        <dl className="summary-ledger">
          <Row
            label="Result"
            value={formatSignedMoney(summary.resultCash)}
            trend={summary.resultCash}
            note={summary.cashNote}
            testId="summary-result-cash"
          />
          <Row
            label="Valued result"
            value={formatSignedMoney(summary.resultEquity)}
            trend={summary.resultEquity}
            note={summary.equityNote}
            testId="summary-result-equity"
            strong
          />
          <Row
            label="Expected"
            value={formatSignedMoney(summary.expected)}
            trend={summary.expected}
            note={summary.expectedNote}
            testId="summary-expected"
            indent
          />
          <Row
            label="Luck"
            value={formatSignedMoney(summary.luck)}
            trend={summary.luck}
            note={summary.luckNote}
            testId="summary-luck"
            indent
          />
        </dl>
      </section>

      <section className="summary-section" aria-labelledby="summary-families-title">
        <h3 id="summary-families-title" className="summary-heading">
          Expected loss by bet family
        </h3>
        {summary.noBets !== null ? (
          <p className="summary-empty">{text(summary.noBets)}</p>
        ) : (
          <ul className="summary-list" data-testid="summary-families">
            {summary.byFamily.map((family) => (
              <li key={family.group} data-family={family.group}>
                {text(family.line)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="summary-section" aria-labelledby="summary-leaks-title">
        <h3 id="summary-leaks-title" className="summary-heading">
          Leaks: same bet, cheaper
        </h3>
        {summary.noLeaks !== null ? (
          <p className="summary-empty" data-testid="summary-no-leaks">
            {text(summary.noLeaks)}
          </p>
        ) : (
          <ul className="summary-list" data-testid="summary-leaks">
            {summary.leaks.map((leak) => (
              <li key={leak.line.id} data-leak={`${leak.from.typeId}>${leak.to.typeId}`}>
                {text(leak.line)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="summary-section" aria-labelledby="summary-focus-title">
        <h3 id="summary-focus-title" className="summary-heading">
          Next session focus
        </h3>
        {summary.noFocus !== null ? (
          <p className="summary-empty">{text(summary.noFocus)}</p>
        ) : (
          <ol className="summary-list summary-focus" data-testid="summary-focus">
            {summary.focus.map((item) => (
              <li key={item.line.id}>{text(item.line)}</li>
            ))}
          </ol>
        )}
      </section>

      {summary.assumedPaths.length > 0 && (
        <p className="coach-assumed" title={summary.assumedPaths.join(', ')}>
          Uses assumed machine values
        </p>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  note,
  testId,
  trend,
  strong = false,
  indent = false,
}: {
  label: string
  value: string
  note: CoachLine
  testId: string
  trend?: CoachNumber
  strong?: boolean
  indent?: boolean
}) {
  const direction = trend === undefined ? undefined : trendOf(trend)
  return (
    <div
      className="summary-row"
      data-strong={strong || undefined}
      data-indent={indent || undefined}
    >
      <dt>{label}</dt>
      <dd>
        <span
          className={
            direction === 'up' ? 'amount-up' : direction === 'down' ? 'amount-down' : undefined
          }
          data-testid={testId}
        >
          {value}
        </span>
        <span className="summary-note">{text(note)}</span>
      </dd>
    </div>
  )
}

/** Template parts as plain text: words verbatim, every number formatted from its `CoachNumber`. */
function text(line: CoachLine): string {
  return line.parts.map((part) => formatPart(part)).join('')
}
