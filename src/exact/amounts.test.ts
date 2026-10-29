import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS, type PresetId } from '../engine/config/presets/index.ts'
import type { PointNumber } from '../engine/config/rulesets.ts'
import { cents } from '../engine/core/money.ts'
import {
  commissionMinimumBinds,
  exactUnit,
  largestAmount,
  legalAmounts,
  minimumFreeFrom,
  paysExactly,
  roundingPeriod,
  smallestAmount,
} from './amounts.ts'
import type { BetSpec } from './chain.ts'
import { distribution } from './price.ts'
import { typicalStart } from './start.ts'

const cfgOf = (id: PresetId) => compileConfig(PRESETS[id])

function labels(spec: BetSpec, id: PresetId) {
  const cfg = cfgOf(id)
  return distribution(spec, typicalStart(spec, cfg), 'decision', cfg).labels
}

describe('legal stakes', () => {
  it("are the engine's: multiples of the increment within the limits", () => {
    const cfg = cfgOf('craplessBubble')
    const place6: BetSpec = { typeId: 'place', number: 6 }
    expect(legalAmounts(place6, cfg, { from: 0, to: 450 })).toEqual([100, 200, 300, 400])
    expect(legalAmounts(place6, cfg, { from: 150, to: 10_000 }, 3)).toEqual([200, 300, 400])
    expect(smallestAmount(place6, cfg)).toBe(100)
    expect(largestAmount(place6, cfg)).toBe(50_000)
    // The live table takes a pass bet from $10.
    expect(smallestAmount({ typeId: 'pass', number: null }, cfgOf('traditionalLive345'))).toBe(
      1_000,
    )
    // Come and odds are placed where they can be: with a point on, behind a parent.
    expect(smallestAmount({ typeId: 'come', number: null }, cfg)).toBe(100)
    expect(smallestAmount({ typeId: 'comeOdds', number: 4 }, cfg)).toBe(100)
  })
})

describe('exactUnit', () => {
  it('is the smallest stake paid exactly (rules spec §3.2, exact unit live / penny)', () => {
    const cases: [PresetId, string, PointNumber | null, number][] = [
      ['craplessBubble', 'place', 6, 300],
      ['craplessBubble', 'place', 2, 100],
      ['traditionalLive345', 'place', 6, 600],
      ['traditionalLive345', 'place', 4, 500],
      ['traditionalLive345', 'buy', 4, 2_000],
      ['traditionalLive345', 'lay', 4, 4_000],
      ['traditionalBubble', 'lay', 4, 200],
      ['traditionalBubble', 'lay', 5, 300],
      ['traditionalBubble', 'lay', 6, 600],
      ['traditionalBubble', 'dontPassOdds', 4, 100],
      ['traditionalBubble', 'dontPassOdds', 5, 300],
      ['traditionalBubble', 'dontPassOdds', 6, 300],
    ]
    for (const [id, typeId, number, unit] of cases) {
      const spec = { typeId, number }
      expect(exactUnit(spec, labels(spec, id), cfgOf(id)), `${id} ${typeId} ${number}`).toBe(unit)
    }
  })

  it('needs exact pays, exact commission and no binding minimum', () => {
    const penny = cfgOf('craplessBubble')
    const place6: BetSpec = { typeId: 'place', number: 6 }
    const placeLabels = labels(place6, 'craplessBubble')
    expect([100, 200, 300].map((a) => paysExactly(place6, placeLabels, cents(a), penny))).toEqual([
      false,
      false,
      true,
    ])
    const live = cfgOf('traditionalLive345')
    const buy4: BetSpec = { typeId: 'buy', number: 4 }
    expect(commissionMinimumBinds(buy4, cents(500), live)).toBe(true)
    expect(commissionMinimumBinds(buy4, cents(2_000), live)).toBe(false)
    expect(minimumFreeFrom(buy4, live)).toBe(2_000)
    // A lay's base is its win: a $40 lay on 4 wins $20, whose 5% is the $1 minimum.
    expect(minimumFreeFrom({ typeId: 'lay', number: 4 }, live)).toBe(4_000)
    expect(minimumFreeFrom(buy4, penny)).toBe(0)
  })
})

describe('roundingPeriod', () => {
  it('repeats every b·r cents for pays a:b rounded to r, with commission folded in', () => {
    const period = (id: PresetId, typeId: string, number: PointNumber | null) =>
      roundingPeriod({ typeId, number }, labels({ typeId, number }, id), cfgOf(id))
    expect(period('craplessBubble', 'place', 6)).toBe(6)
    expect(period('traditionalLive345', 'place', 6)).toBe(600)
    expect(period('craplessBubble', 'pass', null)).toBe(1)
    // 5:6 to the cent, 5% of the win rounded up to the cent: lcm(6, 20 × 6).
    expect(period('traditionalBubble', 'lay', 6)).toBe(120)
  })
})
