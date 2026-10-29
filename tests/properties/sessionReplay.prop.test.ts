import { describe, expect, it } from 'vitest'
import { PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import { checkSessionRuns, expectReplayMatches, expectSerializes } from '../replay/play.ts'

// Replay and the session log (M5; plan §4.9, §9 item 6 "replay equals live play … JSON
// round-trips"), quick subset on every preset. A seeded random session's log replays to the table
// live play reached, window by window: every window's hash matches its record and its live table,
// and the roll history rebuilt from the log (plan §0 #20) has exactly the events live play gave,
// every betResolved with its SettlementTrace. The session resumes from its log, open window
// included, to an equal session. Its JSON log reads back to an equal session, which writes the same
// JSON.

describe.each(PRESET_IDS)('session logs on %s (quick subset)', (id) => {
  it('replay equals live play, with the state hash checked per window', () => {
    let sessions = 0
    let windows = 0
    const report = checkSessionRuns(
      id,
      30,
      120,
      (played) => {
        expectReplayMatches(played)
        sessions++
        windows += played.windows.length
      },
      { seed: 20261029 },
    )
    expect(sessions).toBe(30)
    expect(windows).toBe(report.rolls)
    expect(windows).toBeGreaterThan(300)
  })

  it('serialize round-trips exactly, open window included', () => {
    let pending = 0
    let deposits = 0
    checkSessionRuns(
      id,
      20,
      120,
      (played) => {
        expectSerializes(played)
        pending += played.session.pending.length
        deposits += played.session.committed
          .flatMap((record) => record.actions)
          .filter((action) => action.type === 'deposit').length
      },
      { seed: 20261030 },
    )
    expect(pending).toBeGreaterThan(10)
    expect(deposits).toBeGreaterThan(10)
  })
})
