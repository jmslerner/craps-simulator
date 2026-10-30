import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import {
  ExactError,
  analyzeBet,
  catalogSpecs,
  configPathsOf,
  renewalCost,
  standingCost,
  type BetSpec,
  type Toggles,
} from '../../src/exact/index.ts'
import type { Cents } from '../../src/engine/core/money.ts'
import {
  analysisFingerprint,
  firstAmounts,
  hasStandingCost,
  mutated,
  mutationsOf,
  overlaps,
  standingCases,
} from '../properties/exactCases.ts'

// The exact solver's properties in full (plan §9 item 6): the standing-cost identity on every bet,
// stake and toggle of every preset and of config variants that reach rarer rules, and config-path
// invariance over many more random changes. Seeds are pinned.

const TOGGLES: readonly Toggles[] = [
  {},
  { globalOff: false },
  { globalOff: true },
  { working: true },
  { working: false },
]

function variant(id: PresetId, edit: (input: MachineConfigInput) => void): MachineConfig {
  const changed = mutated(PRESETS[id] as MachineConfigInput, edit)
  if (changed === null) throw new Error(`invalid variant of ${id}`)
  return changed
}

/** Variants whose rules the presets do not reach: winners that come back, one-roll toggles... */
const VARIANTS: readonly MachineConfig[] = [
  variant('craplessBubble', (input) => {
    for (const type of Object.values(input.catalog)) {
      if (type.family === 'numberVsSeven' || type.family === 'hardway') type.afterWin = 'return'
    }
  }),
  variant('strictBubble', (input) => {
    input.workingToggle = { ...input.workingToggle, scope: 'nextRollOnly', perBet: true }
  }),
  variant('traditionalBubble', (input) => {
    if (input.comeOut.autoOff === null) throw new Error('no auto-OFF')
    input.comeOut.autoOff = { ...input.comeOut.autoOff, newlyPlaced: [] }
  }),
  variant('craplessBubble', (input) => {
    input.afterSevenOut.newPlacedOff = {
      types: ['place', 'buy'],
      trigger: 'anySeven',
      until: 'pointEstablished',
    }
  }),
]

const PRESET_CONFIGS = PRESET_IDS.map((id) => compileConfig(PRESETS[id]))

/**
 * A zero rate means the toggles keep the bet OFF for good: the renewal side must agree — the cycle
 * never regenerates (`NEVER_RESOLVES`) or costs zero too (M5/M6 audit: the identity tests used to
 * return early on a zero rate, which hid a lay the machine re-enables).
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

describe('standing-cost identity (full)', () => {
  it.each([...PRESET_CONFIGS, ...VARIANTS].map((cfg) => [cfg.id, cfg] as const))(
    'holds on %s for every bet, its first stakes and every toggle',
    (_, cfg) => {
      let checked = 0
      for (const spec of catalogSpecs(cfg)) {
        if (!hasStandingCost(spec, cfg)) continue
        for (const amount of firstAmounts(spec, cfg, 4)) {
          for (const toggles of TOGGLES) {
            const cost = standingCost(spec, amount, cfg, toggles)
            if (cost.rate.isZero()) {
              expect(cost.perRoll.isZero()).toBe(true)
              expect(
                renewalAgreesItIsDead(spec, amount, cfg, toggles),
                `${spec.typeId} ${String(spec.number)} ${amount} dead`,
              ).toBe(true)
              continue
            }
            const renewal = renewalCost(spec, amount, cfg, toggles)
            expect(renewal.toString(), `${spec.typeId} ${String(spec.number)} ${amount}`).toBe(
              cost.perRoll.toString(),
            )
            checked++
          }
        }
      }
      expect(checked).toBeGreaterThan(500)
    },
    120_000,
  )

  it('holds at random stakes and toggles', () => {
    fc.assert(
      fc.property(
        standingCases([...PRESET_CONFIGS, ...VARIANTS]),
        ({ cfg, spec, amount, toggles }) => {
          const cost = standingCost(spec, amount, cfg, toggles)
          if (cost.rate.isZero()) {
            return cost.perRoll.isZero() && renewalAgreesItIsDead(spec, amount, cfg, toggles)
          }
          return cost.perRoll.equals(renewalCost(spec, amount, cfg, toggles))
        },
      ),
      { seed: 20261028, numRuns: 1_000 },
    )
  }, 120_000)
})

describe('config-path invariance (full)', () => {
  it('leaves every analysis unchanged by changes outside its configPaths', () => {
    const presets = PRESET_IDS.map((id) => {
      const input = PRESETS[id] as MachineConfigInput
      return { input, cfg: compileConfig(input), mutations: mutationsOf(input) }
    })
    let compared = 0
    fc.assert(
      fc.property(
        fc.nat({ max: presets.length - 1 }),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        (presetIndex, specIndex, mutationIndex, amountIndex) => {
          const preset = presets[presetIndex]
          if (preset === undefined) return false
          const specs = catalogSpecs(preset.cfg)
          const spec = specs[specIndex % specs.length]
          if (spec === undefined) return false
          const paths = configPathsOf(spec, preset.cfg)
          const outside = preset.mutations.filter(
            ({ pointer }) => !paths.some((path) => overlaps(pointer, path)),
          )
          const mutation = outside[mutationIndex % outside.length]
          const amounts = firstAmounts(spec, preset.cfg, 12)
          const amount = amounts[amountIndex % amounts.length]
          if (mutation === undefined || amount === undefined) return false
          const changed = mutated(preset.input, mutation.apply)
          if (changed === null) return true
          compared++
          const before = analysisFingerprint(analyzeBet(spec, amount, 'typical', preset.cfg))
          const after = analysisFingerprint(analyzeBet(spec, amount, 'typical', changed))
          if (before !== after) {
            throw new Error(
              `${preset.cfg.id} ${spec.typeId} ${String(spec.number)}: ${mutation.pointer}`,
            )
          }
          return true
        },
      ),
      { seed: 20261028, numRuns: 2_000 },
    )
    expect(compared).toBeGreaterThan(1_000)
  }, 300_000)
})
