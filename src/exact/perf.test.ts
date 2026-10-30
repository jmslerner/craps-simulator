import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../engine/config/presets/index.ts'
import { cents } from '../engine/core/money.ts'
import { catalogTable } from './catalog.ts'
import { clearAnalysisCache } from './cache.ts'
import { distribution, price } from './price.ts'
import { typicalStart } from './start.ts'

// The performance targets of plan §10 M6 and M11: the catalog in under 200 ms without side bets,
// the full crapless catalog (side bets included) in under 2 s and then cached, pricing a stake in
// under 0.1 ms. Measured here and printed; the assertions are loose (5x on M6's figure), so a slow
// CI machine does not fail the suite, while a regression by an order of magnitude does.

/**
 * The fastest of `runs` cold computations of `cfg`'s catalog, in ms: the suite runs many files in
 * parallel on a small machine, and one run can stall on contention that is nothing to do with the
 * solver; the best of a few is what the solver itself costs.
 */
function coldCatalogMs(cfg: ReturnType<typeof compileConfig>, runs = 3): number {
  let best = Number.POSITIVE_INFINITY
  for (let run = 0; run < runs; run++) {
    clearAnalysisCache()
    const start = performance.now()
    catalogTable(cfg)
    best = Math.min(best, performance.now() - start)
  }
  return best
}

describe('performance', () => {
  it('computes the full crapless catalog, side bets included, cold in under 2 s, then from cache (§10 M11)', () => {
    const cfg = compileConfig(PRESETS.craplessBubble)
    const cold = coldCatalogMs(cfg)
    const rows = catalogTable(cfg)
    const sideRows = rows.filter((row) => cfg.sideBets.has(row.spec.typeId))
    expect(sideRows.map((row) => row.spec.typeId)).toEqual([
      'luckyRollerLow',
      'luckyRollerHigh',
      'luckyRollerAll',
    ])
    expect(cold).toBeLessThan(2_000)
    const again = performance.now()
    expect(catalogTable(cfg)).toBe(rows)
    const warm = performance.now() - again
    expect(warm).toBeLessThan(50)
    console.info(
      `[exact perf] full crapless catalog: ${rows.length} rows cold in ${cold.toFixed(1)} ms, ` +
        `cached in ${warm.toFixed(2)} ms`,
    )
  }, 60_000)

  it('computes each preset’s catalog cold in under 1 s (M6: non-side rows in under 200 ms)', () => {
    // Warm the JIT on a copy of the default preset, which has its own config hash.
    catalogTable(compileConfig({ ...PRESETS.craplessBubble, id: 'warmUp', name: 'Warm-up' }))
    const timings: string[] = []
    for (const id of PRESET_IDS) {
      const cfg = compileConfig(PRESETS[id])
      const elapsed = coldCatalogMs(cfg)
      const rows = catalogTable(cfg)
      timings.push(`${id}: ${rows.length} rows in ${elapsed.toFixed(1)} ms`)
      expect(rows.length).toBeGreaterThan(50)
      expect(elapsed, id).toBeLessThan(1_000)
    }
    console.info(`[exact perf] catalog, cold: ${timings.join('; ')}`)
  }, 60_000)

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
