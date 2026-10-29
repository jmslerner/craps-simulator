import { describe, expect, it } from 'vitest'
import { PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import { checkSessionRuns, expectReplayMatches, expectSerializes } from '../replay/play.ts'

// The full M5 session properties (plan §4.9, §9 item 6): seeded random sessions of up to 200 moves
// through the betting window (tests/replay/play.ts), 400 on the default crapless machine and 150 on
// each other preset; with the quick subsets, over 1,000 sessions in all. After every move: undo is
// exact and never crosses a roll, clear goes back to the window's start, a roll commits its window
// atomically, and refused or unchanged actions are not logged; every macro dispatched emits one
// batch the table accepts, and on every 16th table all of them are run and checked. After every
// session: the log replays to live play window by window, hashes, tables and events alike; it
// resumes to an equal session; and its JSON round-trips. The quick subsets are
// tests/properties/session*.prop.test.ts.

const RUNS: Record<PresetId, number> = {
  craplessBubble: 400,
  traditionalBubble: 150,
  strictBubble: 150,
  traditionalLive345: 150,
}

describe.each(PRESET_IDS)('session properties on %s (slow)', (id) => {
  it(`hold over ${RUNS[id]} sessions of up to 200 moves`, () => {
    let windows = 0
    const report = checkSessionRuns(
      id,
      RUNS[id],
      200,
      (played) => {
        expectReplayMatches(played)
        expectSerializes(played)
        windows += played.windows.length
      },
      { seed: 20261028, macroEvery: 16 },
    )
    expect(windows).toBe(report.rolls)
    expect(report.rolls).toBeGreaterThan(RUNS[id] * 15)
    expect(report.undone).toBeGreaterThan(RUNS[id])
    expect(report.macroChecks).toBeGreaterThan(RUNS[id] * 20)
    console.log(
      `${id}: ${report.moves} moves, ${report.logged} logged, ${report.refused} refused, ` +
        `${report.undone} undone, ${report.cleared} cleared, ${report.rolls} rolls ` +
        `(${report.refusedRolls} refused), ${report.deposits} deposits; macros dispatched ` +
        `${JSON.stringify(Object.fromEntries(report.macros))}, checked ${report.macroChecks} ` +
        `(${JSON.stringify(Object.fromEntries(report.macroEmitted))} emitting)`,
    )
  }, 240_000)
})
