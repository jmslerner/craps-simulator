import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { Fraction } from '../engine/core/rational.ts'
import { cents } from '../engine/core/money.ts'
import { coachMoney, coachPercent, sourceOf } from './numbers.ts'

const crapless = compileConfig(PRESETS.craplessBubble)

describe('CoachNumber constructors', () => {
  it('attach the exact source: function, JSON args, and the config hash', () => {
    const source = sourceOf('analyzeBet', { spec: { typeId: 'place', number: 6 } }, crapless)
    expect(source).toEqual({
      fn: 'analyzeBet',
      args: { spec: { typeId: 'place', number: 6 } },
      configHash: crapless.configHash,
    })
    const edge = coachPercent(Fraction.of(1, 66), source, ['/catalog/place/pays/6'])
    expect(edge.kind).toBe('percent')
    expect(edge.exact).toBeInstanceOf(Fraction)
    expect(edge.assumedPaths).toEqual(['/catalog/place/pays/6'])
  })

  it('carry machine-paid money as integer cents and expectations as fractions', () => {
    const source = sourceOf('t', null, crapless)
    expect(coachMoney(cents(583), source).exact).toBe(583)
    const equity = coachMoney(Fraction.of(2000, 7), source)
    expect(equity.exact).toBeInstanceOf(Fraction)
  })
})
