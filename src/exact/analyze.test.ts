import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../engine/config/presets/index.ts'
import { pruneProvenance, statusAt } from '../engine/config/provenance.ts'
import type { MachineConfigInput } from '../engine/config/schema.ts'
import { cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import {
  analyzeBet,
  assumedPaths,
  combinedEdge,
  configPathsOf,
  efficientAmounts,
} from './analyze.ts'
import { catalogSpecs } from './catalog.ts'
import { ExactError } from './chain.ts'

const cfgOf = (id: PresetId) => compileConfig(PRESETS[id])

function variant(id: PresetId, edit: (input: MachineConfigInput) => void): MachineConfig {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  edit(input)
  input.provenance = pruneProvenance(input)
  return compileConfig(input)
}

describe('analyzeBet', () => {
  it.each(PRESET_IDS)('gives first-decision chances that add up to 1 for every bet on %s', (id) => {
    const cfg = cfgOf(id)
    for (const spec of catalogSpecs(cfg)) {
      const analysis = analyzeBet(spec, cents(600), 'typical', cfg)
      const total = analysis.pWin.add(analysis.pLose).add(analysis.pPush)
      expect(total.toString(), `${spec.typeId} ${String(spec.number)}`).toBe('1')
      expect(analysis.edge.isNegative(), spec.typeId).toBe(false)
      expect(analysis.breakage.equals(analysis.edge.sub(analysis.nominalEdge))).toBe(true)
    }
  })

  it('lists every way a bet wins, with what it pays at the stake', () => {
    const cfg = cfgOf('craplessBubble')
    const field = analyzeBet({ typeId: 'field', number: null }, cents(500), 'typical', cfg)
    expect(field.payouts.map((line) => line.payKey).sort()).toEqual(
      ['2', '3', '4', '9', '10', '11', '12'].sort(),
    )
    expect(Fraction.sum(field.payouts.map((line) => line.chance)).equals(field.pWin)).toBe(true)
    expect(field.payouts.find((line) => line.payKey === '2')?.winPaid).toBe(1_000)
    const place = analyzeBet({ typeId: 'place', number: 6 }, cents(500), 'typical', cfg)
    expect([place.payoutLabel, place.winPaid]).toEqual(['7:6', 583])
    expect(place.payouts[0]?.winExact.toString()).toBe('1750/3')
    expect(place.payouts[0]?.rounding).toEqual({ mode: 'floor', increment: 1 })
    expect(place.payouts[0]?.disposition).toBe('stays')
  })

  it('reports the commission: up front and again (Interblock), or from the win (Shoot To Win)', () => {
    const buy4 = { typeId: 'buy', number: 4 } as const
    const ib = analyzeBet(buy4, cents(2_000), 'typical', cfgOf('craplessBubble'))
    expect(ib.vig).toEqual({ placement: 100, onWin: 0, rearm: 100 })
    const stw = analyzeBet(buy4, cents(2_000), 'typical', cfgOf('traditionalBubble'))
    expect(stw.vig).toEqual({ placement: 0, onWin: 100, rearm: 0 })
  })

  it('counts every decision of the lifecycle, and the vig paid once, in the amount risked', () => {
    const once = variant('craplessBubble', (input) => {
      const buy = input.catalog.buy
      if (buy?.family !== 'numberVsSeven' || buy.commission === undefined) throw new Error('no buy')
      buy.commission = { ...buy.commission, rearm: 'none' }
    })
    const buy4 = analyzeBet({ typeId: 'buy', number: 4 }, cents(2_000), 'typical', once)
    // Wins (P 1/3) ride: 3/2 decisions; risked 3/2 × $20 + $1; lost: the $1 only.
    expect(buy4.lifecycle.decisions.toString()).toBe('3/2')
    expect(buy4.lifecycle.risked.toString()).toBe('3100')
    expect(buy4.lifecycle.loss.toString()).toBe('100')
    expect(buy4.edge.toString()).toBe('1/31')
    // Per decision, the first carries the vig: 5% of the stake per (stake + vig).
    expect(buy4.lossPerDecision.toString()).toBe('100')
  })

  it('refuses a bet the machine does not offer', () => {
    expect(() =>
      analyzeBet({ typeId: 'lay', number: 4 }, cents(100), 'typical', cfgOf('craplessBubble')),
    ).toThrow(ExactError)
  })
})

describe('configPathsOf and assumedPaths', () => {
  it.each(PRESET_IDS)("are the family's pointers, and their assumed ones, on %s", (id) => {
    const cfg = cfgOf(id)
    for (const spec of catalogSpecs(cfg)) {
      const paths = configPathsOf(spec, cfg)
      const assumed = assumedPaths(spec, cfg)
      expect(paths.length).toBeGreaterThan(0)
      for (const path of assumed) {
        expect(paths).toContain(path)
        const below = Object.entries(cfg.provenance).some(
          ([pointer, entry]) => pointer.startsWith(`${path}/`) && entry.status === 'assumed',
        )
        expect(statusAt(cfg.provenance, path) === 'assumed' || below, path).toBe(true)
      }
    }
  })

  it("flags crapless place 2's 11:2, which no Interblock source confirms", () => {
    const cfg = cfgOf('craplessBubble')
    expect(assumedPaths({ typeId: 'place', number: 2 }, cfg)).toContain('/catalog/place/pays/2')
  })
})

describe('efficientAmounts', () => {
  it('scans the edge stake by stake: place 6 floored to the penny is cheapest at $3 and $6', () => {
    const scan = efficientAmounts({ typeId: 'place', number: 6 }, cfgOf('craplessBubble'), {
      from: 100,
      to: 600,
    })
    expect(scan.map(({ amount }) => amount)).toEqual([100, 200, 300, 400, 500, 600])
    expect(scan[0]?.edge.toString()).toBe('1/55')
    expect(scan[2]?.edge.toString()).toBe('1/66')
    expect(scan[4]?.edge.toString()).toBe('17/1100')
    expect(scan[5]?.edge.toString()).toBe('1/66')
  })
})

describe('combinedEdge', () => {
  it('spreads the flat loss over the odds wagered, which add no loss at true odds', () => {
    const cfg = cfgOf('craplessBubble')
    const max = combinedEdge({ typeId: 'pass', number: null }, cents(1_000), cfg)
    expect(max.edge.toString()).toBe('373/18480')
    expect(max.odds).toHaveLength(10)
    expect(max.odds.every(({ amount }) => amount === 2_000)).toBe(true)
    // With 1x odds: (373/6930) / (1 + 5/6).
    const single = combinedEdge({ typeId: 'pass', number: null }, cents(1_000), cfg, () =>
      cents(1_000),
    )
    expect(single.edge.toString()).toBe(Fraction.of(373, 6930).div(Fraction.of(11, 6)).toString())
  })
})
