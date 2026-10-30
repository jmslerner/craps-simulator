import type { BetInstance, CompiledSideBet, LegalBet, MachineConfig } from '../../engine/index.ts'
import {
  countingNote,
  payRows,
  progressOf,
  trackOf,
  type PayRow,
} from '../layout/sideBetProgress.ts'
import { rejectionText } from './rejectionText.ts'
import { pipClass } from './ZoneButton.tsx'

/**
 * The inspector's progress section for a side bet (plan §10 M11): the track with the numbers the
 * bet has collected lit (or the Hot Shooter's roll count), the machine's pay table with the row the
 * bet has reached and the next one marked, the counting rule from the config, and whether the bet
 * can still be changed — the engine's own answer from `legalBets` (`canAdd`, `canRemove`), worded
 * by `rejectionText`, never decided here. These are machine facts and show in every coach mode;
 * the chance of the next tier and the equity are the coach's numbers (`coach/sideBetProgress.ts`,
 * on `InspectorMath.sideBet`) and render below in `InspectorExtras`, gated by the coach mode.
 */
export function SideBetProgress({
  side,
  bet,
  spot,
  cfg,
}: {
  side: CompiledSideBet
  bet: BetInstance | null
  spot: LegalBet | null
  cfg: MachineConfig
}) {
  const progress = progressOf(side, bet?.progress ?? 0)
  const rows = payRows(side, bet?.progress ?? 0)
  const track = trackOf(side)
  const note = countingNote(side)
  const status = statusOf(bet, spot, cfg)
  return (
    <section
      className="inspector-progress"
      aria-label={`${side.label} progress`}
      data-testid="side-bet-progress"
    >
      {track !== null && (
        <span
          className="zone-track progress-track"
          aria-hidden="true"
          data-lit={progress.lit.join(' ')}
        >
          {track.map((n) => (
            <span key={n} className={pipClass(progress.lit.includes(n), progress.point === n)}>
              {n}
            </span>
          ))}
        </span>
      )}
      {bet !== null && (
        <p className="progress-words" data-testid="side-bet-words">
          {capitalize(progress.words)}
        </p>
      )}
      <ul className="pay-table" aria-label={`${side.label} pays`}>
        {rows.map((row) => (
          <li key={row.key} className={rowClass(row)} data-pay-row={row.key}>
            <span className="pay-reach">{row.reach}</span>
            <span className="pay-amount">{row.pays}</span>
          </li>
        ))}
      </ul>
      {note !== null && <p className="inspector-line">{note}</p>}
      {status !== null && (
        <p className="inspector-line" data-testid="side-bet-status">
          {status}
        </p>
      )}
    </section>
  )
}

/** Whether the bet can be placed or changed now, from `legalBets`' answers in the player's words. */
function statusOf(
  bet: BetInstance | null,
  spot: LegalBet | null,
  cfg: MachineConfig,
): string | null {
  if (spot === null) return null
  if (bet === null)
    return spot.canAdd === null ? 'Open to bet now.' : rejectionText(spot.canAdd, cfg)
  if (spot.canRemove === null) return 'Can still be changed or taken down.'
  return rejectionText(spot.canRemove, cfg)
}

function rowClass(row: PayRow): string {
  return ['pay-row', row.reached ? 'is-reached' : '', row.next ? 'is-next' : '']
    .filter((c) => c !== '')
    .join(' ')
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1)
}
