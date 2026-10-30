import { describe, expect, it } from 'vitest'
import { runCoachAudit } from './coachAudit.ts'

/**
 * The coach audit, quick subset (plan §5.8, §10 M9c): a few seeded sessions on the default
 * machine, every emitted number recomputed from its source, every claim re-verified, the gate
 * checked in all three modes. The full 200-session run over more presets is
 * `tests/slow/audit.slow.test.ts`.
 */

describe('coach audit (quick subset)', () => {
  it('finds 0 discrepancies over seeded sessions on the crapless preset', () => {
    const report = runCoachAudit({
      presets: ['craplessBubble'],
      sessions: 6,
      actions: 22,
      extraSpecs: 2,
      adviceEvery: 4,
      seed: 20261028,
    })
    expect(report.discrepancies).toStrictEqual([])
    expect(report.states).toBe(6 * 22)
    expect(report.steps).toBeGreaterThan(60)
    expect(report.numbers).toBeGreaterThan(200)
    expect(report.advice).toBeGreaterThan(50)
    expect(report.sameEventChecks).toBeGreaterThan(0)
    expect(report.fixChecks).toBeGreaterThan(0)
    expect(report.oracleChecks).toBeGreaterThan(20)
    expect(report.gateChecks).toBeGreaterThan(50)
    expect(report.rowOracleChecks).toBeGreaterThan(0)
    expect(report.layoutOracleChecks).toBeGreaterThan(0)
    expect(report.equityChecks).toBeGreaterThan(0)
    // Side bets (M11 audit): rows against the side-bet oracle, and progress on the table.
    expect(report.sideRowOracleChecks).toBe(6)
    expect(report.sideProgressChecks).toBeGreaterThan(10)
    expect(report.sideProgressOracleChecks).toBeGreaterThan(5)
  }, 60_000)

  it('finds 0 discrepancies on the side bets of the other presets', () => {
    const report = runCoachAudit({
      presets: ['traditionalBubble', 'strictBubble', 'traditionalLive345'],
      sessions: 2,
      actions: 16,
      extraSpecs: 1,
      adviceEvery: 4,
      seed: 20261028,
    })
    expect(report.discrepancies).toStrictEqual([])
    expect(report.sideRowOracleChecks).toBe(6)
    expect(report.sideProgressChecks).toBeGreaterThan(5)
    expect(report.sideProgressOracleChecks).toBeGreaterThan(0)
    // Every side bet of these presets was on a table and audited.
    for (const typeId of ['hotShooter', 'luckyShooter', 'fire', 'luckyRollerLow']) {
      expect(report.sideProgressByType[typeId] ?? 0, typeId).toBeGreaterThan(0)
    }
  }, 60_000)
})
