import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { cents, formatCents } from '../../engine/index.ts'
import type { Cents, MachineConfig, TableState } from '../../engine/index.ts'
import { formatPart } from '../../coach/format.ts'
import { MOMENT_SHOWN_COUNT, coachModeName } from '../../coach/policy.ts'
import { momentLine, momentWantsEquity, noActionLine, recapMath } from '../../coach/recap.ts'
import type { RecapContext, TeachableMoment } from '../../coach/recap.ts'
import type { TemplateParts } from '../../coach/types.ts'
import { Die } from '../dice2d/Die.tsx'
import { progressOf, settledWords } from '../layout/sideBetProgress.ts'
import {
  inspectFor,
  inspectKey,
  requestInspect,
  subscribeAnalysis,
} from '../services/analysisClient.ts'
import { selectHands, selectShown } from '../state/gameStore.ts'
import type {
  BetAtRoll,
  HandGroup,
  ProgressItem,
  RollEntry,
  RollItem,
} from '../state/rollHistory.ts'
import { netWords, roundEventWords, typeLabel } from './copy.ts'
import { useGameState, useSettingsState } from './context.tsx'

/**
 * The roll history (plan §0 #20, §10 M9b): every roll newest first, grouped by hand with per-hand
 * totals and a seven-out or point-made marker; each roll shows its dice as pips (with sr-only
 * words), the total, the round event and every bet the roll decided, with amounts. The newest
 * entry is the post-roll recap (plan §5.5 surface 5): each settled bet carries its payout
 * arithmetic straight from its `SettlementTrace` — stake × ratio = the exact product, what the
 * machine paid, rounding, commission, what reached credit and where the stake went — plus
 * no-action lines for the bets the roll left untouched, and the roll's teachable moments (plan
 * §5.4, each shown for its first `MOMENT_SHOWN_COUNT` occurrences). All wording comes from
 * `coach/content` and every number is a `CoachNumber`; the one solver number, a stuck bet's
 * equity, comes from the analysis worker. The list is a focusable region, so it scrolls from the
 * keyboard, and the cap leaves a trimmed marker.
 *
 * **Coach mode (plan §5.6 Recap row):** the history itself is the player's record (plan §0 #20:
 * every roll, every decided bet with its amount, the net and the credit) and shows in every mode.
 * The coach's additions ride only in Coach mode — the per-bet math, the no-action lines and the
 * lessons; Quiet keeps one line per bet, Off the same lines with no coaching on them.
 *
 * **Side bets (plan §10 M11):** a roll that moves a side bet on lists it ("Low Rolls: 2 and 4
 * rolled, needs 3, 5 and 6", from the engine's `betProgress` event), and a settled side bet says
 * what it had collected or which tier paid, from its trace and the progress it carried into the
 * roll (`settledWords`). These are the player's record, so they show in every mode.
 */

export function RollHistoryPanel() {
  const cfg = useGameState((state) => state.cfg)
  const hands = useGameState(selectHands)
  const trimmed = useGameState((state) => state.history.trimmed)
  const coachMode = useSettingsState((state) => coachModeName(state.coachMode))
  if (cfg === null) return null
  const newestIndex = hands[0]?.rolls[0]?.rollIndex ?? null
  // The recap's coaching (math, no-action lines, lessons) is Coach mode's alone (plan §5.6).
  const coaching = coachMode === 'coach'
  return (
    <section
      className="history"
      aria-label="Roll history"
      tabIndex={0}
      data-testid="roll-history"
      data-coach-mode={coachMode}
    >
      <h2 className="history-title">Roll history</h2>
      {hands.length === 0 && <p className="history-empty">No rolls yet.</p>}
      <ol className="history-hands">
        {hands.map((hand) => (
          <HandView
            key={hand.handIndex}
            hand={hand}
            cfg={cfg}
            newestIndex={newestIndex}
            coaching={coaching}
          />
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
  coaching,
}: {
  hand: HandGroup
  cfg: MachineConfig
  newestIndex: number | null
  coaching: boolean
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
            newest={roll.rollIndex === newestIndex && coaching}
          />
        ))}
      </ol>
    </li>
  )
}

/** `newest` is true only for the newest roll in Coach mode: it alone carries the recap extras. */
function RollView({ roll, cfg, newest }: { roll: RollEntry; cfg: MachineConfig; newest: boolean }) {
  const round = roundEventWords(roll.roundEvent)
  const ctx: RecapContext = { rollIndex: roll.rollIndex, comeOut: roll.comeOut, total: roll.total }
  const recap = newest && (roll.items.length > 0 || roll.noAction.length > 0)
  const listed = roll.items.length > 0 || roll.progress.length > 0 || recap
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
        <span className={roll.total === 7 ? 'roll-total seven' : 'roll-total'}>{roll.total}</span>
        {round !== null && (
          <span className="roll-event" data-event={roll.roundEvent?.type}>
            {round}
          </span>
        )}
        <span
          className={`roll-net${roll.net < 0 ? ' amount-down' : roll.net > 0 ? ' amount-up' : ''}`}
        >
          <span className="sr-only">{netWords(roll.net)}, </span>
          <span aria-hidden="true">{signedCents(roll.net)}</span>
          <span className="roll-credit"> · credit {formatCents(roll.creditAfter)}</span>
        </span>
      </p>
      {listed && (
        <ul className="roll-items">
          {roll.items.map((item, index) => {
            const math = newest ? recapMath(item, ctx, cfg) : null
            return (
              <li key={index} className="roll-item" data-outcome={itemOutcome(item)}>
                {itemWords(item, cfg, roll.betsAtRoll)}
                {math !== null && (
                  <span
                    className="roll-math"
                    data-testid={item.type === 'betResolved' ? 'roll-math' : 'roll-note'}
                  >
                    {' '}
                    {renderParts(math)}
                  </span>
                )}
              </li>
            )
          })}
          {roll.progress.map((item) => (
            <li
              key={`progress-${item.betId}`}
              className="roll-item roll-progress"
              data-outcome="neutral"
              data-testid="roll-progress"
            >
              {progressWords(item, roll.betsAtRoll, cfg)}
            </li>
          ))}
          {newest &&
            roll.noAction.map((bet) => {
              const line = noActionLine(bet, ctx, cfg)
              return (
                <li
                  key={`no-action-${bet.betId}`}
                  className="roll-item roll-no-action"
                  data-testid="roll-no-action"
                  data-coach-line={line.id}
                >
                  {renderParts(line.parts)}
                </li>
              )
            })}
        </ul>
      )}
      {newest && <MomentList key={roll.rollIndex} roll={roll} cfg={cfg} />}
    </li>
  )
}

