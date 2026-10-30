import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hashJson } from '../../src/engine/core/hash.ts'
import { headerConfig } from '../../src/engine/session/replay.ts'
import { parseSessionLog } from '../../src/engine/session/serialize.ts'
import { dispatchBetting, newSession, rollWindow } from '../../src/engine/session/window.ts'
import { nextRollPreview, outcomeOf } from '../../src/ui/state/nextRoll.ts'
import { rollEntryOf } from '../../src/ui/state/rollHistory.ts'
import { FIXTURE_ROLLS } from './recorder.ts'

/**
 * The Next roll panel over the pinned crapless-200 fixture (plan §0 #18 lessons): the log is
 * played again through the real session API, and before each of its 200 rolls the panel predicts
 * every dice outcome from the table as it stands. The roll then draws its dice from the seed, as
 * the fixture did, and the prediction for that pair must be exactly what the roll did — the net
 * the history shows, the credit after, the round event and every bet-level event — on all 200
 * rolls, bets, deposits, presses, vigs and holds included.
 */

const FIXTURE = new URL('./fixtures/crapless-200.json', import.meta.url)

function fixture() {
  const parsed = parseSessionLog(readFileSync(FIXTURE, 'utf8'))
  if (!parsed.ok) throw new Error(`the fixture does not parse: ${JSON.stringify(parsed.error)}`)
  return parsed.log
}

describe('the Next roll panel predicts every roll of the crapless-200 fixture', () => {
  it('matches the net, credit, round event and bet-level events of all 200 rolls', () => {
    const log = fixture()
    const cfg = headerConfig(log.header)
    let session = newSession(cfg, log.header.seed)
    expect(session.header.configHash).toBe(log.header.configHash)

    let checked = 0
    let splitTables = 0
    let decidedRolls = 0
    let totalWays = 0
    for (const [index, record] of log.windows.entries()) {
      for (const action of record.actions) {
        const result = dispatchBetting(session, action, cfg)
        if (!result.ok) throw new Error(`window ${index}: ${result.rejection.code}`)
        session = result.session
      }
      const before = session.state
      const preview = nextRollPreview(session, cfg)
      expect(preview.refused, `window ${index} refused`).toBeNull()
      expect(preview.rows).toHaveLength(11)
      totalWays += preview.rows.reduce((sum, row) => sum + row.ways, 0)
      if (preview.rows.some((row) => row.hardSplit !== undefined)) splitTables += 1

      // The fixture's rolls all draw from the seed (`{ type: 'roll' }`), and so does this one.
      expect(record.roll).toStrictEqual({ type: 'roll' })
      const rolled = rollWindow(session, cfg)
      if (!rolled.ok) throw new Error(`window ${index} roll refused: ${rolled.rejection.code}`)
      expect(rolled.record.hashAfter, `window ${index} hash`).toBe(record.hashAfter)

      const actual = rollEntryOf(before, rolled.events, rolled.session.state)
      const predicted = outcomeOf(preview, actual.dice)
      expect(predicted, `window ${index}: ${actual.dice.d1}-${actual.dice.d2}`).not.toBeNull()
      if (predicted === null) throw new Error('unreachable')
      expect(predicted.net, `window ${index} net`).toBe(actual.net)
      expect(predicted.creditAfter, `window ${index} credit`).toBe(actual.creditAfter)
      expect(predicted.roundEvent, `window ${index} round`).toStrictEqual(actual.roundEvent)
      expect(predicted.endedHand, `window ${index} hand`).toBe(actual.endedHand)
      expect(predicted.items, `window ${index} events`).toStrictEqual(actual.items)
      expect(predicted.bets.reduce((sum, bet) => sum + bet.net, 0)).toBe(actual.net)
      if (actual.items.some((item) => item.type === 'betResolved')) decidedRolls += 1

      checked += 1
      session = rolled.session
    }
    expect(checked).toBe(FIXTURE_ROLLS)
    expect(totalWays).toBe(36 * FIXTURE_ROLLS)
    expect(hashJson(session.state)).toBe(log.finalStateHash)
    // Not vacuous: over half the rolls decided a bet (116 of 200), and some tables carried a hardway.
    expect(decidedRolls).toBeGreaterThan(100)
    expect(splitTables).toBeGreaterThan(0)
  })
})
