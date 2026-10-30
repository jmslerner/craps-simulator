import { describe, expect, it } from 'vitest'
import { PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import { checkSessionRuns, type MacroKind } from '../replay/play.ts'

// The macro property (M5; plan §4.9, §9 item 6 "macros emit only valid actions"), quick subset: on
// every preset, every macro runs on every other table a seeded random session passes through, and
// emits nothing or one batch that validateAction accepts on that table and that changes it. Each is
// also checked against what it is for (tests/replay/play.ts, `checkAllMacros`): Repeat is the last
// window's betting actions; Double sets bets to twice their amount; Press adds at most the win, in
// whole units of the bet's increment; maximum odds leaves no odds spot it covers that could take
// more; take down all leaves nothing that could come down.

const KINDS: readonly MacroKind[] = [
  'repeat',
  'double',
  'press',
  'maxOdds',
  'maxOddsOne',
  'takeDownAll',
]

describe.each(PRESET_IDS)('macros on %s (quick subset)', (id) => {
  it('emit only one batch the table accepts, from random reachable tables', () => {
    const report = checkSessionRuns(id, 16, 100, () => undefined, { macroEvery: 2 })
    expect(report.macroChecks).toBeGreaterThan(1_000)
    // Every macro does something on many of those tables, rather than only standing aside.
    for (const kind of KINDS) {
      expect(report.macroEmitted.get(kind) ?? 0, kind).toBeGreaterThan(20)
    }
    // ~1.5 s quiet, but this 8 GB machine has stalled it past the 5 s default under a coverage
    // run; the slow suite's allowance, scaled down (see the Reconciliation row, plan §13).
  }, 30_000)
})