/**
 * The newest roll's teachable moments (plan §5.4): only those still within their first
 * `MOMENT_SHOWN_COUNT` occurrences. The post-roll table is pinned at mount, so the equity a
 * moment shows is the moment's own, not a later layout's.
 */
function MomentList({ roll, cfg }: { roll: RollEntry; cfg: MachineConfig }) {
  const shown = useGameState(selectShown)
  const [table] = useState(() => shown)
  const visible = roll.moments.filter(
    (moment) => moment.ordinal > 0 && moment.ordinal <= MOMENT_SHOWN_COUNT,
  )
  if (visible.length === 0) return null
  return (
    <ul className="roll-items roll-moments">
      {visible.map((moment) => (
        <MomentView
          key={`${moment.id}-${moment.ordinal}`}
          moment={moment}
          cfg={cfg}
          table={table}
        />
      ))}
    </ul>
  )
}

function MomentView({
  moment,
  cfg,
  table,
}: {
  moment: TeachableMoment
  cfg: MachineConfig
  table: TableState | null
}) {
  const want = useMemo(() => momentWantsEquity(moment), [moment])
  const ready = want !== null && table !== null && table.bets.some((bet) => bet.id === want.betId)
  const key = useMemo(
    () =>
      ready && want !== null && table !== null
        ? inspectKey(cfg, want.spec, want.amount, want.betId, table)
        : null,
    [ready, want, cfg, table],
  )
  useEffect(() => {
    if (ready && want !== null && table !== null) {
      requestInspect(cfg, want.spec, want.amount, table, want.betId)
    }
  }, [ready, want, cfg, table])
  const math = useSyncExternalStore(subscribeAnalysis, () =>
    key === null ? null : inspectFor(key),
  )
  const equity = math?.existing?.equity ?? null
  const line = momentLine(moment, equity, cfg)
  return (
    <li
      className="roll-item coach-moment"
      data-testid="coach-moment"
      data-moment={moment.id}
      data-coach-line={line.id}
    >
      {renderParts(line.parts)}
    </li>
  )
}

/** Template parts as plain text: words verbatim, every number formatted from its `CoachNumber`. */
function renderParts(parts: TemplateParts): string {
  return parts.map((part) => formatPart(part)).join('')
}

/**
 * One decided bet in player words, amounts straight from the event. A side bet adds what it had
 * collected or which tier paid (M11): "Low Rolls lost $1.00 — had 2 and 4, needed 3, 5 and 6".
 */
function itemWords(item: RollItem, cfg: MachineConfig, betsAtRoll: readonly BetAtRoll[]): string {
  switch (item.type) {
    case 'betResolved': {
      const { trace } = item
      const name = traceName(trace, cfg)
      const base =
        trace.outcome === 'win'
          ? `${name} won ${formatCents(trace.winPaid)}`
          : trace.outcome === 'lose'
            ? `${name} lost ${formatCents(trace.stake)}`
            : trace.stakeDisposition === 'returned'
              ? `${name} returned ${formatCents(trace.stake)}`
              : `${name} pushed`
      const side = cfg.sideBets.get(trace.typeId)
      if (side === undefined) return base
      const before = betsAtRoll.find((bet) => bet.betId === trace.betId)?.progress ?? 0
      const detail = settledWords(side, trace, before)
      return detail === null ? base : `${base} — ${detail}`
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

/** A side bet that moved on: its label and where it stands now, from the event's progress (M11). */
function progressWords(
  item: ProgressItem,
  betsAtRoll: readonly BetAtRoll[],
  cfg: MachineConfig,
): string {
  const typeId = betsAtRoll.find((bet) => bet.betId === item.betId)?.typeId ?? null
  const side = typeId === null ? undefined : cfg.sideBets.get(typeId)
  if (side === undefined) return `${typeId === null ? 'Side bet' : typeLabel(cfg, typeId)} moved on`
  return `${side.label}: ${progressOf(side, item.progress).words}`
}

/** How the row is tinted: a settled bet by its outcome, everything else neutral. */
function itemOutcome(item: RollItem): 'win' | 'lose' | 'neutral' {
  if (item.type !== 'betResolved') return 'neutral'
  return item.trace.outcome === 'win' ? 'win' : item.trace.outcome === 'lose' ? 'lose' : 'neutral'
}

function traceName(trace: { typeId: string; number: number | null }, cfg: MachineConfig): string {
  const label = typeLabel(cfg, trace.typeId)
  return trace.number === null ? label : `${label} ${trace.number}`
}

function signedCents(amount: Cents): string {
  return amount > 0 ? `+${formatCents(amount)}` : formatCents(cents(amount))
}
