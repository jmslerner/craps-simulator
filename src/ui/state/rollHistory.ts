import { cents } from '../../engine/index.ts'
import type {
  BetId,
  Cents,
  Dice,
  GameEvent,
  MachineConfig,
  ReplayedWindow,
  TableState,
  Total,
} from '../../engine/index.ts'
import { chasingMoment, detectMoments, detectNoAction, stakesOf } from '../../coach/recap.ts'
import type { NoActionBet, TeachableMoment } from '../../coach/recap.ts'

/**
 * The roll history's data (plan §0 #20), derived from the engine's events and ledgers and never
 * from the UI's own arithmetic. Live rolls append an entry from each `rollWindow` result; a resumed
 * session rebuilds the list from `replayHistory(header, committed)`. The list is kept newest first
 * and capped, with a marker when older rolls were trimmed; `groupByHand` turns it into the
 * hand-grouped view the panel renders.
 */

/** The round's own event on a roll; null when a point-phase roll misses. */
export type RoundEvent = Extract<
  GameEvent,
  { type: 'natural' | 'crapsOut' | 'pointEstablished' | 'pointMade' | 'sevenOut' }
>

/**
 * A bet-level line of a roll (plan §0 #20): a settlement with its full `SettlementTrace`, a travel,
 * commission charged or refunded, a bet the machine took down, or a working switch the machine
 * made. These are the roll's own events, kept as the engine emitted them, in settlement order.
 */
export type RollItem = Extract<
  GameEvent,
  {
    type:
      'betResolved' | 'betTraveled' | 'vigCharged' | 'vigRefunded' | 'betRemoved' | 'workingChanged'
  }
>

/** A side bet's progress event on a roll (M11): the bet moved on without being decided. */
export type ProgressItem = Extract<GameEvent, { type: 'betProgress' }>

/** A bet as it stood when the roll was made (M11): its type and the progress it carried in. */
export interface BetAtRoll {
  readonly betId: BetId
  readonly typeId: string
  readonly progress: number
}

export interface RollEntry {
  /** The roll's 0-based index in the session. */
  readonly rollIndex: number
  readonly dice: Dice
  readonly total: Total
  readonly scripted: boolean
  /** The hand the roll belongs to (a seven-out's roll still counts to the hand it ended). */
  readonly handIndex: number
  readonly roundEvent: RoundEvent | null
  readonly items: readonly RollItem[]
  /** Side bets the roll moved on without deciding (M11), in settlement order. */
  readonly progress: readonly ProgressItem[]
  /**
   * Every bet on the table when the roll was made, with the progress it carried into the roll
   * (M11): what a settled side bet had collected, for the history's words.
   */
  readonly betsAtRoll: readonly BetAtRoll[]
  /** The roll ended the hand; the next entry starts a new one. */
  readonly endedHand: boolean
  /** The player's net on the roll: the house's net change, sign flipped. */
  readonly net: Cents
  /** The player's credit after the roll. */
  readonly creditAfter: Cents
  /** The roll was made on a come-out (M9b recaps word the roll by the table it was made on). */
  readonly comeOut: boolean
  /** Σ bet amounts on the table when the roll was made (the coach's streak comparison). */
  readonly stakes: Cents
  /** Bets the roll left untouched, for the recap's no-action lines; [] when built without a cfg. */
  readonly noAction: readonly NoActionBet[]
  /**
   * Teachable moments the roll triggered (plan §5.4), ordinals assigned by `pushRoll`; [] when
   * built without a cfg (a restored history shows no moments for its stored rolls).
   */
  readonly moments: readonly TeachableMoment[]
}

export interface RollHistory {
  /** Newest first. */
  readonly rolls: readonly RollEntry[]
  /** Older rolls were dropped at the cap (or were unavailable on a divergent resume). */
  readonly trimmed: boolean
  /**
   * How often each teachable moment has occurred this session, by id — counted past the cap, so a
   * trimmed history still retires a moment after its first `MOMENT_SHOWN_COUNT` occurrences.
   */
  readonly seen: Readonly<Record<string, number>>
}

/** How many rolls the kept list holds (plan task: cap with a trimmed marker). */
export const HISTORY_CAP = 300

export function emptyHistory(trimmed = false): RollHistory {
  return { rolls: [], trimmed, seen: {} }
}

const ROUND_EVENTS: ReadonlySet<GameEvent['type']> = new Set([
  'natural',
  'crapsOut',
  'pointEstablished',
  'pointMade',
  'sevenOut',
])

const ITEM_EVENTS: ReadonlySet<GameEvent['type']> = new Set([
  'betResolved',
  'betTraveled',
  'vigCharged',
  'vigRefunded',
  'betRemoved',
  'workingChanged',
])

