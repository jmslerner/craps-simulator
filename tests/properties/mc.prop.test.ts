import { describe, expect, it } from 'vitest'
import { compileConfig, seedRng } from '../../src/engine/index.ts'
import { PRESETS } from '../../src/engine/config/presets/index.ts'
import { catalogRow, typicalStart, type BetSpec } from '../../src/exact/index.ts'
import { decisionExpectation, sampleDecisions } from '../../src/sim/index.ts'
import { checkDecisionSample } from './mc.ts'

// The quick Monte Carlo subset (plan §9 item 9): 4 bets × 2×10⁴ decisions on the default crapless
// machine, each sampled through the engine's own decide/settle with dice from the engine RNG, then
// held within 4σ of the exact mean loss and χ²-checked against the exact outcome-label
// probabilities (tests/properties/mc.ts). The full run — every offered bet of every preset at 10⁵
// decisions — is tests/slow/mc.decisions.slow.test.ts. Seeds are pinned, so a pass is
// deterministic. The four bets cover the families whose settlement differs most: a line bet that
// travels (pass), a place bet priced at the dollar floor where rounding binds (place 6 at $1), a
// buy with up-front commission (buy 4) and a multi-pay one-roll bet (field).

const DECISIONS = 20_000

const BETS: readonly BetSpec[] = [
  { typeId: 'pass', number: null },
  { typeId: 'place', number: 6 },
  { typeId: 'buy', number: 4 },
  { typeId: 'field', number: null },
]

describe('Monte Carlo quick subset on craplessBubble', () => {
  const cfg = compileConfig(PRESETS.craplessBubble)

  it.each(BETS.map((spec) => [spec.typeId, spec.number, spec] as const))(
    '%s %s: 2×10⁴ sampled decisions match the exact distribution',
    (typeId, number, spec) => {
      const row = catalogRow(spec, cfg)
      const amount = row.atMinimum?.amount ?? row.amount
      const start = typicalStart(spec, cfg)
      const exp = decisionExpectation(spec, start, amount, cfg)
      const sample = sampleDecisions(
        spec,
        start,
        amount,
        cfg,
        DECISIONS,
        seedRng(`mc-quick:${typeId}:${String(number)}`),
      )
      expect(sample.decisions).toBe(DECISIONS)
      const check = checkDecisionSample(`${typeId} ${String(number)} at ${amount}¢`, sample, exp)
      expect(check.sigmas).toBeLessThanOrEqual(4)
      // Each of the four bets has at least win and lose, so the χ² never degenerates.
      expect(check.chi2).not.toBeNull()
    },
  )
})
