import { describe, expect, it } from 'vitest'
import { DIFF_MACHINES } from '../properties/machineVariants.ts'
import { runSummaryProperty } from '../properties/sessionSummary.ts'

// The full M13 session-summary properties (plan §5.7, §10 M13), fast-check seed 20261028: on every
// preset and every machine variant of the reference differential (commission re-collected from
// credit, never, capped or declined; per-number rounding and units; working and hold variants),
// 40 random sessions of up to 90 moves through the betting window — side bets, credit added
// mid-hand, presses, cuts, take-downs, switches, macros, undo — and after each one: the exact
// identity W_end − W_start − top-ups = Σ luck − Σ cost; the summary's equity result = expected +
// luck and its family costs = Σ cost; every leak a same-event twin re-verified by `sameEvents`;
// the session saved, loaded and resumed summarising identically, and the accountant fed window by
// window agreeing with one pass; and on every third table before a roll, luck summed over the 36
// rolls exactly zero. The quick subset is tests/properties/sessionSummary.prop.test.ts.

const RUNS = 40
const MAX_MOVES = 90

describe.each(DIFF_MACHINES.map((machine) => [machine.id, machine] as const))(
  'session summary properties on %s (slow)',
  (id, machine) => {
    it(`hold over ${RUNS} sessions of up to ${MAX_MOVES} moves`, () => {
      const stats = runSummaryProperty(machine, {
        numRuns: RUNS,
        maxMoves: MAX_MOVES,
        martingaleEvery: 3,
      })
      expect(stats.report.rolls).toBeGreaterThan(RUNS * 5)
      expect(stats.martingaleTables).toBeGreaterThan(RUNS)
      console.log(
        `${id}: ${stats.report.rolls} rolls, ${stats.rewagers} re-wagers, ` +
          `${stats.report.sideBets} side bets, ${stats.report.depositsMidHand} deposits mid-hand ` +
          `(${stats.report.deposits} in all), ${stats.report.takeDowns} take-downs, ` +
          `${stats.report.switches} switches, ${stats.report.macros} macros, ` +
          `${stats.leakDecisions} leak decisions; luck fair on ${stats.martingaleTables} tables ` +
          `(${stats.martingaleSkipped} skipped: a re-collection credit could not pay)`,
      )
    }, 120_000)
  },
)
