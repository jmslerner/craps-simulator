import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import type { Cents } from '../../src/engine/core/money.ts'
import {
  ExactError,
  catalogSpecs,
  legalAmounts,
  renewalCost,
  standingCost,
  type BetSpec,
  type Toggles,
} from '../../src/exact/index.ts'
import { hasStandingCost, standingCases } from './exactCases.ts'

// Plan §9 item 6, standing-cost identity: for every bet, the π formula (`standingCost`) equals
// lifecycle loss ÷ lifecycle rolls from a renewal cycle (`renewalCost`), exactly. A put spec is
// one decision, not a stream, so it has no standing cost and is skipped. Quick subset; the full
// run is tests/slow/exact.slow.test.ts.

const configs: readonly MachineConfig[] = PRESET_IDS.map((id) => compileConfig(PRESETS[id]))

/**
 * A zero rate means the toggles keep the bet OFF for good: it costs nothing, and the renewal side
 * of the identity must agree — the cycle never regenerates (`NEVER_RESOLVES`) or costs zero too.
 */
function renewalAgreesItIsDead(
  spec: BetSpec,
  amount: Cents,
  cfg: MachineConfig,
  toggles: Toggles,
): boolean {
  try {
    return renewalCost(spec, amount, cfg, toggles).isZero()
  } catch (error) {
    return error instanceof ExactError && error.code === 'NEVER_RESOLVES'
  }
}

describe('standing-cost identity (quick subset)', () => {
  it('holds for every offered bet on every preset at its smallest stake', () => {
    let checked = 0
    for (const cfg of configs) {
      for (const spec of catalogSpecs(cfg)) {
        if (!hasStandingCost(spec, cfg)) continue
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
        if (cost.rate.isZero()) {
          return cost.perRoll.isZero() && renewalAgreesItIsDead(spec, amount, cfg, toggles)
        }
        return cost.perRoll.equals(renewalCost(spec, amount, cfg, toggles))
      }),
      { seed: 20261028, numRuns: 150 },
    )
  })
})

function label(spec: BetSpec): string {
  return spec.number === null ? spec.typeId : `${spec.typeId} ${spec.number}`
}
