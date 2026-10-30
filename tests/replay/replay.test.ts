import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { configHashOf } from '../../src/engine/config/compile.ts'
import { PRESETS } from '../../src/engine/config/presets/index.ts'
import { hashJson } from '../../src/engine/core/hash.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import type { GameEvent } from '../../src/engine/table/events.ts'
import { ENGINE_VERSION } from '../../src/engine/version.ts'
import { replay, replayHistory } from '../../src/engine/session/replay.ts'
import {
  deserializeSession,
  parseSessionLog,
  serializeSession,
} from '../../src/engine/session/serialize.ts'
import { FIXTURE_ROLLS, FIXTURE_SEED } from './recorder.ts'

/**
 * The pinned replay fixture (plan §10 M5): tests/replay/fixtures/crapless-200.json is a session log
 * of 200 rolls on craplessBubble, dice drawn from its seed, with bets made before every roll and
 * credit added along the way (`recorder.ts`). It must replay, window by window, to the hashes it
 * recorded, and to the final table pinned below.
 *
 * When this fails, the engine now plays the same actions differently. If that was not meant, it is
 * a bug. If it was (a rules or payout fix, a new state field, an event change), follow the
 * ENGINE_VERSION policy in CLAUDE.md: bump ENGINE_VERSION in the same change, re-record with
 * `node tests/replay/record.ts`, and pin the hash and ledger it prints here.
 */

const FIXTURE = new URL('./fixtures/crapless-200.json', import.meta.url)
const RECORDED = {
  engineVersion: 4,
  finalStateHash: '8f1aa84f7baeca3a',
  ledger: { bankroll: 16_270, deposits: 210_000, houseNet: 190_230 },
}

function fixture() {
  const parsed = parseSessionLog(readFileSync(FIXTURE, 'utf8'))
  if (!parsed.ok) throw new Error(`the fixture does not parse: ${JSON.stringify(parsed.error)}`)
  return parsed.log
}

/** Whether an action places or changes a bet (a deposit or the ON/OFF button does not). */
function changesBets(action: Action): boolean {
  return action.type === 'place' || action.type === 'setAmount' || action.type === 'batch'
}

describe('the pinned crapless-200 replay fixture', () => {
  it('is a log of this engine version, on today’s craplessBubble', () => {
    const { header } = fixture()
    expect(
      header.engineVersion,
      'Recorded on another engine version: re-record it with the bump (see the comment above)',
    ).toBe(ENGINE_VERSION)
    expect(header.engineVersion).toBe(RECORDED.engineVersion)
    expect(header.configHash).toBe(configHashOf(PRESETS.craplessBubble))
    expect(header.seed).toBe(FIXTURE_SEED)
  })

  it('has 200 rolls from the seed, bets before every one, and deposits', () => {
    const log = fixture()
    expect(log.windows).toHaveLength(FIXTURE_ROLLS)
    for (const [index, record] of log.windows.entries()) {
      expect(record.actions.some(changesBets), `window ${index} bets`).toBe(true)
      expect(record.roll, `window ${index} rolls from the seed`).toStrictEqual({ type: 'roll' })
    }
    const deposits = log.windows.flatMap((w) => w.actions).filter((a) => a.type === 'deposit')
    expect(deposits.length).toBeGreaterThanOrEqual(5)
  })

  it('replays to its recorded hash, window by window', () => {
    const log = fixture()
    // `replay` checks every window's hashAfter, and throws ReplayError on the first difference.
    const table = replay(log.header, log.windows)
    expect(hashJson(table)).toBe(log.finalStateHash)
    expect(log.finalStateHash).toBe(RECORDED.finalStateHash)
    expect(table.ledger).toMatchObject(RECORDED.ledger)
    expect(table.round.rollIndex).toBe(FIXTURE_ROLLS)
  })

  it('rebuilds the roll history from the log, every cent of every roll accounted for', () => {
    const log = fixture()
    const history = replayHistory(log.header, log.windows)
    expect(history).toHaveLength(FIXTURE_ROLLS)
    let hands = 0
    for (const replayed of history) {
      const { index, atRoll, rollEvents, after } = replayed
      expect(rollEvents[0]).toMatchObject({ type: 'diceRolled', rollIndex: index, scripted: false })
      // The roll's net to the player, from its events alone, is what the house's net says.
      expect(rollNet(rollEvents), `window ${index} net`).toBe(
        atRoll.ledger.houseNet - after.ledger.houseNet,
      )
      // And the credit after it.
      expect(bankrollChange(rollEvents)).toBe(after.ledger.bankroll - atRoll.ledger.bankroll)
      hands += rollEvents.filter((e) => e.type === 'newShooter').length
    }
    expect(hands).toBe(history.at(-1)?.after.round.hand.index)
    const resolved = history.flatMap((w) => w.rollEvents).filter((e) => e.type === 'betResolved')
    expect(resolved.length).toBeGreaterThan(200)
  })

  it('round-trips through the session log', () => {
    const text = readFileSync(FIXTURE, 'utf8')
    const loaded = deserializeSession(text)
    if (!loaded.ok) throw new Error(`the fixture does not load: ${JSON.stringify(loaded.error)}`)
    expect(JSON.parse(serializeSession(loaded.session))).toStrictEqual(JSON.parse(text))
  })
})

/** The player's gain on a roll (credit plus bets), from its events. */
function rollNet(events: readonly GameEvent[]): number {
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

/** The change in the player's credit on a roll, from its events. */
function bankrollChange(events: readonly GameEvent[]): number {
  let change = 0
  for (const event of events) {
    if (event.type === 'betResolved') change += event.trace.credited
    else if (event.type === 'vigCharged' && event.from !== 'win') change -= event.amount
    else if (event.type === 'vigRefunded' || event.type === 'betRemoved') change += event.amount
  }
  return change
}
