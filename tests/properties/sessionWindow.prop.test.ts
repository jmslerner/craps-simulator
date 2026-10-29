import { describe, expect, it } from 'vitest'
import { compileConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import { checkSessionRuns, type MacroKind } from '../replay/play.ts'

// The betting window (M5; plan §4.9, §9 item 6), quick subset: seeded random sessions on every
// preset, checked after every move (tests/replay/play.ts). Undo gives back exactly the table before
// the window's last action (deep equality) and never reaches past a roll: right after every roll it
// refuses. Clear gives back the window's start. An accepted roll commits the window's actions and
// the roll as one record carrying the table's hash; a refused roll changes nothing and the window
// stays open. Refused actions, and accepted ones that change nothing, are never logged. Every
// macro is dispatched too, as one undoable batch.

const KINDS: readonly MacroKind[] = [
  'repeat',
  'double',
  'press',
  'maxOdds',
  'maxOddsOne',
  'takeDownAll',
]

describe.each(PRESET_IDS)('the betting window on %s (quick subset)', (id) => {
  it('undoes exactly, never across a roll, and commits each window with its roll', () => {
    const report = checkSessionRuns(id, 60, 120, () => undefined)
    // The sessions play rather than collect refusals, and reach everything that is checked.
    expect(report.logged).toBeGreaterThan(report.moves / 4)
    expect(report.rolls).toBeGreaterThan(600)
    expect(report.rollBoundaries).toBe(report.rolls)
    expect(report.undone).toBeGreaterThan(50)
    expect(report.cleared).toBeGreaterThan(10)
    expect(report.refused).toBeGreaterThan(100)
    expect(report.unchanged).toBeGreaterThan(3)
    expect(report.deposits).toBeGreaterThan(50)
    for (const kind of KINDS) expect(report.macros.get(kind) ?? 0, kind).toBeGreaterThan(0)
    // Where the round has a minimum, refused rolls happen, and undo still works after them.
    if (compileConfig(PRESETS[id]).limits.minTotal !== null) {
      expect(report.refusedRolls).toBeGreaterThan(50)
      expect(report.undoneAfterRefusedRoll).toBeGreaterThan(20)
    }
  })
})
