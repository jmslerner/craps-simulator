import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../engine/config/presets/index.ts'
import { cents } from '../engine/core/money.ts'
import { catalogTable } from './catalog.ts'
import { clearAnalysisCache } from './cache.ts'
import { distribution, price } from './price.ts'
import { typicalStart } from './start.ts'

// The performance targets of plan §10 M6: the non-side catalog in under 200 ms, pricing a stake in
// under 0.1 ms. Measured here and printed; the assertions are loose (5x), so a slow CI machine does
// not fail the suite, while a regression by an order of magnitude does.

describe('performance', () => {
  it('computes each preset’s non-side catalog cold in under 200 ms', () => {
    // Warm the JIT on a copy of the default preset, which has its own config hash.
    catalogTable(compileConfig({ ...PRESETS.craplessBubble, id: 'warmUp', name: 'Warm-up' }))
    const timings: string[] = []
    for (const id of PRESET_IDS) {
      const cfg = compileConfig(PRESETS[id])
      clearAnalysisCache()
      const start = performance.now()
      const rows = catalogTable(cfg)
      const elapsed = performance.now() - start
      timings.push(`${id}: ${rows.length} rows in ${elapsed.toFixed(1)} ms`)
      expect(rows.length).toBeGreaterThan(50)
      expect(elapsed, id).toBeLessThan(1_000)
    }
    console.info(`[exact perf] catalog, cold: ${timings.join('; ')}`)
  })

  it('prices a stake in under 0.1 ms', () => {
    const cfg = compileConfig(PRESETS.craplessBubble)
    const specs = [
      { typeId: 'pass', number: null },
      { typeId: 'place', number: 6 },
      { typeId: 'buy', number: 4 },
      { typeId: 'field', number: null },
      { typeId: 'comeOdds', number: 5 },
    ] as const
    const dists = specs.map((spec) => distribution(spec, typicalStart(spec, cfg), 'lifetime', cfg))
    for (const dist of dists) price(dist, cents(500), cfg, 'rounded')
    const calls = 20_000
    const start = performance.now()
    for (let i = 0; i < calls; i++) {
      const dist = dists[i % dists.length]
      if (dist !== undefined) price(dist, cents(100 * (1 + (i % 50))), cfg, 'rounded')
    }
    const perCall = (performance.now() - start) / calls
    console.info(`[exact perf] pricing: ${(perCall * 1_000).toFixed(2)} µs a call`)
    expect(perCall).toBeLessThan(0.5)
  })
})
