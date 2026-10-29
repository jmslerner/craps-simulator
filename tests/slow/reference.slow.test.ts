import { describe, expect, it } from 'vitest'
import { compileConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import { describeCoverage } from '../properties/actions.ts'
import { describeMismatch, expectExercised, runDifferential } from '../properties/differential.ts'

// The full reference differential (plan §9 item 2, §0 #17; M4d acceptance): 2,000 seeded
// sequences of 100 actions per machine through the engine and the reference table, compared after
// every action (tests/properties/differential.ts). The bar is 0 mismatches. The quick subset is
// tests/oracle/reference.diff.test.ts.

describe.each(PRESET_IDS)('the reference differential on %s (slow)', (id) => {
  it('finds no mismatch in 2,000 sequences of 100 actions, and exercises every bet', () => {
    const report = runDifferential(id, 2_000, 100)
    expect(report.mismatches.slice(0, 3).map(describeMismatch)).toEqual([])
    expect(report.actions).toBe(200_000)
    expectExercised(report, compileConfig(PRESETS[id]))
    const { placed, settled, decisions, machine } = describeCoverage(report.coverage)
    console.log(
      `${id}: ${report.actions} actions, ${report.accepted} accepted by both, ${report.refused} ` +
        `refused by both (${report.sameCode} with the same code); codes that differ: ` +
        `${JSON.stringify(Object.fromEntries(report.codePairs))}\n` +
        `  placed ${JSON.stringify(placed)}\n  settled ${JSON.stringify(settled)}\n` +
        `  decisions ${JSON.stringify(decisions)}\n  machine ${JSON.stringify(machine)}`,
    )
  }, 120_000)
})
