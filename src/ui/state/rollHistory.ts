import { cents } from '../../engine/index.ts'
import type {
  Cents,
  Dice,
  GameEvent,
  ReplayedWindow,
  TableState,
  Total,
} from '../../engine/index.ts'

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
  /** The roll ended the hand; the next entry starts a new one. */
  readonly endedHand: boolean
  /** The player's net on the roll: the house's net change, sign flipped. */
  readonly net: Cents
  /** The player's credit after the roll. */
  readonly creditAfter: Cents
}

export interface RollHistory {
  /** Newest first. */
  readonly rolls: readonly RollEntry[]
  /** Older rolls were dropped at the cap (or were unavailable on a divergent resume). */
  readonly trimmed: boolean
}

/** How many rolls the kept list holds (plan task: cap with a trimmed marker). */
export const HISTORY_CAP = 300

export function emptyHistory(trimmed = false): RollHistory {
  return { rolls: [], trimmed }
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
 * Every amount comes from the events' traces and the ledgers; nothing is recomputed here.
 */
export function rollEntryOf(
  atRoll: TableState,
  events: readonly GameEvent[],
  after: TableState,
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
    endedHand: events.some((event) => event.type === 'newShooter'),
    net: cents(atRoll.ledger.houseNet - after.ledger.houseNet),
    creditAfter: after.ledger.bankroll,
  }
}

/** The newest roll onto the front of the list, dropping the oldest past the cap. */
export function pushRoll(history: RollHistory, entry: RollEntry, cap = HISTORY_CAP): RollHistory {
  const rolls = [entry, ...history.rolls]
  if (rolls.length <= cap) return { rolls, trimmed: history.trimmed }
  rolls.length = cap
  return { rolls, trimmed: true }
}

/** The history of a resumed session, from `replayHistory(header, committed)` (plan §0 #20). */
export function historyFromWindows(
  windows: readonly ReplayedWindow[],
  cap = HISTORY_CAP,
): RollHistory {
  const kept = windows.length > cap ? windows.slice(windows.length - cap) : windows
  const rolls = kept
    .map((window) => rollEntryOf(window.atRoll, window.rollEvents, window.after))
    .reverse()
  return { rolls, trimmed: windows.length > cap }
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
