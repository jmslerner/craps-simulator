import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { clearAnalysisCache } from '../../src/exact/index.ts'
import {
  closedFormMismatches,
  closedFormSweep,
  dispatchSweep,
  fuzzCaseArb,
} from '../properties/exactOracles.ts'
import { DIFF_MACHINES } from '../properties/machineVariants.ts'

// The exact analysis against the independent oracles in full (plan §9 items 3 and 4; M6
// acceptance), by exact rational equality, with pinned seeds. The bar is 0 mismatches.
// - Closed-form fuzzing: 600 random machines (pay ratios, commission basis, timing, rounding,
//   minimum and re-arm, payout roundings, after-win rules) with a random bet and stake; at least
//   300 cases the closed form models.
// - Every bet of every preset, and of each machine variant that changes a lone bet's price
//   (commission, rounding, the bar: `prices` in tests/properties/machineVariants.ts), against the
//   closed form at plan §9 item 4's stakes and odd cents, and against the dispatch chain at plan §9
//   item 4's stakes, on `dispatchVariant`s (1¢ increments, no minimum total).
// The quick subsets are in tests/oracle/exact.diff.test.ts. Each test takes seconds; the timeouts
// leave room for a machine short of memory.

const SEED = 20261028
/** Plan §9 item 4's stakes. */
const STAKES = [101, 500, 600, 1_000, 2_500]
/** Odd cents and a large stake, where rounding and commission minimums show. */
const ODD_STAKES = [1, 2, 3, 7, 13, 99, 199, 333, 4_999]
const PRICED = DIFF_MACHINES.filter((machine) => machine.prices).map(
  (machine) => [machine.id, machine] as const,
)
const TIMEOUT = 600_000

describe('analyzeBet against the closed form (slow)', () => {
  it(
    'agrees on 600 random machines, at least 300 of them on a bet the closed form models',
    () => {
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
        { seed: SEED, numRuns: 600 },
      )
      clearAnalysisCache()
      expect(checked).toBeGreaterThanOrEqual(300)
      expect(commission).toBeGreaterThan(200)
      console.log(`closed-form fuzz: ${checked} cases compared, ${commission} on a buy or a lay`)
    },
    TIMEOUT,
  )

  it.each(PRICED)(
    'agrees on every bet %s offers at every stake',
    (id, machine) => {
      const { checked, mismatches } = closedFormSweep(machine.input, [...STAKES, ...ODD_STAKES])
      expect(mismatches.slice(0, 10)).toEqual([])
      expect(checked).toBeGreaterThan(800)
      console.log(`${id}: ${checked} bets against the closed form`)
    },
    TIMEOUT,
  )
})

describe('analyzeBet against the dispatch chain (slow)', () => {
  it.each(PRICED)(
    'agrees on every bet %s offers at 101, 500, 600, 1,000 and 2,500 cents',
    (id, machine) => {
      const { checked, mismatches } = dispatchSweep(machine.input, STAKES)
      expect(mismatches.slice(0, 10)).toEqual([])
      expect(checked).toBeGreaterThan(350)
      console.log(`${id}: ${checked} bets against the reducer`)
    },
    TIMEOUT,
  )
})
