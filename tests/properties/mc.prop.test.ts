import { describe, expect, it } from 'vitest'
import { compileConfig, seedRng } from '../../src/engine/index.ts'
import { PRESETS } from '../../src/engine/config/presets/index.ts'
import {
  COME_OUT,
  catalogRow,
  startAt,
  typicalStart,
  type BetSpec,
  type StartContext,
} from '../../src/exact/index.ts'
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

// The side bets (M11): the sampler walks `progress` decisions roll by roll and never lumps a
// count, so it cross-checks the solver's side-bet chains (states beyond phase and point, the Hot
// Shooter's lumped top tier) and a start from a bet's progress so far — the equity and "P(next
// tier)" the coach shows. The full run over every side bet and more progress states is
// tests/slow/mc.sideBets.slow.test.ts.
describe('Monte Carlo quick subset: side bets (M11)', () => {
  const cases: readonly {
    readonly preset: keyof typeof PRESETS
    readonly typeId: string
    readonly start: (cfg: ReturnType<typeof compileConfig>) => StartContext
    readonly name: string
  }[] = [
    {
      preset: 'craplessBubble',
      typeId: 'luckyRollerLow',
      start: (cfg) => typicalStart({ typeId: 'luckyRollerLow', number: null }, cfg),
      name: 'Low Rolls, new',
    },
    {
      preset: 'craplessBubble',
      typeId: 'luckyRollerLow',
      start: () =>
        startAt(COME_OUT, { carried: true, progress: (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) }),
      name: 'Low Rolls with four targets rolled',
    },
    {
      preset: 'traditionalBubble',
      typeId: 'hotShooter',
      start: (cfg) => typicalStart({ typeId: 'hotShooter', number: null }, cfg),
      name: 'Hot Shooter Jackpot, new hand',
    },
  ]

  it.each(cases.map((c) => [c.name, c] as const))('%s: 2×10⁴ sampled decisions match', (_, c) => {
    const cfg = compileConfig(PRESETS[c.preset])
    const spec: BetSpec = { typeId: c.typeId, number: null }
    const amount = catalogRow(spec, cfg).amount
    const start = c.start(cfg)
    const exp = decisionExpectation(spec, start, amount, cfg)
    const sample = sampleDecisions(
      spec,
      start,
      amount,
      cfg,
      DECISIONS,
      seedRng(`mc-quick:side:${c.preset}:${c.typeId}:${String(start.progress ?? 0)}`),
    )
    expect(sample.decisions).toBe(DECISIONS)
    const check = checkDecisionSample(c.name, sample, exp)
    expect(check.sigmas).toBeLessThanOrEqual(4)
    expect(check.chi2).not.toBeNull()
  })
})
