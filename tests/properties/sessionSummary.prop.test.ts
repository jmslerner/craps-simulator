import { describe, expect, it } from 'vitest'
import { PRESET_IDS } from '../../src/engine/index.ts'
import { DIFF_MACHINES } from './machineVariants.ts'
import { runSummaryProperty, type SummaryRunStats } from './sessionSummary.ts'

/**
 * The session summary's exact identity as a property over random sessions (plan §5.7, §10 M13),
 * fast-check seed 20261028: the quick subset — every preset, and the variants whose commission
 * re-collection takes vig from credit, is never collected again, is capped at the win or is
 * declined — with side bets, credit added mid-hand, presses, take-downs, switches, macros and undo
 * in the moves. The full run, every machine variant with more and longer sessions, is
 * tests/slow/sessionSummary.slow.test.ts; the checks themselves are in `sessionSummary.ts`.
 */

const VARIANTS = [
  'crapless-big-vig',
  'crapless-recollect-credit',
  'crapless-rearm-none',
  'strict-lay-credit',
  'stw-vig-cap',
]
const MACHINES = DIFF_MACHINES.filter(
  (machine) =>
    (PRESET_IDS as readonly string[]).includes(machine.id) || VARIANTS.includes(machine.id),
)

describe('the session summary identity (quick subset)', () => {
  const all: SummaryRunStats[] = []

  for (const machine of MACHINES) {
    it(`W_end − W_start − top-ups = Σ luck − Σ cost on ${machine.id}`, { timeout: 60_000 }, () => {
      const stats = runSummaryProperty(machine, { numRuns: 10, maxMoves: 50, martingaleEvery: 5 })
      expect(stats.report.rolls).toBeGreaterThan(0)
      all.push(stats)
    })
  }

  it('reached what the summary must account for', () => {
    const sum = (pick: (stats: SummaryRunStats) => number) =>
      all.reduce((total, stats) => total + pick(stats), 0)
    expect(all).toHaveLength(PRESET_IDS.length + VARIANTS.length)
    expect(
      sum((s) => s.report.sideBets),
      'side bets placed',
    ).toBeGreaterThan(0)
    expect(
      sum((s) => s.report.depositsMidHand),
      'credit added mid-hand',
    ).toBeGreaterThan(0)
    expect(
      sum((s) => s.report.takeDowns),
      'take-downs',
    ).toBeGreaterThan(0)
    expect(
      sum((s) => s.rewagers),
      'winners re-wagered',
    ).toBeGreaterThan(0)
    expect(
      sum((s) => s.leakDecisions),
      'same-event leaks',
    ).toBeGreaterThan(0)
    expect(
      sum((s) => s.martingaleTables),
      'tables checked for fair luck',
    ).toBeGreaterThan(20)
    expect(
      sum((s) => s.pendingWindows),
      'open windows summarised',
    ).toBeGreaterThan(0)
  })
})
