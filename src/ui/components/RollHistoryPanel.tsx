import { cents, formatCents } from '../../engine/index.ts'
import type { Cents, MachineConfig, SettlementTrace } from '../../engine/index.ts'
import { Die } from '../dice2d/Die.tsx'
import { selectHands } from '../state/gameStore.ts'
import type { HandGroup, RollEntry, RollItem } from '../state/rollHistory.ts'
import { netWords, roundEventWords, typeLabel } from './copy.ts'
import { useGameState } from './context.tsx'

/**
 * The roll history (plan §0 #20): every roll newest first, grouped by hand with per-hand totals
 * and a seven-out or point-made marker; each roll shows its dice as pips (with sr-only words), the
 * total, the round event and every bet the roll decided, with amounts. The newest entry also shows
 * its payout arithmetic straight from each `SettlementTrace` — stake, the machine's ratio, what
 * was paid, and the commission or breakage when there was any — nothing recomputed. The list is a
 * focusable region, so it scrolls from the keyboard, and the cap leaves a trimmed marker.
 */

export function RollHistoryPanel() {
  const cfg = useGameState((state) => state.cfg)
  const hands = useGameState(selectHands)
  const trimmed = useGameState((state) => state.history.trimmed)
  if (cfg === null) return null
  const newestIndex = hands[0]?.rolls[0]?.rollIndex ?? null
  return (
    <section className="history" aria-label="Roll history" tabIndex={0} data-testid="roll-history">
      <h2 className="history-title">Roll history</h2>
      {hands.length === 0 && <p className="history-empty">No rolls yet.</p>}
      <ol className="history-hands">
        {hands.map((hand) => (
          <HandView key={hand.handIndex} hand={hand} cfg={cfg} newestIndex={newestIndex} />
        ))}
      </ol>
      {trimmed && <p className="history-trimmed">Older rolls were trimmed.</p>}
    </section>
  )
}

function HandView({
  hand,
  cfg,
  newestIndex,
}: {
  hand: HandGroup
  cfg: MachineConfig
  newestIndex: number | null
}) {
  const sevenOut = hand.rolls.some((roll) => roll.endedHand)
  const pointsMade = hand.rolls.filter((roll) => roll.roundEvent?.type === 'pointMade').length
  return (
    <li className="history-hand">
      <p className="hand-head">
        <span className="hand-name">Hand {hand.handIndex + 1}</span>
        <span className="hand-rolls">
          {hand.rollCount} {hand.rollCount === 1 ? 'roll' : 'rolls'}
        </span>
        {sevenOut && <span className="hand-marker hand-seven-out">seven-out</span>}
        {pointsMade > 0 && (
          <span className="hand-marker hand-point-made">
            {pointsMade === 1 ? 'point made' : `${pointsMade} points made`}
          </span>
        )}
        <span
          className={`hand-net${hand.net < 0 ? ' amount-down' : hand.net > 0 ? ' amount-up' : ''}`}
        >
          {signedCents(hand.net)}
        </span>
      </p>
      <ol className="hand-rolls-list">
        {hand.rolls.map((roll) => (
          <RollView
            key={roll.rollIndex}
            roll={roll}
            cfg={cfg}
            newest={roll.rollIndex === newestIndex}
          />
        ))}
      </ol>
    </li>
  )
}

function RollView({ roll, cfg, newest }: { roll: RollEntry; cfg: MachineConfig; newest: boolean }) {
  const round = roundEventWords(roll.roundEvent)
  return (
    <li className={newest ? 'history-roll history-newest' : 'history-roll'}>
      <p className="roll-head">
        <span className="roll-dice">
          <Die face={roll.dice.d1} small />
          <Die face={roll.dice.d2} small />
          <span className="sr-only">
            rolled {roll.dice.d1} and {roll.dice.d2},
          </span>
        </span>
        <span className="roll-total">{roll.total}</span>
        {round !== null && <span className="roll-event">{round}</span>}
        <span className="roll-net">
          <span className="sr-only">{netWords(roll.net)}, </span>
          <span aria-hidden="true">{signedCents(roll.net)}</span>
          <span className="roll-credit"> · credit {formatCents(roll.creditAfter)}</span>
        </span>
      </p>
      {roll.items.length > 0 && (
        <ul className="roll-items">
          {roll.items.map((item, index) => (
            <li key={index} className="roll-item">
              {itemWords(item, cfg)}
              {newest && item.type === 'betResolved' && (
                <span className="roll-math" data-testid="roll-math">
                  {' '}
                  {traceMath(item.trace)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** One decided bet in player words, amounts straight from the event. */
function itemWords(item: RollItem, cfg: MachineConfig): string {
  switch (item.type) {
    case 'betResolved': {
      const { trace } = item
      const name = traceName(trace, cfg)
      if (trace.outcome === 'win') return `${name} won ${formatCents(trace.winPaid)}`
      if (trace.outcome === 'lose') return `${name} lost ${formatCents(trace.stake)}`
      return trace.stakeDisposition === 'returned'
        ? `${name} returned ${formatCents(trace.stake)}`
        : `${name} pushed`
    }
    case 'betTraveled':
      return `${typeLabel(cfg, item.typeId)} moved to ${item.number}`
    case 'vigCharged':
      return `Commission ${formatCents(item.amount)}${item.reason === 'rearm' ? ' re-collected' : ''}`
    case 'vigRefunded':
      return `Commission ${formatCents(item.amount)} refunded`
    case 'betRemoved': {
      const name = typeLabel(cfg, item.typeId)
      if (item.reason === 'vigDeclined') {
        return `${name} taken down: credit could not pay its commission`
      }
      return `${name} ${formatCents(item.amount)} ${
        item.reason === 'withParent' ? 'down with its bet' : 'taken down'
      }`
    }
    case 'workingChanged': {
      if (item.scope === 'global') return item.off === true ? 'Bets set off' : 'Bets set on'
      if (item.by === 'layAutoOn') return 'Machine set the lay working'
      if (item.by === 'afterSevenOut') return 'Machine hold ended'
      return item.working === false ? 'Bet set off' : 'Bet set working'
    }
  }
}

/**
 * The newest roll's payout arithmetic, from the trace alone (plan §0 #20): stake × the machine's
 * ratio = what was paid, then commission and breakage when the trace holds any.
 */
export function traceMath(trace: SettlementTrace): string {
  if (trace.outcome === 'lose') return `(−${formatCents(trace.stake)} stake)`
  if (trace.outcome === 'push') return '(no money moved)'
  const parts = [
    `${formatCents(trace.stake)} × ${trace.ratioLabel} = ${formatCents(trace.winPaid)}`,
  ]
  if (trace.vigOnWin > 0) parts.push(`− ${formatCents(trace.vigOnWin)} vig`)
  if (trace.vigRearm > 0) parts.push(`− ${formatCents(trace.vigRearm)} vig re-collected`)
  if (hasBreakage(trace.breakage)) parts.push(`(machine kept ${trace.breakage}¢)`)
  return `(${parts.join(' ')})`
}

function hasBreakage(breakage: string): boolean {
  return breakage !== '' && breakage !== '0'
}

function traceName(trace: SettlementTrace, cfg: MachineConfig): string {
  const label = typeLabel(cfg, trace.typeId)
  return trace.number === null ? label : `${label} ${trace.number}`
}

function signedCents(amount: Cents): string {
  return amount > 0 ? `+${formatCents(amount)}` : formatCents(cents(amount))
}
