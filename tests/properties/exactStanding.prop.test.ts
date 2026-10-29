import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import {
  catalogSpecs,
  legalAmounts,
  renewalCost,
  standingCost,
  type BetSpec,
} from '../../src/exact/index.ts'
import { standingCases } from './exactCases.ts'

// Plan §9 item 6, standing-cost identity: for every bet, the π formula (`standingCost`) equals
// lifecycle loss ÷ lifecycle rolls from a renewal cycle (`renewalCost`), exactly. Quick subset; the
// full run is tests/slow/exact.slow.test.ts.

const configs: readonly MachineConfig[] = PRESET_IDS.map((id) => compileConfig(PRESETS[id]))

describe('standing-cost identity (quick subset)', () => {
  it('holds for every offered bet on every preset at its smallest stake', () => {
    let checked = 0
    for (const cfg of configs) {
      for (const spec of catalogSpecs(cfg)) {
        const [amount] = legalAmounts(spec, cfg, { from: 0, to: Number.MAX_SAFE_INTEGER }, 1)
        if (amount === undefined) continue
        const pi = standingCost(spec, amount, cfg).perRoll
        expect(renewalCost(spec, amount, cfg).toString(), `${cfg.id} ${label(spec)}`).toBe(
          pi.toString(),
        )
        checked++
      }
    }
    expect(checked).toBeGreaterThan(300)
  })

  it('holds at random stakes and toggles (pinned seed)', () => {
    fc.assert(
      fc.property(standingCases(configs), ({ cfg, spec, amount, toggles }) => {
        const cost = standingCost(spec, amount, cfg, toggles)
        // A bet the toggles keep OFF for good costs nothing and is never placed again.
        if (cost.rate.isZero()) return cost.perRoll.isZero()
        return cost.perRoll.equals(renewalCost(spec, amount, cfg, toggles))
      }),
      { seed: 20261028, numRuns: 150 },
    )
  })
})

function label(spec: BetSpec): string {
  return spec.number === null ? spec.typeId : `${spec.typeId} ${spec.number}`
}
