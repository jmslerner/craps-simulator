import { describe, expect, it } from 'vitest'
import { runCoachAudit } from '../properties/coachAudit.ts'

/**
 * The coach audit harness in full (plan §5.8, §10 M9c acceptance: 0 discrepancies): 200 seeded
 * random sessions across the shipping presets, replayed through the coach. Every emitted
 * `CoachNumber` is recomputed from its recorded source, every plain `analyzeBet` edge is
 * cross-checked against the independent closed-form oracle, every sameEvent claim is re-verified
 * (strictly cheaper by ≥ 0.25 pp, identical events, stake unchanged), every fix is dry-run on the
 * table it was offered for, and the anti-nag gate is exercised in all three modes under rotating
 * memory fixtures. Side bets (M11 audit): one side-bet catalog row per session against the
 * independent side-bet oracle, and a side-bet session per preset whose every `sideBetProgress`
 * number is recomputed from its source, fresh bets and Lucky Rollers held to the oracle. The quick
 * subset is `tests/properties/coachAudit.prop.test.ts`.
 */

describe('coach audit (full)', () => {
  it('finds 0 discrepancies over 200 random sessions in all modes', () => {
    const report = runCoachAudit({
      presets: [
        'craplessBubble',
        'craplessBubbleHighLimit',
        'traditionalBubble',
        'strictBubble',
        'traditionalLive345',
      ],
      sessions: 40, // 40 × 5 presets = 200 sessions
      actions: 30,
      extraSpecs: 2,
      adviceEvery: 5,
      seed: 20261028,
    })
    expect(report.discrepancies).toStrictEqual([])
    expect(report.states).toBe(200 * 30)
    expect(report.advice).toBeGreaterThan(1_000)
    expect(report.numbers).toBeGreaterThan(5_000)
    expect(report.sameEventChecks).toBeGreaterThan(50)
    expect(report.fixChecks).toBeGreaterThan(200)
    expect(report.oracleChecks).toBeGreaterThan(500)
    expect(report.gateChecks).toBeGreaterThan(1_000)
    expect(report.rowOracleChecks).toBeGreaterThan(100)
    expect(report.layoutOracleChecks).toBeGreaterThan(100)
    expect(report.equityChecks).toBeGreaterThan(500)
    // Every preset offers side bets: one row per session, every one modelled by the oracle.
    expect(report.sideRowOracleChecks).toBe(200)
    expect(report.sideProgressChecks).toBeGreaterThan(300)
    expect(report.sideProgressOracleChecks).toBeGreaterThan(50)
  }, 240_000)
})
