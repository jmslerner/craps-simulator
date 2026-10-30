import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../engine/config/presets/index.ts'
import { pruneProvenance, statusAt } from '../engine/config/provenance.ts'
import type { MachineConfigInput } from '../engine/config/schema.ts'
import { cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import { legalBets } from '../engine/bets/legal.ts'
import { betId, type BetInstance } from '../engine/bets/types.ts'
import { newTable, type TableState } from '../engine/table/state.ts'
import {
  analyzeBet,
  assumedPaths,
  attainableOdds,
  combinedEdge,
  configPathsOf,
  efficientAmounts,
} from './analyze.ts'
import { catalogSpecs } from './catalog.ts'
import { ExactError, roundAt } from './chain.ts'

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

  it('adds the round pointers for π-weighted starts, and only those (M5/M6 audit)', () => {
    const cfg = cfgOf('craplessBubble')
    // π-weighted: number bets, hardways, come-type odds — their chances read the variant's round.
    for (const spec of [
      { typeId: 'place', number: 6 },
      { typeId: 'hard', number: 6 },
      { typeId: 'comeOdds', number: 4 },
      { typeId: 'come', number: null },
    ] as const) {
      const paths = configPathsOf(spec, cfg)
      for (const pointer of ['/variant', '/rules/naturals', '/rules/craps', '/rules/points']) {
        expect(paths, `${spec.typeId} ${String(spec.number)}`).toContain(pointer)
      }
    }
    // Fixed-phase starts stay as the family lists them: pass odds sit on one point, and a
    // one-roll bet has no phase at all.
    expect(configPathsOf({ typeId: 'passOdds', number: 4 }, cfg)).not.toContain('/variant')
    expect(configPathsOf({ typeId: 'field', number: null }, cfg)).not.toContain('/variant')
    // A put spec reads /rules/allowPutBets: it decides whether the lifecycle is one decision.
    expect(configPathsOf({ typeId: 'pass', number: 4 }, cfgOf('traditionalLive345'))).toContain(
      '/rules/allowPutBets',
    )
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

  it("prices only odds the machine accepts: a $300 crapless flat's odds cap at the $500 maximum", () => {
    // The 2x cap would allow $600, but the per-bet maximum is $500, so the attainable combined
    // edge is (300 × 373/6930) ÷ (300 + 500 × 30/36) = 373/16555, not 373/18480's scaling
    // (M5/M6 audit: 2.2531% displayed, not 2.0184%).
    const cfg = cfgOf('craplessBubble')
    const flat300 = combinedEdge({ typeId: 'pass', number: null }, cents(30_000), cfg)
    expect(flat300.odds.every(({ amount }) => amount === 50_000)).toBe(true)
    expect(flat300.edge.toString()).toBe(Fraction.of(373, 16555).toString())
    expect(flat300.edge.formatPercent(4)).toBe('2.2531')
    const flat500 = combinedEdge({ typeId: 'pass', number: null }, cents(50_000), cfg)
    expect(flat500.edge.toString()).toBe(Fraction.of(373, 12705).toString())
    expect(flat500.edge.formatPercent(4)).toBe('2.9359')
    // The flat's own dollar loss never changes with the odds.
    expect(flat500.flatLoss.toString()).toBe(Fraction.of(50_000).mul(Fraction.of(373, 6930)).toString())
  })

  it('counts the loss of short-paid odds: Shoot To Win lay odds floored to the cent', () => {
    // A $1 don't pass takes $2 lay odds on every point (2x, stake basis). On 5/9 they pay 2:3
    // ($1.33, losing 1/3¢ to the floor with P = 3/5) and on 6/8 5:6 ($1.66, 2/3¢ at P = 6/11):
    // oddsLoss = 2 × (1/9)(3/5)(1/3) + 2 × (5/36)(6/11)(2/3) = 8/55¢, and the combined edge is
    // ((100 × 3/220) + 8/55) ÷ (100 + 200 × 2/3) = 249/38500.
    const dontPass = combinedEdge(
      { typeId: 'dontPass', number: null },
      cents(100),
      cfgOf('traditionalBubble'),
    )
    expect(dontPass.odds.every(({ amount }) => amount === 200)).toBe(true)
    expect(dontPass.oddsLoss.toString()).toBe(Fraction.of(8, 55).toString())
    expect(dontPass.oddsWagered.toString()).toBe(Fraction.of(400, 3).toString())
    expect(dontPass.edge.toString()).toBe(Fraction.of(249, 38500).toString())
  })

  it.each(['craplessBubble', 'craplessBubbleHighLimit', 'traditionalLive345'] as const)(
    'places exactly what a dry-run table accepts behind the flat on %s',
    (id) => {
      const cfg = cfgOf(id)
      const oddsId = cfg.oddsFor.get('pass')
      if (oddsId === undefined) throw new Error('no pass odds')
      const flats = [
        cfg.limits.byType.get('pass')?.min ?? cfg.limits.min,
        30_000,
        cfg.limits.byType.get('pass')?.max ?? cfg.limits.max,
      ]
      for (const flat of flats) {
        for (const n of cfg.ruleset.points) {
          const parent: BetInstance = {
            id: betId(1),
            typeId: 'pass',
            number: n,
            parentId: null,
            amount: cents(flat),
            vigHeld: cents(0),
            working: null,
            progress: 0,
            placedAtRoll: 0,
          }
          const base = newTable(cfg, 'attainable-odds')
          const state: TableState = {
            ...base,
            round: roundAt({ kind: 'point', point: n }),
            bets: [parent],
            nextBetSeq: 2,
            ledger: {
              ...base.ledger,
              deposits: cents(1_000_000_000),
              bankroll: cents(1_000_000_000),
            },
          }
          const spot = legalBets(state, cfg).find(
            (bet) => bet.typeId === oddsId && bet.parentId === parent.id,
          )
          if (spot === undefined) throw new Error(`no ${oddsId} spot on ${n}`)
          const attainable = attainableOdds({ typeId: 'pass', number: null }, cents(flat), oddsId, n, cfg)
          expect(attainable, `${id} $${flat / 100} flat on ${n}`).toBe(
            spot.canAdd === null ? spot.maxAdd : 0,
          )
        }
      }
    },
  )
})
