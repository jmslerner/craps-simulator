import { describe, expect, it } from 'vitest'
import { PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import { checkSessionRuns, expectReplayMatches, expectSerializes } from '../replay/play.ts'

// The full M5 session properties (plan §4.9, §9 item 6): seeded random sessions of up to 200 moves
// through the betting window (tests/replay/play.ts), 1,000 on the default crapless machine (§9
// item 6's floor) and 250 on each other preset — 1,750 in all, plus the quick subsets. M7 set
// these counts from measured wall time (73 ms a crapless session here): 1,000 on every preset
// would cost about 4½ minutes of the 5-minute `test:slow` budget on this 8 GB machine, while the
// other presets' engine-level rules already get 1,000 sessions each in engine.slow.test.ts and
// 2,000 reference-differential sequences each. After every move: undo is exact and never crosses
// a roll, clear goes back to the window's start, a roll commits its window atomically, and
// refused or unchanged actions are not logged; every macro dispatched emits one batch the table
// accepts, and on every 16th table all of them are run and checked. After every session: the log
// replays to live play window by window, hashes, tables and events alike; it resumes to an equal
// session; and its JSON round-trips. The quick subsets are tests/properties/session*.prop.test.ts.

const RUNS: Record<PresetId, number> = {
  craplessBubble: 1_000,
  // The high-limit preset shares craplessBubble's rules: the default machine keeps the deep run.
  craplessBubbleHighLimit: 250,
  traditionalBubble: 250,
  strictBubble: 250,
  traditionalLive345: 250,
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