/**
 * One roll's entry from the tables around it and its events: `atRoll` is the table the roll was
 * made on and `after` the table it left (`rollWindow`'s input and output, or a `ReplayedWindow`).
 * Every amount comes from the events' traces and the ledgers; nothing is recomputed here. With a
 * `cfg` the entry also carries the coach's recap data (M9b): the untouched bets with their working
 * status, and the teachable moments the roll triggered (ordinals assigned by `pushRoll`).
 */
export function rollEntryOf(
  atRoll: TableState,
  events: readonly GameEvent[],
  after: TableState,
  cfg?: MachineConfig,
): RollEntry {
  const rolled = events.find((event) => event.type === 'diceRolled')
  if (rolled === undefined) throw new RangeError('rollEntryOf needs the events of a roll')
  const roundEvent = events.find((event): event is RoundEvent => ROUND_EVENTS.has(event.type))
  const items = events.filter((event): event is RollItem => ITEM_EVENTS.has(event.type))
  return {
    rollIndex: rolled.rollIndex,
    dice: rolled.dice,
    total: rolled.total,
    scripted: rolled.scripted,
    handIndex: atRoll.round.hand.index,
    roundEvent: roundEvent ?? null,
    items,
    progress: events.filter((event): event is ProgressItem => event.type === 'betProgress'),
    betsAtRoll: atRoll.bets.map((bet) => ({
      betId: bet.id,
      typeId: bet.typeId,
      progress: bet.progress,
    })),
    endedHand: events.some((event) => event.type === 'newShooter'),
    net: cents(atRoll.ledger.houseNet - after.ledger.houseNet),
    creditAfter: after.ledger.bankroll,
    comeOut: atRoll.round.phase.kind === 'comeOut',
    stakes: stakesOf(atRoll),
    noAction: cfg === undefined ? [] : detectNoAction(atRoll, events, cfg),
    moments: cfg === undefined ? [] : detectMoments(atRoll, events, cfg),
  }
}

/**
 * The newest roll onto the front of the list, dropping the oldest past the cap. This is also
 * where each teachable moment gets its 1-based session `ordinal` (and where the streak-triggered
 * chasing-losses moment is detected, since it needs the rolls before this one), so live play and
 * a replayed history assign identical ordinals.
 */
export function pushRoll(history: RollHistory, entry: RollEntry, cap = HISTORY_CAP): RollHistory {
  const chasing = chasingMoment(history.rolls, entry.stakes)
  const pending = chasing === null ? entry.moments : [...entry.moments, chasing]
  const seen: Record<string, number> = { ...history.seen }
  const moments = pending.map((moment) => {
    const ordinal = (seen[moment.id] ?? 0) + 1
    seen[moment.id] = ordinal
    return { ...moment, ordinal }
  })
  const rolls = [{ ...entry, moments }, ...history.rolls]
  if (rolls.length <= cap) return { rolls, trimmed: history.trimmed, seen }
  rolls.length = cap
  return { rolls, trimmed: true, seen }
}

/**
 * The history of a resumed session, from `replayHistory(header, committed)` (plan §0 #20), built
 * through `pushRoll` so moment ordinals and the `seen` counts match a live session. Without a
 * `cfg` (the M8 bootstrap call) the stored rolls carry no recap extras.
 */
export function historyFromWindows(
  windows: readonly ReplayedWindow[],
  cap = HISTORY_CAP,
  cfg?: MachineConfig,
): RollHistory {
  let history = emptyHistory()
  for (const window of windows) {
    history = pushRoll(
      history,
      rollEntryOf(window.atRoll, window.rollEvents, window.after, cfg),
      cap,
    )
  }
  return history
}

export interface HandGroup {
  readonly handIndex: number
  /** Newest first, as in the history. */
  readonly rolls: readonly RollEntry[]
  /** The hand's total: the sum of its kept rolls' nets. */
  readonly net: Cents
  /** Rolls kept here; the oldest hand on a trimmed list may be missing earlier rolls. */
  readonly rollCount: number
}

/** The history grouped by hand (plan §0 #20: grouped by `newShooter`), newest hand first. */
export function groupByHand(history: RollHistory): readonly HandGroup[] {
  const groups: HandGroup[] = []
  for (const entry of history.rolls) {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.handIndex === entry.handIndex) {
      groups[groups.length - 1] = {
        ...last,
        rolls: [...last.rolls, entry],
        net: cents(last.net + entry.net),
        rollCount: last.rollCount + 1,
      }
    } else {
      groups.push({ handIndex: entry.handIndex, rolls: [entry], net: entry.net, rollCount: 1 })
    }
  }
  return groups
}
