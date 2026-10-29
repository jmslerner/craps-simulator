import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { analyzeBet, catalogSpecs, configPathsOf } from '../../src/exact/index.ts'
import { analysisFingerprint, firstAmounts, mutated, mutationsOf, overlaps } from './exactCases.ts'

// Plan §9 item 6, config-path invariance: changing any config value outside a bet's
// `configPaths()` leaves its analysis unchanged. The pointers come from the bet's family, so a
// family that forgets a value its math reads fails here. Quick subset; the full run is
// tests/slow/exact.slow.test.ts.

interface Preset {
  readonly input: MachineConfigInput
  readonly cfg: MachineConfig
  readonly mutations: ReturnType<typeof mutationsOf>
}

const presets: readonly Preset[] = PRESET_IDS.map((id) => {
  const input = PRESETS[id] as MachineConfigInput
  return { input, cfg: compileConfig(input), mutations: mutationsOf(input) }
})

describe('config-path invariance (quick subset)', () => {
  it('has many changes to try on every preset', () => {
    for (const { mutations } of presets) expect(mutations.length).toBeGreaterThan(300)
  })

  it('leaves an analysis unchanged when a value outside its configPaths changes (pinned seed)', () => {
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
      { seed: 20261028, numRuns: 120 },
    )
    // Most changes keep the config valid, so the property is not vacuous.
    expect(compared).toBeGreaterThan(60)
  })

  it('notices a change inside a bet’s configPaths (the check is not vacuous)', () => {
    const input = PRESETS.craplessBubble as MachineConfigInput
    const cfg = compileConfig(input)
    const place6 = { typeId: 'place', number: 6 } as const
    expect(configPathsOf(place6, cfg)).toContain('/catalog/place/pays/6')
    const changed = mutated(input, (copy) => {
      const place = copy.catalog.place
      if (place?.family !== 'numberVsSeven') throw new Error('no place')
      place.pays = { ...place.pays, '6': '7:5' }
    })
    if (changed === null) throw new Error('invalid change')
    const at = (config: MachineConfig) =>
      analysisFingerprint(analyzeBet(place6, config.limits.min, 'typical', config))
    expect(at(changed)).not.toBe(at(cfg))
  })
})
