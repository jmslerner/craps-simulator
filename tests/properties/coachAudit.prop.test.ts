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
  }, 60_000)
})
