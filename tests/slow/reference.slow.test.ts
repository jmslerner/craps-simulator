import { describe, expect, it } from 'vitest'
import { compileConfig } from '../../src/engine/config/compile.ts'
import { describeCoverage } from '../properties/actions.ts'
import {
  codeAgreement,
  describeMismatch,
  expectExercised,
  runDifferential,
  unexplainedCodePairs,
} from '../properties/differential.ts'
import { DIFF_MACHINES } from '../properties/machineVariants.ts'

// The full reference differential (plan §9 item 2, §0 #17; M4d acceptance, M6 reconciliation):
// 2,000 seeded sequences of 100 actions per machine, the four presets and the variants that turn
// on the knobs no preset uses (tests/properties/machineVariants.ts), through the engine and the
// reference table, compared after every action (tests/properties/differential.ts). The bar is 0
// mismatches, every odds type placed at least 150 times, each commission event the machine has
// reached at least 20 times, and refusal codes that differ only where the engine answers
// CONTRACT_BET first. The quick subset is tests/oracle/reference.diff.test.ts. Each machine takes a
// few seconds; the timeout leaves room for a machine short of memory.

const RUNS = 2_000

describe.each(DIFF_MACHINES.map((machine) => [machine.id, machine] as const))(
  'the reference differential on %s (slow)',
  (id, machine) => {
    it(`finds no mismatch in ${RUNS} sequences of 100 actions, and exercises every bet`, () => {
      const report = runDifferential(machine.input, RUNS, 100)
      expect(report.mismatches.slice(0, 3).map(describeMismatch)).toEqual([])
      expect(report.actions).toBe(RUNS * 100)
      expectExercised(report, compileConfig(machine.input), {
        oddsPlaced: 150,
        commission: machine.commission,
        commissionCount: 20,
      })
      expect(unexplainedCodePairs(report), codeAgreement(report)).toEqual([])
      const { placed, settled, decisions, machine: done } = describeCoverage(report.coverage)
      const knobs = machine.knobs.length === 0 ? '' : ` (${machine.knobs.join('; ')})`
      console.log(
        `${id}${knobs}: ${report.actions} actions, ${report.accepted} accepted by both, ` +
          `${report.refused} refused by both; ${codeAgreement(report)}\n` +
          `  placed ${JSON.stringify(placed)}\n  settled ${JSON.stringify(settled)}\n` +
          `  decisions ${JSON.stringify(decisions)}\n  machine ${JSON.stringify(done)}`,
      )
    }, 600_000)
  },
)
