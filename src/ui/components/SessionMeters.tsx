import { cents, formatCents } from '../../engine/index.ts'
import type { Cents } from '../../engine/index.ts'
import type { SessionTotals, TopUp } from '../../coach/summary/meters.ts'
import { selectSessionResult, selectSessionTotals } from '../state/gameStore.ts'
import { useGameState } from './context.tsx'

/**
 * The session meters (rules spec §4.6; the player asked that a session "keeps track of my total
 * wager and what was added as credit"). `SessionMeters` is the compact, always-visible row —
 * credit added, total wagered and the result — and `SessionMoneyList` the detailed list the session
 * section and the session summary show: each deposit, the decisions behind the total wagered, the
 * commission paid and its parts, each figure with its one-line definition. Every figure comes from
 * the store (`selectSessionTotals`, `selectSessionResult`: the engine's ledger and the meters'
 * fold over the session log) and every amount is shown through `formatCents`; nothing here
 * computes. The figures follow the shown table, so during a roll they still read as before it.
 */

/** The definitions as the player reads them: one short plain line each. */
export const METER_DEFINITIONS = {
  creditAdded: 'Every deposit this session, the buy-in included. A top-up is never a win.',
  wagered:
    'Each bet’s stake every time it is decided, so a bet that stays up counts again. Commission is not included.',
  commission: 'Vig on buy and lay bets — up front, from wins and re-collected — less refunds.',
  result: 'Credit plus the bets still up, less everything put in.',
} as const

const UNAVAILABLE = 'Not available: this session’s log no longer replays on this version.'

/** The compact row: credit added, total wagered and the result, always on screen. */
export function SessionMeters() {
  const totals = useGameState(selectSessionTotals)
  const result = useGameState(selectSessionResult)
  if (totals === null || result === null) return null
  return (
    <section className="session-meters" aria-label="Session totals" data-testid="session-meters">
      <dl className="session-meters-list">
        <div className="session-meter">
          <dt>Credit added</dt>
          <dd data-testid="meters-credit-added">{formatCents(totals.creditAdded)}</dd>
        </div>
        <div className="session-meter">
          <dt>Total wagered</dt>
          <dd data-testid="meters-wagered">
            {totals.wagered === null ? '—' : formatCents(totals.wagered)}
          </dd>
        </div>
        <div className="session-meter">
          <dt>Result</dt>
          <dd data-testid="meters-result" className={trendClass(result)}>
            {signed(result)}
          </dd>
        </div>
      </dl>
    </section>
  )
}

/**
 * The detailed list: credit added with every deposit, the total wagered with its decisions, the
 * commission paid with its parts and, unless `result` is null, the result — each with its
 * definition. `testIdPrefix` names the values for tests (`money-…` in the session section).
 */
export function SessionMoneyList({
  totals,
  result = null,
  testIdPrefix = 'money',
  creditAdded,
  creditTestId,
}: {
  totals: SessionTotals
  result?: Cents | null
  testIdPrefix?: string
  /** The credit-added figure when the caller already shows the same number its own way. */
  creditAdded?: string
  creditTestId?: string
}) {
  const id = (name: string): string => `${testIdPrefix}-${name}`
  return (
    <dl className="session-money" data-testid={id('list')}>
      <div className="session-money-item">
        <dt>Credit added</dt>
        <dd>
          <span className="session-money-value" data-testid={creditTestId ?? id('credit-added')}>
            {creditAdded ?? formatCents(totals.creditAdded)}
          </span>
          <span className="session-money-detail" data-testid={id('deposit-count')}>
            {depositsLine(totals)}
          </span>
          {totals.topUps.length > 0 && (
            <ul className="session-money-deposits" data-testid={id('deposit-list')}>
              {totals.buyIn > 0 && <li>{`Buy-in ${formatCents(totals.buyIn)}`}</li>}
              {totals.topUps.map((topUp, index) => (
                <li key={index}>{topUpLine(topUp)}</li>
              ))}
            </ul>
          )}
          <span className="session-money-note">{METER_DEFINITIONS.creditAdded}</span>
        </dd>
      </div>
      <div className="session-money-item">
        <dt>Total wagered</dt>
        <dd>
          <span className="session-money-value" data-testid={id('wagered')}>
            {totals.wagered === null ? '—' : formatCents(totals.wagered)}
          </span>
          <span className="session-money-detail" data-testid={id('decisions')}>
            {totals.decisions === null ? UNAVAILABLE : counted(totals.decisions, 'decision')}
          </span>
          <span className="session-money-note">{METER_DEFINITIONS.wagered}</span>
        </dd>
      </div>
      <div className="session-money-item">
        <dt>Commission paid</dt>
        <dd>
          <span className="session-money-value" data-testid={id('commission')}>
            {formatCents(totals.commission)}
          </span>
          {totals.commissionParts !== null && totals.commission !== 0 && (
            <span className="session-money-detail" data-testid={id('commission-parts')}>
              {partsLine(totals.commissionParts)}
            </span>
          )}
          <span className="session-money-note">{METER_DEFINITIONS.commission}</span>
        </dd>
      </div>
      {result !== null && (
        <div className="session-money-item">
          <dt>Result</dt>
          <dd>
            <span
              className={`session-money-value${trendClass(result) === undefined ? '' : ` ${trendClass(result)}`}`}
              data-testid={id('result')}
            >
              {signed(result)}
            </span>
            <span className="session-money-note">{METER_DEFINITIONS.result}</span>
          </dd>
        </div>
      )}
    </dl>
  )
}

/** "2 deposits" with the buy-in counted, or "No deposits" for a $0 buy-in and no top-up. */
function depositsLine(totals: SessionTotals): string {
  if (totals.deposits === 0) return 'No deposits'
  if (totals.topUps.length === 0) return `${counted(totals.deposits, 'deposit')}: the buy-in`
  return counted(totals.deposits, 'deposit')
}

/** A top-up and the roll it came before, rolls counted from 1 as the history counts them. */
function topUpLine(topUp: TopUp): string {
  return `${formatCents(topUp.amount)} before roll ${topUp.beforeRoll + 1}`
}

function partsLine(parts: NonNullable<SessionTotals['commissionParts']>): string {
  const named: [string, Cents][] = [
    ['up front', parts.upfront],
    ['from wins', parts.fromWins],
    ['re-collected', parts.recollected],
  ]
  return named
    .filter(([, amount]) => amount !== 0)
    .map(([name, amount]) => `${name} ${formatCents(amount)}`)
    .join(' · ')
}

function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function signed(amount: Cents): string {
  return amount > 0 ? `+${formatCents(amount)}` : formatCents(cents(amount))
}

function trendClass(amount: Cents): 'amount-up' | 'amount-down' | undefined {
  return amount > 0 ? 'amount-up' : amount < 0 ? 'amount-down' : undefined
}
