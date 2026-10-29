import { describe, expect, it } from 'vitest'
import { PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import { checkSessions } from './session.ts'

// legalBets agrees with validateAction (plan §4.6), on the tables random sessions pass through:
// every bet is on exactly one spot; canRemove is what a take-down gets; when canAdd is null, the
// smallest, the largest and a middle addition are accepted and one increment more is not; when it
// is a rejection, that is what the smallest addition gets; a `place` on a spot with a bet agrees
// with pressing it; and every bet change the table accepts lies within what legalBets offered for
// its spot (tests/properties/session.ts, `checkLegal`). Quick subset; the slow suite runs more.

describe.each(PRESET_IDS)('legalBets on %s (quick subset)', (id) => {
  it('agrees with validateAction on every spot of the tables a session passes through', () => {
    const report = checkSessions(id, 16, 120, { legalEvery: 3 })
    expect(report.legalTables).toBeGreaterThan(200)
    expect(report.legalSpots).toBeGreaterThan(8_000)
  })
})
