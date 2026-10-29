import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS, type PresetId } from '../engine/config/presets/index.ts'
import { pruneProvenance } from '../engine/config/provenance.ts'
import type { MachineConfigInput } from '../engine/config/schema.ts'
import { cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import { ENGINE_VERSION } from '../engine/version.ts'
import { ExactError, solveBetChain, buildChain, type BetSpec } from './chain.ts'
import {
  EXACT_VERSION,
  analysisKey,
  distribution,
  edgeOf,
  measure,
  nodeDistribution,
  price,
  upfrontCharge,
} from './price.ts'
import { startAt, typicalStart } from './start.ts'

const cfgOf = (id: PresetId) => compileConfig(PRESETS[id])

function variant(id: PresetId, edit: (input: MachineConfigInput) => void): MachineConfig {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  edit(input)
  input.provenance = pruneProvenance(input)
  return compileConfig(input)
}

describe('price', () => {
  it('is the dot product of label counts with what the engine settles at the stake', () => {
    const cfg = cfgOf('craplessBubble')
    const spec: BetSpec = { typeId: 'place', number: 6 }
    const first = distribution(spec, typicalStart(spec, cfg), 'decision', cfg)
    // Wins 5/11, paying $5.83 at $5 and leaving the $5 up (counted as returned); loses 6/11.
    const priced = price(first, cents(500), cfg, 'rounded')
    expect(priced.credited.toString()).toBe(
      Fraction.of(5, 11)
        .mul(Fraction.of(583 + 500))
        .toString(),
    )
    expect(priced.decisions.toString()).toBe('1')
    const exact = price(first, cents(500), cfg, 'exact')
    expect(exact.credited.toString()).toBe(
      Fraction.of(5, 11)
        .mul(Fraction.of(1750, 3).add(Fraction.of(500)))
        .toString(),
    )
  })

  it('charges the full up-front vig again for each winner that stays up', () => {
    const cfg = cfgOf('craplessBubble')
    const spec: BetSpec = { typeId: 'buy', number: 4 }
    const life = distribution(spec, typicalStart(spec, cfg), 'lifetime', cfg)
    // E[wins before the loss] = (1/3) ÷ (2/3) = 1/2, each re-collecting 5% of $20.
    expect(price(life, cents(2_000), cfg, 'rounded').rearmed.toString()).toBe('50')
    expect(edgeOf(measure(life, cents(2_000), cfg, 'rounded')).toString()).toBe('1/21')
  })

  it('prices up-front vig as the machine charges it, or exactly', () => {
    const strict = cfgOf('strictBubble')
    const lay4: BetSpec = { typeId: 'lay', number: 4 }
    // A $1 lay on 4 would win 50¢: 5% is 2.5¢, rounded up to 3¢.
    expect(upfrontCharge(lay4, cents(100), strict, 'rounded').toString()).toBe('3')
    expect(upfrontCharge(lay4, cents(100), strict, 'exact').toString()).toBe('5/2')
    expect(
      upfrontCharge({ typeId: 'place', number: 6 }, cents(100), strict, 'rounded').isZero(),
    ).toBe(true)
  })

  it('caches distributions under every input they depend on', () => {
    const cfg = cfgOf('craplessBubble')
    const spec: BetSpec = { typeId: 'pass', number: null }
    const start = typicalStart(spec, cfg)
    expect(distribution(spec, start, 'decision', cfg)).toBe(
      distribution(spec, start, 'decision', cfg),
    )
    const key = analysisKey(spec, start, 'decision', cfg)
    expect(key.split('|').slice(0, 5)).toEqual([
      cfg.configHash,
      `e${ENGINE_VERSION}`,
      `x${EXACT_VERSION}`,
      'pass',
      '-',
    ])
    expect(key.endsWith('|decision')).toBe(true)
    const other = variant('craplessBubble', (input) => {
      input.pace.rollsPerHour = 100
    })
    expect(analysisKey(spec, start, 'decision', other)).not.toBe(key)
  })

  it('gives each state its own distribution', () => {
    const cfg = cfgOf('craplessBubble')
    const solved = solveBetChain(
      buildChain(
        { typeId: 'pass', number: null },
        typicalStart({ typeId: 'pass', number: null }, cfg),
        'decision',
        cfg,
      ),
    )
    const onTwo = solved.chain.nodes.findIndex((node) => node.key.startsWith('p2|'))
    const dist = nodeDistribution(solved, onTwo)
    const win = dist.labels.findIndex((label) => label.key === 'win:flat:stays')
    expect(dist.counts[win]?.toString()).toBe('1/7')
    expect(dist.rolls.toString()).toBe('36/7')
  })

  it('refuses a bet that is never decided from its start', () => {
    const cfg = cfgOf('craplessBubble')
    const off = startAt({ kind: 'comeOut' }, { working: false })
    expect(() => distribution({ typeId: 'place', number: 6 }, off, 'decision', cfg)).toThrow(
      ExactError,
    )
  })
})
