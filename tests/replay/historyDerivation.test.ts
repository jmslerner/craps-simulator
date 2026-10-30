import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { GameEvent } from '../../src/engine/table/events.ts'
import { replayHistory } from '../../src/engine/session/replay.ts'
import { parseSessionLog } from '../../src/engine/session/serialize.ts'
import {
  emptyHistory,
  groupByHand,
  historyFromWindows,
  pushRoll,
  rollEntryOf,
  type RollHistory,
} from '../../src/ui/state/rollHistory.ts'

/**
 * The roll-history derivation (plan §0 #20) against the pinned crapless-200 fixture, through
 * `replayHistory`: every roll's net and credit, derived for the panel, must reconcile with the
 * fixture's ledger — the net from the events alone equals the ledger's own movement on every one
 * of the 200 rolls, and the whole session's nets add up to the final house net.
 */

const FIXTURE = new URL('./fixtures/crapless-200.json', import.meta.url)

function fixtureWindows() {
  const parsed = parseSessionLog(readFileSync(FIXTURE, 'utf8'))
  if (!parsed.ok) throw new Error(`the fixture does not parse: ${JSON.stringify(parsed.error)}`)
  return replayHistory(parsed.log.header, parsed.log.windows)
}

/** The player's gain on a roll from its bet-level events alone, independent of any ledger. */
function netFromEvents(events: readonly GameEvent[]): number {
  let net = 0
  for (const event of events) {
    if (event.type === 'betResolved') {
      const { trace } = event
      net += trace.credited - (trace.stakeDisposition === 'stays' ? 0 : trace.stake)
    } else if (event.type === 'vigCharged' && event.from !== 'win') {
      net -= event.amount
    } else if (event.type === 'vigRefunded') {
      net += event.amount
    }
  }
  return net
}

describe('the crapless-200 roll history reconciliation (plan §0 #20)', () => {
  const windows = fixtureWindows()
  const history = historyFromWindows(windows, windows.length)

  it('derives every roll of the fixture, newest first', () => {
    expect(windows).toHaveLength(200)
    expect(history.rolls).toHaveLength(200)
    expect(history.trimmed).toBe(false)
    expect(history.rolls.map((entry) => entry.rollIndex)).toStrictEqual(
      windows.map((replayed) => replayed.index).reverse(),
    )
  })

  it('reconciles every roll: the events-only net equals the ledger movement, to the cent', () => {
    for (const [index, replayed] of windows.entries()) {
      const entry = history.rolls[windows.length - 1 - index]
      if (entry === undefined) throw new Error(`entry ${index} missing`)
      expect(entry.net, `roll ${index} net`).toBe(
        replayed.atRoll.ledger.houseNet - replayed.after.ledger.houseNet,
      )
      expect(entry.net, `roll ${index} net from events`).toBe(netFromEvents(replayed.rollEvents))
      expect(entry.creditAfter, `roll ${index} credit`).toBe(replayed.after.ledger.bankroll)
    }
  })

  it('reconciles the whole session with the fixture ledger', () => {
    const final = windows[windows.length - 1]
    if (final === undefined) throw new Error('no final window')
    // The newest entry's credit is the fixture's final bankroll.
    expect(history.rolls[0]?.creditAfter).toBe(final.after.ledger.bankroll)
    // Rolls and betting windows together account for the final house net exactly.
    const rollNets = history.rolls.reduce((sum, entry) => sum + entry.net, 0)
    const bettingVig = windows.reduce(
      (sum, replayed) => sum + (replayed.atRoll.ledger.houseNet - replayed.start.ledger.houseNet),
      0,
    )
    expect(bettingVig - rollNets).toBe(final.after.ledger.houseNet)
  })

  it('groups the fixture by hand, nets adding up across the groups', () => {
    const hands = groupByHand(history)
    const final = windows[windows.length - 1]
    const lastEntry = history.rolls[0]
    if (final === undefined || lastEntry === undefined) throw new Error('no final window')
    // Hands are contiguous, newest first, one group per hand index that rolled.
    expect(hands[0]?.handIndex).toBe(lastEntry.handIndex)
    expect(hands[hands.length - 1]?.handIndex).toBe(0)
    const sevenOuts = history.rolls.filter((entry) => entry.endedHand).length
    expect(hands).toHaveLength(lastEntry.endedHand ? sevenOuts : sevenOuts + 1)
    expect(hands.reduce((sum, hand) => sum + hand.rolls.length, 0)).toBe(200)
    expect(hands.reduce((sum, hand) => sum + hand.net, 0)).toBe(
      history.rolls.reduce((sum, entry) => sum + entry.net, 0),
    )
    for (const hand of hands) {
      expect(hand.net, `hand ${hand.handIndex}`).toBe(
        hand.rolls.reduce((sum, entry) => sum + entry.net, 0),
      )
    }
  })

  it('live pushes build the same history as the resume derivation', () => {
    let live: RollHistory = emptyHistory()
    for (const replayed of windows) {
      live = pushRoll(live, rollEntryOf(replayed.atRoll, replayed.rollEvents, replayed.after), 300)
    }
    expect(live).toStrictEqual(historyFromWindows(windows, 300))
  })

  it('caps the kept list with a trimmed marker', () => {
    const capped = historyFromWindows(windows, 50)
    expect(capped.trimmed).toBe(true)
    expect(capped.rolls).toHaveLength(50)
    expect(capped.rolls).toStrictEqual(history.rolls.slice(0, 50))
  })
})
