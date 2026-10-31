import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import { clearAnalysisCache } from '../../src/exact/index.ts'
import {
  closedFormMismatches,
  closedFormSweep,
  dispatchSweep,
  fuzzCaseArb,
} from '../properties/exactOracles.ts'

// The exact analysis against the independent oracles, quick subsets (plan §9 items 3 and 4; M6
// acceptance): `analyzeBet` against the closed form on random machines and on every bet of every
// preset, and against the dispatch chain (the real reducer, solved by denseSolve.ts) on every bet
// of every preset at 101¢. The full runs are tests/slow/exactOracles.slow.test.ts. The bar is 0
// mismatches, by exact rational equality.

const SEED = 20261028
/** Plan §9 item 4's stakes. */
const STAKES = [101, 500, 600, 1_000, 2_500]

describe('analyzeBet against the closed form (quick subset)', () => {
  it('agrees on random machines: pays, commission basis, timing, rounding, minimum, re-arm, stakes', () => {
    let checked = 0
    let commission = 0
    fc.assert(
      fc.property(fuzzCaseArb, (found) => {
        if (found === null) return
        const mismatches = closedFormMismatches(found.cfg, found.facts, found.bet)
        if (mismatches === null) return
        checked++
        const type = found.facts.types.get(found.bet.typeId)
        if (type?.family === 'numberVsSeven' && type.commission.size > 0) commission++
        expect(mismatches).toEqual([])
      }),
      { seed: SEED, numRuns: 80 },
    )
    clearAnalysisCache()
    expect(checked).toBeGreaterThan(60)
    expect(commission).toBeGreaterThan(25)
  })

  it.each(PRESET_IDS)('agrees on every bet %s offers at the plan stakes', (id) => {
    const { checked, mismatches } = closedFormSweep(PRESETS[id], STAKES)
    expect(mismatches.slice(0, 10)).toEqual([])
    expect(checked).toBeGreaterThan(300)
  })
})

describe('analyzeBet against the dispatch chain (quick subset)', () => {
  it.each(PRESET_IDS)(
    'agrees on every bet %s offers at 101¢',
    (id) => {
      const { checked, mismatches } = dispatchSweep(PRESETS[id], [101])
      expect(mismatches.slice(0, 10)).toEqual([])
      expect(checked).toBeGreaterThan(70)
      // The same 30 s allowance as the real-tree scans: this 8 GB machine has stalled a preset past
      // the 5 s default under a coverage run (a preset takes well under a second quiet).
    },
    30_000,
  )
})
